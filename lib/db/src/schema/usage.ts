import { pgTable, text, date, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * Counts real (uncached) calls to paid providers, one row per provider per
 * JST service day. A month's total is `sum(count)` over its days, computed at
 * read time — see `usageReport` in artifacts/api-server/src/lib/usage.ts — so
 * there is exactly one number to keep correct, not a daily and a monthly
 * count that could drift apart.
 *
 * `count = count + 1` inside `on conflict ... do update` is a single atomic
 * statement: two requests hitting the same provider on the same day at the
 * same moment cannot lose one of the increments the way two processes each
 * reading-then-writing a shared JSON file can.
 */
export const apiUsageTable = pgTable(
  "api_usage",
  {
    provider: text("provider").notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.provider, table.day] })],
);

export const insertApiUsageSchema = createInsertSchema(apiUsageTable);
export type InsertApiUsageRow = typeof apiUsageTable.$inferInsert;
export type ApiUsageRow = typeof apiUsageTable.$inferSelect;
