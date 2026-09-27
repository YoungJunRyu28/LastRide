import {
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organizationMembersTable } from "./organizations";

export const hostDevicePlatformEnum = pgEnum("host_device_platform", [
  "ios",
  "android",
]);

export const hostDevicesTable = pgTable(
  "host_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationMemberId: uuid("organization_member_id")
      .notNull()
      .references(() => organizationMembersTable.id, { onDelete: "cascade" }),
    expoPushToken: varchar("expo_push_token", { length: 255 }).notNull(),
    platform: hostDevicePlatformEnum("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("host_devices_expo_push_token_idx").on(table.expoPushToken),
  ],
);

export const insertHostDeviceSchema = createInsertSchema(hostDevicesTable).omit(
  {
    id: true,
    createdAt: true,
    updatedAt: true,
  },
);
export const selectHostDeviceSchema = createSelectSchema(hostDevicesTable);

export type HostDevice = typeof hostDevicesTable.$inferSelect;
export type NewHostDevice = typeof hostDevicesTable.$inferInsert;
