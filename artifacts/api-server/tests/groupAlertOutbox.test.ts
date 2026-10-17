import { describe, expect, test, vi } from "vitest";
vi.mock("../src/lib/groupStore", () => ({ GROUP_LEAVE_ALERT_GRACE_MS: 600_000 }));
import { nextGroupDeliveryRetryDelay, receiptFailure } from "../src/lib/groupAlertOutbox";

describe("bounded retries and receipts", () => {
  test("exponential retry backoff caps at five minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(nextGroupDeliveryRetryDelay))
      .toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  });
  test("receipt status is independent of push ticket acceptance", () => {
    expect(receiptFailure({ status: "ok" })).toBeNull();
    expect(receiptFailure({ status: "error", details: { error: "DeviceNotRegistered" } })).toBe("DeviceNotRegistered");
    expect(receiptFailure({ status: "error" })).toBe("UnknownPushError");
  });
});
