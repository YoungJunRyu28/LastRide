import { and, eq, gt, gte, isNotNull, lte } from "drizzle-orm";
import {
  enterpriseEventsTable,
  eventParticipantsTable,
  getDb,
  hostDevicesTable,
  notificationDeliveriesTable,
  organizationMembersTable,
} from "@workspace/db";
import { logger } from "./logger";

export type EnterpriseNotificationKind = "leaving_soon" | "leave_now";

const MINUTE_MS = 60_000;
const MAX_ALERT_WINDOW_MS = 120 * MINUTE_MS;
const LEAVE_NOW_GRACE_MS = 10 * MINUTE_MS;

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
}): Promise<boolean> {
  const time = formatJstTime(input.leaveBy);
  const title =
    input.kind === "leave_now"
      ? `${input.displayName} — time to leave`
      : `${input.displayName} should leave soon`;
  const body =
    input.kind === "leave_now"
      ? `Their LastRide departure time is now (${time}).`
      : `Their LastRide departure time is ${time}.`;

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
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      data?: { status?: string } | Array<{ status?: string }>;
    };
    const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    return ticket?.status === "ok";
  } catch (err) {
    logger.warn({ err }, "Enterprise push request failed");
    return false;
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
      organizationMembersTable,
      eq(
        organizationMembersTable.organizationId,
        enterpriseEventsTable.organizationId,
      ),
    )
    .innerJoin(
      hostDevicesTable,
      eq(hostDevicesTable.organizationMemberId, organizationMembersTable.id),
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
  for (const candidate of candidates) {
    if (!candidate.leaveBy) continue;
    const kind = notificationKindFor(
      candidate.leaveBy.getTime(),
      candidate.alertLeadMinutes,
      now.getTime(),
    );
    if (!kind) continue;

    const [reservation] = await db
      .insert(notificationDeliveriesTable)
      .values({
        participantId: candidate.participantId,
        hostDeviceId: candidate.hostDeviceId,
        kind,
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveriesTable.id });
    if (!reservation) continue;

    const delivered = await sendExpoPush({
      token: candidate.expoPushToken,
      displayName: candidate.displayName,
      leaveBy: candidate.leaveBy,
      kind,
      eventId: candidate.eventId,
    });

    if (delivered) {
      await db
        .update(notificationDeliveriesTable)
        .set({ sentAt: new Date() })
        .where(eq(notificationDeliveriesTable.id, reservation.id));
      sent += 1;
    } else {
      await db
        .delete(notificationDeliveriesTable)
        .where(eq(notificationDeliveriesTable.id, reservation.id));
    }
  }

  return sent;
}
