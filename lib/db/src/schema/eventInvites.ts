import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { enterpriseEventsTable } from "./events";

export const eventInvitesTable = pgTable(
  "event_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => enterpriseEventsTable.id, { onDelete: "cascade" }),

    // Invite credentials are capabilities, so persist only deterministic hashes.
    // Plaintext QR tokens / short join codes are returned only when generated.
    inviteTokenHash: varchar("invite_token_hash", { length: 64 }).notNull(),
    joinCodeHash: varchar("join_code_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("event_invites_token_hash_idx").on(table.inviteTokenHash),
    uniqueIndex("event_invites_join_code_hash_idx").on(table.joinCodeHash),
    index("event_invites_event_idx").on(table.eventId),
    index("event_invites_expires_at_idx").on(table.expiresAt),
  ],
);

export const insertEventInviteSchema = createInsertSchema(
  eventInvitesTable,
).omit({
  id: true,
  createdAt: true,
});
export const selectEventInviteSchema = createSelectSchema(eventInvitesTable);

export type EventInvite = typeof eventInvitesTable.$inferSelect;
export type NewEventInvite = typeof eventInvitesTable.$inferInsert;
