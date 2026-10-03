import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import {
  getDb,
  enterpriseEventsTable,
  eventInvitesTable,
  eventParticipantsTable,
  hostDevicesTable,
  organizationMembersTable,
  organizationsTable,
} from "@workspace/db";
import type { EnterprisePrincipal } from "./enterpriseAuth";
import {
  createCapabilityToken,
  createJoinCode,
  hashCapability,
  normalizeJoinCode,
} from "./enterpriseTokens";

export type OrganizerContext = {
  memberId: string;
  organizationId: string;
};

function bootstrapEmails(): Set<string> {
  return new Set(
    (process.env.ENTERPRISE_BOOTSTRAP_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function getOrganizerContext(
  principal: EnterprisePrincipal,
): Promise<OrganizerContext | null> {
  const db = getDb();
  const findExisting = async () => {
    const [member] = await db
      .select({
        memberId: organizationMembersTable.id,
        organizationId: organizationMembersTable.organizationId,
      })
      .from(organizationMembersTable)
      .where(eq(organizationMembersTable.authUserId, principal.authUserId))
      .limit(1);
    return member ?? null;
  };

  const existing = await findExisting();
  if (existing) return existing;

  const devBootstrap =
    process.env.NODE_ENV !== "production" &&
    principal.authUserId ===
      (process.env.ENTERPRISE_DEV_AUTH_USER_ID || "dev-organizer");
  const emailBootstrap =
    principal.email !== null &&
    bootstrapEmails().has(principal.email.toLowerCase());
  if (!devBootstrap && !emailBootstrap) return null;

  try {
    return await db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizationsTable)
        .values({
          name:
            process.env.ENTERPRISE_BOOTSTRAP_ORGANIZATION_NAME ||
            "LastRide Business",
        })
        .returning({ id: organizationsTable.id });
      const [member] = await tx
        .insert(organizationMembersTable)
        .values({
          organizationId: organization.id,
          authUserId: principal.authUserId,
          displayName: principal.email,
          role: "owner",
        })
        .returning({
          memberId: organizationMembersTable.id,
          organizationId: organizationMembersTable.organizationId,
        });
      return member;
    });
  } catch (err) {
    // Concurrent first requests can both observe "not provisioned". The
    // global unique auth-user index makes one insertion win; the losing
    // transaction rolls back its organization and reuses the winner.
    const raced = await findExisting();
    if (raced) return raced;
    throw err;
  }
}

function eventShape(
  event: typeof enterpriseEventsTable.$inferSelect,
  participantCount: number,
) {
  return {
    id: event.id,
    organizationId: event.organizationId,
    title: event.title,
    startsAt: event.startsAt,
    expiresAt: event.expiresAt,
    status: event.status,
    alertLeadMinutes: event.alertLeadMinutes,
    participantLimit: event.participantLimit,
    participantCount,
  };
}

export async function createEnterpriseEventRecord(
  organizer: OrganizerContext,
  input: {
    title: string;
    startsAt: Date;
    expiresAt: Date;
    alertLeadMinutes: number;
    participantLimit: number;
  },
) {
  const db = getDb();
  const inviteToken = createCapabilityToken();
  const joinCode = createJoinCode();

  const event = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(enterpriseEventsTable)
      .values({
        organizationId: organizer.organizationId,
        createdByMemberId: organizer.memberId,
        title: input.title.trim(),
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        alertLeadMinutes: input.alertLeadMinutes,
        participantLimit: input.participantLimit,
        status: "active",
      })
      .returning();

    await tx.insert(eventInvitesTable).values({
      eventId: created.id,
      inviteTokenHash: hashCapability(inviteToken),
      joinCodeHash: hashCapability(joinCode),
      expiresAt: input.expiresAt,
    });
    return created;
  });

  return { ...eventShape(event, 0), inviteToken, joinCode };
}

