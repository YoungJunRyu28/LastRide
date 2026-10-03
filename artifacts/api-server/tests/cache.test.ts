import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, kvCacheTable } from "@workspace/db";
import {
  MAX_CACHE_TTL_MS,
  TtlCache,
  purgeExpiredCacheEntries,
} from "../src/lib/cache";

/**
 * Runs against a real Postgres (DATABASE_URL) rather than a mock — the whole
 * point of this class is what Postgres does that a JSON file cannot: survive
 * a restart, and be shared correctly when more than one server instance
 * writes to it. A mocked driver would not prove either of those.
 *
 * Each test uses its own cache name so tests never see each other's rows, and
 * the cache name is cleaned up before and after so a failed run doesn't leave
 * data behind for the next one.
 */
const TEST_CACHE = "test-cache";

async function clearTestCache() {
  await getDb().delete(kvCacheTable).where(eq(kvCacheTable.cacheName, TEST_CACHE));
}

beforeEach(clearTestCache);
afterAll(clearTestCache);

describe("TtlCache", () => {
  it("returns undefined for a key that was never set", async () => {
    const cache = new TtlCache<string>(60_000, TEST_CACHE);
    expect(await cache.get("never-set")).toBeUndefined();
  });

  it("returns what was set", async () => {
    const cache = new TtlCache<{ n: number }>(60_000, TEST_CACHE);
    await cache.set("key", { n: 42 });
    expect(await cache.get("key")).toEqual({ n: 42 });
  });

  it("setting the same key again replaces the value (upsert, not a duplicate row)", async () => {
    const cache = new TtlCache<string>(60_000, TEST_CACHE);
    await cache.set("key", "first");
    await cache.set("key", "second");
    expect(await cache.get("key")).toBe("second");

    const rows = await getDb().select().from(kvCacheTable).where(eq(kvCacheTable.cacheName, TEST_CACHE));
    expect(rows).toHaveLength(1);
  });

  it("an expired entry is not returned", async () => {
    const cache = new TtlCache<string>(50, TEST_CACHE);
    await cache.set("key", "value");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await cache.get("key")).toBeUndefined();
  });

  it("different cache names never collide, even with the same key", async () => {
    const a = new TtlCache<string>(60_000, TEST_CACHE);
    const b = new TtlCache<string>(60_000, "test-cache-other");
    await a.set("shared-key", "from-a");
    await b.set("shared-key", "from-b");

    expect(await a.get("shared-key")).toBe("from-a");
    expect(await b.get("shared-key")).toBe("from-b");

    await getDb().delete(kvCacheTable).where(eq(kvCacheTable.cacheName, "test-cache-other"));
  });

  it("a second TtlCache instance for the same name sees what the first wrote", async () => {
    // This is the property a JSON-file-per-process cache did not have: two
    // instances (two server processes, in production) sharing one cache.
    const writer = new TtlCache<string>(60_000, TEST_CACHE);
    const reader = new TtlCache<string>(60_000, TEST_CACHE);

    await writer.set("shared", "written-by-writer");
    expect(await reader.get("shared")).toBe("written-by-writer");
  });

  it("stores a one-way digest instead of the raw caller key", async () => {
    const rawKey = "35.6580|139.7010|private-address-query";
    const cache = new TtlCache<string>(60_000, TEST_CACHE);
    await cache.set(rawKey, "value");

    const [row] = await getDb()
      .select()
      .from(kvCacheTable)
      .where(eq(kvCacheTable.cacheName, TEST_CACHE))
      .limit(1);

    const expected = createHash("sha256")
      .update(TEST_CACHE, "utf8")
      .update("\0")
      .update(rawKey, "utf8")
      .digest("hex");
    expect(row.cacheKey).toBe(expected);
    expect(row.cacheKey).not.toContain("35.658");
    expect(row.cacheKey).not.toContain("private-address-query");
  });

  it("caps retention at 24 hours even when a caller asks for longer", async () => {
    const before = Date.now();
    const cache = new TtlCache<string>(30 * 24 * 60 * 60 * 1000, TEST_CACHE);
    await cache.set("long-lived", "value");

    const [row] = await getDb()
      .select({ expiresAt: kvCacheTable.expiresAt })
      .from(kvCacheTable)
      .where(eq(kvCacheTable.cacheName, TEST_CACHE))
      .limit(1);

    expect(row.expiresAt.getTime()).toBeGreaterThan(before + MAX_CACHE_TTL_MS - 2_000);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(before + MAX_CACHE_TTL_MS + 2_000);
  });

  it("keeps the requested TTL only for caches that opt out of personal data", async () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const before = Date.now();
    const capped = new TtlCache<string>(thirtyDaysMs, TEST_CACHE);
    const optedOut = new TtlCache<string>(thirtyDaysMs, TEST_CACHE, {
      containsPersonalData: false,
    });
    await capped.set("capped", "value");
    await optedOut.set("opted-out", "value");

    const expiryFor = async (key: string) => {
      const [row] = await getDb()
        .select({ expiresAt: kvCacheTable.expiresAt })
        .from(kvCacheTable)
        .where(
          and(
            eq(kvCacheTable.cacheName, TEST_CACHE),
            eq(
              kvCacheTable.cacheKey,
              createHash("sha256")
                .update(TEST_CACHE, "utf8")
                .update("\0")
                .update(key, "utf8")
                .digest("hex"),
            ),
          ),
        );
      return row.expiresAt.getTime() - before;
    };

    const cappedTtl = await expiryFor("capped");
    const optedOutTtl = await expiryFor("opted-out");
    expect(cappedTtl).toBeLessThanOrEqual(MAX_CACHE_TTL_MS + 2_000);
    expect(optedOutTtl).toBeGreaterThan(thirtyDaysMs - 2_000);
    expect(optedOutTtl).toBeLessThanOrEqual(thirtyDaysMs + 2_000);
  });

  it("physically purges expired rows while retaining live rows", async () => {
    const now = new Date();
    await getDb().insert(kvCacheTable).values([
      {
        cacheName: TEST_CACHE,
        cacheKey: "expired-manual",
        value: "expired",
        expiresAt: new Date(now.getTime() - 1_000),
      },
      {
        cacheName: TEST_CACHE,
        cacheKey: "live-manual",
        value: "live",
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);

    const purged = await purgeExpiredCacheEntries(now);
    expect(purged).toBeGreaterThanOrEqual(1);

    const expired = await getDb()
      .select()
      .from(kvCacheTable)
      .where(
        and(
          eq(kvCacheTable.cacheName, TEST_CACHE),
          eq(kvCacheTable.cacheKey, "expired-manual"),
        ),
      );
    const live = await getDb()
      .select()
      .from(kvCacheTable)
      .where(
        and(
          eq(kvCacheTable.cacheName, TEST_CACHE),
          eq(kvCacheTable.cacheKey, "live-manual"),
        ),
      );
    expect(expired).toHaveLength(0);
    expect(live).toHaveLength(1);
  });
});
