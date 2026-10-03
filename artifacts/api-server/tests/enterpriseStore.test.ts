import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  enterpriseEventsTable,
  eventInvitesTable,
  eventParticipantsTable,
  getDb,
  hostDevicesTable,
  notificationDeliveriesTable,
  organizationMembersTable,
  organizationsTable,
} from "@workspace/db";
import {
  createEnterpriseEventInviteRecord,
  createEnterpriseEventRecord,
  getOrganizerContext,
  joinEnterpriseEventRecord,
  updateEnterpriseEventRecord,
} from "../src/lib/enterpriseStore";

async function clearEnterpriseData() {
  const db = getDb();
  await db.delete(notificationDeliveriesTable);
  await db.delete(eventParticipantsTable);
  await db.delete(eventInvitesTable);
  await db.delete(enterpriseEventsTable);
  await db.delete(hostDevicesTable);
  await db.delete(organizationMembersTable);
  await db.delete(organizationsTable);
}

beforeEach(clearEnterpriseData);
afterEach(() => {
  delete process.env.ENTERPRISE_BOOTSTRAP_EMAILS;
});
afterAll(clearEnterpriseData);

async function organizer() {
  const db = getDb();
  const [organization] = await db
    .insert(organizationsTable)
    .values({ name: "Test Organization" })
    .returning({ id: organizationsTable.id });
  const [member] = await db
    .insert(organizationMembersTable)
    .values({
      organizationId: organization.id,
      authUserId: "test-organizer",
      role: "owner",
    })
    .returning({ id: organizationMembersTable.id });
  return { organizationId: organization.id, memberId: member.id };
}

async function eventForTest() {
  const owner = await organizer();
  const now = Date.now();
  const created = await createEnterpriseEventRecord(owner, {
    title: "Friday drinks",
    startsAt: new Date(now - 60_000),
    expiresAt: new Date(now + 60 * 60_000),
    alertLeadMinutes: 10,
    participantLimit: 30,
  });
  return { owner, created };
}

describe("enterprise store integrity", () => {
  it("closing an event immediately deletes participants and invites", async () => {
    const { owner, created } = await eventForTest();
    const joined = await joinEnterpriseEventRecord({
      inviteToken: created.inviteToken,
      displayName: "Participant",
    });
    expect(joined.kind).toBe("joined");

    const closed = await updateEnterpriseEventRecord(
      owner.organizationId,
      created.id,
      { status: "closed" },
    );
    expect(closed?.status).toBe("closed");
    expect(closed?.participantCount).toBe(0);

    const participants = await getDb()
      .select()
      .from(eventParticipantsTable)
      .where(eq(eventParticipantsTable.eventId, created.id));
    const invites = await getDb()
      .select()
      .from(eventInvitesTable)
      .where(eq(eventInvitesTable.eventId, created.id));
    expect(participants).toHaveLength(0);
    expect(invites).toHaveLength(0);
  });

  it("a rotated invite can no longer join while the replacement can", async () => {
    const { owner, created } = await eventForTest();
    const rotated = await createEnterpriseEventInviteRecord(
      owner.organizationId,
      created.id,
    );
    expect(rotated.kind).toBe("created");
    if (rotated.kind !== "created") throw new Error("rotation failed");

    const stale = await joinEnterpriseEventRecord({
      inviteToken: created.inviteToken,
      displayName: "Stale",
    });
    const fresh = await joinEnterpriseEventRecord({
      inviteToken: rotated.inviteToken,
      displayName: "Fresh",
    });

    expect(stale.kind).toBe("invalid");
    expect(fresh.kind).toBe("joined");
  });

  it("concurrent first access provisions exactly one organizer context", async () => {
    process.env.ENTERPRISE_BOOTSTRAP_EMAILS = "owner@example.com";
    const principal = {
      authUserId: "supabase-user-123",
      email: "owner@example.com",
    };

    const contexts = await Promise.all(
      Array.from({ length: 10 }, () => getOrganizerContext(principal)),
    );

    expect(contexts.every(Boolean)).toBe(true);
    const organizationIds = new Set(
      contexts.map((context) => context?.organizationId),
    );
    const memberIds = new Set(contexts.map((context) => context?.memberId));
    expect(organizationIds.size).toBe(1);
    expect(memberIds.size).toBe(1);

    const members = await getDb()
      .select()
      .from(organizationMembersTable)
      .where(eq(organizationMembersTable.authUserId, principal.authUserId));
    expect(members).toHaveLength(1);

    const organizations = await getDb().select().from(organizationsTable);
    expect(organizations).toHaveLength(1);
  });
});