export async function listEnterpriseEventRecords(organizationId: string) {
  const db = getDb();
  const rows = await db
    .select({
      event: enterpriseEventsTable,
      participantCount: count(eventParticipantsTable.id),
    })
    .from(enterpriseEventsTable)
    .leftJoin(
      eventParticipantsTable,
      and(
        eq(eventParticipantsTable.eventId, enterpriseEventsTable.id),
        eq(eventParticipantsTable.status, "active"),
      ),
    )
    .where(eq(enterpriseEventsTable.organizationId, organizationId))
    .groupBy(enterpriseEventsTable.id)
    .orderBy(desc(enterpriseEventsTable.startsAt));

  return rows.map(({ event, participantCount }) =>
    eventShape(event, participantCount),
  );
}

export async function getEnterpriseEventRecord(
  organizationId: string,
  eventId: string,
) {
  const db = getDb();
  const [event] = await db
    .select()
    .from(enterpriseEventsTable)
    .where(
      and(
        eq(enterpriseEventsTable.id, eventId),
        eq(enterpriseEventsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!event) return null;

  const [counter] = await db
    .select({ value: count(eventParticipantsTable.id) })
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        eq(eventParticipantsTable.status, "active"),
      ),
    );

  const participants = await db
    .select({
      id: eventParticipantsTable.id,
      displayName: eventParticipantsTable.displayName,
      leaveBy: eventParticipantsTable.leaveBy,
      status: eventParticipantsTable.status,
      updatedAt: eventParticipantsTable.updatedAt,
    })
    .from(eventParticipantsTable)
    .where(eq(eventParticipantsTable.eventId, eventId))
    .orderBy(
      asc(eventParticipantsTable.leaveBy),
      asc(eventParticipantsTable.displayName),
    );

  return {
    ...eventShape(event, counter?.value ?? 0),
    participants,
  };
}

export async function updateEnterpriseEventRecord(
  organizationId: string,
  eventId: string,
  patch: {
    title?: string;
    alertLeadMinutes?: number;
    participantLimit?: number;
    status?: "active" | "closed";
  },
) {
  const db = getDb();
  const updates: Partial<typeof enterpriseEventsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.title !== undefined) updates.title = patch.title.trim();
  if (patch.alertLeadMinutes !== undefined) {
    updates.alertLeadMinutes = patch.alertLeadMinutes;
  }
  if (patch.participantLimit !== undefined) {
    updates.participantLimit = patch.participantLimit;
  }
  if (patch.status !== undefined) updates.status = patch.status;

  return db.transaction(async (tx) => {
    // Serialize organizer changes with joins, which also lock this row. This
    // makes participant-limit changes deterministic under concurrent joins.
    const [current] = await tx
      .select()
      .from(enterpriseEventsTable)
      .where(
        and(
          eq(enterpriseEventsTable.id, eventId),
          eq(enterpriseEventsTable.organizationId, organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) return { kind: "not-found" as const };

    const [counter] = await tx
      .select({ value: count(eventParticipantsTable.id) })
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, eventId),
          eq(eventParticipantsTable.status, "active"),
        ),
      );
    const activeCount = counter?.value ?? 0;

    if (
      patch.status !== "closed" &&
      patch.participantLimit !== undefined &&
      patch.participantLimit < activeCount
    ) {
      return {
        kind: "limit-below-active" as const,
        activeCount,
      };
    }

    const [updated] = await tx
      .update(enterpriseEventsTable)
      .set(updates)
      .where(eq(enterpriseEventsTable.id, eventId))
      .returning();

    if (patch.status === "closed") {
      // Closing is also a data-minimization action: participant records,
      // capabilities and notification deliveries disappear immediately, and
      // all outstanding invite credentials are invalidated by deletion.
      await tx
        .delete(eventParticipantsTable)
        .where(eq(eventParticipantsTable.eventId, eventId));
      await tx
        .delete(eventInvitesTable)
        .where(eq(eventInvitesTable.eventId, eventId));
      return { kind: "updated" as const, event: eventShape(updated, 0) };
    }

    return {
      kind: "updated" as const,
      event: eventShape(updated, activeCount),
    };
  });
}

type JoinInput = {
  inviteToken?: string;
  joinCode?: string;
  displayName: string;
};

