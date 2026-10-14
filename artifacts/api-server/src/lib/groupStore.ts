/**
 * Persistent consumer groups: accountless membership via per-group capability
 * tokens, a host, invites, and a nightly "tonight" in which opted-in members
 * share only a leave-by timestamp. Everything under a night is deleted (not
 * hidden) when the night ends.
 *
 * Every mutation locks the group row first, so membership changes, host
 * changes, night start/end and participation updates are serialized per group.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, min, ne, or } from "drizzle-orm";
import {
  getDb,
  groupMembersTable,
  groupNightParticipantsTable,
  groupNightsTable,
  groupsTable,
  type Group,
  type GroupMember,
} from "@workspace/db";
import {
  createCapabilityToken,
  createJoinCode,
  hashCapability,
  normalizeJoinCode,
} from "./enterpriseTokens";
import { openGroupInvite, sealGroupInvite } from "./groupInvites";
import { isLeaveByInNight, nightWindow, serviceDateFor } from "./groupNight";
import type { GroupLanguage, GroupPushRecipient } from "./groupNotifications";

export const GROUP_MEMBER_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
/** lastSeenAt is refreshed at most this often, to keep reads cheap. */
const LAST_SEEN_REFRESH_MS = 12 * 60 * 60 * 1000;
/** Members whose app hasn't been in touch this long are removed. */
export const INACTIVE_MEMBER_DAYS = 180;
/** Sooner when the push token was reported dead (the app was most likely deleted). */
export const UNREGISTERED_MEMBER_DAYS = 30;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type InviteSecret = { inviteToken: string; joinCode: string };

export type GroupDetail = {
  id: string;
  name: string;
  memberLimit: number;
  me: {
    memberId: string;
    displayName: string;
    role: "host" | "member";
    language: GroupLanguage;
    pushRegistered: boolean;
    notifications: boolean;
    leaveTimeAlerts: boolean;
  };
  members: Array<{ id: string; displayName: string; role: "host" | "member" }>;
  invite: { inviteToken: string; joinCode: string; rotatedAt: Date } | null;
  tonight: {
    active: boolean;
    serviceDate: string | null;
    startedAt: Date | null;
    endsAt: Date | null;
    participants: Array<{
      memberId: string;
      displayName: string;
      leaveBy: Date | null;
    }>;
  };
};

function cleanName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Retries a whole transaction when a freshly generated credential collides. */
async function withCredentialRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= 3 || !isUniqueViolation(err)) throw err;
    }
  }
}

function newInvite(): InviteSecret {
  return { inviteToken: createCapabilityToken(), joinCode: createJoinCode() };
}

function inviteColumns(groupId: string, invite: InviteSecret, now: Date) {
  return {
    inviteTokenHash: hashCapability(invite.inviteToken),
    joinCodeHash: hashCapability(invite.joinCode),
    inviteCiphertext: sealGroupInvite(groupId, invite),
    inviteRotatedAt: now,
  };
}

/** Lazy cleanup: a night past its 08:00 JST end is deleted with its rows. */
async function expireNight(tx: Tx, groupId: string, now: Date) {
  await deleteNights(
    tx,
    and(eq(groupNightsTable.groupId, groupId), lte(groupNightsTable.endsAt, now)),
  );
}

async function deleteNights(
  tx: Tx,
  where: ReturnType<typeof and>,
): Promise<number> {
  const nights = await tx
    .select({ id: groupNightsTable.id })
    .from(groupNightsTable)
    .where(where);
  const ids = nights.map(({ id }) => id);
  if (ids.length === 0) return 0;
  // Explicit delete of every leave-by row (the FK cascade would also do it).
  await tx
    .delete(groupNightParticipantsTable)
    .where(inArray(groupNightParticipantsTable.nightId, ids));
  await tx.delete(groupNightsTable).where(inArray(groupNightsTable.id, ids));
  return ids.length;
}

type Authorized = { group: Group; member: GroupMember };

async function authorize(
  tx: Tx,
  groupId: string,
  memberToken: string,
  now: Date,
  lock: boolean,
): Promise<Authorized | null> {
  const query = tx
    .select({ group: groupsTable, member: groupMembersTable })
    .from(groupMembersTable)
    .innerJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberTokenHash, hashCapability(memberToken)),
      ),
    )
    .limit(1);
  const [row] = lock
    ? await query.for("update", { of: groupsTable })
    : await query;
  if (!row) return null;
  if (now.getTime() - row.member.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await tx
      .update(groupMembersTable)
      .set({ lastSeenAt: now })
      .where(eq(groupMembersTable.id, row.member.id));
  }
  await expireNight(tx, groupId, now);
  return row;
}

