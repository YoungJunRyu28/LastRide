import { createHash } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { getDb, kvCacheTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Provider responses are shared across API instances in Postgres. Cache keys
 * can be derived from coordinates, station names or address queries, so raw
 * keys must never be persisted or logged.
 */
export const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function digestCacheKey(cacheName: string, key: string): string {
  return createHash("sha256")
    .update(cacheName, "utf8")
    .update("\0")
    .update(key, "utf8")
    .digest("hex");
}

export class TtlCache<T> {
  private readonly ttlMs: number;

  constructor(
    ttlMs: number,
    private readonly name: string,
  ) {
    // Enforce the privacy retention boundary centrally so a future caller
    // cannot accidentally retain provider-query material for weeks.
    this.ttlMs = Math.min(Math.max(1, ttlMs), MAX_CACHE_TTL_MS);
  }

  async get(key: string): Promise<T | undefined> {
    const cacheKey = digestCacheKey(this.name, key);
    try {
      const [row] = await getDb()
        .select({ value: kvCacheTable.value })
        .from(kvCacheTable)
        .where(
          and(
            eq(kvCacheTable.cacheName, this.name),
            eq(kvCacheTable.cacheKey, cacheKey),
            gt(kvCacheTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row?.value as T | undefined;
    } catch (err) {
      // A cache outage should degrade to a miss. Deliberately omit the raw
      // key because it may contain coordinates, station names or addresses.
      logger.warn({ err, cache: this.name }, "Cache read failed, treating as a miss");
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const cacheKey = digestCacheKey(this.name, key);
    const expiresAt = new Date(Date.now() + this.ttlMs);
    try {
      await getDb()
        .insert(kvCacheTable)
        .values({
          cacheName: this.name,
          cacheKey,
          value: value as unknown,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [kvCacheTable.cacheName, kvCacheTable.cacheKey],
          set: { value: value as unknown, expiresAt },
        });
    } catch (err) {
      logger.warn({ err, cache: this.name }, "Cache write failed");
    }
  }
}

/** Physically remove expired rows so TTL is also a storage-retention bound. */
export async function purgeExpiredCacheEntries(now = new Date()): Promise<number> {
  const deleted = await getDb()
    .delete(kvCacheTable)
    .where(lte(kvCacheTable.expiresAt, now))
    .returning({ cacheName: kvCacheTable.cacheName });
  return deleted.length;
}

/** Thrown when an upstream data provider is unreachable or misconfigured. */
export class ProviderError extends Error {}
