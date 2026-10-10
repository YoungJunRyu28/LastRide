import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, apiUsageTable } from "@workspace/db";
import { ProviderError } from "./cache";
import { logger } from "./logger";

/**
 * Paid upstream providers, counted per day and capped per month. LastRide
 * currently calls none (train data is ODPT, maps/routing are Apple MapKit on
 * the device), so the list is empty; the accounting stays for any future
 * paid provider. A provider's monthly cap can be set or overridden with
 * `<PROVIDER>_MONTHLY_LIMIT` (upper case, non-alphanumerics as "_").
 */
export type Provider = string;

/** Default monthly caps per paid provider (none at present). */
export const MONTHLY_LIMITS: Partial<Record<Provider, number>> = {};

export function limitEnvName(provider: Provider): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_MONTHLY_LIMIT`;
}

function parseLimit(provider: Provider): number | undefined {
  const name = limitEnvName(provider);
  const raw = process.env[name]?.trim();
  if (!raw) return MONTHLY_LIMITS[provider];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageAccountingError(
      `Invalid ${name}: expected a positive integer`,
    );
  }
  return parsed;
}

export class ProviderQuotaExceededError extends ProviderError {
  constructor(
    public readonly provider: Provider,
    public readonly monthlyLimit: number,
  ) {
    super(`Monthly provider quota reached for ${provider}`);
    this.name = "ProviderQuotaExceededError";
  }
}

export class UsageAccountingError extends ProviderError {
  constructor(message = "Provider usage accounting unavailable") {
    super(message);
    this.name = "UsageAccountingError";
  }
}

function jstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1))
    .toISOString()
    .slice(0, 10);
  return { start: `${month}-01`, end: next };
}

export function configuredMonthlyLimits(): Partial<Record<Provider, number>> {
  const limits: Partial<Record<Provider, number>> = {};
  for (const provider of Object.keys(MONTHLY_LIMITS)) {
    const limit = parseLimit(provider);
    if (limit !== undefined) limits[provider] = limit;
  }
  return limits;
}

/**
 * Reserve one real upstream call. For capped providers, an advisory
 * transaction lock serializes the monthly check plus increment across every
 * Lambda instance, so concurrent requests cannot race past the configured cap.
 */
export async function recordCall(
  provider: Provider,
  endpoint: string,
): Promise<void> {
  const day = jstDate();
  const month = day.slice(0, 7);
  const limit = parseLimit(provider);
  const { start, end } = monthBounds(month);

  let counts: { today: number; month: number | null };
  try {
    counts = await getDb().transaction(async (tx) => {
      let priorMonthCount: number | null = null;
      if (limit) {
        const lockKey = `lastride:provider-quota:${provider}:${month}`;
        // Bound the wait for the quota lock; on timeout the reservation fails
        // closed like any other accounting error instead of hanging the request.
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const [monthly] = await tx
          .select({
            total: sql<number>`coalesce(sum(${apiUsageTable.count}), 0)::int`,
          })
          .from(apiUsageTable)
          .where(
            and(
              eq(apiUsageTable.provider, provider),
              gte(apiUsageTable.day, start),
              lt(apiUsageTable.day, end),
            ),
          );
        priorMonthCount = Number(monthly?.total ?? 0);
        if (priorMonthCount >= limit) {
          throw new ProviderQuotaExceededError(provider, limit);
        }
      }

      const [row] = await tx
        .insert(apiUsageTable)
        .values({ provider, day, count: 1 })
        .onConflictDoUpdate({
          target: [apiUsageTable.provider, apiUsageTable.day],
          set: { count: sql`${apiUsageTable.count} + 1` },
        })
        .returning({ count: apiUsageTable.count });

      return {
        today: row.count,
        month: priorMonthCount === null ? null : priorMonthCount + 1,
      };
    });
  } catch (err) {
    if (err instanceof ProviderQuotaExceededError) throw err;
    logger.error({ err, provider, endpoint }, "Failed to reserve provider usage");
    if (
      process.env.NODE_ENV === "production" ||
      process.env.REQUIRE_USAGE_ACCOUNTING === "true"
    ) {
      throw new UsageAccountingError();
    }
    return;
  }

  logger.info(
    { provider, endpoint, today: counts.today, thisMonth: counts.month, limit },
    "Paid API call reserved",
  );

  if (limit && counts.month === Math.floor(limit * 0.8)) {
    logger.warn(
      { provider, thisMonth: counts.month, monthlyLimit: limit },
      "80% of monthly provider quota used",
    );
  }
}

export async function usageReport() {
  const day = jstDate();
  const month = day.slice(0, 7);
  const { start, end } = monthBounds(month);

  const rows = await getDb()
    .select({
      provider: apiUsageTable.provider,
      day: apiUsageTable.day,
      count: apiUsageTable.count,
    })
    .from(apiUsageTable)
    .where(and(gte(apiUsageTable.day, start), lt(apiUsageTable.day, end)));

  const today: Record<string, number> = {};
  const thisMonth: Record<string, number> = {};
  for (const row of rows) {
    thisMonth[row.provider] = (thisMonth[row.provider] ?? 0) + row.count;
    if (row.day === day) today[row.provider] = row.count;
  }

  return {
    date: day,
    month,
    today,
    thisMonth,
    monthlyLimits: configuredMonthlyLimits(),
  };
}
