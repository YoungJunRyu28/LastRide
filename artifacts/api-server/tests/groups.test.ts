import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  apiRateLimitsTable,
  getDb,
  groupAlertDeliveriesTable,
  groupMembersTable,
  groupNightParticipantsTable,
  groupNightsTable,
  groupsTable,
} from "@workspace/db";
import {
  createGroupRecord,
  disbandGroupRecord,
  endGroupTonightRecord,
  getGroupDetailRecord,
  claimDueGroupLeaveAlerts,
  nextGroupLeaveAlertAt,
  GROUP_MEMBER_LIMIT,
  joinGroupRecord,
  leaveGroupRecord,
  leaveGroupTonightRecord,
  purgeEndedGroupNights,
  purgeInactiveGroupMembers,
  removeGroupMemberRecord,
  renameGroupRecord,
  rotateGroupInviteRecord,
  setGroupTonightParticipationRecord,
  startGroupTonightRecord,
  updateGroupMembershipRecord,
} from "../src/lib/groupStore";
import { nightWindow, serviceDateFor } from "../src/lib/groupNight";
import { clearEntitlementCache } from "../src/lib/revenueCat";
import { dispatchGroupLeaveAlerts } from "../src/lib/groupNotifications";
import { claimGroupDeliveryBatch, settleGroupDelivery } from "../src/lib/groupAlertOutbox";
import app from "../src/app";

/**
 * Runs against a real, disposable Postgres (DATABASE_URL) initialized from the
 * committed migrations, like enterpriseStore.test.ts. Store and HTTP tests
 * share this file because both clear the groups tables, and vitest runs
 * separate files in parallel.
 */
async function clearGroups() {
  // Cascades to members, nights and participants.
  await getDb().delete(groupsTable);
}

beforeEach(clearGroups);
afterAll(clearGroups);

async function groupWithMembers(names: string[] = ["Bea", "Cai"]) {
  const created = await createGroupRecord({
    name: "金曜会",
    displayName: "Ann",
  });
  if (created.kind !== "created") throw new Error("create failed");
  const invite = created.group.invite;
  if (!invite) throw new Error("host should see the invite");
  const members = [];
  for (const name of names) {
    const joined = await joinGroupRecord({
      inviteToken: invite.inviteToken,
      displayName: name,
    });
    if (joined.kind !== "joined") throw new Error("join failed");
    members.push({ token: joined.memberToken, id: joined.group.me.memberId });
  }
  return {
    groupId: created.group.id,
    host: { token: created.memberToken, id: created.group.me.memberId },
    invite,
    members,
  };
}

function tonightWindow(now = new Date()) {
  return nightWindow(serviceDateFor(now));
}

async function setPush(groupId: string, token: string, suffix: string) {
  const result = await updateGroupMembershipRecord(groupId, token, {
    expoPushToken: `ExponentPushToken[${suffix.padEnd(20, "x")}]`,
  });
  if (result.kind !== "ok") throw new Error("push registration failed");
}

