import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, kvCacheTable } from "@workspace/db";
import { TtlCache } from "../src/lib/cache";

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
  await db.delete(kvCacheTable).where(eq(kvCacheTable.cacheName, TEST_CACHE));
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

    const rows = await db.select().from(kvCacheTable).where(eq(kvCacheTable.cacheName, TEST_CACHE));
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

    await db.delete(kvCacheTable).where(eq(kvCacheTable.cacheName, "test-cache-other"));
  });

  it("a second TtlCache instance for the same name sees what the first wrote", async () => {
    // This is the property a JSON-file-per-process cache did not have: two
    // instances (two server processes, in production) sharing one cache.
    const writer = new TtlCache<string>(60_000, TEST_CACHE);
    const reader = new TtlCache<string>(60_000, TEST_CACHE);

    await writer.set("shared", "written-by-writer");
    expect(await reader.get("shared")).toBe("written-by-writer");
  });
});
