/**
 * Server-side check of the RevenueCat "premium" entitlement, used to gate
 * group creation. Joining a group is free and never calls this.
 *
 * - REVENUECAT_SECRET_KEY set: ask RevenueCat's REST API for the subscriber.
 * - unset outside production: allow (test/dev mode).
 * - unset in production: report "unavailable" so the route answers 503
 *   instead of silently giving premium away.
 * - "test" on the staging stack (LASTRIDE_STAGE=staging): allow, so groups can
 *   be tested before RevenueCat exists. infra/deploy.sh refuses "test" for
 *   production, and it is ignored there regardless.
 *
 * Only positive answers are cached, briefly, so a purchase that just went
 * through is never stuck behind a cached "no".
 */
import { logger } from "./logger";
import { premiumDeviceProofRequired } from "./premiumDeviceIdentity";

export const PREMIUM_ENTITLEMENT = "premium";
const POSITIVE_CACHE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

export type EntitlementResult = "active" | "inactive" | "unavailable";

const positiveCache = new Map<string, number>();

export function clearEntitlementCache(): void {
  positiveCache.clear();
}

type SubscriberResponse = {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null } | undefined>;
  };
};

/** Pure: is the named entitlement active in a RevenueCat subscriber payload? */
export function entitlementActiveUntil(
  payload: SubscriberResponse,
  nowMs: number,
  entitlement = PREMIUM_ENTITLEMENT,
): { active: boolean; expiresAtMs: number | null } {
  const entry = payload.subscriber?.entitlements?.[entitlement];
  if (!entry) return { active: false, expiresAtMs: null };
  if (entry.expires_date === null || entry.expires_date === undefined) {
    // Lifetime / non-expiring entitlement.
    return { active: true, expiresAtMs: null };
  }
  const expiresAtMs = Date.parse(entry.expires_date);
  if (!Number.isFinite(expiresAtMs)) return { active: false, expiresAtMs: null };
  return { active: expiresAtMs > nowMs, expiresAtMs };
}

export async function checkPremiumEntitlement(
  appUserId: string,
  nowMs = Date.now(),
): Promise<EntitlementResult> {
  const secret = process.env.REVENUECAT_SECRET_KEY?.trim();
  if (secret === "test") {
    return process.env.LASTRIDE_STAGE === "staging" ? "active" : "unavailable";
  }
  if (!secret) {
    // Lambda may not set NODE_ENV. The same fail-closed production marker
    // used for device ownership proof must also gate RevenueCat credentials.
    return premiumDeviceProofRequired() ? "unavailable" : "active";
  }

  const cachedUntil = positiveCache.get(appUserId);
  if (cachedUntil !== undefined) {
    if (cachedUntil > nowMs) return "active";
    positiveCache.delete(appUserId);
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (err) {
    logger.warn({ err }, "RevenueCat entitlement check failed");
    return "unavailable";
  }

  if (response.status === 404) return "inactive";
  if (!response.ok) {
    logger.warn(
      { status: response.status },
      "RevenueCat entitlement check returned an error",
    );
    return "unavailable";
  }

  let payload: SubscriberResponse;
  try {
    payload = (await response.json()) as SubscriberResponse;
  } catch {
    return "unavailable";
  }
  const { active, expiresAtMs } = entitlementActiveUntil(payload, nowMs);
  if (!active) return "inactive";

  if (positiveCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = positiveCache.keys().next().value;
    if (oldest !== undefined) positiveCache.delete(oldest);
  }
  positiveCache.set(
    appUserId,
    Math.min(nowMs + POSITIVE_CACHE_MS, expiresAtMs ?? Number.POSITIVE_INFINITY),
  );
  return "active";
}