export async function joinEnterpriseEventRecord(input: JoinInput) {
  const db = getDb();
  const credential = input.inviteToken
    ? hashCapability(input.inviteToken)
    : input.joinCode
      ? hashCapability(normalizeJoinCode(input.joinCode))
      : null;
  if (!credential) return { kind: "invalid" as const };

  const now = new Date();
  const inviteCondition = input.inviteToken
    ? eq(eventInvitesTable.inviteTokenHash, credential)
    : eq(eventInvitesTable.joinCodeHash, credential);

  const [resolved] = await db
    .select({ invite: eventInvitesTable, event: enterpriseEventsTable })
    .from(eventInvitesTable)
    .innerJoin(
      enterpriseEventsTable,
      eq(eventInvitesTable.eventId, enterpriseEventsTable.id),
    )
    .where(
      and(
        inviteCondition,
        isNull(eventInvitesTable.revokedAt),
        gt(eventInvitesTable.expiresAt, now),
        gt(enterpriseEventsTable.expiresAt, now),
        eq(enterpriseEventsTable.status, "active"),
      ),
    )
    .limit(1);
  if (!resolved) return { kind: "invalid" as const };

  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(enterpriseEventsTable)
      .where(eq(enterpriseEventsTable.id, resolved.event.id))
      .for("update")
      .limit(1);
    const lockedAt = new Date();
    if (
      !event ||
      event.status !== "active" ||
      event.expiresAt.getTime() <= lockedAt.getTime()
    ) {
      return { kind: "invalid" as const };
    }

    // Invite rotation locks the same event row before revoking credentials.
    // Re-check the resolved invite only after acquiring that lock: if rotation
    // won the race, this sees revokedAt and the stale credential cannot join.
    const [stillValidInvite] = await tx
      .select({ id: eventInvitesTable.id })
      .from(eventInvitesTable)
      .where(
        and(
          eq(eventInvitesTable.id, resolved.invite.id),
          inviteCondition,
          isNull(eventInvitesTable.revokedAt),
          gt(eventInvitesTable.expiresAt, lockedAt),
        ),
      )
      .limit(1);
    if (!stillValidInvite) return { kind: "invalid" as const };

    const [counter] = await tx
      .select({ value: count(eventParticipantsTable.id) })
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, event.id),
          eq(eventParticipantsTable.status, "active"),
        ),
      );
    if ((counter?.value ?? 0) >= event.participantLimit) {
      return { kind: "full" as const };
    }

    const participantToken = createCapabilityToken();

    const [participant] = await tx
      .insert(eventParticipantsTable)
      .values({
        eventId: event.id,
        displayName: input.displayName.trim(),
        participantTokenHash: hashCapability(participantToken),
      })
      .returning({
        id: eventParticipantsTable.id,
        displayName: eventParticipantsTable.displayName,
        leaveBy: eventParticipantsTable.leaveBy,
        status: eventParticipantsTable.status,
      });

    return {
      kind: "joined" as const,
      participantToken,
      participant,
      event: {
        id: event.id,
        title: event.title,
        expiresAt: event.expiresAt,
      },
    };
  });
}

