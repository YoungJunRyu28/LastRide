import {
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Shared fixed-window rate-limit counters. The application stores only a
 * SHA-256 digest of the logical client key, never a raw IP address or token.
 */
export const apiRateLimitsTable = pgTable(
  "api_rate_limits",
  {
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },  (table) => [
    primaryKey({ columns: [table.keyHash, table.windowStart] }),
    index("api_rate_limits_expires_at_idx").on(table.expiresAt),
  ],
);

export type ApiRateLimitRow = typeof apiRateLimitsTable.$inferSelect;
