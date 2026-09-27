import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * Backs `TtlCache` (see artifacts/api-server/src/lib/cache.ts). One row per
 * cached key, scoped by `cacheName` (e.g. "navitime-nearby", "ekispert-routes-v3").
 *
 * This replaces a JSON file per cache on local disk. A file disappears the
 * moment the server restarts or a second instance starts up with an empty
 * disk of its own — this table is shared and durable across both.
 */
export const kvCacheTable = pgTable(
  "kv_cache",
  {
    cacheName: text("cache_name").notNull(),
    cacheKey: text("cache_key").notNull(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.cacheName, table.cacheKey] })],
);

export const insertKvCacheSchema = createInsertSchema(kvCacheTable);
export type InsertKvCacheEntry = typeof kvCacheTable.$inferInsert;
export type KvCacheEntry = typeof kvCacheTable.$inferSelect;
