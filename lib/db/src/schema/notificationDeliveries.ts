import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { eventParticipantsTable } from "./eventParticipants";
import { hostDevicesTable } from "./hostDevices";

export const enterpriseNotificationKindEnum = pgEnum(
  "enterprise_notification_kind",
  ["leaving_soon", "leave_now"],
);

export const notificationDeliveriesTable = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => eventParticipantsTable.id, { onDelete: "cascade" }),
    hostDeviceId: uuid("host_device_id")
      .notNull()
      .references(() => hostDevicesTable.id, { onDelete: "cascade" }),
    kind: enterpriseNotificationKindEnum("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    expoTicketId: varchar("expo_ticket_id", { length: 128 }),
    receiptCheckedAt: timestamp("receipt_checked_at", { withTimezone: true }),
    receiptError: varchar("receipt_error", { length: 64 }),
  },
  (table) => [
    uniqueIndex("notification_deliveries_once_idx").on(
      table.participantId,
      table.hostDeviceId,
      table.kind,
    ),
    index("notification_deliveries_receipt_pending_idx").on(
      table.receiptCheckedAt,
      table.sentAt,
    ),
  ],
);

export const insertNotificationDeliverySchema = createInsertSchema(
  notificationDeliveriesTable,
).omit({ id: true, createdAt: true });
export const selectNotificationDeliverySchema = createSelectSchema(
  notificationDeliveriesTable,
);

export type NotificationDelivery =
  typeof notificationDeliveriesTable.$inferSelect;
