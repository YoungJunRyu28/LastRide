import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Persistent consumer groups (飲み会 groups). There are no user accounts: each
 * device holds a per-group capability "member token" and the server stores
 * only its SHA-256 hash, exactly like enterprise participant tokens.
 */
export const groupsTable = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),

    // Invite credentials are capabilities. Lookups use deterministic hashes;
    // rotating replaces both hashes, which revokes every older link and code.
    inviteTokenHash: varchar("invite_token_hash", { length: 64 }).notNull(),
    // Hash of the device-generated 256-bit host/creation capability. Legacy
    // groups have NULL; newer POST retries use this key to recover the host.
    creationKeyHash: varchar("creation_key_hash", { length: 64 }),
    joinCodeHash: varchar("join_code_hash", { length: 64 }).notNull(),
    // AES-256-GCM ciphertext of the current invite token + join code (bound to
    // the group id), so whoever is host can re-share the same link later.
    // Null when no GROUP_INVITE_ENCRYPTION_KEY is configured in production;
    // the host must then rotate to get a fresh, shareable invite.
    inviteCiphertext: text("invite_ciphertext"),
    inviteRotatedAt: timestamp("invite_rotated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("groups_invite_token_hash_idx").on(table.inviteTokenHash),
    uniqueIndex("groups_creation_key_hash_idx").on(table.creationKeyHash),
    uniqueIndex("groups_join_code_hash_idx").on(table.joinCodeHash),
  ],
);

export const groupMemberRoleEnum = pgEnum("group_member_role", [
  "host",
  "member",
]);

export const groupLanguageEnum = pgEnum("group_language", ["ja", "en"]);

export const groupMembersTable = pgTable(
  "group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 40 }).notNull(),
    role: groupMemberRoleEnum("role").default("member").notNull(),
    // Anonymous capability credential. The phone keeps the plaintext token;
    // the server stores only its SHA-256 hash.
    memberTokenHash: varchar("member_token_hash", { length: 64 }).notNull(),
    expoPushToken: varchar("expo_push_token", { length: 255 }),
    language: groupLanguageEnum("language").default("ja").notNull(),
    // "今夜の開始": the host-started-tonight notification.
    notifications: boolean("notifications").default(true).notNull(),
    // "メンバーの出発時刻": when another participant's leave time comes. Some
    // join only to see the list or to share their own time, so it is separate.
    leaveTimeAlerts: boolean("leave_time_alerts").default(true).notNull(),
    // Last authenticated request from this member's app (refreshed at most
    // twice a day). Members inactive for long enough are removed by the
    // nightly cleanup, since deleting the app can't tell the server.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Set when Expo reports the push token as DeviceNotRegistered (usually the
    // app was deleted); such members are removed sooner if they stay inactive.
    pushTokenInvalidAt: timestamp("push_token_invalid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("group_members_token_hash_idx").on(table.memberTokenHash),
    index("group_members_group_idx").on(table.groupId),
    // Exactly one host per group.
    uniqueIndex("group_members_one_host_idx")
      .on(table.groupId)
      .where(sql`${table.role} = 'host'`),
    // A device re-joining the same group must not receive duplicate pushes.
    uniqueIndex("group_members_group_push_token_idx").on(
      table.groupId,
      table.expoPushToken,
    ),
  ],
);

/**
 * "Tonight" for a group. At most one row per group; the row (and every
 * participant leave-by under it) is deleted when the night ends, either at
 * 08:00 JST the following morning or when the host ends it early.
 */
export const groupNightsTable = pgTable(
  "group_nights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    // Japan rail service day (04:00 JST boundary), YYYY-MM-DD.
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("group_nights_group_idx").on(table.groupId),
    index("group_nights_ends_at_idx").on(table.endsAt),
  ],
);

export const groupNightParticipantsTable = pgTable(
  "group_night_participants",
  {
    nightId: uuid("night_id")
      .notNull()
      .references(() => groupNightsTable.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => groupMembersTable.id, { onDelete: "cascade" }),

    // Privacy boundary: the leave-by timestamp is the only trip-derived value
    // persisted for group members, and it is deleted when the night ends.
    // Never add location, station, route, or destination.
    leaveBy: timestamp("leave_by", { withTimezone: true }),
    // The leave-by value the "time to leave" push was sent for. A later
    // leave-by re-arms the alert; an earlier or equal one does not.
    leaveAlertSentFor: timestamp("leave_alert_sent_for", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.nightId, table.memberId] }),
    index("group_night_participants_member_idx").on(table.memberId),
    index("group_night_participants_leave_by_idx").on(table.leaveBy),
  ],
);

export type Group = typeof groupsTable.$inferSelect;
export type GroupMember = typeof groupMembersTable.$inferSelect;
export type GroupNight = typeof groupNightsTable.$inferSelect;
export type GroupNightParticipant =
  typeof groupNightParticipantsTable.$inferSelect;
