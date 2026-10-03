import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { eq } from "drizzle-orm";
import { getDb, apiUsageTable } from "@workspace/db";
import {
  MONTHLY_LIMITS,
  ProviderQuotaExceededError,
  recordCall,
  usageReport,
  type Provider,
} from "../src/lib/usage";

const TEST_PROVIDER = "navitime-transport" as Provider;
const LIMIT_ENV = "NAVITIME_TRANSPORT_MONTHLY_LIMIT";

async function clearTestUsage() {
  await getDb()
    .delete(apiUsageTable)
    .where(eq(apiUsageTable.provider, TEST_PROVIDER));
}

beforeEach(async () => {
  delete process.env[LIMIT_ENV];
  await clearTestUsage();
});
afterEach(() => {
  delete process.env[LIMIT_ENV];
});
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
    await Promise.all(
      Array.from({ length: 20 }, () => recordCall(TEST_PROVIDER, "/test")),
    );
    const report = await usageReport();
    expect(report.today[TEST_PROVIDER]).toBe(20);
  });

  it("rejects calls once the configured monthly quota is exhausted", async () => {
    process.env[LIMIT_ENV] = "2";
    await recordCall(TEST_PROVIDER, "/test");
    await recordCall(TEST_PROVIDER, "/test");

    await expect(recordCall(TEST_PROVIDER, "/test")).rejects.toBeInstanceOf(
      ProviderQuotaExceededError,
    );

    const report = await usageReport();
    expect(report.thisMonth[TEST_PROVIDER]).toBe(2);
  });

  it("cannot race past a monthly quota under concurrency", async () => {
    process.env[LIMIT_ENV] = "5";
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => recordCall(TEST_PROVIDER, "/test")),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(5);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof ProviderQuotaExceededError,
      ),
    ).toHaveLength(15);

    const report = await usageReport();
    expect(report.thisMonth[TEST_PROVIDER]).toBe(5);
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
