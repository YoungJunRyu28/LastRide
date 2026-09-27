/**
 * Counts real (uncached) calls to paid providers, per Japan-time day and
 * month, so API spend during testing is visible rather than guessed.
 *
 * The count lives in Postgres now, not a JSON file (see schema in
 * lib/db/src/schema/usage.ts for why: durability across restarts, and a
 * single correct total when more than one server instance is recording
 * calls at once — the thing a file on local disk cannot do).
 */
import { sql } from "drizzle-orm";
import { getDb, apiUsageTable } from "@workspace/db";
import { logger } from "./logger";

export type Provider = "ekispert" | "navitime-transport" | "navitime-route-car" | "navitime-route-walk" | "navitime-spot" | "navitime-geocoding";

/** Free-plan monthly allowances; RapidAPI Basic plans stop at 500 calls a month per API. */
export const MONTHLY_LIMITS: Partial<Record<Provider, number>> = {
  "navitime-transport": 500,
  "navitime-route-car": 500,
  "navitime-route-walk": 500,
  "navitime-spot": 500,
  "navitime-geocoding": 500,
};

function jstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Records one real call, atomically. `on conflict ... do update set count =
 * count + 1` is a single statement Postgres executes under a row lock: two
 * requests recording the same provider on the same day at the same instant
 * cannot both read "5" and both write "6", the way two processes updating a
 * shared in-memory object (or a JSON file) can.
 */
export async function recordCall(provider: Provider, endpoint: string): Promise<void> {
  const day = jstDate();

  let todayCount: number;
  try {
    const [row] = await getDb()
      .insert(apiUsageTable)
      .values({ provider, day, count: 1 })
      .onConflictDoUpdate({
        target: [apiUsageTable.provider, apiUsageTable.day],
        set: { count: sql`${apiUsageTable.count} + 1` },
      })
      .returning({ count: apiUsageTable.count });
    todayCount = row.count;
  } catch (err) {
    // Losing one usage record is far cheaper than failing the request it
    // belongs to, but it must not happen silently.
    logger.error({ err, provider, endpoint }, "Failed to record API usage");
    return;
  }

  const limit = MONTHLY_LIMITS[provider];
  logger.info({ provider, endpoint, today: todayCount }, "Paid API call");

  if (limit) {
    const monthCount = await monthlyCount(provider, day.slice(0, 7));
    if (monthCount === Math.floor(limit * 0.8)) {
      logger.warn({ provider, thisMonth: monthCount, monthlyLimit: limit }, "80% of monthly free calls used");
    }
  }
}

async function monthlyCount(provider: Provider, month: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${apiUsageTable.count}), 0)::int` })
    .from(apiUsageTable)
    .where(sql`${apiUsageTable.provider} = ${provider} and to_char(${apiUsageTable.day}, 'YYYY-MM') = ${month}`);
  return row?.total ?? 0;
}

export async function usageReport() {
  const day = jstDate();
  const month = day.slice(0, 7);

  const rows = await getDb()
    .select({ provider: apiUsageTable.provider, day: apiUsageTable.day, count: apiUsageTable.count })
    .from(apiUsageTable)
    .where(sql`to_char(${apiUsageTable.day}, 'YYYY-MM') = ${month}`);

  const today: Record<string, number> = {};
  const thisMonth: Record<string, number> = {};
  for (const row of rows) {
    thisMonth[row.provider] = (thisMonth[row.provider] ?? 0) + row.count;
    if (row.day === day) today[row.provider] = row.count;
  }

  return { date: day, month, today, thisMonth, monthlyLimits: MONTHLY_LIMITS };
}
