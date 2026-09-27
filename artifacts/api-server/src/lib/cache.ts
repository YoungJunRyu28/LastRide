/**
 * `TtlCache<T>` is used by six route modules (stations, trains, walk, places,
 * taxi, addresses) exactly as before: `new TtlCache(ttlMs, name)`, then
 * `await cache.get(key)` / `await cache.set(key, value)`. Only the body
 * changed — from a JSON file on local disk to a shared table in Postgres.
 *
 * That is the actual fix, not just a relocation:
 *   - A file lives on the one machine running it. Lambda, ECS, or any
 *     redeploy gives you a fresh disk, so the cache — and the point of
 *     having one — disappears with it.
 *   - Two instances of the server each had their own file, so a cache hit in
 *     one process was a cache miss in the other, doubling calls to paid
 *     upstream providers for no reason. A shared table fixes that too.
 *
 * `get`/`set` are async now (they weren't before): every existing call site
 * already sat inside an `async` function, so this only meant adding `await`,
 * not restructuring anything.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, kvCacheTable } from "@workspace/db";
import { logger } from "./logger";

export class TtlCache<T> {
  constructor(
    private ttlMs: number,
    private name: string,
  ) {}

  async get(key: string): Promise<T | undefined> {
    try {
      const [row] = await getDb()
        .select({ value: kvCacheTable.value })
        .from(kvCacheTable)
        .where(
          and(
            eq(kvCacheTable.cacheName, this.name),
            eq(kvCacheTable.cacheKey, key),
            gt(kvCacheTable.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
      return row?.value as T | undefined;
    } catch (err) {
      // A cache outage should degrade to "always fetch fresh", not take the
      // whole route down with it.
      logger.warn({ err, cache: this.name, key }, "Cache read failed, treating as a miss");
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    try {
      await getDb()
        .insert(kvCacheTable)
        .values({
          cacheName: this.name,
          cacheKey: key,
          value: value as unknown,
          expiresAt: new Date(Date.now() + this.ttlMs),
        })
        .onConflictDoUpdate({
          target: [kvCacheTable.cacheName, kvCacheTable.cacheKey],
          set: { value: value as unknown, expiresAt: new Date(Date.now() + this.ttlMs) },
        });
    } catch (err) {
      // Worth logging, but a failed cache write should not fail the request
      // that already has its answer — it just means the next request re-fetches.
      logger.warn({ err, cache: this.name, key }, "Cache write failed");
    }
  }
}

/** Thrown when an upstream data provider is unreachable or misconfigured. */
export class ProviderError extends Error {}