describe("group creation and joining", () => {
  it("creates a group whose creator is host and sees the invite", async () => {
    const created = await createGroupRecord({
      name: "  金曜会  ",
      displayName: "Ann",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    expect(created.group.name).toBe("金曜会");
    expect(created.group.me.role).toBe("host");
    expect(created.group.invite?.joinCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(created.group.memberLimit).toBe(GROUP_MEMBER_LIMIT);

    // Only hashes of capabilities are stored in their lookup columns.
    const [row] = await getDb()
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.id, created.group.id));
    expect(row.inviteTokenHash).not.toBe(created.group.invite?.inviteToken);
    expect(row.inviteCiphertext).not.toContain(
      created.group.invite?.joinCode ?? "",
    );
    const [member] = await getDb()
      .select()
      .from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, created.group.id));
    expect(member.memberTokenHash).not.toBe(created.memberToken);
  });

  it("joins by short join code, case- and dash-insensitively", async () => {
    const { invite } = await groupWithMembers([]);
    const code = invite.joinCode.toLowerCase();
    const joined = await joinGroupRecord({
      joinCode: `${code.slice(0, 4)}-${code.slice(4)}`,
      displayName: "Dan",
    });
    expect(joined.kind).toBe("joined");
    if (joined.kind !== "joined") return;
    expect(joined.group.me.role).toBe("member");
    // Members can invite too: the same link and code as the host.
    expect(joined.group.invite?.joinCode).toBe(invite.joinCode);
    expect(joined.group.members.map((member) => member.displayName)).toEqual([
      "Ann",
      "Dan",
    ]);
  });

  it("joining your own group again returns your membership, never a second member", async () => {
    const created = await createGroupRecord({ name: "金曜会", displayName: "Ann" });
    if (created.kind !== "created" || !created.group.invite) throw new Error("setup");
    const other = await createGroupRecord({ name: "別の会", displayName: "Ann" });
    if (other.kind !== "created") throw new Error("setup");
    // The host opens their own invite link (this device also holds another group's token).
    const again = await joinGroupRecord({
      inviteToken: created.group.invite.inviteToken,
      displayName: "Ann 2",
      knownMemberTokens: [other.memberToken, created.memberToken],
    });
    expect(again.kind).toBe("already");
    if (again.kind !== "already") return;
    expect(again.memberToken).toBe(created.memberToken);
    expect(again.group.me.role).toBe("host");
    expect(again.group.members).toHaveLength(1);
    // Tokens for other groups don't stop a real join.
    const someoneElse = await joinGroupRecord({
      inviteToken: created.group.invite.inviteToken,
      displayName: "Bea",
      knownMemberTokens: [other.memberToken],
    });
    expect(someoneElse.kind).toBe("joined");
  });

  it("rejects unknown codes and blank names", async () => {
    await groupWithMembers([]);
    expect(
      (await joinGroupRecord({ joinCode: "ZZZZZZZZ", displayName: "X" })).kind,
    ).toBe("invalid");
    const { invite } = await groupWithMembers([]);
    expect(
      (await joinGroupRecord({ joinCode: invite.joinCode, displayName: "  " }))
        .kind,
    ).toBe("invalid");
  });

  it("caps a group at 50 members", async () => {
    const { groupId, invite } = await groupWithMembers([]);
    await getDb()
      .insert(groupMembersTable)
      .values(
        Array.from({ length: GROUP_MEMBER_LIMIT - 1 }, (_, index) => ({
          groupId,
          displayName: `m${index}`,
          memberTokenHash: String(index).padStart(64, "f"),
        })),
      );
    const joined = await joinGroupRecord({
      inviteToken: invite.inviteToken,
      displayName: "Late",
    });
    expect(joined.kind).toBe("full");
  });

  it("rotating the invite revokes the old link and code; host can re-read the new one", async () => {
    const { groupId, host, invite } = await groupWithMembers([]);
    const rotated = await rotateGroupInviteRecord(groupId, host.token);
    expect(rotated.kind).toBe("ok");
    if (rotated.kind !== "ok") return;

    expect(
      (await joinGroupRecord({ inviteToken: invite.inviteToken, displayName: "Old" }))
        .kind,
    ).toBe("invalid");
    expect(
      (await joinGroupRecord({ joinCode: invite.joinCode, displayName: "Old" }))
        .kind,
    ).toBe("invalid");
    expect(
      (await joinGroupRecord({ joinCode: rotated.invite.joinCode, displayName: "New" }))
        .kind,
    ).toBe("joined");

    const detail = await getGroupDetailRecord(groupId, host.token);
    expect(detail?.invite?.inviteToken).toBe(rotated.invite.inviteToken);
    expect(detail?.invite?.joinCode).toBe(rotated.invite.joinCode);
  });
});

