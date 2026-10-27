/**
 * Expo push for persistent groups. Messages are purely operational (tonight
 * started / a member's leave time). Never put promotions, upsells or
 * marketing copy in these: they go to members who never paid for anything.
 */
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { getDb, groupMembersTable } from "@workspace/db";
import { EXPO_PUSH_BATCH_SIZE } from "./enterpriseNotifications";
import { logger } from "./logger";
import { claimDueGroupLeaveAlerts } from "./groupStore";
import { claimGroupDeliveryBatch, settleGroupDelivery } from "./groupAlertOutbox";

export type GroupLanguage = "ja" | "en";

export type GroupPushRecipient = {
  memberId: string;
  expoPushToken: string;
  language: GroupLanguage;
};

export type GroupPushEvent =
  | { kind: "tonight_started"; groupName: string }
  | { kind: "leave_time"; groupName: string; displayName: string; leaveBy: Date };

export type GroupPushMessage = {
  to: string;
  sound: "default";
  body: string;
  priority: "high";
  data: { target: "/groups"; groupId: string; kind: GroupPushEvent["kind"] };
};

function formatJstTime(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function groupPushBody(
  event: GroupPushEvent,
  language: GroupLanguage,
): string {
  switch (event.kind) {
    case "tonight_started":
      return language === "en"
        ? `${event.groupName}: The host started tonight's meetup`
        : `${event.groupName}: ホストが今夜の共有を開始しました`;
    case "leave_time": {
      const time = formatJstTime(event.leaveBy);
      return language === "en"
        ? `${event.groupName}: time for ${event.displayName} to leave (${time})`
        : `${event.groupName}: ${event.displayName}さんの出発時刻です（${time}）`;
    }
  }
}

export function buildGroupPushMessages(
  groupId: string,
  event: GroupPushEvent,
  recipients: GroupPushRecipient[],
): GroupPushMessage[] {
  return recipients.map((recipient) => ({
    to: recipient.expoPushToken,
    sound: "default",
    body: groupPushBody(event, recipient.language),
    priority: "high",
    data: { target: "/groups", groupId, kind: event.kind },
  }));
}

type ExpoPushTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type GroupPushTicket = { ticketId: string } | { error: string };


/**
 * Sends best-effort pushes. Never throws: a push outage must not fail the
 * request that triggered it. Tokens Expo reports as DeviceNotRegistered are
 * removed from the member so we stop sending to them, and the member is marked
 * so the nightly cleanup removes them sooner if the app doesn't come back.
 */
/**
 * A silent push (no banner, sound or badge) telling a member's app that the
 * group changed, so an open app refreshes it at once instead of polling.
 */
export type GroupUpdatedMessage = {
  to: string;
  data: { kind: "group_updated"; groupId: string };
  _contentAvailable: true;
  priority: "normal";
};

export function buildGroupUpdatedMessages(
  groupId: string,
  tokens: string[],
): GroupUpdatedMessage[] {
  return tokens.map((to) => ({
    to,
    data: { kind: "group_updated", groupId },
    _contentAvailable: true,
    priority: "normal",
  }));
}

/**
 * Tells the group's other members' apps that something they see changed
 * (a leave time, who's in tonight, a member joining or leaving, a name).
 * Never throws. The database is already awake for the change itself.
 */
export async function notifyGroupUpdated(
  groupId: string,
  exceptMemberId: string | null,
): Promise<number> {
  try {
    const rows = await getDb()
      .select({ token: groupMembersTable.expoPushToken })
      .from(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          isNotNull(groupMembersTable.expoPushToken),
          ...(exceptMemberId ? [ne(groupMembersTable.id, exceptMemberId)] : []),
        ),
      );
    const tokens = rows.map((row) => row.token).filter((token): token is string => !!token);
    return await postExpoMessages(groupId, buildGroupUpdatedMessages(groupId, tokens));
  } catch (err) {
    logger.warn({ err }, "Failed to notify a group of an update");
    return 0;
  }
}

export async function sendGroupPush(
  groupId: string,
  event: GroupPushEvent,
  recipients: GroupPushRecipient[],
): Promise<number> {
  if (recipients.length === 0) return 0;
  return postExpoMessages(groupId, buildGroupPushMessages(groupId, event, recipients));
}

