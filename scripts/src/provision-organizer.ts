import { eq } from "drizzle-orm";
import {
  getDb,
  getPool,
  organizationMembersTable,
  organizationsTable,
} from "@workspace/db";

type Role = "owner" | "organizer";

function value(name: string): string | null {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return null;
  const result = process.argv[index + 1]?.trim();
  return result || null;
}

function has(name: string): boolean {
  return process.argv.includes("--" + name);
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    [
      "",
      "Usage:",
      "  DATABASE_URL=... pnpm --filter @workspace/scripts provision-organizer -- \\",
      "    --auth-user-id <auth-provider-user-id> \\",
      "    (--organization-name <new-name> | --organization-id <existing-uuid>) \\",
      "    [--display-name <name>] [--role owner|organizer] --confirm",
      "",
      "This command is deliberately explicit and idempotent by auth user ID.",
      "It never looks up users by email and never requires an auth-provider admin key.",
    ].join("\n"),
  );
  process.exit(2);
}

const authUserId = value("auth-user-id");
const organizationName = value("organization-name");
const organizationId = value("organization-id");
const displayName = value("display-name");
const role = (value("role") || "owner") as Role;

if (!process.env.DATABASE_URL?.trim()) usage("DATABASE_URL is required.");
if (!authUserId) usage("--auth-user-id is required.");
if (Boolean(organizationName) === Boolean(organizationId)) {
  usage("Provide exactly one of --organization-name or --organization-id.");
}
if (role !== "owner" && role !== "organizer") {
  usage("--role must be owner or organizer.");
}
if (!has("confirm")) {
  usage("Refusing to change organization access without --confirm.");
}

const target = new URL(process.env.DATABASE_URL);
console.log(
  "Provisioning organizer against " + target.hostname + target.pathname + "...",
);

const db = getDb();
const [existing] = await db
  .select({
    memberId: organizationMembersTable.id,
    organizationId: organizationMembersTable.organizationId,
    role: organizationMembersTable.role,
  })
  .from(organizationMembersTable)
  .where(eq(organizationMembersTable.authUserId, authUserId))
  .limit(1);

if (existing) {
  console.log(
    JSON.stringify(
      {
        status: "already-provisioned",
        authUserId,
        memberId: existing.memberId,
        organizationId: existing.organizationId,
        role: existing.role,
      },
      null,
      2,
    ),
  );
  await getPool().end();
  process.exit(0);
}

const result = await db.transaction(async (tx) => {
  let targetOrganizationId = organizationId;

  if (targetOrganizationId) {
    const [organization] = await tx
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, targetOrganizationId))
      .limit(1);
    if (!organization) {
      throw new Error(
        "Organization " + targetOrganizationId + " does not exist.",
      );
    }
  } else {
    const [organization] = await tx
      .insert(organizationsTable)
      .values({ name: organizationName! })
      .returning({ id: organizationsTable.id });
    if (!organization) throw new Error("Failed to create organization.");
    targetOrganizationId = organization.id;
  }

  const [member] = await tx
    .insert(organizationMembersTable)
    .values({
      organizationId: targetOrganizationId!,
      authUserId,
      role,
      displayName,
    })
    .returning({
      id: organizationMembersTable.id,
      organizationId: organizationMembersTable.organizationId,
      role: organizationMembersTable.role,
    });
  if (!member) throw new Error("Failed to create organization member.");
  return member;
});

console.log(
  JSON.stringify(
    {
      status: "provisioned",
      authUserId,
      memberId: result.id,
      organizationId: result.organizationId,
      role: result.role,
    },
    null,
    2,
  ),
);

await getPool().end();
