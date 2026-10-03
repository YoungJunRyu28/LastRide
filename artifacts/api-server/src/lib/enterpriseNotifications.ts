import { and, asc, eq, gt, gte, isNotNull, isNull, lte } from "drizzle-orm";
import {
  enterpriseEventsTable,
  eventParticipantsTable,
  getDb,
  hostDevicesTable,
  notificationDeliveriesTable,
} from "@workspace/db";
import { logger } from "./logger";

export type EnterpriseNotificationKind = "leaving_soon" | "leave_now";

const MINUTE_MS = 60_000;
const MAX_ALERT_WINDOW_MS = 120 * MINUTE_MS;
const LEAVE_NOW_GRACE_MS = 10 * MINUTE_MS;
const RECEIPT_DELAY_MS = 15 * MINUTE_MS;
const RECEIPT_BATCH_SIZE = 100;
const SEND_CONCURRENCY = 10;
const MAX_RECEIPT_AGE_MS = 24 * 60 * MINUTE_MS;

type ExpoPushSendResult =
  | { accepted: true; ticketId: string }
  | { accepted: false; error: string | null };

type ExpoPushReceipt = {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

export function expoReceiptError(receipt: ExpoPushReceipt): string | null {
  if (receipt.status !== "error") return null;
  return receipt.details?.error || receipt.message || "UnknownPushError";
}

export function notificationKindFor(
  leaveByMs: number,
  alertLeadMinutes: number,
  nowMs: number,
): EnterpriseNotificationKind | null {
  const untilLeave = leaveByMs - nowMs;
  if (untilLeave <= 0 && untilLeave >= -LEAVE_NOW_GRACE_MS) {
    return "leave_now";
  }
  if (untilLeave > 0 && untilLeave <= alertLeadMinutes * MINUTE_MS) {
    return "leaving_soon";
  }
  return null;
}

function formatJstTime(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

async function sendExpoPush(input: {
  token: string;
  displayName: string;
  leaveBy: Date;
  kind: EnterpriseNotificationKind;
  eventId: string;
}): Promise<ExpoPushSendResult> {
  const time = formatJstTime(input.leaveBy);
  const includeName = process.env.ENTERPRISE_PUSH_INCLUDE_NAME === "true";
  const subject = includeName ? input.displayName : "A participant";
  const title =
    input.kind === "leave_now"
      ? `${subject} — time to leave`
      : `${subject} should leave soon`;
  const body =
    input.kind === "leave_now"
      ? `LastRide departure time is now (${time}).`
      : `LastRide departure time is ${time}.`;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: input.token,
        sound: "default",
        title,
        body,
        priority: "high",
        data: {
          target: "/business-event",
          eventId: input.eventId,
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { accepted: false, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      data?:
        | {
            status?: string;
            id?: string;
            message?: string;
            details?: { error?: string };
          }
        | Array<{
            status?: string;
            id?: string;
            message?: string;
            details?: { error?: string };
          }>;
    };
    const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (ticket?.status === "ok" && typeof ticket.id === "string") {
      return { accepted: true, ticketId: ticket.id };
    }
    return {
      accepted: false,
      error: ticket?.details?.error || ticket?.message || null,
    };
  } catch (err) {
    logger.warn({ err }, "Enterprise push request failed");
    return { accepted: false, error: null };
  }
}

export async function dispatchEnterpriseDepartureAlerts(
  now = new Date(),
): Promise<number> {
  const db = getDb();
  const upperBound = new Date(now.getTime() + MAX_ALERT_WINDOW_MS);
  const lowerBound = new Date(now.getTime() - LEAVE_NOW_GRACE_MS);

  const candidates = await db
    .select({
      participantId: eventParticipantsTable.id,
      displayName: eventParticipantsTable.displayName,
      leaveBy: eventParticipantsTable.leaveBy,
      eventId: enterpriseEventsTable.id,
      alertLeadMinutes: enterpriseEventsTable.alertLeadMinutes,
      hostDeviceId: hostDevicesTable.id,
      expoPushToken: hostDevicesTable.expoPushToken,
    })
    .from(eventParticipantsTable)
    .innerJoin(
      enterpriseEventsTable,
      eq(eventParticipantsTable.eventId, enterpriseEventsTable.id),
    )
    .innerJoin(
      hostDevicesTable,
      eq(
        hostDevicesTable.organizationMemberId,
        enterpriseEventsTable.createdByMemberId,
      ),
    )
    .where(
      and(
        eq(eventParticipantsTable.status, "active"),
        eq(enterpriseEventsTable.status, "active"),
        gt(enterpriseEventsTable.expiresAt, now),
        isNotNull(eventParticipantsTable.leaveBy),
        gte(eventParticipantsTable.leaveBy, lowerBound),
        lte(eventParticipantsTable.leaveBy, upperBound),
      ),
    );

  let sent = 0;
  for (let offset = 0; offset < candidates.length; offset += SEND_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (candidate) => {
        if (!candidate.leaveBy) return 0;
        const kind = notificationKindFor(
          candidate.leaveBy.getTime(),
          candidate.alertLeadMinutes,
          now.getTime(),
        );
        if (!kind) return 0;

        const [reservation] = await db
          .insert(notificationDeliveriesTable)
          .values({
            participantId: candidate.participantId,
            hostDeviceId: candidate.hostDeviceId,
            kind,
          })
          .onConflictDoNothing()
          .returning({ id: notificationDeliveriesTable.id });
        if (!reservation) return 0;

        const delivery = await sendExpoPush({
          token: candidate.expoPushToken,
          displayName: candidate.displayName,
          leaveBy: candidate.leaveBy,
          kind,
          eventId: candidate.eventId,
        });

        if (delivery.accepted) {
          await db
            .update(notificationDeliveriesTable)
            .set({ sentAt: new Date(), expoTicketId: delivery.ticketId })
            .where(eq(notificationDeliveriesTable.id, reservation.id));
          return 1;
        }
        if (delivery.error === "DeviceNotRegistered") {
          await db
            .delete(hostDevicesTable)
            .where(eq(hostDevicesTable.id, candidate.hostDeviceId));
        } else {
          // No ticket means the push was not accepted. Remove the reservation so
          // the next worker pass can retry transient failures.
          await db
            .delete(notificationDeliveriesTable)
            .where(eq(notificationDeliveriesTable.id, reservation.id));
        }
        return 0;
      }),
    );
    sent += results.reduce((total, value) => total + value, 0);
  }

  return sent;
}