/**
 * Send one Expo batch and retain every recipient's individual acceptance
 * result. A successful HTTP status does not mean every push was accepted.
 */
async function postExpoTickets(messages: Array<{ to: string }>): Promise<GroupPushTicket[]> {
  if (messages.length === 0) return [];
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers, body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Group push batch rejected");
      return messages.map(() => ({ error: `HTTP ${response.status}` }));
    }
    const payload = (await response.json()) as { data?: ExpoPushTicket | ExpoPushTicket[] };
    const tickets = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
    return messages.map((_, index) => {
      const ticket = tickets[index];
      return ticket?.status === "ok" && typeof ticket.id === "string"
        ? { ticketId: ticket.id }
        : { error: ticket?.details?.error || ticket?.message || "MissingOrInvalidExpoTicket" };
    });
  } catch (err) {
    logger.warn({ err, batchSize: messages.length }, "Group push batch failed");
    return messages.map(() => ({ error: "ExpoNetworkError" }));
  }
}

/** Best-effort group-start and silent change notifications, separate from durable departure alerts. */
async function postExpoMessages(groupId: string, messages: Array<{ to: string }>): Promise<number> {
  let accepted = 0;
  const unregistered: string[] = [];
  for (let offset = 0; offset < messages.length; offset += EXPO_PUSH_BATCH_SIZE) {
    const batch = messages.slice(offset, offset + EXPO_PUSH_BATCH_SIZE);
    const results = await postExpoTickets(batch);
    results.forEach((result, index) => {
      if ("ticketId" in result) accepted += 1;
      else if (result.error === "DeviceNotRegistered") unregistered.push(batch[index].to);
    });
  }
  if (unregistered.length > 0) {
    try {
      await getDb().update(groupMembersTable)
        .set({ expoPushToken: null, pushTokenInvalidAt: new Date(), updatedAt: new Date() })
        .where(and(eq(groupMembersTable.groupId, groupId), inArray(groupMembersTable.expoPushToken, unregistered)));
    } catch (err) {
      logger.warn({ err }, "Failed to clear unregistered group push tokens");
    }
  }
  return accepted;
}

/**
 * Drain leased, per-device records. A failure for one device never prevents
 * accepted tickets for another device from being persisted. Missing/429/5xx
 * tickets are retried with bounded backoff while the alert remains timely.
 */
export async function dispatchGroupDeliveryOutbox(now = new Date()): Promise<number> {
  let accepted = 0;
  // The lease prevents concurrent processors from taking the same batch.
  // Bound per-run work to avoid unbounded serverless invocation duration.
  for (let round = 0; round < 5; round += 1) {
    const deliveries = await claimGroupDeliveryBatch(now);
    if (deliveries.length === 0) break;
    const messages = deliveries.map((delivery) => buildGroupPushMessages(
      delivery.groupId,
      { kind: "leave_time", groupName: delivery.groupName,
        displayName: delivery.displayName, leaveBy: delivery.leaveBy },
      [{ memberId: delivery.recipientMemberId, expoPushToken: delivery.token, language: delivery.language }],
    )[0]);
    const tickets = await postExpoTickets(messages);
    const settled = await Promise.allSettled(deliveries.map(async (delivery, index) => {
      const ticket = tickets[index] ?? { error: "MissingExpoTicket" };
      await settleGroupDelivery(delivery, ticket, now);
      return "ticketId" in ticket;
    }));
    for (const item of settled) {
      if (item.status === "fulfilled" && item.value) accepted += 1;
      if (item.status === "rejected") logger.error({ err: item.reason }, "Group push ticket write failed; lease will expire");
    }
    if (deliveries.length < EXPO_PUSH_BATCH_SIZE) break;
  }
  return accepted;
}

/**
 * Scheduled scan (runs with the enterprise departure alerts, every minute in
 * production): push "time to leave" for each tonight participant whose
 * leave-by has arrived. Returns the number of pushes Expo accepted.
 */
export async function dispatchGroupLeaveAlerts(
  now = new Date(),
): Promise<number> {
  // Enqueue and advance the once-per-leave-time marker in one DB transaction.
  // If a process exits at any later point, the next worker can drain rows.
  await claimDueGroupLeaveAlerts(now);
  return dispatchGroupDeliveryOutbox(now);
}