export async function updateEventParticipantRecord(
  participantToken: string,
  leaveBy: Date,
) {
  const db = getDb();
  const tokenHash = hashCapability(participantToken);
  return db.transaction(async (tx) => {
    // Lock the event row (as closing and joins do) so the event cannot close
    // between this check and the write below. A concurrent leave deletes the
    // participant without that lock and is caught by the empty update.
    const [current] = await tx
      .select({
        participant: eventParticipantsTable,
        event: enterpriseEventsTable,
      })
      .from(eventParticipantsTable)
      .innerJoin(
        enterpriseEventsTable,
        eq(eventParticipantsTable.eventId, enterpriseEventsTable.id),
      )
      .where(eq(eventParticipantsTable.participantTokenHash, tokenHash))
      .for("update", { of: enterpriseEventsTable })
      .limit(1);

    if (!current) return { kind: "unauthorized" as const };

    if (
      current.participant.status !== "active" ||
      current.event.status !== "active" ||
      current.event.expiresAt.getTime() <= Date.now()
    ) {
      return { kind: "gone" as const };
    }

    // A synced leave-by is derived from this event's night plan. Keep it within
    // the event's retention window so malformed clients cannot persist
    // effectively unbounded timestamps.
    const earliestLeaveBy =
      current.event.startsAt.getTime() - 12 * 60 * 60_000;
    if (
      leaveBy.getTime() < earliestLeaveBy ||
      leaveBy.getTime() > current.event.expiresAt.getTime()
    ) {
      return { kind: "invalid-leave-by" as const };
    }

    const now = new Date();
    const [updated] = await tx
      .update(eventParticipantsTable)
      .set({
        leaveBy,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(eventParticipantsTable.id, current.participant.id))
      .returning({
        id: eventParticipantsTable.id,
        displayName: eventParticipantsTable.displayName,
        leaveBy: eventParticipantsTable.leaveBy,
        status: eventParticipantsTable.status,
      });
    if (!updated) return { kind: "gone" as const };
    return { kind: "updated" as const, participant: updated };
  });
}

export async function leaveEnterpriseEventRecord(
  participantToken: string,
): Promise<boolean> {
  const db = getDb();
  // Explicitly leaving is a deletion request, not a historical status change.
  // This immediately removes the participant name, leave time and capability
  // token. Notification delivery rows disappear through ON DELETE CASCADE.
  const [deleted] = await db
    .delete(eventParticipantsTable)
    .where(
      eq(
        eventParticipantsTable.participantTokenHash,
        hashCapability(participantToken),
      ),
    )
    .returning({ id: eventParticipantsTable.id });
  return Boolean(deleted);
}

export async function purgeExpiredEnterpriseData(now = new Date()) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(enterpriseEventsTable)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          lte(enterpriseEventsTable.expiresAt, now),
          or(
            eq(enterpriseEventsTable.status, "active"),
            eq(enterpriseEventsTable.status, "draft"),
          ),
        ),
      )
      .returning({ id: enterpriseEventsTable.id });

    const ids = expired.map(({ id }) => id);
    if (ids.length === 0) return 0;
    await tx
      .delete(eventParticipantsTable)
      .where(inArray(eventParticipantsTable.eventId, ids));
    await tx
      .delete(eventInvitesTable)
      .where(inArray(eventInvitesTable.eventId, ids));
    return ids.length;
  });
}

export async function createEnterpriseEventInviteRecord(
  organizationId: string,
  eventId: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(enterpriseEventsTable)
      .where(
        and(
          eq(enterpriseEventsTable.id, eventId),
          eq(enterpriseEventsTable.organizationId, organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!event) return { kind: "not-found" as const };
    if (event.status !== "active" || event.expiresAt.getTime() <= Date.now()) {
      return { kind: "gone" as const };
    }

    const now = new Date();
    await tx
      .update(eventInvitesTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(eventInvitesTable.eventId, event.id),
          isNull(eventInvitesTable.revokedAt),
        ),
      );

    const inviteToken = createCapabilityToken();
    const joinCode = createJoinCode();
    await tx.insert(eventInvitesTable).values({
      eventId: event.id,
      inviteTokenHash: hashCapability(inviteToken),
      joinCodeHash: hashCapability(joinCode),
      expiresAt: event.expiresAt,
    });

    return {
      kind: "created" as const,
      inviteToken,
      joinCode,
      expiresAt: event.expiresAt,
    };
  });
}

export async function registerEnterpriseHostDeviceRecord(
  organizationMemberId: string,
  expoPushToken: string,
  platform: "ios" | "android",
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(hostDevicesTable)
    .values({
      organizationMemberId,
      expoPushToken,
      platform,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: hostDevicesTable.expoPushToken,
      set: { organizationMemberId, platform, updatedAt: now },
    });
}

export async function unregisterEnterpriseHostDeviceRecord(
  organizationMemberId: string,
  expoPushToken: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(hostDevicesTable)
    .where(
      and(
        eq(hostDevicesTable.organizationMemberId, organizationMemberId),
        eq(hostDevicesTable.expoPushToken, expoPushToken),
      ),
    );
}
