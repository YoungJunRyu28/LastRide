import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { claim, outbox, settle, logs } = vi.hoisted(() => ({
  claim: vi.fn(), outbox: vi.fn(), settle: vi.fn(),
  logs: { warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/lib/groupStore", () => ({ claimDueGroupLeaveAlerts: claim }));
vi.mock("../src/lib/groupAlertOutbox", () => ({ claimGroupDeliveryBatch: outbox, settleGroupDelivery: settle }));
vi.mock("../src/lib/enterpriseNotifications", () => ({ EXPO_PUSH_BATCH_SIZE: 100 }));
vi.mock("../src/lib/logger", () => ({ logger: logs }));
vi.mock("@workspace/db", () => ({ getDb: vi.fn(), groupMembersTable: {} }));

import { dispatchGroupLeaveAlerts } from "../src/lib/groupNotifications";

const delivery = {
  id: "delivery-a", groupId: "group", groupName: "Team", displayName: "Friend",
  leaveBy: new Date("2026-10-16T15:00:00Z"), recipientMemberId: "receiver",
  token: "ExponentPushToken[some-valid-device-token]", language: "ja", attempts: 1,
};
const other = { ...delivery, id: "delivery-b", recipientMemberId: "second", token: "ExponentPushToken[other-device-token]" };

beforeEach(() => {
  claim.mockReset(); outbox.mockReset(); settle.mockReset(); logs.warn.mockReset(); logs.error.mockReset();
  claim.mockResolvedValue([]); outbox.mockResolvedValueOnce([delivery, other]).mockResolvedValue([]);
  settle.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("durable per-recipient group push worker", () => {
  test("keeps each rejected delivery retryable after a total Expo outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    expect(await dispatchGroupLeaveAlerts()).toBe(0);
    expect(settle).toHaveBeenCalledWith(delivery, { error: "HTTP 503" }, expect.any(Date));
    expect(settle).toHaveBeenCalledWith(other, { error: "HTTP 503" }, expect.any(Date));
  });
  test("commits a successful ticket independently of a rejected device", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [
      { status: "ok", id: "ticket-1" },
      { status: "error", details: { error: "MessageTooBig" } },
    ] }), { status: 200 })));
    expect(await dispatchGroupLeaveAlerts()).toBe(1);
    expect(settle).toHaveBeenCalledWith(delivery, { ticketId: "ticket-1" }, expect.any(Date));
    expect(settle).toHaveBeenCalledWith(other, { error: "MessageTooBig" }, expect.any(Date));
  });
  test("an accepted ticket without an Expo id is not counted delivered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [
      { status: "ok" }, { status: "ok", id: "ticket-2" },
    ] }), { status: 200 })));
    expect(await dispatchGroupLeaveAlerts()).toBe(1);
    expect(settle).toHaveBeenCalledWith(delivery, { error: "MissingOrInvalidExpoTicket" }, expect.any(Date));
  });
  test("worker failure to settle one ticket does not discard other ticket success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [
      { status: "ok", id: "ticket-1" }, { status: "ok", id: "ticket-2" },
    ] }), { status: 200 })));
    settle.mockRejectedValueOnce(new Error("database outage"));
    expect(await dispatchGroupLeaveAlerts()).toBe(1);
    expect(logs.error).toHaveBeenCalled();
  });
});