/**
 * Removes a member who reset the app or went inactive. A host's group is
 * disbanded (hosting is a Premium feature, so the role isn't passed on), and
 * everything in it is deleted.
 */
async function removeMemberOrDisband(
  tx: Tx,
  groupId: string,
  member: { id: string; role: GroupMember["role"] },
): Promise<"left" | "group-deleted"> {
  if (member.role === "host") {
    await deleteNights(tx, eq(groupNightsTable.groupId, groupId));
    // Members, invites and nights all go with the group (ON DELETE CASCADE).
    await tx.delete(groupsTable).where(eq(groupsTable.id, groupId));
    return "group-deleted";
  }
  await tx.delete(groupMembersTable).where(eq(groupMembersTable.id, member.id));
  return "left";
}

async function loadDetail(
  tx: Tx,
  groupId: string,
  memberId: string,
  freshInvite?: InviteSecret,
): Promise<GroupDetail> {
  const [group] = await tx
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId))
    .limit(1);
  const memberRows = await tx
    .select()
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, groupId));
  const me = memberRows.find((member) => member.id === memberId);
  if (!group || !me) throw new Error("Group detail requested for a missing member");

  const members = memberRows
    .sort((a, b) =>
      a.role === b.role
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : a.role === "host"
          ? -1
          : 1,
    )
    .map((member) => ({
      id: member.id,
      displayName: member.displayName,
      role: member.role,
    }));

  let invite: GroupDetail["invite"] = null;
  if (me.role === "host") {
    const secret =
      freshInvite ?? openGroupInvite(group.id, group.inviteCiphertext);
    if (secret) invite = { ...secret, rotatedAt: group.inviteRotatedAt };
  }

  const [night] = await tx
    .select()
    .from(groupNightsTable)
    .where(eq(groupNightsTable.groupId, groupId))
    .limit(1);
  let tonight: GroupDetail["tonight"] = {
    active: false,
    serviceDate: null,
    startedAt: null,
    endsAt: null,
    participants: [],
  };
  if (night) {
    const rows = await tx
      .select({
        memberId: groupNightParticipantsTable.memberId,
        displayName: groupMembersTable.displayName,
        leaveBy: groupNightParticipantsTable.leaveBy,
      })
      .from(groupNightParticipantsTable)
      .innerJoin(
        groupMembersTable,
        eq(groupNightParticipantsTable.memberId, groupMembersTable.id),
      )
      .where(eq(groupNightParticipantsTable.nightId, night.id));
    const participants = rows
      .map((row) => ({
        memberId: row.memberId,
        displayName: row.displayName,
        leaveBy: row.leaveBy,
      }))
      .sort((a, b) => {
        if (a.leaveBy && b.leaveBy) {
          const diff = a.leaveBy.getTime() - b.leaveBy.getTime();
          if (diff !== 0) return diff;
        } else if (a.leaveBy || b.leaveBy) {
          return a.leaveBy ? -1 : 1; // unknown leave-by last
        }
        return a.displayName.localeCompare(b.displayName, "ja");
      });
    tonight = {
      active: true,
      serviceDate: night.serviceDate,
      startedAt: night.startedAt,
      endsAt: night.endsAt,
      participants,
    };
  }

  return {
    id: group.id,
    name: group.name,
    memberLimit: GROUP_MEMBER_LIMIT,
    me: {
      memberId: me.id,
      displayName: me.displayName,
      role: me.role,
      language: me.language,
      pushRegistered: me.expoPushToken !== null,
      notifications: me.notifications,
      leaveTimeAlerts: me.leaveTimeAlerts,
    },
    members,
    invite,
    tonight,
  };
}

// ---------------------------------------------------------------------------
// Create / join
// ---------------------------------------------------------------------------

