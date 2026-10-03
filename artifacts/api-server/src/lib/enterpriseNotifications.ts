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
const MAX_RECEIPT_AGE_MS = 24 * 60 * MINUTE_MS;

// Expo accepts up to 100 messages per request and recommends no more than six
// concurrent connections. Six full batches also stay at the documented
// 600-notifications-per-second project limit.
export const EXPO_PUSH_BATCH_SIZE = 100;
const EXPO_MAX_CONCURRENT_BATCHES = 6;
const EXPO_RATE_WINDOW_MS = 1_100;
const RESERVATION_BATCH_SIZE = 500;

type ExpoPushInput = {
  token: string;
  displayName: string;
  leaveBy: Date;
  kind: EnterpriseNotificationKind;
  eventId: string;
};

type ExpoPushMessage = {
  to: string;
  sound: "default";
  title: string;
  body: string;
  priority: "high";
  data: {
    target: "/business-event";
    eventId: string;
  };
};

type ExpoPushTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushSendResult =
  | { accepted: true; ticketId: string }
  | { accepted: false; error: string | null };

type ExpoPushReceipt = {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

type PreparedDelivery = ExpoPushInput & {
  participantId: string;
  hostDeviceId: string;
  reservationId: string;
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

export function buildExpoPushMessage(input: ExpoPushInput): ExpoPushMessage {
  const time = formatJstTime(input.leaveBy);
  const includeName = process.env.ENTERPRISE_PUSH_INCLUDE_NAME === "true";
  const subject = includeName ? input.displayName : "A participant";
  const title =
    input.kind === "leave_now"
      ? subject + " — time to leave"
      : subject + " should leave soon";
  const body =
    input.kind === "leave_now"
      ? "LastRide departure time is now (" + time + ")."
      : "LastRide departure time is " + time + ".";

  return {
    to: input.token,
    sound: "default",
    title,
    body,
    priority: "high",
    data: {
      target: "/business-event",
      eventId: input.eventId,
    },
  };
}

function ticketResult(ticket: ExpoPushTicket | undefined): ExpoPushSendResult {
  if (ticket?.status === "ok" && typeof ticket.id === "string") {
    return { accepted: true, ticketId: ticket.id };
  }
  return {
    accepted: false,
    error:
      ticket?.details?.error ||
      ticket?.message ||
      (ticket ? "UnknownPushTicketError" : "MissingPushTicket"),
  };
}

export async function sendExpoPushBatch(
  inputs: ExpoPushInput[],
): Promise<ExpoPushSendResult[]> {
  if (inputs.length === 0) return [];
  if (inputs.length > EXPO_PUSH_BATCH_SIZE) {
    throw new Error(
      "Expo push batch exceeds " + EXPO_PUSH_BATCH_SIZE + " messages.",
    );
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = "Bearer " + accessToken;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(inputs.map(buildExpoPushMessage)),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return inputs.map(() => ({
        accepted: false as const,
        error: "HTTP " + response.status,
      }));
    }

    const payload = (await response.json()) as {
      data?: ExpoPushTicket | ExpoPushTicket[];
    };
    const tickets = Array.isArray(payload.data)
      ? payload.data
      : payload.data
        ? [payload.data]
        : [];
    return inputs.map((_, index) => ticketResult(tickets[index]));
  } catch (err) {
    logger.warn(
      { err, batchSize: inputs.length },
      "Enterprise push batch failed",
    );
    return inputs.map(() => ({ accepted: false as const, error: null }));
  }
}

function reservationKey(input: {
  participantId: string;
  hostDeviceId: string;
  kind: EnterpriseNotificationKind;
}): string {
  return input.participantId + ":" + input.hostDeviceId + ":" + input.kind;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const deliverable: Array<Omit<PreparedDelivery, "reservationId">> = [];
  for (const candidate of candidates) {
    if (!candidate.leaveBy) continue;
    const kind = notificationKindFor(
      candidate.leaveBy.getTime(),
      candidate.alertLeadMinutes,
      now.getTime(),
    );
    if (!kind) continue;
    deliverable.push({
      participantId: candidate.participantId,
      hostDeviceId: candidate.hostDeviceId,
      token: candidate.expoPushToken,
      displayName: candidate.displayName,
      leaveBy: candidate.leaveBy,
      kind,
      eventId: candidate.eventId,
    });
  }
  if (deliverable.length === 0) return 0;

  // Reserve every participant/device/kind before talking to Expo. A unique
  // constraint makes concurrent scheduled invocations collapse to one sender.
  const reservedByKey = new Map<string, string>();
  for (const reservationBatch of chunks(deliverable, RESERVATION_BATCH_SIZE)) {
    const reservations = await db
      .insert(notificationDeliveriesTable)
      .values(
        reservationBatch.map((candidate) => ({
          participantId: candidate.participantId,
          hostDeviceId: candidate.hostDeviceId,
          kind: candidate.kind,
        })),
      )
      .onConflictDoNothing()
      .returning({
        id: notificationDeliveriesTable.id,
        participantId: notificationDeliveriesTable.participantId,
        hostDeviceId: notificationDeliveriesTable.hostDeviceId,
        kind: notificationDeliveriesTable.kind,
      });

    for (const reservation of reservations) {
      reservedByKey.set(reservationKey(reservation), reservation.id);
    }
  }

  const prepared: PreparedDelivery[] = [];
  for (const candidate of deliverable) {
    const reservationId = reservedByKey.get(reservationKey(candidate));
    if (reservationId) prepared.push({ ...candidate, reservationId });
  }
  if (prepared.length === 0) return 0;

  let sent = 0;
  const rateWindowSize = EXPO_PUSH_BATCH_SIZE * EXPO_MAX_CONCURRENT_BATCHES;

  for (
    let windowOffset = 0;
    windowOffset < prepared.length;
    windowOffset += rateWindowSize
  ) {
    const window = prepared.slice(windowOffset, windowOffset + rateWindowSize);
    const batches = chunks(window, EXPO_PUSH_BATCH_SIZE);

    const batchResults = await Promise.all(
      batches.map(async (batch) => ({
        batch,
        results: await sendExpoPushBatch(batch),
      })),
    );

    for (const { batch, results } of batchResults) {
      const writes = batch.map(async (candidate, index) => {
        const delivery = results[index] ?? {
          accepted: false as const,
          error: "MissingPushTicket",
        };

        if (delivery.accepted) {
          await db
            .update(notificationDeliveriesTable)
            .set({
              sentAt: new Date(),
              expoTicketId: delivery.ticketId,
            })
            .where(eq(notificationDeliveriesTable.id, candidate.reservationId));
          return 1;
        }

        if (delivery.error === "DeviceNotRegistered") {
          await db
            .delete(hostDevicesTable)
            .where(eq(hostDevicesTable.id, candidate.hostDeviceId));
        } else {
          // No accepted ticket means the reservation can be retried by the
          // next scheduled pass. A network/429/5xx failure therefore gets an
          // automatic ~1 minute backoff instead of blocking this invocation.
          await db
            .delete(notificationDeliveriesTable)
            .where(eq(notificationDeliveriesTable.id, candidate.reservationId));
        }
        return 0;
      });
      const writeResults = await Promise.all(writes);
      sent += writeResults.reduce((total, value) => total + value, 0);
    }

    if (windowOffset + rateWindowSize < prepared.length) {
      await delay(EXPO_RATE_WINDOW_MS);
    }
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

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = "Bearer " + accessToken;

  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers,
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error("Expo receipt request failed with HTTP " + response.status);
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
      if (
        row.sentAt &&
        now.getTime() - row.sentAt.getTime() >= MAX_RECEIPT_AGE_MS
      ) {
        await db
          .update(notificationDeliveriesTable)
          .set({
            receiptCheckedAt: now,
            receiptError: "ReceiptUnavailable",
          })
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
