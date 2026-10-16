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
        : `${event.groupName}: ホストが今夜の会を始めました`;
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
  details?: { error?: string };
};

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

/** Sends to Expo in batches; clears tokens Expo reports as DeviceNotRegistered. */
async function postExpoMessages(
  groupId: string,
  messages: Array<{ to: string }>,
): Promise<number> {
  if (messages.length === 0) return 0;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = "Bearer " + accessToken;

  let accepted = 0;
  const unregistered: string[] = [];

  for (
    let offset = 0;
    offset < messages.length;
    offset += EXPO_PUSH_BATCH_SIZE
  ) {
    const batch = messages.slice(offset, offset + EXPO_PUSH_BATCH_SIZE);
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "Group push batch rejected");
        continue;
      }
      const payload = (await response.json()) as {
        data?: ExpoPushTicket | ExpoPushTicket[];
      };
      const tickets = Array.isArray(payload.data)
        ? payload.data
        : payload.data
          ? [payload.data]
          : [];
      batch.forEach((message, index) => {
        const ticket = tickets[index];
        if (ticket?.status === "ok") accepted += 1;
        else if (ticket?.details?.error === "DeviceNotRegistered") {
          unregistered.push(message.to);
        }
      });
    } catch (err) {
      logger.warn({ err, batchSize: batch.length }, "Group push batch failed");
    }
  }

  if (unregistered.length > 0) {
    try {
      await getDb()
        .update(groupMembersTable)
        .set({ expoPushToken: null, pushTokenInvalidAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(groupMembersTable.groupId, groupId),
            inArray(groupMembersTable.expoPushToken, unregistered),
          ),
        );
    } catch (err) {
      logger.warn({ err }, "Failed to clear unregistered group push tokens");
    }
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
  const alerts = await claimDueGroupLeaveAlerts(now);
  let sent = 0;
  for (const alert of alerts) {
    sent += await sendGroupPush(
      alert.groupId,
      {
        kind: "leave_time",
        groupName: alert.groupName,
        displayName: alert.displayName,
        leaveBy: alert.leaveBy,
      },
      alert.recipients,
    );
  }
  return sent;
}
