/**
 * Read-only checks run by the deploy script before `migrate`, for data that
 * would make a pending migration fail (or that a NOT VALID constraint lets
 * through). Exits non-zero only on blocking violations. Never prints the
 * connection string.
 */
import pg from "pg";

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error("preflight: DATABASE_URL is not set");
    return 1;
  }
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });
  await client.connect();
  let failed = false;
  try {
    await client.query("begin read only");
    const exists = async (table: string) =>
      (
        await client.query<{ present: boolean }>(
          "select to_regclass($1) is not null as present",
          [`public.${table}`],
        )
      ).rows[0]?.present === true;

    if (await exists("enterprise_events")) {
      // Informational: 0006 adds this CHECK as NOT VALID, so existing rows
      // do not block the migration, but they would fail a later VALIDATE.
      const { rows } = await client.query<{ id: string }>(
        `select id from enterprise_events
         where expires_at > starts_at + interval '36 hours'
         order by id limit 20`,
      );
      if (rows.length > 0) {
        console.warn(
          `preflight: WARNING ${rows.length}${rows.length === 20 ? "+" : ""} enterprise event(s) last longer than 36 hours: ${rows.map((row) => row.id).join(", ")}`,
        );
      }
    }

    if (await exists("organization_members")) {
      // Blocking: 0004 adds a global UNIQUE index on auth_user_id.
      const { rows } = await client.query<{
        auth_user_id: string;
        organizations: number;
      }>(
        `select auth_user_id, count(*)::int as organizations
         from organization_members group by 1 having count(*) > 1
         order by 1 limit 20`,
      );
      for (const row of rows) {
        console.error(
          `preflight: FAIL auth user ${row.auth_user_id} belongs to ${row.organizations} organizations; remove extra memberships before migrating`,
        );
      }
      if (rows.length > 0) failed = true;
    }
    await client.query("rollback");
  } finally {
    await client.end();
  }
  if (!failed) console.log("preflight: OK");
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // pg errors do not include the password; avoid dumping config objects.
    const { message, code } = err as { message?: string; code?: string };
    console.error(`preflight: failed to run checks: ${message || code || "unknown error"}`);
    process.exit(1);
  },
);
