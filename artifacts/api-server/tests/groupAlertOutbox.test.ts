import { describe, expect, test, vi } from "vitest";
vi.mock("../src/lib/groupStore", () => ({ GROUP_LEAVE_ALERT_GRACE_MS: 600_000 }));
import {
  nextGroupDeliveryRetryDelay, receiptFailure, isTerminalGroupPushReceipt,
  parseGroupPushReceiptEnvelope,
} from "../src/lib/groupAlertOutbox";

describe("bounded retries and receipts", () => {
  test("exponential retry backoff caps at five minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(nextGroupDeliveryRetryDelay))
      .toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  });
  test("only explicit Expo ok/error receipt statuses may consume a durable ticket", () => {
    expect(isTerminalGroupPushReceipt({ status: "ok" })).toBe(true);
    expect(isTerminalGroupPushReceipt({ status: "error", details: { error: "DeviceNotRegistered" } })).toBe(true);
    for (const incomplete of [null, undefined, {}, { status: "pending" }, { status: null }, [], "ok", { message: "No status" }]) {
      expect(isTerminalGroupPushReceipt(incomplete)).toBe(false);
    }
  });
  test("HTTP 200 with malformed Expo envelope does not clear unverified receipt", () => {
    for (const response of [null, {}, [], { data: null }, { errors: [{ code: "PUSH_TOO_MANY_NOTIFICATIONS" }] },
      { data: [] }, { data: "error" }, { data: true }]) {
      expect(() => parseGroupPushReceiptEnvelope(response)).toThrow("Invalid Expo group push receipt response");
    }
    expect(parseGroupPushReceiptEnvelope({ data: { abc: { status: "ok" } } })).toEqual({ abc: { status: "ok" } });
    expect(parseGroupPushReceiptEnvelope({ data: {} })).toEqual({});
  });
  test("receipt status is independent of push ticket acceptance", () => {
    expect(receiptFailure({ status: "ok" })).toBeNull();
    expect(receiptFailure({ status: "error", details: { error: "DeviceNotRegistered" } })).toBe("DeviceNotRegistered");
    expect(receiptFailure({ status: "error" })).toBe("UnknownPushError");
  });
});
