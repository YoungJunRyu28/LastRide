import type { Request } from "express";
import { rateLimitMiddleware, requestAddress } from "./rateLimit";

const ONE_MINUTE_MS = 60_000;

/** Safe operational tuning knobs; never accidentally disable a limiter. */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Bucket by the actual endpoint family rather than the full URL. Query values
 * may include coordinates, station names or addresses and must never be used
 * as limiter keys (or appear in logs).
 */
export function publicLookupFamily(path: string): string {
  const family = /^\/(trains|stations|taxi|addresses|places|walk)(?:\/|$)/.exec(path)?.[1];
  return family ?? "other";
}

export function publicLookupRateKey(req: Request): string {
  return "public-lookup:" + publicLookupFamily(req.path) + ":" + requestAddress(req);
}

/**
 * Anonymous public requests cannot be authenticated by a client-provided ID:
 * that would permit unlimited key rotation. Both budgets are keyed to the
 * trusted remote address. A modest aggregate IP ceiling still protects a
 * service if clients rotate between endpoints. API Gateway has its own
 * deployment-wide request throttle.
 *
 * The previous single shared 60/min budget covered six families and could
 * block legitimate passengers behind school, train-station or venue Wi-Fi.
 * These in-memory limits never wake Postgres when the timetable is bundled.
 */
export function publicLookupLimiters(options?: {
  perFamilyLimit?: number;
  totalIpLimit?: number;
}) {
  const familyLimit = options?.perFamilyLimit ??
    positiveIntEnv("PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE", 240);
  const totalIpLimit = options?.totalIpLimit ??
    positiveIntEnv("PUBLIC_LOOKUP_TOTAL_RATE_LIMIT_PER_MINUTE", 720);
  const totalIpGuard = rateLimitMiddleware({
    limit: totalIpLimit,
    windowMs: ONE_MINUTE_MS,
    key: (req) => "public-lookup-ip:" + requestAddress(req),
    shared: false,
  });
  const perFamilyGuard = rateLimitMiddleware({
    limit: familyLimit,
    windowMs: ONE_MINUTE_MS,
    key: publicLookupRateKey,
    shared: false,
  });
  // Reject hot-family traffic before charging the shared-IP guard. Otherwise
  // an attacker repeating /trains beyond that family's quota could exhaust
  // the total NAT budget and deny unrelated station requests.
  return [perFamilyGuard, totalIpGuard] as const;
}
