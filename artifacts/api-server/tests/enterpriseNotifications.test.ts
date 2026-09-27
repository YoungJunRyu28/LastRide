import { describe, expect, it } from "vitest";
import {
  expoReceiptError,
  notificationKindFor,
} from "../src/lib/enterpriseNotifications";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

describe("enterprise departure alert timing", () => {
  it("does not alert before the configured lead window", () => {
    expect(notificationKindFor(NOW + 11 * MINUTE, 10, NOW)).toBeNull();
  });

  it("alerts once a participant enters the lead window", () => {
    expect(notificationKindFor(NOW + 10 * MINUTE, 10, NOW)).toBe(
      "leaving_soon",
    );
    expect(notificationKindFor(NOW + MINUTE, 10, NOW)).toBe("leaving_soon");
  });

  it("switches to leave-now at the departure time", () => {
    expect(notificationKindFor(NOW, 10, NOW)).toBe("leave_now");
    expect(notificationKindFor(NOW - 5 * MINUTE, 10, NOW)).toBe("leave_now");
  });

  it("does not alert long after the departure time", () => {
    expect(notificationKindFor(NOW - 11 * MINUTE, 10, NOW)).toBeNull();
  });
});

describe("Expo receipt handling", () => {
  it("treats successful receipts as delivered", () => {
    expect(expoReceiptError({ status: "ok" })).toBeNull();
  });

  it("extracts permanent device-registration errors", () => {
    expect(
      expoReceiptError({
        status: "error",
        message: "The device is not registered",
        details: { error: "DeviceNotRegistered" },
      }),
    ).toBe("DeviceNotRegistered");
  });

  it("falls back to the receipt message for other errors", () => {
    expect(
      expoReceiptError({ status: "error", message: "MessageTooBig" }),
    ).toBe("MessageTooBig");
  });
});
