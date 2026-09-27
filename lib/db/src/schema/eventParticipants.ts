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
import { enterpriseEventsTable } from "./events";

export const eventParticipantStatusEnum = pgEnum("event_participant_status", [
  "active",
  "left",
]);

export const eventParticipantsTable = pgTable(
  "event_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => enterpriseEventsTable.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 80 }).notNull(),

    // Privacy boundary: this is the only trip-derived value persisted for
    // enterprise participants. Never add destination, route, or coordinates.
    leaveBy: timestamp("leave_by", { withTimezone: true }),
    // Anonymous capability credential. The phone keeps the plaintext token;
    // the server stores only its SHA-256 hash.
    participantTokenHash: varchar("participant_token_hash", {
      length: 64,
    }).notNull(),
    status: eventParticipantStatusEnum("status").default("active").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("event_participants_token_hash_idx").on(
      table.participantTokenHash,
    ),
    index("event_participants_event_leave_by_idx").on(
      table.eventId,
      table.leaveBy,
    ),
    index("event_participants_event_status_idx").on(
      table.eventId,
      table.status,
    ),
  ],
);

export const insertEventParticipantSchema = createInsertSchema(
  eventParticipantsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectEventParticipantSchema = createSelectSchema(
  eventParticipantsTable,
);

export type EventParticipant = typeof eventParticipantsTable.$inferSelect;
export type NewEventParticipant = typeof eventParticipantsTable.$inferInsert;