describe("host-only actions", () => {
  it("rejects every host action from a regular member", async () => {
    const { groupId, host, members } = await groupWithMembers();
    const member = members[0];
    expect((await renameGroupRecord(groupId, member.token, "x")).kind).toBe(
      "forbidden",
    );
    expect((await disbandGroupRecord(groupId, member.token)).kind).toBe(
      "forbidden",
    );
    expect((await rotateGroupInviteRecord(groupId, member.token)).kind).toBe(
      "forbidden",
    );
    expect(
      (await removeGroupMemberRecord(groupId, member.token, host.id)).kind,
    ).toBe("forbidden");
    expect((await startGroupTonightRecord(groupId, member.token)).kind).toBe(
      "forbidden",
    );
    expect((await endGroupTonightRecord(groupId, member.token)).kind).toBe(
      "forbidden",
    );
  });

  it("does not accept a member token for a different group", async () => {
    const first = await groupWithMembers([]);
    const second = await groupWithMembers([]);
    expect(await getGroupDetailRecord(second.groupId, first.host.token)).toBeNull();
    expect((await renameGroupRecord(second.groupId, first.host.token, "x")).kind).toBe(
      "not-found",
    );
  });

  it("the host cannot simply leave (only disband, or hand over on reset)", async () => {
    const { groupId, host } = await groupWithMembers();
    expect((await leaveGroupRecord(groupId, host.token)).kind).toBe("host");
  });

  it("removing a member revokes their token", async () => {
    const { groupId, host, members } = await groupWithMembers();
    const removed = await removeGroupMemberRecord(
      groupId,
      host.token,
      members[0].id,
    );
    expect(removed.kind).toBe("ok");
    expect(await getGroupDetailRecord(groupId, members[0].token)).toBeNull();
    expect(
      (await removeGroupMemberRecord(groupId, host.token, host.id)).kind,
    ).toBe("self");
  });

  it("disbanding deletes the group and everything under it", async () => {
    const { groupId, host, members } = await groupWithMembers();
    await startGroupTonightRecord(groupId, host.token);
    await setGroupTonightParticipationRecord(groupId, members[0].token, null);
    expect((await disbandGroupRecord(groupId, host.token)).kind).toBe("ok");
    const db = getDb();
    expect(await db.select().from(groupsTable)).toHaveLength(0);
    expect(await db.select().from(groupMembersTable)).toHaveLength(0);
    expect(await db.select().from(groupNightsTable)).toHaveLength(0);
    expect(await db.select().from(groupNightParticipantsTable)).toHaveLength(0);
  });

  it("member settings are per group and the display name can change", async () => {
    const { groupId, members } = await groupWithMembers();
    const updated = await updateGroupMembershipRecord(groupId, members[0].token, {
      displayName: "Bee",
      language: "en",
      expoPushToken: "ExponentPushToken[abcdefghijklmnopqrst]",
    });
    expect(updated.kind).toBe("ok");
    if (updated.kind !== "ok") return;
    expect(updated.group.me).toMatchObject({
      displayName: "Bee",
      language: "en",
      pushRegistered: true,
    });
    const cleared = await updateGroupMembershipRecord(groupId, members[0].token, {
      expoPushToken: null,
    });
    expect(cleared.kind === "ok" && cleared.group.me.pushRegistered).toBe(false);
  });
});

describe("leaving on reset, and members whose app is gone", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seen(memberId: string, daysAgo: number, pushInvalid = false) {
    const at = new Date(Date.now() - daysAgo * DAY);
    await getDb()
      .update(groupMembersTable)
      .set({ lastSeenAt: at, pushTokenInvalidAt: pushInvalid ? at : null })
      .where(eq(groupMembersTable.id, memberId));
  }

  async function roleOf(memberId: string) {
    const [row] = await getDb()
      .select({ role: groupMembersTable.role })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.id, memberId));
    return row?.role ?? null;
  }

  it("reset as host disbands the group (hosting isn't passed on)", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    expect((await leaveGroupRecord(groupId, host.token, { disbandIfHost: true })).kind).toBe("ok");
    const rows = await getDb().select().from(groupsTable).where(eq(groupsTable.id, groupId));
    expect(rows).toHaveLength(0);
    expect(await roleOf(members[0].id)).toBeNull();
  });

  it("reset as a member just leaves", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea"]);
    expect((await leaveGroupRecord(groupId, members[0].token, { disbandIfHost: true })).kind).toBe("ok");
    expect(await roleOf(members[0].id)).toBeNull();
    expect(await roleOf(host.id)).toBe("host");
  });

  it("any request from the app refreshes last-seen", async () => {
    const { groupId, members } = await groupWithMembers(["Bea"]);
    await seen(members[0].id, 100);
    await getGroupDetailRecord(groupId, members[0].token);
    const [row] = await getDb()
      .select({ lastSeenAt: groupMembersTable.lastSeenAt })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.id, members[0].id));
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(60_000);
  });

  it("the cleanup removes long-inactive members and members whose app was deleted", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai", "Dan", "Eve"]);
    await seen(members[0].id, 200); // 6+ months away: removed
    await seen(members[1].id, 40, true); // push token dead, 30+ days: removed
    await seen(members[2].id, 10, true); // push token dead but recent: kept
    await seen(members[3].id, 100); // quiet but under 6 months: kept

    expect(await purgeInactiveGroupMembers()).toBe(2);
    expect(await roleOf(members[0].id)).toBeNull();
    expect(await roleOf(members[1].id)).toBeNull();
    expect(await roleOf(members[2].id)).toBe("member");
    expect(await roleOf(members[3].id)).toBe("member");
    expect(await roleOf(host.id)).toBe("host");
    expect(await getGroupDetailRecord(groupId, host.token)).not.toBeNull();
  });

  it("an inactive host's group is disbanded", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea"]);
    await seen(host.id, 200);

    expect(await purgeInactiveGroupMembers()).toBe(1);
    expect(await roleOf(members[0].id)).toBeNull();
    const rows = await getDb().select().from(groupsTable).where(eq(groupsTable.id, groupId));
    expect(rows).toHaveLength(0);
  });

  it("メンバーの出発時刻 can be muted on its own", async () => {
    const { groupId, members } = await groupWithMembers(["Bea"]);
    const muted = await updateGroupMembershipRecord(groupId, members[0].token, { leaveTimeAlerts: false });
    expect(muted.kind).toBe("ok");
    if (muted.kind !== "ok") return;
    expect(muted.group.me.leaveTimeAlerts).toBe(false);
    // Everything else stays on.
    expect(muted.group.me.notifications).toBe(true);
  });

  it("a fresh push token clears the dead-token mark", async () => {
    const { groupId, members } = await groupWithMembers(["Bea"]);
    await seen(members[0].id, 1, true);
    await setPush(groupId, members[0].token, "fresh");
    const [row] = await getDb()
      .select({ invalid: groupMembersTable.pushTokenInvalidAt })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.id, members[0].id));
    expect(row.invalid).toBeNull();
  });
});

