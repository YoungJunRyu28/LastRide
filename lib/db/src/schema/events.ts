import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organizationMembersTable, organizationsTable } from "./organizations";

export const enterpriseEventStatusEnum = pgEnum("enterprise_event_status", [
  "draft",
  "active",
  "closed",
  "expired",
]);

export const enterpriseEventsTable = pgTable(
  "enterprise_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    createdByMemberId: uuid("created_by_member_id")
      .notNull()
      .references(() => organizationMembersTable.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 160 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: enterpriseEventStatusEnum("status").default("draft").notNull(),
    alertLeadMinutes: integer("alert_lead_minutes").default(10).notNull(),
    participantLimit: integer("participant_limit").default(30).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("enterprise_events_org_starts_at_idx").on(
      table.organizationId,
      table.startsAt,
    ),
    index("enterprise_events_status_expires_at_idx").on(
      table.status,
      table.expiresAt,
    ),
    check(
      "enterprise_events_alert_lead_minutes_check",
      sql`${table.alertLeadMinutes} between 1 and 120`,
    ),
    check(
      "enterprise_events_participant_limit_check",
      sql`${table.participantLimit} between 1 and 500`,
    ),
    check(
      "enterprise_events_expiry_after_start_check",
      sql`${table.expiresAt} > ${table.startsAt}`,
    ),
  ],
);

export const insertEnterpriseEventSchema = createInsertSchema(
  enterpriseEventsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectEnterpriseEventSchema = createSelectSchema(
  enterpriseEventsTable,
);

export type EnterpriseEvent = typeof enterpriseEventsTable.$inferSelect;
export type NewEnterpriseEvent = typeof enterpriseEventsTable.$inferInsert;