export async function reconcileEnterprisePushReceipts(
  now = new Date(),
): Promise<{ checked: number; invalidDevices: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - RECEIPT_DELAY_MS);
  const pending = await db
    .select({
      deliveryId: notificationDeliveriesTable.id,
      hostDeviceId: notificationDeliveriesTable.hostDeviceId,
      expoTicketId: notificationDeliveriesTable.expoTicketId,
      sentAt: notificationDeliveriesTable.sentAt,
    })
    .from(notificationDeliveriesTable)
    .where(
      and(
        isNotNull(notificationDeliveriesTable.sentAt),
        isNotNull(notificationDeliveriesTable.expoTicketId),
        isNull(notificationDeliveriesTable.receiptCheckedAt),
        lte(notificationDeliveriesTable.sentAt, cutoff),
      ),
    )
    .orderBy(asc(notificationDeliveriesTable.sentAt))
    .limit(RECEIPT_BATCH_SIZE);

  const ids = pending
    .map(({ expoTicketId }) => expoTicketId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { checked: 0, invalidDevices: 0 };

  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Expo receipt request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: Record<string, ExpoPushReceipt>;
  };
  let checked = 0;
  let invalidDevices = 0;
  for (const row of pending) {
    if (!row.expoTicketId) continue;
    const receipt = payload.data?.[row.expoTicketId];
    if (!receipt) {
      if (row.sentAt && now.getTime() - row.sentAt.getTime() >= MAX_RECEIPT_AGE_MS) {
        await db
          .update(notificationDeliveriesTable)
          .set({ receiptCheckedAt: now, receiptError: "ReceiptUnavailable" })
          .where(eq(notificationDeliveriesTable.id, row.deliveryId));
        checked += 1;
      }
      continue;
    }

    const error = expoReceiptError(receipt);
    if (error === "DeviceNotRegistered") {
      await db
        .delete(hostDevicesTable)
        .where(eq(hostDevicesTable.id, row.hostDeviceId));
      checked += 1;
      invalidDevices += 1;
      continue;
    }

    await db
      .update(notificationDeliveriesTable)
      .set({
        receiptCheckedAt: now,
        receiptError: error,
      })
      .where(eq(notificationDeliveriesTable.id, row.deliveryId));
    checked += 1;
  }

  return { checked, invalidDevices };
}
