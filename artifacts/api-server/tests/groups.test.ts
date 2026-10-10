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
  GROUP_MEMBER_LIMIT,
  joinGroupRecord,
  leaveGroupRecord,
  leaveGroupTonightRecord,
  purgeEndedGroupNights,
  removeGroupMemberRecord,
  renameGroupRecord,
  reportGroupTonightMissedRecord,
  rotateGroupInviteRecord,
  setGroupTonightParticipationRecord,
  startGroupTonightRecord,
  transferGroupHostRecord,
  updateGroupMembershipRecord,
} from "../src/lib/groupStore";
import { nightWindow, serviceDateFor } from "../src/lib/groupNight";
import { clearEntitlementCache } from "../src/lib/revenueCat";
import { dispatchGroupLeaveAlerts } from "../src/lib/groupNotifications";
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
    expect(joined.group.invite).toBeNull();
    expect(joined.group.members.map((member) => member.displayName)).toEqual([
      "Ann",
      "Dan",
    ]);
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
      (await transferGroupHostRecord(groupId, member.token, member.id)).kind,
    ).toBe("forbidden");
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

  it("the host cannot leave without transferring; after transfer they can", async () => {
    const { groupId, host, members } = await groupWithMembers();
    expect((await leaveGroupRecord(groupId, host.token)).kind).toBe("host");

    const transferred = await transferGroupHostRecord(
      groupId,
      host.token,
      members[0].id,
    );
    expect(transferred.kind).toBe("ok");
    if (transferred.kind !== "ok") return;
    expect(transferred.group.me.role).toBe("member");
    expect(transferred.group.invite).toBeNull();
    expect(
      transferred.group.members.find((member) => member.role === "host")?.id,
    ).toBe(members[0].id);

    // The new host can recover the existing invite without rotating it.
    const newHostView = await getGroupDetailRecord(groupId, members[0].token);
    expect(newHostView?.invite).not.toBeNull();

    expect((await leaveGroupRecord(groupId, host.token)).kind).toBe("ok");
    expect(await getGroupDetailRecord(groupId, host.token)).toBeNull();
  });

  it("cannot transfer to someone outside the group", async () => {
    const { groupId, host } = await groupWithMembers();
    const other = await groupWithMembers([]);
    expect(
      (await transferGroupHostRecord(groupId, host.token, other.host.id)).kind,
    ).toBe("invalid-target");
    expect(
      (await transferGroupHostRecord(groupId, host.token, host.id)).kind,
    ).toBe("invalid-target");
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
      { memberId: members[1].id, displayName: "Cai", leaveBy: earlier, missed: false },
      { memberId: members[0].id, displayName: "Bea", leaveBy: later, missed: false },
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

  it("乗り遅れた notifies the other participants and the host, once", async () => {
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
    await startGroupTonightRecord(groupId, host.token);
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 60 * 60_000);
    await setGroupTonightParticipationRecord(groupId, bea.token, leaveBy);
    await setGroupTonightParticipationRecord(groupId, cai.token, leaveBy);
    // Dan is a member but not participating tonight.

    expect((await reportGroupTonightMissedRecord(groupId, dan.token)).kind).toBe(
      "not-participant",
    );

    const missed = await reportGroupTonightMissedRecord(groupId, bea.token);
    expect(missed.kind).toBe("ok");
    if (missed.kind !== "ok") return;
    expect(missed.displayName).toBe("Bea");
    expect(missed.recipients.map((r) => r.memberId).sort()).toEqual(
      [host.id, cai.id].sort(),
    );
    expect(
      missed.group.tonight.participants.find((p) => p.memberId === bea.id)?.missed,
    ).toBe(true);

    const repeat = await reportGroupTonightMissedRecord(groupId, bea.token);
    expect(repeat.kind === "ok" && repeat.recipients).toEqual([]);
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
    // Dan switched group notifications off.
    const off = await updateGroupMembershipRecord(groupId, dan.token, {
      notifications: false,
    });
    expect(off.kind === "ok" && off.group.me.notifications).toBe(false);

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
    // Other participants + host; not Bea herself, not Dan (notifications off).
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

  it("does not send stale leave-time alerts or alerts for someone who already missed", async () => {
    const { groupId, host, members } = await groupWithMembers(["Bea", "Cai"]);
    await startGroupTonightRecord(groupId, host.token);
    const leaveBy = new Date(tonightWindow().endsAt.getTime() - 2 * 60 * 60_000);
    await setGroupTonightParticipationRecord(groupId, members[0].token, leaveBy);
    expect(
      await claimDueGroupLeaveAlerts(new Date(leaveBy.getTime() + 11 * 60_000)),
    ).toEqual([]);

    await setGroupTonightParticipationRecord(groupId, members[1].token, leaveBy);
    await reportGroupTonightMissedRecord(groupId, members[1].token);
    const alerts = await claimDueGroupLeaveAlerts(new Date(leaveBy.getTime() + 60_000));
    expect(alerts.map((alert) => alert.memberId)).toEqual([members[0].id]);
  });

  it("missed is rejected when the group is not active tonight", async () => {
    const { groupId, members } = await groupWithMembers();
    expect(
      (await reportGroupTonightMissedRecord(groupId, members[0].token)).kind,
    ).toBe("inactive");
  });
});

describe("groups HTTP routes", () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  let pushes: Array<{ to: string; body: string }> = [];
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
            body: string;
          }>;
          pushes.push(...batch.map(({ to, body }) => ({ to, body })));
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
      ["POST", `/groups/${groupId}/transfer`, { memberId: member.group.me.memberId }],
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

  it("activation and 乗り遅れた push to the right members", async () => {
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
    expect(pushes.map((push) => push.body).sort()).toEqual(
      [
        "金曜会: ホストが今夜の会を始めました",
        "金曜会: The host started tonight's meetup",
      ].sort(),
    );
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

    pushes = [];
    const missed = await call("POST", `/groups/${groupId}/tonight/missed`, {
      token: bea.token,
    });
    expect(missed.status).toBe(200);
    // Cai is not participating tonight; only the host hears about it.
    expect(pushes).toEqual([
      {
        to: "ExponentPushToken[hostxxxxxxxxxxxxxxxx]",
        body: "金曜会: Beaさんが終電に乗り遅れました",
      },
    ]);
    const detail = (await missed.json()) as {
      tonight: { participants: Array<{ displayName: string; missed: boolean }> };
    };
    expect(detail.tonight.participants).toEqual([
      expect.objectContaining({ displayName: "Bea", missed: true }),
    ]);
  });
});
