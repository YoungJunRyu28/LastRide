/**
 * Durable, per-recipient consumer group departure alerts.
 *
 * A claim enqueues recipients in the same transaction as leaveAlertSentFor;
 * this worker leases the records and updates each ticket independently.
 * Without device receipts delivery is not guaranteed; accepted tickets
 * still need receipt reconciliation. Retry after a worker crash is at-least-
 * once, so a duplicate push remains possible in the ambiguous crash window.
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, min, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  getDb, groupAlertDeliveriesTable, groupMembersTable, groupNightParticipantsTable,
  groupNightsTable, groupsTable,
} from "@workspace/db";
import { GROUP_LEAVE_ALERT_GRACE_MS } from "./groupStore";
import { logger } from "./logger";

const BATCH_SIZE = 100;
const LEASE_MS = 45_000;
const RETRY_START_MS = 30_000;
const RECEIPT_DELAY_MS = 15 * 60_000;
const RECEIPT_BATCH_SIZE = 100;

const recipientMember = alias(groupMembersTable, "recipient_member");

export type PendingGroupDelivery = {
  id: string;
  groupId: string;
  groupName: string;
  displayName: string;
  leaveBy: Date;
  recipientMemberId: string;
  token: string;
  language: "ja" | "en";
  attempts: number;
};

/**
 * Returns rows with a short database lease. FOR UPDATE SKIP LOCKED avoids
 * duplicate work under concurrent Lambdas; the expiry resumes crashed jobs.
 */
export async function claimGroupDeliveryBatch(now = new Date()): Promise<PendingGroupDelivery[]> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - GROUP_LEAVE_ALERT_GRACE_MS);
  return db.transaction(async (tx) => {
    const rows = await tx.select({
      id: groupAlertDeliveriesTable.id,
      groupId: groupsTable.id,
      groupName: groupsTable.name,
      displayName: groupMembersTable.displayName,
      leaveBy: groupAlertDeliveriesTable.leaveBy,
      recipientMemberId: recipientMember.id,
      token: recipientMember.expoPushToken,
      language: recipientMember.language,
      attempts: groupAlertDeliveriesTable.attempts,
    })
      .from(groupAlertDeliveriesTable)
      .innerJoin(groupNightsTable, eq(groupAlertDeliveriesTable.nightId, groupNightsTable.id))
      .innerJoin(groupsTable, eq(groupNightsTable.groupId, groupsTable.id))
      .innerJoin(groupMembersTable, eq(groupAlertDeliveriesTable.senderMemberId, groupMembersTable.id))
      .innerJoin(recipientMember, eq(groupAlertDeliveriesTable.recipientMemberId, recipientMember.id))
      .innerJoin(groupNightParticipantsTable, and(
        eq(groupNightParticipantsTable.nightId, groupAlertDeliveriesTable.nightId),
        eq(groupNightParticipantsTable.memberId, groupAlertDeliveriesTable.senderMemberId),
        eq(groupNightParticipantsTable.leaveBy, groupAlertDeliveriesTable.leaveBy),
      ))
      .where(and(
        isNull(groupAlertDeliveriesTable.sentAt),
        lte(groupAlertDeliveriesTable.nextAttemptAt, now),
        or(isNull(groupAlertDeliveriesTable.leaseExpiresAt), lte(groupAlertDeliveriesTable.leaseExpiresAt, now)),
        gt(groupNightsTable.endsAt, now),
        gte(groupAlertDeliveriesTable.leaveBy, cutoff),
        lte(groupAlertDeliveriesTable.leaveBy, now),
        eq(recipientMember.leaveTimeAlerts, true),
        isNotNull(recipientMember.expoPushToken),
      ))
      .orderBy(asc(groupAlertDeliveriesTable.nextAttemptAt))
      .limit(BATCH_SIZE)
      .for("update", { of: groupAlertDeliveriesTable, skipLocked: true });
    if (rows.length === 0) return [];
    await tx.update(groupAlertDeliveriesTable).set({
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: sql`${groupAlertDeliveriesTable.attempts} + 1`,
    }).where(inArray(groupAlertDeliveriesTable.id, rows.map((row) => row.id)));
    return rows.filter((row): row is PendingGroupDelivery => row.token !== null)
      .map((row) => ({ ...row, attempts: row.attempts + 1 }));
  });
}

export function nextGroupDeliveryRetryDelay(attempts: number): number {
  return Math.min(5 * 60_000, RETRY_START_MS * 2 ** Math.min(4, Math.max(0, attempts - 1)));
}

