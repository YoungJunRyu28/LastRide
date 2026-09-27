import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, apiUsageTable } from "@workspace/db";
import { recordCall, usageReport, MONTHLY_LIMITS, type Provider } from "../src/lib/usage";

/**
 * Runs against a real Postgres. The property that matters most here —
 * concurrent calls all being counted — cannot be demonstrated against a mock;
 * it depends on Postgres actually serialising the two `UPDATE`s, which is the
 * reason this moved off a JSON file (two processes reading-then-writing a
 * shared object can each read "5" and both write "6", losing one).
 */
const TEST_PROVIDER = "navitime-transport" as Provider;

async function clearTestUsage() {
  await getDb().delete(apiUsageTable).where(eq(apiUsageTable.provider, TEST_PROVIDER));
}

beforeEach(clearTestUsage);
afterAll(clearTestUsage);

describe("recordCall", () => {
  it("starts a provider's count at one", async () => {
    await recordCall(TEST_PROVIDER, "/test");
    const report = await usageReport();
    expect(report.today[TEST_PROVIDER]).toBe(1);
  });

  it("accumulates across repeated calls", async () => {
    await recordCall(TEST_PROVIDER, "/test");
    await recordCall(TEST_PROVIDER, "/test");
    await recordCall(TEST_PROVIDER, "/test");
    const report = await usageReport();
    expect(report.today[TEST_PROVIDER]).toBe(3);
  });

  it("counts every call made concurrently, none lost", async () => {
    // The regression this guards against: two requests recording the same
    // provider at the same instant both reading count=N and both writing
    // N+1, so twenty calls land as fewer than twenty.
    await Promise.all(Array.from({ length: 20 }, () => recordCall(TEST_PROVIDER, "/test")));
    const report = await usageReport();
    expect(report.today[TEST_PROVIDER]).toBe(20);
  });
});

describe("usageReport", () => {
  it("reports the configured monthly limits", async () => {
    const report = await usageReport();
    expect(report.monthlyLimits).toEqual(MONTHLY_LIMITS);
  });

  it("reports today's date and this month, in JST", async () => {
    const report = await usageReport();
    expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.month).toBe(report.date.slice(0, 7));
  });

  it("a provider with no calls today is simply absent, not zero", async () => {
    const report = await usageReport();
    expect(report.today[TEST_PROVIDER]).toBeUndefined();
  });
});