describe("tonight", () => {
  it("activation returns push recipients for every other member, once", async () => {
    const { groupId, host, members } = await groupWithMembers();
    await setPush(groupId, host.token, "host");
    await setPush(groupId, members[0].token, "bea");

    const started = await startGroupTonightRecord(groupId, host.token);
    expect(started.kind).toBe("ok");
    if (started.kind !== "ok") return;
    expect(started.started).toBe(true);
    expect(started.group.tonight.active).toBe(true);
    expect(started.group.tonight.endsAt?.toISOString()).toBe(
      tonightWindow().endsAt.toISOString(),
    );
    // Host is not notified of their own action; Cai has no push token.
    expect(started.recipients.map((r) => r.memberId)).toEqual([members[0].id]);

    const again = await startGroupTonightRecord(groupId, host.token);
    expect(again.kind === "ok" && again.started).toBe(false);
    expect(again.kind === "ok" && again.recipients).toEqual([]);
    expect(await getDb().select().from(groupNightsTable)).toHaveLength(1);
  });

  it("opt-in requires an active night and a leave-by inside it", async () => {
    const { groupId, host, members } = await groupWithMembers();
    const window = tonightWindow();
    const inside = new Date(window.endsAt.getTime() - 6 * 60 * 60_000);

    expect(
      (await setGroupTonightParticipationRecord(groupId, members[0].token, inside))
        .kind,
    ).toBe("inactive");

    await startGroupTonightRecord(groupId, host.token);
    expect(
      (
        await setGroupTonightParticipationRecord(
          groupId,
          members[0].token,
          new Date(window.endsAt.getTime() + 60_000),
        )
      ).kind,
    ).toBe("invalid-leave-by");
    expect(
      (
        await setGroupTonightParticipationRecord(
          groupId,
          members[0].token,
          new Date(window.startsAt.getTime() - 60_000),
        )
      ).kind,
    ).toBe("invalid-leave-by");

    // Opt in without a time yet, then update it twice; then a second member.
    await setGroupTonightParticipationRecord(groupId, members[0].token, undefined);
    await setGroupTonightParticipationRecord(groupId, members[0].token, inside);
    const later = new Date(inside.getTime() + 30 * 60_000);
    await setGroupTonightParticipationRecord(groupId, members[0].token, later);
    const earlier = new Date(inside.getTime() - 30 * 60_000);
    const result = await setGroupTonightParticipationRecord(
      groupId,
      members[1].token,
      earlier,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Sorted by leave-by.
    expect(result.group.tonight.participants).toEqual([
      { memberId: members[1].id, displayName: "Cai", leaveBy: earlier },
      { memberId: members[0].id, displayName: "Bea", leaveBy: later },
    ]);

    // undefined keeps the current leave-by.
    const kept = await setGroupTonightParticipationRecord(
      groupId,
      members[0].token,
      undefined,
    );
    expect(
      kept.kind === "ok" &&
        kept.group.tonight.participants.find((p) => p.memberId === members[0].id)
          ?.leaveBy,
    ).toEqual(later);

    // Opting out deletes the row.
    const out = await leaveGroupTonightRecord(groupId, members[0].token);
    expect(out.kind === "ok" && out.group.tonight.participants).toHaveLength(1);
  });

  it("ending the night early deletes every leave-by", async () => {
    const { groupId, host, members } = await groupWithMembers();
    await startGroupTonightRecord(groupId, host.token);
    await setGroupTonightParticipationRecord(
      groupId,
      members[0].token,
      new Date(tonightWindow().endsAt.getTime() - 60 * 60_000),
    );
    const ended = await endGroupTonightRecord(groupId, host.token);
    expect(ended.kind === "ok" && ended.group.tonight.active).toBe(false);
    expect(await getDb().select().from(groupNightParticipantsTable)).toHaveLength(0);
    expect(await getDb().select().from(groupNightsTable)).toHaveLength(0);
  });

  it("the scheduled purge deletes nights and leave-by rows after 08:00 JST", async () => {
    const { groupId, host, members } = await groupWithMembers();
    await startGroupTonightRecord(groupId, host.token);
    const endsAt = tonightWindow().endsAt;
    await setGroupTonightParticipationRecord(
      groupId,
      members[0].token,
      new Date(endsAt.getTime() - 60 * 60_000),
    );

    expect(await purgeEndedGroupNights(new Date(endsAt.getTime() - 1))).toBe(0);
    expect(await getDb().select().from(groupNightParticipantsTable)).toHaveLength(1);

    expect(await purgeEndedGroupNights(endsAt)).toBe(1);
    expect(await getDb().select().from(groupNightParticipantsTable)).toHaveLength(0);
    expect(await getDb().select().from(groupNightsTable)).toHaveLength(0);
  });

  it("reads lazily expire a finished night even without the scheduled job", async () => {
    const { groupId, host, members } = await groupWithMembers();
    await startGroupTonightRecord(groupId, host.token);
    const endsAt = tonightWindow().endsAt;
    await setGroupTonightParticipationRecord(
      groupId,
      members[0].token,
      new Date(endsAt.getTime() - 60 * 60_000),
    );

    const after = new Date(endsAt.getTime() + 60_000);
    const detail = await getGroupDetailRecord(groupId, members[1].token, after);
    expect(detail?.tonight).toEqual({
      active: false,
      serviceDate: null,
      startedAt: null,
      endsAt: null,
      participants: [],
    });
    expect(await getDb().select().from(groupNightParticipantsTable)).toHaveLength(0);
    // The member's own write after expiry finds no night.
    expect(
      (await setGroupTonightParticipationRecord(groupId, members[0].token, null, after))
        .kind,
    ).toBe("inactive");
  });

  it("the 今夜の開始 and メンバーの出発時刻 switches are independent", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    const [bea, cai] = members;
    for (const [who, label] of [[host, "host"], [bea, "bea"], [cai, "cai"]] as const) {
      await setPush(groupId, who.token, label);
    }
    // Bea mutes the start notification only.
    await updateGroupMembershipRecord(groupId, bea.token, { notifications: false });
    const started = await startGroupTonightRecord(groupId, host.token);
    expect(started.kind === "ok" && started.recipients.map((r) => r.memberId)).toEqual([cai.id]);
    // …but still hears when Cai's leave time comes.
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 2 * 60 * 60_000);
    await setGroupTonightParticipationRecord(groupId, bea.token, null);
    await setGroupTonightParticipationRecord(groupId, cai.token, leaveBy);
    const [alert] = await claimDueGroupLeaveAlerts(new Date(leaveBy.getTime() + 60_000));
    expect(alert.recipients.map((r) => r.memberId).sort()).toEqual([host.id, bea.id].sort());
  });

  it("the next leave-time alert due is the earliest unsent one, and moves on once sent", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    const [bea, cai] = members;
    await startGroupTonightRecord(groupId, host.token);
    const early = new Date(tonightWindow().endsAt.getTime() - 3 * 60 * 60_000);
    const late = new Date(early.getTime() + 20 * 60_000);
    const before = new Date(early.getTime() - 60 * 60_000);
    expect(await nextGroupLeaveAlertAt(before)).toBeNull();

    await setGroupTonightParticipationRecord(groupId, cai.token, late);
    await setGroupTonightParticipationRecord(groupId, bea.token, early);
    expect(await nextGroupLeaveAlertAt(before)).toEqual(early);

    // Bea's alert is sent: next up is Cai's.
    await claimDueGroupLeaveAlerts(new Date(early.getTime() + 60_000));
    expect(await nextGroupLeaveAlertAt(new Date(early.getTime() + 60_000))).toEqual(late);
  });

  it("leave-time alerts skip members who muted メンバーの出発時刻", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    const [bea, cai] = members;
    for (const [who, label] of [[host, "host"], [bea, "bea"], [cai, "cai"]] as const) {
      await setPush(groupId, who.token, label);
    }
    await updateGroupMembershipRecord(groupId, cai.token, { leaveTimeAlerts: false });
    await startGroupTonightRecord(groupId, host.token);
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 2 * 60 * 60_000);
    await setGroupTonightParticipationRecord(groupId, bea.token, leaveBy);
    await setGroupTonightParticipationRecord(groupId, cai.token, null);
    const [alert] = await claimDueGroupLeaveAlerts(new Date(leaveBy.getTime() + 60_000));
    // The host still hears about Bea; Cai, who muted it, doesn't.
    expect(alert.recipients.map((r) => r.memberId)).toEqual([host.id]);
  });

  it("leave-time alerts fire once per night and re-arm only when leave-by moves later", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai", "Dan"]);
    const [bea, cai, dan] = members;
    for (const [who, label] of [
      [host, "host"],
      [bea, "bea"],
      [cai, "cai"],
      [dan, "dan"],
    ] as const) {
      await setPush(groupId, who.token, label);
    }
    // Dan switched メンバーの出発時刻 off.
    const off = await updateGroupMembershipRecord(groupId, dan.token, {
      leaveTimeAlerts: false,
    });
    expect(off.kind === "ok" && off.group.me.leaveTimeAlerts).toBe(false);

    await startGroupTonightRecord(groupId, host.token);
    const MIN = 60_000;
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 2 * 60 * MIN);
    await setGroupTonightParticipationRecord(groupId, bea.token, leaveBy);
    await setGroupTonightParticipationRecord(groupId, cai.token, null);
    await setGroupTonightParticipationRecord(groupId, dan.token, null);
    const at = (offsetMinutes: number) =>
      new Date(leaveBy.getTime() + offsetMinutes * MIN);

    expect(await claimDueGroupLeaveAlerts(at(-1))).toEqual([]);

    const first = await claimDueGroupLeaveAlerts(at(1));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ memberId: bea.id, displayName: "Bea", leaveBy });
    // Other participants + host; not Bea herself, not Dan (leave times muted).
    expect(first[0].recipients.map((r) => r.memberId).sort()).toEqual(
      [host.id, cai.id].sort(),
    );
    expect(await claimDueGroupLeaveAlerts(at(2))).toEqual([]);

    // Moving earlier (or to the same time) does not re-send.
    await setGroupTonightParticipationRecord(groupId, bea.token, at(-5));
    expect(await claimDueGroupLeaveAlerts(at(3))).toEqual([]);

    // Moving later than the alerted time re-arms it, once.
    await setGroupTonightParticipationRecord(groupId, bea.token, at(30));
    expect(await claimDueGroupLeaveAlerts(at(29))).toEqual([]);
    expect(await claimDueGroupLeaveAlerts(at(31))).toHaveLength(1);
    expect(await claimDueGroupLeaveAlerts(at(32))).toEqual([]);
  });

  it("atomically enqueues each recipient once, retries individual failures and expires with the night", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    const [bea, cai] = members;
    for (const [member, name] of [[host, "host"], [bea, "bea"], [cai, "cai"]] as const)
      await setPush(groupId, member.token, name);
    await startGroupTonightRecord(groupId, host.token);
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 2 * 60 * 60_000);
    await setGroupTonightParticipationRecord(groupId, bea.token, leaveBy);
    await setGroupTonightParticipationRecord(groupId, cai.token, null);
    const dueAt = new Date(leaveBy.getTime() + 60_000);
    const [alert] = await claimDueGroupLeaveAlerts(dueAt);
    expect(alert.recipients).toHaveLength(2);
    expect(await getDb().select().from(groupAlertDeliveriesTable)).toHaveLength(2);
    expect(await claimDueGroupLeaveAlerts(dueAt)).toEqual([]);
    expect(await getDb().select().from(groupAlertDeliveriesTable)).toHaveLength(2);

    const leased = await claimGroupDeliveryBatch(dueAt);
    expect(leased).toHaveLength(2);
    expect(await claimGroupDeliveryBatch(dueAt)).toHaveLength(0);
    const succeeded = leased[0];
    const failed = leased[1];
    await settleGroupDelivery(succeeded, { ticketId: "ticket-1" }, dueAt);
    await settleGroupDelivery(failed, { error: "HTTP 503" }, dueAt);
    const retryAt = new Date(dueAt.getTime() + 31_000);
    const retryBatch = await claimGroupDeliveryBatch(retryAt);
    expect(retryBatch.map((delivery) => delivery.id)).toEqual([failed.id]);
    await settleGroupDelivery(retryBatch[0], { ticketId: "ticket-2" }, retryAt);
    expect(await claimGroupDeliveryBatch(new Date(retryAt.getTime() + 60_000))).toHaveLength(0);

    // The source's private leave-by time and push tickets never survive 08:00 JST.
    expect(await purgeEndedGroupNights(tonightWindow().endsAt)).toBe(1);
    expect(await getDb().select().from(groupAlertDeliveriesTable)).toEqual([]);
  });

  it("does not send stale leave-time alerts", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    await startGroupTonightRecord(groupId, host.token);
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 2 * 60 * 60_000);
    await setGroupTonightParticipationRecord(groupId, members[0].token, leaveBy);
    expect(
      await claimDueGroupLeaveAlerts(new Date(leaveBy.getTime() + 11 * 60_000)),
    ).toEqual([]);
  });

});

