import { integer, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { groupMembersTable, groupNightsTable } from "./groups";

/**
 * One durable departure-alert delivery per recipient and exact leave-by time.
 * Group nights are erased at 08:00 JST; the CASCADE removes these delivery
 * rows (including any trip-derived timestamp) on the same privacy boundary.
 */
export const groupAlertDeliveriesTable = pgTable(
  "group_alert_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nightId: uuid("night_id").notNull().references(() => groupNightsTable.id, { onDelete: "cascade" }),
    senderMemberId: uuid("sender_member_id").notNull().references(() => groupMembersTable.id, { onDelete: "cascade" }),
    recipientMemberId: uuid("recipient_member_id").notNull().references(() => groupMembersTable.id, { onDelete: "cascade" }),
    leaveBy: timestamp("leave_by", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    expoTicketId: varchar("expo_ticket_id", { length: 128 }),
    pushTokenUsed: varchar("push_token_used", { length: 255 }),
    receiptCheckedAt: timestamp("receipt_checked_at", { withTimezone: true }),
    receiptError: varchar("receipt_error", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("group_alert_deliveries_once_idx").on(
      table.nightId, table.senderMemberId, table.recipientMemberId, table.leaveBy,
    ),
    index("group_alert_deliveries_retry_idx").on(table.sentAt, table.nextAttemptAt, table.leaseExpiresAt),
    index("group_alert_deliveries_receipt_idx").on(table.receiptCheckedAt, table.sentAt),
  ],
);
