import { afterEach, describe, expect, it } from "vitest";
import {
  isLeaveByInNight,
  nightWindow,
  serviceDateFor,
} from "../src/lib/groupNight";
import { openGroupInvite, sealGroupInvite } from "../src/lib/groupInvites";
import {
  buildGroupPushMessages,
  groupPushBody,
} from "../src/lib/groupNotifications";

// Helper: a JST wall-clock time as a Date.
function jst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

describe("group night service day", () => {
  it("puts 22:00 and 01:00 JST in the same night", () => {
    expect(serviceDateFor(jst("2026-10-10T22:00:00"))).toBe("2026-10-10");
    expect(serviceDateFor(jst("2026-10-11T01:00:00"))).toBe("2026-10-10");
    expect(serviceDateFor(jst("2026-10-11T03:59:59"))).toBe("2026-10-10");
  });

  it("rolls over at 04:00 JST", () => {
    expect(serviceDateFor(jst("2026-10-11T04:00:00"))).toBe("2026-10-11");
  });

  it("ends the night at 08:00 JST the following morning", () => {
    const window = nightWindow("2026-10-10");
    expect(window.startsAt.toISOString()).toBe(
      jst("2026-10-10T04:00:00").toISOString(),
    );
    expect(window.endsAt.toISOString()).toBe(
      jst("2026-10-11T08:00:00").toISOString(),
    );
  });

  it("handles month and year boundaries", () => {
    expect(nightWindow("2026-12-31").endsAt.toISOString()).toBe(
      jst("2027-01-01T08:00:00").toISOString(),
    );
  });

  it("accepts leave-by times only inside the night", () => {
    expect(isLeaveByInNight(jst("2026-10-10T23:40:00"), "2026-10-10")).toBe(
      true,
    );
    expect(isLeaveByInNight(jst("2026-10-11T00:30:00"), "2026-10-10")).toBe(
      true,
    );
    expect(isLeaveByInNight(jst("2026-10-11T08:01:00"), "2026-10-10")).toBe(
      false,
    );
    expect(isLeaveByInNight(jst("2026-10-10T03:00:00"), "2026-10-10")).toBe(
      false,
    );
  });
});

describe("recoverable group invites", () => {
  const ORIGINAL_KEY = process.env.GROUP_INVITE_ENCRYPTION_KEY;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.GROUP_INVITE_ENCRYPTION_KEY;
    } else process.env.GROUP_INVITE_ENCRYPTION_KEY = ORIGINAL_KEY;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  const invite = { inviteToken: "a".repeat(43), joinCode: "ABCD2345" };

  it("round-trips for the same group only", () => {
    process.env.GROUP_INVITE_ENCRYPTION_KEY = "11".repeat(32);
    const sealed = sealGroupInvite("group-a", invite);
    expect(sealed).not.toContain(invite.joinCode);
    expect(openGroupInvite("group-a", sealed)).toEqual(invite);
    expect(openGroupInvite("group-b", sealed)).toBeNull();
  });

  it("cannot be opened with a different key", () => {
    process.env.GROUP_INVITE_ENCRYPTION_KEY = "11".repeat(32);
    const sealed = sealGroupInvite("group-a", invite);
    process.env.GROUP_INVITE_ENCRYPTION_KEY = "22".repeat(32);
    expect(openGroupInvite("group-a", sealed)).toBeNull();
  });

  it("stores nothing recoverable in production without a key", () => {
    delete process.env.GROUP_INVITE_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";
    expect(sealGroupInvite("group-a", invite)).toBeNull();
  });
});

describe("group push copy", () => {
  it("announces tonight in the member's language", () => {
    const event = { kind: "tonight_started" as const, groupName: "金曜会" };
    expect(groupPushBody(event, "ja")).toBe(
      "金曜会: ホストが今夜の会を始めました",
    );
    expect(groupPushBody(event, "en")).toBe(
      "金曜会: The host started tonight's meetup",
    );
  });

  it("formats the leave time in JST", () => {
    const event = {
      kind: "leave_time" as const,
      groupName: "金曜会",
      displayName: "ゆき",
      leaveBy: jst("2026-10-10T23:28:00"),
    };
    expect(groupPushBody(event, "ja")).toBe("金曜会: ゆきさんの出発時刻です（23:28）");
    expect(groupPushBody(event, "en")).toBe("金曜会: time for ゆき to leave (23:28)");
    expect(
      groupPushBody({ ...event, leaveBy: jst("2026-10-11T00:05:00") }, "ja"),
    ).toBe("金曜会: ゆきさんの出発時刻です（00:05）");
  });

  it("builds one operational message per recipient, deep-linking the group", () => {
    const messages = buildGroupPushMessages(
      "g1",
      { kind: "missed", groupName: "金曜会", displayName: "ゆき" },
      [
        { memberId: "m1", expoPushToken: "ExponentPushToken[a]", language: "ja" },
        { memberId: "m2", expoPushToken: "ExponentPushToken[b]", language: "en" },
      ],
    );
    expect(messages.map((message) => message.body)).toEqual([
      "金曜会: ゆきさんが終電に乗り遅れました",
      "金曜会: ゆき missed their train",
    ]);
    expect(messages[0].data).toEqual({
      target: "/groups",
      groupId: "g1",
      kind: "missed",
    });
    for (const message of messages) {
      expect(message.body).not.toMatch(/premium|プレミアム|sale|セール|%/i);
    }
  });
});