/** Mark an Expo ticket accepted or schedule an individual retry. */
export async function settleGroupDelivery(
  delivery: PendingGroupDelivery,
  result: { ticketId: string } | { error: string },
  now = new Date(),
): Promise<void> {
  const accepted = "ticketId" in result;
  await getDb().update(groupAlertDeliveriesTable)
    .set(accepted
      ? {
          sentAt: now, expoTicketId: result.ticketId, pushTokenUsed: delivery.token,
          leaseExpiresAt: null,
        }
      : {
          leaseExpiresAt: null,
          nextAttemptAt: new Date(now.getTime() + nextGroupDeliveryRetryDelay(delivery.attempts)),
          receiptError: result.error.slice(0, 128),
        })
    .where(and(
      eq(groupAlertDeliveriesTable.id, delivery.id),
      isNull(groupAlertDeliveriesTable.sentAt),
    ));
  if (!accepted && result.error === "DeviceNotRegistered") {
    // The token can rotate while Expo is processing the ticket. Never revoke
    // a newer token for the same anonymous group member.
    await getDb().update(groupMembersTable)
      .set({ expoPushToken: null, pushTokenInvalidAt: now, updatedAt: now })
      .where(and(eq(groupMembersTable.id, delivery.recipientMemberId), eq(groupMembersTable.expoPushToken, delivery.token)));
  }
}

/** An earlier scheduled job cannot be forgotten after a crash. */
export async function nextGroupOutboxRetryAt(now = new Date()): Promise<Date | null> {
  const db = getDb();
  const [row] = await db.select({
    next: min(sql<Date>`greatest(${groupAlertDeliveriesTable.nextAttemptAt},
      coalesce(${groupAlertDeliveriesTable.leaseExpiresAt}, ${groupAlertDeliveriesTable.nextAttemptAt}))`),
  })
    .from(groupAlertDeliveriesTable)
    .innerJoin(groupNightsTable, eq(groupAlertDeliveriesTable.nightId, groupNightsTable.id))
    .innerJoin(recipientMember, eq(groupAlertDeliveriesTable.recipientMemberId, recipientMember.id))
    .innerJoin(groupNightParticipantsTable, and(
      eq(groupNightParticipantsTable.nightId, groupAlertDeliveriesTable.nightId),
      eq(groupNightParticipantsTable.memberId, groupAlertDeliveriesTable.senderMemberId),
      eq(groupNightParticipantsTable.leaveBy, groupAlertDeliveriesTable.leaveBy),
    ))
    .where(and(
      isNull(groupAlertDeliveriesTable.sentAt),
      gt(groupNightsTable.endsAt, now),
      gte(groupAlertDeliveriesTable.leaveBy, new Date(now.getTime() - GROUP_LEAVE_ALERT_GRACE_MS)),
      lte(groupAlertDeliveriesTable.leaveBy, now),
      isNotNull(recipientMember.expoPushToken),
      eq(recipientMember.leaveTimeAlerts, true),
    ));
  return row?.next ? new Date(row.next) : null;
}

export type GroupPushReceipt = { status?: "ok" | "error"; details?: { error?: string }; message?: string };

export function receiptFailure(receipt: GroupPushReceipt): string | null {
  return receipt.status === "error" ? (receipt.details?.error || receipt.message || "UnknownPushError") : null;
}

/** Receipts are checked only for successfully accepted Expo tickets. */
export async function reconcileGroupPushReceipts(now = new Date()): Promise<{ checked: number; invalidDevices: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - RECEIPT_DELAY_MS);
  const pending = await db.select({
    id: groupAlertDeliveriesTable.id,
    recipientMemberId: groupAlertDeliveriesTable.recipientMemberId,
    tokenUsed: groupAlertDeliveriesTable.pushTokenUsed,
    expoTicketId: groupAlertDeliveriesTable.expoTicketId,
  }).from(groupAlertDeliveriesTable).where(and(
    isNotNull(groupAlertDeliveriesTable.sentAt),
    lte(groupAlertDeliveriesTable.sentAt, cutoff),
    isNotNull(groupAlertDeliveriesTable.expoTicketId),
    isNull(groupAlertDeliveriesTable.receiptCheckedAt),
  )).limit(RECEIPT_BATCH_SIZE);
  if (pending.length === 0) return { checked: 0, invalidDevices: 0 };

  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST", headers,
    body: JSON.stringify({ ids: pending.map((p) => p.expoTicketId) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Group push receipt HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Record<string, GroupPushReceipt> };
  const receipts = payload.data ?? {};
  let checked = 0;
  let invalidDevices = 0;
  for (const delivery of pending) {
    const receipt = delivery.expoTicketId ? receipts[delivery.expoTicketId] : undefined;
    if (!receipt) continue; // Expo can return a missing receipt until it arrives.
    const error = receiptFailure(receipt);
    await db.update(groupAlertDeliveriesTable).set({
      receiptCheckedAt: now,
      receiptError: error?.slice(0, 128) ?? null,
    }).where(eq(groupAlertDeliveriesTable.id, delivery.id));
    checked += 1;
    if (error === "DeviceNotRegistered" && delivery.tokenUsed) {
      const updated = await db.update(groupMembersTable).set({
        expoPushToken: null, pushTokenInvalidAt: now, updatedAt: now,
      }).where(and(
        eq(groupMembersTable.id, delivery.recipientMemberId),
        eq(groupMembersTable.expoPushToken, delivery.tokenUsed),
      )).returning({ id: groupMembersTable.id });
      invalidDevices += updated.length;
    } else if (error) logger.warn({ deliveryId: delivery.id, error }, "Group push receipt reported delivery error");
  }
  return { checked, invalidDevices };
}
