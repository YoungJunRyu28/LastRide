import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { claim, release, logs } = vi.hoisted(() => ({
  claim: vi.fn(),
  release: vi.fn(),
  logs: { warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/lib/groupStore", () => ({
  claimDueGroupLeaveAlerts: claim,
  releaseFailedGroupLeaveAlert: release,
}));
vi.mock("../src/lib/enterpriseNotifications", () => ({ EXPO_PUSH_BATCH_SIZE: 100 }));
vi.mock("../src/lib/logger", () => ({ logger: logs }));
vi.mock("@workspace/db", () => ({ getDb: vi.fn(), groupMembersTable: {} }));

import { dispatchGroupLeaveAlerts } from "../src/lib/groupNotifications";

const due = {
  nightId: "night",
  groupId: "group",
  memberId: "leaving",
  groupName: "Team",
  displayName: "Friend",
  leaveBy: new Date("2026-10-16T15:00:00Z"),
  recipients: [{ memberId: "receiver", expoPushToken: "ExponentPushToken[some-valid-device-token]", language: "ja" }],
};

beforeEach(() => {
  claim.mockReset();
  release.mockReset();
  logs.warn.mockReset();
  logs.error.mockReset();
  claim.mockResolvedValue([due]);
  release.mockResolvedValue(undefined);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("group leave-time dispatch crash/outage behavior", () => {
  test("re-arms a due alert when Expo rejects the entire batch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    expect(await dispatchGroupLeaveAlerts()).toBe(0);
    expect(release).toHaveBeenCalledWith(due);
  });

  test("does not re-arm when Expo accepts the delivery ticket", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 }),
    ));
    expect(await dispatchGroupLeaveAlerts()).toBe(1);
    expect(release).not.toHaveBeenCalled();
  });

  test("does not re-arm a leave alert when no recipient opted in", async () => {
    claim.mockResolvedValue([{ ...due, recipients: [] }]);
    vi.stubGlobal("fetch", vi.fn());
    expect(await dispatchGroupLeaveAlerts()).toBe(0);
    expect(release).not.toHaveBeenCalled();
  });
});