export async function createGroupRecord(input: {
  name: string;
  displayName: string;
  language?: GroupLanguage;
}) {
  const name = cleanName(input.name);
  const displayName = cleanName(input.displayName);
  if (!name || !displayName) return { kind: "invalid" as const };

  return withCredentialRetry(() =>
    getDb().transaction(async (tx) => {
      const now = new Date();
      const invite = newInvite();
      const memberToken = createCapabilityToken();
      // Id generated up front so the invite ciphertext can be bound to it.
      const group = { id: randomUUID() };
      await tx
        .insert(groupsTable)
        .values({ id: group.id, name, ...inviteColumns(group.id, invite, now) });
      const [member] = await tx
        .insert(groupMembersTable)
        .values({
          groupId: group.id,
          displayName,
          role: "host",
          memberTokenHash: hashCapability(memberToken),
          language: input.language ?? "ja",
        })
        .returning({ id: groupMembersTable.id });
      return {
        kind: "created" as const,
        memberToken,
        group: await loadDetail(tx, group.id, member.id, invite),
      };
    }),
  );
}

export async function joinGroupRecord(input: {
  inviteToken?: string;
  joinCode?: string;
  displayName: string;
  language?: GroupLanguage;
}) {
  const displayName = cleanName(input.displayName);
  if (!displayName) return { kind: "invalid" as const };
  const condition = input.inviteToken
    ? eq(groupsTable.inviteTokenHash, hashCapability(input.inviteToken))
    : input.joinCode
      ? eq(groupsTable.joinCodeHash, hashCapability(normalizeJoinCode(input.joinCode)))
      : null;
  if (!condition) return { kind: "invalid" as const };

  return getDb().transaction(async (tx) => {
    // Rotation also locks this row, so a revoked credential cannot slip in.
    const [group] = await tx
      .select()
      .from(groupsTable)
      .where(condition)
      .for("update")
      .limit(1);
    if (!group) return { kind: "invalid" as const };

    const members = await tx
      .select({ id: groupMembersTable.id })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, group.id));
    if (members.length >= GROUP_MEMBER_LIMIT) return { kind: "full" as const };

    const memberToken = createCapabilityToken();
    const [member] = await tx
      .insert(groupMembersTable)
      .values({
        groupId: group.id,
        displayName,
        role: "member",
        memberTokenHash: hashCapability(memberToken),
        language: input.language ?? "ja",
      })
      .returning({ id: groupMembersTable.id });
    await expireNight(tx, group.id, new Date());
    return {
      kind: "joined" as const,
      memberToken,
      group: await loadDetail(tx, group.id, member.id),
    };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getGroupDetailRecord(
  groupId: string,
  memberToken: string,
  now = new Date(),
): Promise<GroupDetail | null> {
  return getDb().transaction(async (tx) => {
    const auth = await authorize(tx, groupId, memberToken, now, false);
    if (!auth) return null;
    return loadDetail(tx, groupId, auth.member.id);
  });
}

// ---------------------------------------------------------------------------
// Host actions
// ---------------------------------------------------------------------------

type HostResult<T> =
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | ({ kind: "ok" } & T);

async function asHost<T>(
  groupId: string,
  memberToken: string,
  now: Date,
  run: (tx: Tx, auth: Authorized) => Promise<T>,
): Promise<{ kind: "not-found" } | { kind: "forbidden" } | { kind: "ran"; value: T }> {
  return getDb().transaction(async (tx) => {
    const auth = await authorize(tx, groupId, memberToken, now, true);
    if (!auth) return { kind: "not-found" as const };
    if (auth.member.role !== "host") return { kind: "forbidden" as const };
    return { kind: "ran" as const, value: await run(tx, auth) };
  });
}

function unwrap<T extends { kind: string }>(
  result: { kind: "not-found" } | { kind: "forbidden" } | { kind: "ran"; value: T },
): T | { kind: "not-found" } | { kind: "forbidden" } {
  return result.kind === "ran" ? result.value : result;
}

export async function renameGroupRecord(
  groupId: string,
  memberToken: string,
  name: string,
): Promise<HostResult<{ group: GroupDetail }> | { kind: "invalid" }> {
  const cleaned = cleanName(name);
  if (!cleaned) return { kind: "invalid" };
  return unwrap(
    await asHost(groupId, memberToken, new Date(), async (tx, auth) => {
      await tx
        .update(groupsTable)
        .set({ name: cleaned, updatedAt: new Date() })
        .where(eq(groupsTable.id, groupId));
      return {
        kind: "ok" as const,
        group: await loadDetail(tx, groupId, auth.member.id),
      };
    }),
  );
}

export async function disbandGroupRecord(
  groupId: string,
  memberToken: string,
): Promise<HostResult<object>> {
  return unwrap(
    await asHost(groupId, memberToken, new Date(), async (tx) => {
      await deleteNights(tx, eq(groupNightsTable.groupId, groupId));
      // Members, invites and nights all go with the group (ON DELETE CASCADE).
      await tx.delete(groupsTable).where(eq(groupsTable.id, groupId));
      return { kind: "ok" as const };
    }),
  );
}

export async function rotateGroupInviteRecord(
  groupId: string,
  memberToken: string,
): Promise<HostResult<{ invite: { inviteToken: string; joinCode: string; rotatedAt: Date } }>> {
  return withCredentialRetry(async () =>
    unwrap(
      await asHost(groupId, memberToken, new Date(), async (tx) => {
        const now = new Date();
        const invite = newInvite();
        // Replacing the hashes revokes every previous link and join code.
        await tx
          .update(groupsTable)
          .set({ ...inviteColumns(groupId, invite, now), updatedAt: now })
          .where(eq(groupsTable.id, groupId));
        return { kind: "ok" as const, invite: { ...invite, rotatedAt: now } };
      }),
    ),
  );
}

export async function removeGroupMemberRecord(
  groupId: string,
  memberToken: string,
  targetMemberId: string,
): Promise<
  HostResult<{ group: GroupDetail }> | { kind: "self" } | { kind: "member-not-found" }
> {
  return unwrap(
    await asHost(groupId, memberToken, new Date(), async (tx, auth) => {
      if (targetMemberId === auth.member.id) return { kind: "self" as const };
      // Deleting the member also deletes their capability token and any
      // leave-by row for tonight (ON DELETE CASCADE).
      const deleted = await tx
        .delete(groupMembersTable)
        .where(
          and(
            eq(groupMembersTable.id, targetMemberId),
            eq(groupMembersTable.groupId, groupId),
          ),
        )
        .returning({ id: groupMembersTable.id });
      if (deleted.length === 0) return { kind: "member-not-found" as const };
      return {
        kind: "ok" as const,
        group: await loadDetail(tx, groupId, auth.member.id),
      };
    }),
  );
}

export async function startGroupTonightRecord(
  groupId: string,
  memberToken: string,
  now = new Date(),
): Promise<
  | HostResult<{
      started: boolean;
      group: GroupDetail;
      groupName: string;
      recipients: GroupPushRecipient[];
    }>
> {
  return unwrap(
    await asHost(groupId, memberToken, now, async (tx, auth) => {
      const [existing] = await tx
        .select({ id: groupNightsTable.id })
        .from(groupNightsTable)
        .where(eq(groupNightsTable.groupId, groupId))
        .limit(1);
      if (existing) {
        return {
          kind: "ok" as const,
          started: false,
          group: await loadDetail(tx, groupId, auth.member.id),
          groupName: auth.group.name,
          recipients: [],
        };
      }
      const serviceDate = serviceDateFor(now);
      await tx.insert(groupNightsTable).values({
        groupId,
        serviceDate,
        startedAt: now,
        endsAt: nightWindow(serviceDate).endsAt,
      });
      const recipients = await pushRecipients(
        tx,
        groupId,
        undefined,
        auth.member.id,
      );
      return {
        kind: "ok" as const,
        started: true,
        group: await loadDetail(tx, groupId, auth.member.id),
        groupName: auth.group.name,
        recipients,
      };
    }),
  );
}

export async function endGroupTonightRecord(
  groupId: string,
  memberToken: string,
  now = new Date(),
): Promise<HostResult<{ group: GroupDetail }>> {
  return unwrap(
    await asHost(groupId, memberToken, now, async (tx, auth) => {
      await deleteNights(tx, eq(groupNightsTable.groupId, groupId));
      return {
        kind: "ok" as const,
        group: await loadDetail(tx, groupId, auth.member.id),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Member actions
// ---------------------------------------------------------------------------

export async function updateGroupMembershipRecord(
  groupId: string,
  memberToken: string,
  patch: {
    displayName?: string;
    expoPushToken?: string | null;
    language?: GroupLanguage;
    notifications?: boolean;
    leaveTimeAlerts?: boolean;
  },
): Promise<{ kind: "not-found" } | { kind: "invalid" } | { kind: "ok"; group: GroupDetail }> {
  const updates: Partial<typeof groupMembersTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.displayName !== undefined) {
    const displayName = cleanName(patch.displayName);
    if (!displayName) return { kind: "invalid" };
    updates.displayName = displayName;
  }
  if (patch.language !== undefined) updates.language = patch.language;
  if (patch.leaveTimeAlerts !== undefined) updates.leaveTimeAlerts = patch.leaveTimeAlerts;
  if (patch.notifications !== undefined) {
    updates.notifications = patch.notifications;
  }
  if (patch.expoPushToken !== undefined) {
    updates.expoPushToken = patch.expoPushToken?.trim() || null;
    // A fresh token means the app is installed and reachable again.
    if (updates.expoPushToken) updates.pushTokenInvalidAt = null;
  }

  return getDb().transaction(async (tx) => {
    const auth = await authorize(tx, groupId, memberToken, new Date(), true);
    if (!auth) return { kind: "not-found" as const };
    if (updates.expoPushToken) {
      // Same device re-joined the group under a new member: keep one owner.
      await tx
        .update(groupMembersTable)
        .set({ expoPushToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(groupMembersTable.groupId, groupId),
            eq(groupMembersTable.expoPushToken, updates.expoPushToken),
            ne(groupMembersTable.id, auth.member.id),
          ),
        );
    }
    await tx
      .update(groupMembersTable)
      .set(updates)
      .where(eq(groupMembersTable.id, auth.member.id));
    return {
      kind: "ok" as const,
      group: await loadDetail(tx, groupId, auth.member.id),
    };
  });
}

/**
 * Leave a group. A host has to disband instead; with `disbandIfHost` (used by
 * "Reset & start over") a host's group is disbanded as part of leaving.
 */
export async function leaveGroupRecord(
  groupId: string,
  memberToken: string,
  { disbandIfHost = false }: { disbandIfHost?: boolean } = {},
): Promise<{ kind: "not-found" } | { kind: "host" } | { kind: "ok" }> {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const auth = await authorize(tx, groupId, memberToken, now, true);
    if (!auth) return { kind: "not-found" as const };
    if (auth.member.role === "host" && !disbandIfHost) return { kind: "host" as const };
    await removeMemberOrDisband(tx, groupId, auth.member);
    return { kind: "ok" as const };
  });
}

async function activeNight(tx: Tx, groupId: string) {
  const [night] = await tx
    .select()
    .from(groupNightsTable)
    .where(eq(groupNightsTable.groupId, groupId))
    .limit(1);
  return night ?? null;
}

/**
 * Opt in to tonight and/or set the leave-by time.
 * `leaveBy` undefined keeps the current value; null clears it.
 */
export async function setGroupTonightParticipationRecord(
  groupId: string,
  memberToken: string,
  leaveBy: Date | null | undefined,
  now = new Date(),
): Promise<
  | { kind: "not-found" }
  | { kind: "inactive" }
  | { kind: "invalid-leave-by" }
  | { kind: "ok"; group: GroupDetail }
> {
  return getDb().transaction(async (tx) => {
    const auth = await authorize(tx, groupId, memberToken, now, true);
    if (!auth) return { kind: "not-found" as const };
    const night = await activeNight(tx, groupId);
    if (!night) return { kind: "inactive" as const };
    if (leaveBy && !isLeaveByInNight(leaveBy, night.serviceDate)) {
      return { kind: "invalid-leave-by" as const };
    }
    const updatedAt = new Date();
    const set: Partial<typeof groupNightParticipantsTable.$inferInsert> = {
      updatedAt,
    };
    if (leaveBy !== undefined) set.leaveBy = leaveBy;
    await tx
      .insert(groupNightParticipantsTable)
      .values({
        nightId: night.id,
        memberId: auth.member.id,
        leaveBy: leaveBy ?? null,
      })
      .onConflictDoUpdate({
        target: [
          groupNightParticipantsTable.nightId,
          groupNightParticipantsTable.memberId,
        ],
        set,
      });
    return {
      kind: "ok" as const,
      group: await loadDetail(tx, groupId, auth.member.id),
    };
  });
}

export async function leaveGroupTonightRecord(
  groupId: string,
  memberToken: string,
  now = new Date(),
): Promise<{ kind: "not-found" } | { kind: "ok"; group: GroupDetail }> {
  return getDb().transaction(async (tx) => {
    const auth = await authorize(tx, groupId, memberToken, now, true);
    if (!auth) return { kind: "not-found" as const };
    const night = await activeNight(tx, groupId);
    if (night) {
      await tx
        .delete(groupNightParticipantsTable)
        .where(
          and(
            eq(groupNightParticipantsTable.nightId, night.id),
            eq(groupNightParticipantsTable.memberId, auth.member.id),
          ),
        );
    }
    return {
      kind: "ok" as const,
      group: await loadDetail(tx, groupId, auth.member.id),
    };
  });
}

/**
 * Members with a push token and group notifications switched on: either
 * everyone (except `excludeMemberId`), or only tonight's participants plus
 * the host.
 */
async function pushRecipients(
  tx: Tx,
  groupId: string,
  nightId: string | undefined,
  excludeMemberId: string,
  /** A member's leave time (メンバーの出発時刻 switch); otherwise the 今夜の開始 switch. */
  { leaveTime = false }: { leaveTime?: boolean } = {},
): Promise<GroupPushRecipient[]> {
  const members = await tx
    .select()
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, groupId));
  let allowed: Set<string> | null = null;
  if (nightId) {
    const participants = await tx
      .select({ memberId: groupNightParticipantsTable.memberId })
      .from(groupNightParticipantsTable)
      .where(eq(groupNightParticipantsTable.nightId, nightId));
    allowed = new Set(participants.map(({ memberId }) => memberId));
    for (const member of members) {
      if (member.role === "host") allowed.add(member.id);
    }
  }
  return members
    .filter(
      (member) =>
        member.id !== excludeMemberId &&
        member.expoPushToken !== null &&
        (leaveTime ? member.leaveTimeAlerts : member.notifications) &&
        (allowed === null || allowed.has(member.id)),
    )
    .map((member) => ({
      memberId: member.id,
      expoPushToken: member.expoPushToken as string,
      language: member.language,
    }));
}

// ---------------------------------------------------------------------------
// Scheduled leave-time alerts
// ---------------------------------------------------------------------------

/** A leave-by older than this when first seen is not alerted (stale). */
export const GROUP_LEAVE_ALERT_GRACE_MS = 10 * 60_000;

export type ClaimedGroupLeaveAlert = {
  groupId: string;
  groupName: string;
  memberId: string;
  displayName: string;
  leaveBy: Date;
  recipients: GroupPushRecipient[];
};

/**
 * Claims every tonight participant whose leave-by has arrived and returns who
 * to tell (the other participants + the host). Each claim records the
 * leave-by it was sent for, so a participant is alerted once per night: an
 * updated leave-by re-arms only when it moves later than the alerted time.
 * The conditional UPDATE makes concurrent scheduled runs collapse to one.
 */
/**
 * When the next leave-time alert is due: the earliest unsent leave time in a
 * night that hasn't ended (one still inside the grace period counts as due now).
 * Same conditions as claimDueGroupLeaveAlerts, without the "already due" bound.
 */
export async function nextGroupLeaveAlertAt(now = new Date()): Promise<Date | null> {
  const db = getDb();
  const lowerBound = new Date(now.getTime() - GROUP_LEAVE_ALERT_GRACE_MS);
  const [row] = await db
    .select({ next: min(groupNightParticipantsTable.leaveBy) })
    .from(groupNightParticipantsTable)
    .innerJoin(
      groupNightsTable,
      eq(groupNightParticipantsTable.nightId, groupNightsTable.id),
    )
    .where(
      and(
        gt(groupNightsTable.endsAt, now),
        gte(groupNightParticipantsTable.leaveBy, lowerBound),
        or(
          isNull(groupNightParticipantsTable.leaveAlertSentFor),
          lt(
            groupNightParticipantsTable.leaveAlertSentFor,
            groupNightParticipantsTable.leaveBy,
          ),
        ),
      ),
    );
  return row?.next ?? null;
}

export async function claimDueGroupLeaveAlerts(
  now = new Date(),
): Promise<ClaimedGroupLeaveAlert[]> {
  const db = getDb();
  const lowerBound = new Date(now.getTime() - GROUP_LEAVE_ALERT_GRACE_MS);
  const due = await db
    .select({
      nightId: groupNightParticipantsTable.nightId,
      memberId: groupNightParticipantsTable.memberId,
      leaveBy: groupNightParticipantsTable.leaveBy,
      groupId: groupsTable.id,
      groupName: groupsTable.name,
      displayName: groupMembersTable.displayName,
    })
    .from(groupNightParticipantsTable)
    .innerJoin(
      groupNightsTable,
      eq(groupNightParticipantsTable.nightId, groupNightsTable.id),
    )
    .innerJoin(groupsTable, eq(groupNightsTable.groupId, groupsTable.id))
    .innerJoin(
      groupMembersTable,
      eq(groupNightParticipantsTable.memberId, groupMembersTable.id),
    )
    .where(
      and(
        gt(groupNightsTable.endsAt, now),
        lte(groupNightParticipantsTable.leaveBy, now),
        gte(groupNightParticipantsTable.leaveBy, lowerBound),
        or(
          isNull(groupNightParticipantsTable.leaveAlertSentFor),
          lt(
            groupNightParticipantsTable.leaveAlertSentFor,
            groupNightParticipantsTable.leaveBy,
          ),
        ),
      ),
    );

  const claimed: ClaimedGroupLeaveAlert[] = [];
  for (const candidate of due) {
    if (!candidate.leaveBy) continue;
    const leaveBy = candidate.leaveBy;
    const alert = await db.transaction(async (tx) => {
      const [won] = await tx
        .update(groupNightParticipantsTable)
        .set({ leaveAlertSentFor: leaveBy })
        .where(
          and(
            eq(groupNightParticipantsTable.nightId, candidate.nightId),
            eq(groupNightParticipantsTable.memberId, candidate.memberId),
            eq(groupNightParticipantsTable.leaveBy, leaveBy),
            or(
              isNull(groupNightParticipantsTable.leaveAlertSentFor),
              lt(groupNightParticipantsTable.leaveAlertSentFor, leaveBy),
            ),
          ),
        )
        .returning({ memberId: groupNightParticipantsTable.memberId });
      if (!won) return null;
      return {
        groupId: candidate.groupId,
        groupName: candidate.groupName,
        memberId: candidate.memberId,
        displayName: candidate.displayName,
        leaveBy,
        recipients: await pushRecipients(
          tx,
          candidate.groupId,
          candidate.nightId,
          candidate.memberId,
          { leaveTime: true },
        ),
      };
    });
    if (alert) claimed.push(alert);
  }
  return claimed;
}

// ---------------------------------------------------------------------------
// Scheduled cleanup
// ---------------------------------------------------------------------------

/**
 * Deletes every night past its 08:00 JST end, with all participant leave-by
 * rows. Run from the scheduled "cleanup" task; reads also do this lazily per
 * group, so correctness never depends on the schedule.
 */
export async function purgeEndedGroupNights(now = new Date()): Promise<number> {
  return getDb().transaction((tx) =>
    deleteNights(tx, lte(groupNightsTable.endsAt, now)),
  );
}

/**
 * Deleting the app can't tell the server, so members whose app hasn't been in
 * touch for INACTIVE_MEMBER_DAYS (or UNREGISTERED_MEMBER_DAYS after their push
 * token was reported dead) are removed; an inactive host's group is disbanded.
 */
export async function purgeInactiveGroupMembers(now = new Date()): Promise<number> {
  const db = getDb();
  const inactiveBefore = new Date(now.getTime() - INACTIVE_MEMBER_DAYS * DAY_MS);
  const unregisteredBefore = new Date(now.getTime() - UNREGISTERED_MEMBER_DAYS * DAY_MS);
  const stale = await db
    .select({ id: groupMembersTable.id, groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(
      or(
        lt(groupMembersTable.lastSeenAt, inactiveBefore),
        and(
          isNotNull(groupMembersTable.pushTokenInvalidAt),
          lt(groupMembersTable.lastSeenAt, unregisteredBefore),
        ),
      ),
    );
  let removed = 0;
  for (const candidate of stale) {
    removed += await db.transaction(async (tx) => {
      // Lock the group, then re-check: the member may have come back meanwhile.
      await tx
        .select({ id: groupsTable.id })
        .from(groupsTable)
        .where(eq(groupsTable.id, candidate.groupId))
        .for("update");
      const [member] = await tx
        .select()
        .from(groupMembersTable)
        .where(eq(groupMembersTable.id, candidate.id))
        .limit(1);
      if (!member) return 0;
      const stillStale =
        member.lastSeenAt < inactiveBefore ||
        (member.pushTokenInvalidAt !== null && member.lastSeenAt < unregisteredBefore);
      if (!stillStale) return 0;
      await removeMemberOrDisband(tx, candidate.groupId, member);
      return 1;
    });
  }
  return removed;
}
