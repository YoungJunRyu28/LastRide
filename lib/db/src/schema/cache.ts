import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * Shared provider-response cache. cacheKey is a SHA-256 digest of the cache
 * namespace plus the caller key; raw coordinate/address-derived keys are never
 * persisted. Application code caps retention at 24 hours and periodically
 * deletes expired rows.
 */
export const kvCacheTable = pgTable(
  "kv_cache",
  {
    cacheName: text("cache_name").notNull(),
    cacheKey: text("cache_key").notNull(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cacheName, table.cacheKey] }),
    index("kv_cache_expires_at_idx").on(table.expiresAt),
  ],
);

export const insertKvCacheSchema = createInsertSchema(kvCacheTable);
export type InsertKvCacheEntry = typeof kvCacheTable.$inferInsert;
export type KvCacheEntry = typeof kvCacheTable.$inferSelect;
