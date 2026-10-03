import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { apiRateLimitsTable, getDb } from "@workspace/db";
import {
  FixedWindowLimiter,
  checkSharedRateLimit,
  purgeExpiredRateLimits,
} from "../src/lib/rateLimit";

describe("FixedWindowLimiter", () => {
  it("allows requests through the configured limit", () => {
    const limiter = new FixedWindowLimiter(2, 1_000);
    expect(limiter.check("client", 10_000).allowed).toBe(true);
    expect(limiter.check("client", 10_100).allowed).toBe(true);
  });

  it("blocks requests above the limit until the window resets", () => {
    const limiter = new FixedWindowLimiter(2, 1_000);
    limiter.check("client", 10_000);
    limiter.check("client", 10_100);

    const blocked = limiter.check("client", 10_200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(800);
  });

  it("starts a fresh window after expiry", () => {
    const limiter = new FixedWindowLimiter(1, 1_000);
    expect(limiter.check("client", 10_000).allowed).toBe(true);
    expect(limiter.check("client", 10_500).allowed).toBe(false);
    expect(limiter.check("client", 11_000).allowed).toBe(true);
  });

  it("tracks limiter keys independently", () => {
    const limiter = new FixedWindowLimiter(1, 1_000);
    expect(limiter.check("first", 10_000).allowed).toBe(true);
    expect(limiter.check("second", 10_000).allowed).toBe(true);
    expect(limiter.check("first", 10_100).allowed).toBe(false);
  });
});

describe("shared database rate limiter", () => {
  beforeEach(async () => {
    await getDb().delete(apiRateLimitsTable);
  });
  afterAll(async () => {
    await getDb().delete(apiRateLimitsTable);
  });

  it("shares one allowance across concurrent callers", async () => {
    const now = 100_000;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        checkSharedRateLimit("client:203.0.113.10", 10, 60_000, now),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(results.filter((result) => !result.allowed)).toHaveLength(10);
  });

  it("persists only a digest of the logical client key", async () => {
    const rawKey = "public-lookup:203.0.113.99";
    await checkSharedRateLimit(rawKey, 10, 60_000, 100_000);

    const [row] = await getDb().select().from(apiRateLimitsTable).limit(1);
    expect(row.keyHash).toBe(
      createHash("sha256").update(rawKey, "utf8").digest("hex"),
    );
    expect(row.keyHash).not.toContain("203.0.113.99");
  });

  it("purges expired windows without deleting live windows", async () => {
    const now = new Date();
    await getDb().insert(apiRateLimitsTable).values([
      {
        keyHash: "a".repeat(64),
        windowStart: new Date(now.getTime() - 120_000),
        count: 1,
        expiresAt: new Date(now.getTime() - 1),
      },
      {
        keyHash: "b".repeat(64),
        windowStart: new Date(now.getTime()),
        count: 1,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);

    expect(await purgeExpiredRateLimits(now)).toBe(1);
    const expired = await getDb()
      .select()
      .from(apiRateLimitsTable)
      .where(eq(apiRateLimitsTable.keyHash, "a".repeat(64)));
    const live = await getDb()
      .select()
      .from(apiRateLimitsTable)
      .where(
        and(
          eq(apiRateLimitsTable.keyHash, "b".repeat(64)),
          eq(apiRateLimitsTable.count, 1),
        ),
      );
    expect(expired).toHaveLength(0);
    expect(live).toHaveLength(1);
  });
});