describe("groups HTTP routes", () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  let pushes: Array<{ to: string; body?: string; kind?: string }> = [];
  let premium = true;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    pushes = [];
    premium = true;
    clearEntitlementCache();
    process.env.REVENUECAT_SECRET_KEY = "sk_test_secret";
    // Reset this file's rate-limit windows so reruns within a minute pass.
    const keys = ["127.0.0.1", "::ffff:127.0.0.1", "::1"].flatMap((ip) => [
      `groups-create:${ip}`,
      `groups-join:${ip}`,
    ]);
    await getDb()
      .delete(apiRateLimitsTable)
      .where(
        inArray(
          apiRateLimitsTable.keyHash,
          keys.map((key) => createHash("sha256").update(key).digest("hex")),
        ),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://api.revenuecat.com/")) {
          return new Response(
            JSON.stringify({
              subscriber: {
                entitlements: premium ? { premium: { expires_date: null } } : {},
              },
            }),
            { status: 200 },
          );
        }
        if (url.startsWith("https://exp.host/")) {
          const batch = JSON.parse(String(init?.body)) as Array<{
            to: string;
            body?: string;
            data?: { kind?: string };
          }>;
          pushes.push(...batch.map(({ to, body, data }) => ({ to, body, kind: data?.kind })));
          return new Response(
            JSON.stringify({ data: batch.map(() => ({ status: "ok", id: "t" })) }),
            { status: 200 },
          );
        }
        return realFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.REVENUECAT_SECRET_KEY;
  });

  function call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) {
    return realFetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { "X-Member-Token": options.token } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  }

  const createBody = { name: "金曜会", displayName: "Ann", language: "ja" };

  it("creating a group requires the premium entitlement", async () => {
    const missing = await call("POST", "/groups", { body: createBody });
    expect(missing.status).toBe(400);

    premium = false;
    const denied = await call("POST", "/groups", {
      body: createBody,
      headers: { "X-RevenueCat-App-User-Id": "free-user" },
    });
    expect(denied.status).toBe(402);

    premium = true;
    const created = await call("POST", "/groups", {
      body: createBody,
      headers: { "X-RevenueCat-App-User-Id": "paid-user" },
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as {
      memberToken: string;
      group: { me: { role: string }; invite: { joinCode: string } };
    };
    expect(session.memberToken.length).toBeGreaterThanOrEqual(32);
    expect(session.group.me.role).toBe("host");
    expect(session.group.invite.joinCode).toHaveLength(8);
  });

  it("reset as host over HTTP disbands the group", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea"]);
    const left = await call("DELETE", `/groups/${groupId}/me`, { token: host.token });
    expect(left.status).toBe(409);
    const reset = await call("POST", `/groups/${groupId}/me/reset`, { token: host.token });
    expect(reset.status).toBe(204);
    // The host's reset disbands the group for everyone.
    expect(await getGroupDetailRecord(groupId, members[0].token)).toBeNull();
    const again = await call("POST", `/groups/${groupId}/me/reset`, { token: host.token });
    expect(again.status).toBe(404);
  });

  it("joining your own group over HTTP: 200 with alreadyMember, no new member", async () => {
    const created = await createGroupRecord({ name: "金曜会", displayName: "Ann" });
    if (created.kind !== "created" || !created.group.invite) throw new Error("setup");
    // Over HTTP: 200 with alreadyMember, not 201.
    const response = await call("POST", "/groups/join", {
      body: { joinCode: created.group.invite.joinCode, displayName: "Ann", knownMemberTokens: [created.memberToken] },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { alreadyMember?: boolean; memberToken: string };
    expect(body.alreadyMember).toBe(true);
    expect(body.memberToken).toBe(created.memberToken);
    const members = await getDb().select().from(groupMembersTable).where(eq(groupMembersTable.groupId, created.group.id));
    expect(members).toHaveLength(1);
  });

  it("join is free, and host-only routes reject members with 403", async () => {
    const created = await call("POST", "/groups", {
      body: createBody,
      headers: { "X-RevenueCat-App-User-Id": "paid-user" },
    });
    const host = (await created.json()) as {
      memberToken: string;
      group: { id: string; me: { memberId: string }; invite: { joinCode: string } };
    };
    const groupId = host.group.id;

    premium = false; // joining never consults RevenueCat
    const joinedResponse = await call("POST", "/groups/join", {
      body: { joinCode: host.group.invite.joinCode, displayName: "Bea" },
    });
    expect(joinedResponse.status).toBe(201);
    const member = (await joinedResponse.json()) as {
      memberToken: string;
      group: { me: { memberId: string } };
    };

    const memberCalls: Array<[string, string, unknown?]> = [
      ["PATCH", `/groups/${groupId}`, { name: "x" }],
      ["DELETE", `/groups/${groupId}`],
      ["POST", `/groups/${groupId}/invite`],
      ["DELETE", `/groups/${groupId}/members/${host.group.me.memberId}`],
      ["POST", `/groups/${groupId}/tonight`],
      ["DELETE", `/groups/${groupId}/tonight`],
    ];
    for (const [method, path, body] of memberCalls) {
      const response = await call(method, path, { token: member.memberToken, body });
      expect(`${method} ${path} ${response.status}`).toBe(`${method} ${path} 403`);
    }

    // Host cannot simply leave.
    const leave = await call("DELETE", `/groups/${groupId}/me`, {
      token: host.memberToken,
    });
    expect(leave.status).toBe(409);

    // Auth / validation perimeter.
    expect((await call("GET", `/groups/${groupId}`)).status).toBe(401);
    expect(
      (await call("GET", `/groups/not-a-uuid`, { token: member.memberToken })).status,
    ).toBe(400);
    expect(
      (await call("GET", `/groups/${groupId}`, { token: "x".repeat(43) })).status,
    ).toBe(404);
  });

  it("the scheduled scan pushes the leave time in each recipient's language", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    const [bea, cai] = members;
    await setPush(groupId, host.token, "host");
    await updateGroupMembershipRecord(groupId, cai.token, {
      expoPushToken: "ExponentPushToken[cai_xxxxxxxxxxxxxxxx]",
      language: "en",
    });
    await startGroupTonightRecord(groupId, host.token);
    pushes = [];
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 2 * 60 * 60_000);
    await setGroupTonightParticipationRecord(groupId, bea.token, leaveBy);
    await setGroupTonightParticipationRecord(groupId, cai.token, null);

    const time = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(leaveBy);
    expect(await dispatchGroupLeaveAlerts(new Date(leaveBy.getTime() + 30_000))).toBe(2);
    expect(pushes.map((push) => push.body).sort()).toEqual(
      [
        `金曜会: Beaさんの出発時刻です（${time}）`,
        `金曜会: time for Bea to leave (${time})`,
      ].sort(),
    );
  });

  it("activation pushes to the members who keep 今夜の開始 on", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    const [bea, cai] = members;
    await setPush(groupId, host.token, "host");
    await setPush(groupId, bea.token, "bea");
    await updateGroupMembershipRecord(groupId, cai.token, {
      expoPushToken: "ExponentPushToken[cai_xxxxxxxxxxxxxxxx]",
      language: "en",
    });

    const started = await call("POST", `/groups/${groupId}/tonight`, {
      token: host.token,
    });
    expect(started.status).toBe(201);
    const visible = pushes.filter((push) => push.body);
    expect(visible.map((push) => push.body).sort()).toEqual(
      [
        "金曜会: ホストが今夜の会を始めました",
        "金曜会: The host started tonight's meetup",
      ].sort(),
    );
    // Every other member's app is also told silently to refresh (not the host's own).
    const silent = pushes.filter((push) => push.kind === "group_updated");
    expect(silent).toHaveLength(2);
    expect(silent.every((push) => push.body === undefined)).toBe(true);
    expect((await call("POST", `/groups/${groupId}/tonight`, { token: host.token })).status).toBe(200);

    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 60 * 60_000);
    const optIn = await call("PUT", `/groups/${groupId}/tonight/me`, {
      token: bea.token,
      body: { leaveBy: leaveBy.toISOString() },
    });
    expect(optIn.status).toBe(200);
    const outside = await call("PUT", `/groups/${groupId}/tonight/me`, {
      token: bea.token,
      body: { leaveBy: new Date(tonightWindow().endsAt.getTime() + 60_000).toISOString() },
    });
    expect(outside.status).toBe(400);
  });

  it("a member's new leave time silently updates the others' apps, not their own", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea"]);
    const [bea] = members;
    await setPush(groupId, host.token, "host");
    await setPush(groupId, bea.token, "bea");
    await call("POST", `/groups/${groupId}/tonight`, { token: host.token });
    pushes = [];
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 60 * 60_000);
    const response = await call("PUT", `/groups/${groupId}/tonight/me`, {
      token: bea.token,
      body: { leaveBy: leaveBy.toISOString() },
    });
    expect(response.status).toBe(200);
    expect(pushes).toEqual([
      { to: expect.stringContaining("host"), body: undefined, kind: "group_updated" },
    ]);
  });
});
