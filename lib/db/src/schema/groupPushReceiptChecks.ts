import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { groupAlertDeliveriesTable } from "./groupAlertDeliveries";
import { groupMembersTable } from "./groups";

/**
 * Short-lived receipt-only journal. Deliberately NOT linked to group_nights:
 * nightly deletion must erase leave-by, names and group context immediately,
 * without preventing late Expo push failure checks. Nullify disappearing
 * member/delivery associations on deletion; no raw Expo push token is stored.
 */
export const groupPushReceiptChecksTable = pgTable("group_push_receipt_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  deliveryId: uuid("delivery_id").references(() => groupAlertDeliveriesTable.id, { onDelete: "set null" }),
  recipientMemberId: uuid("recipient_member_id").references(() => groupMembersTable.id, { onDelete: "set null" }),
  expoTicketId: varchar("expo_ticket_id", { length: 128 }).notNull(),
  pushTokenDigest: varchar("push_token_digest", { length: 64 }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("group_push_receipt_ticket_unique_idx").on(table.expoTicketId),
  index("group_push_receipt_sent_idx").on(table.sentAt),
  index("group_push_receipt_expires_idx").on(table.expiresAt),
]);
