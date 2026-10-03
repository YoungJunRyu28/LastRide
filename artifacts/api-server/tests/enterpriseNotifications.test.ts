import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExpoPushMessage,
  EXPO_PUSH_BATCH_SIZE,
  expoReceiptError,
  notificationKindFor,
  sendExpoPushBatch,
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

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EXPO_ACCESS_TOKEN;
  delete process.env.ENTERPRISE_PUSH_INCLUDE_NAME;
});

const PUSH_INPUT = {
  token: "ExponentPushToken[test]",
  displayName: "Alice",
  leaveBy: new Date("2026-09-27T15:00:00.000Z"),
  kind: "leaving_soon" as const,
  eventId: "event-1",
};

describe("Expo push batching", () => {
  it("keeps participant names off lock screens by default", () => {
    const message = buildExpoPushMessage(PUSH_INPUT);
    expect(message.title).toBe("A participant should leave soon");
    expect(message.title).not.toContain("Alice");

    process.env.ENTERPRISE_PUSH_INCLUDE_NAME = "true";
    expect(buildExpoPushMessage(PUSH_INPUT).title).toBe(
      "Alice should leave soon",
    );
  });

  it("sends one ordered Expo batch and authenticates when push security is enabled", async () => {
    process.env.EXPO_ACCESS_TOKEN = "push-secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body));
      expect(messages).toHaveLength(2);
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer push-secret",
      );
      return new Response(
        JSON.stringify({
          data: [
            { status: "ok", id: "ticket-1" },
            {
              status: "error",
              details: { error: "DeviceNotRegistered" },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await sendExpoPushBatch([
      PUSH_INPUT,
      { ...PUSH_INPUT, token: "ExponentPushToken[test-2]" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { accepted: true, ticketId: "ticket-1" },
      { accepted: false, error: "DeviceNotRegistered" },
    ]);
  });

  it("refuses an oversized request before contacting Expo", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const inputs = Array.from(
      { length: EXPO_PUSH_BATCH_SIZE + 1 },
      (_, index) => ({
        ...PUSH_INPUT,
        token: `ExponentPushToken[test-${index}]`,
      }),
    );

    await expect(sendExpoPushBatch(inputs)).rejects.toThrow(
      /exceeds 100 messages/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
