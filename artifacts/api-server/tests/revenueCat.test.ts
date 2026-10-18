import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkPremiumEntitlement,
  clearEntitlementCache,
  entitlementActiveUntil,
} from "../src/lib/revenueCat";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function subscriber(expires: string | null | undefined, name = "premium") {
  return {
    subscriber: {
      entitlements:
        expires === undefined ? {} : { [name]: { expires_date: expires } },
    },
  };
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  clearEntitlementCache();
  process.env.REVENUECAT_SECRET_KEY = "sk_test_secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REVENUECAT_SECRET_KEY;
  delete process.env.LASTRIDE_STAGE;
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("entitlement payload parsing", () => {
  it("treats a null expiry as a lifetime entitlement", () => {
    expect(entitlementActiveUntil(subscriber(null), NOW).active).toBe(true);
  });

  it("is active only until the expiry date", () => {
    const future = new Date(NOW + 60_000).toISOString();
    const past = new Date(NOW - 60_000).toISOString();
    expect(entitlementActiveUntil(subscriber(future), NOW).active).toBe(true);
    expect(entitlementActiveUntil(subscriber(past), NOW).active).toBe(false);
  });

  it("ignores other entitlements", () => {
    expect(
      entitlementActiveUntil(subscriber(null, "pro_legacy"), NOW).active,
    ).toBe(false);
    expect(entitlementActiveUntil(subscriber(undefined), NOW).active).toBe(
      false,
    );
  });
});

describe("checkPremiumEntitlement", () => {
  it("asks RevenueCat with the secret key and accepts an active entitlement", async () => {
    const fetchMock = stubFetch(200, subscriber(null));
    expect(await checkPremiumEntitlement("user/1", NOW)).toBe("active");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.revenuecat.com/v1/subscribers/user%2F1");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk_test_secret",
    );
  });

  it("rejects an expired entitlement and does not cache the rejection", async () => {
    const fetchMock = stubFetch(
      200,
      subscriber(new Date(NOW - 1).toISOString()),
    );
    expect(await checkPremiumEntitlement("user-2", NOW)).toBe("inactive");
    expect(await checkPremiumEntitlement("user-2", NOW)).toBe("inactive");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches positive answers briefly", async () => {
    const fetchMock = stubFetch(200, subscriber(null));
    expect(await checkPremiumEntitlement("user-3", NOW)).toBe("active");
    expect(await checkPremiumEntitlement("user-3", NOW + 60_000)).toBe(
      "active",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await checkPremiumEntitlement("user-3", NOW + 10 * 60_000)).toBe(
      "active",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches past the entitlement's own expiry", async () => {
    const fetchMock = stubFetch(
      200,
      subscriber(new Date(NOW + 30_000).toISOString()),
    );
    expect(await checkPremiumEntitlement("user-4", NOW)).toBe("active");
    await checkPremiumEntitlement("user-4", NOW + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports RevenueCat outages as unavailable, not inactive", async () => {
    stubFetch(500, {});
    expect(await checkPremiumEntitlement("user-5", NOW)).toBe("unavailable");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await checkPremiumEntitlement("user-5", NOW)).toBe("unavailable");
  });

  it("allows creation without a key outside production (test mode)", async () => {
    delete process.env.REVENUECAT_SECRET_KEY;
    process.env.NODE_ENV = "test";
    const fetchMock = stubFetch(200, {});
    expect(await checkPremiumEntitlement("anyone", NOW)).toBe("active");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without a key in production", async () => {
    delete process.env.REVENUECAT_SECRET_KEY;
    process.env.NODE_ENV = "production";
    expect(await checkPremiumEntitlement("anyone", NOW)).toBe("unavailable");
  });

  it("fails closed if production Lambda omits NODE_ENV and RevenueCat secret", async () => {
    delete process.env.REVENUECAT_SECRET_KEY;
    delete process.env.LASTRIDE_STAGE;
    delete process.env.NODE_ENV;
    expect(await checkPremiumEntitlement("attacker-generated-id", NOW)).toBe("unavailable");
    process.env.LASTRIDE_STAGE = "production";
    expect(await checkPremiumEntitlement("attacker-generated-id", NOW)).toBe("unavailable");
    process.env.NODE_ENV = "test";
    // An explicitly production stage outranks a test-like NODE_ENV.
    expect(await checkPremiumEntitlement("attacker-generated-id", NOW)).toBe("unavailable");
  });

  it("treats the \"test\" key as premium on the staging stack only", async () => {
    process.env.REVENUECAT_SECRET_KEY = "test";
    process.env.NODE_ENV = "production";
    const fetchMock = stubFetch(200, {});
    process.env.LASTRIDE_STAGE = "staging";
    expect(await checkPremiumEntitlement("anyone", NOW)).toBe("active");
    process.env.LASTRIDE_STAGE = "production";
    expect(await checkPremiumEntitlement("anyone", NOW)).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
