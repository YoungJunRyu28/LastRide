import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, apiUsageTable } from "@workspace/db";
import { ProviderError } from "./cache";
import { logger } from "./logger";

export type Provider =
  | "ekispert"
  | "navitime-transport"
  | "navitime-route-car"
  | "navitime-route-walk"
  | "navitime-spot"
  | "navitime-geocoding";

/** Conservative defaults matching the current RapidAPI Basic allowances. */
export const MONTHLY_LIMITS: Partial<Record<Provider, number>> = {
  "navitime-transport": 500,
  "navitime-route-car": 500,
  "navitime-route-walk": 500,
  "navitime-spot": 500,
  "navitime-geocoding": 500,
};

const LIMIT_ENV: Record<Provider, string> = {
  ekispert: "EKISPERT_MONTHLY_LIMIT",
  "navitime-transport": "NAVITIME_TRANSPORT_MONTHLY_LIMIT",
  "navitime-route-car": "NAVITIME_ROUTE_CAR_MONTHLY_LIMIT",
  "navitime-route-walk": "NAVITIME_ROUTE_WALK_MONTHLY_LIMIT",
  "navitime-spot": "NAVITIME_SPOT_MONTHLY_LIMIT",
  "navitime-geocoding": "NAVITIME_GEOCODING_MONTHLY_LIMIT",
};

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
  const limits: Partial<Record<Provider, number>> = { ...MONTHLY_LIMITS };
  for (const provider of Object.keys(LIMIT_ENV) as Provider[]) {
    const raw = process.env[LIMIT_ENV[provider]]?.trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new UsageAccountingError(
        `Invalid ${LIMIT_ENV[provider]}: expected a positive integer`,
      );
    }
    limits[provider] = parsed;
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
  const limit = configuredMonthlyLimits()[provider];
  const { start, end } = monthBounds(month);

  let counts: { today: number; month: number | null };
  try {
    counts = await getDb().transaction(async (tx) => {
      let priorMonthCount: number | null = null;
      if (limit) {
        const lockKey = `lastride:provider-quota:${provider}:${month}`;
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
