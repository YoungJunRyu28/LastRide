import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set before database-backed features are used.",
    );
  }
  if (!poolInstance) {
    const production = process.env.NODE_ENV === "production";
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Serverless execution environments multiply pools by warm instance.
      // Keep each Lambda pool deliberately small; Neon should use its pooled URL.
      max: positiveIntEnv("DB_POOL_MAX", production ? 2 : 10),
      connectionTimeoutMillis: positiveIntEnv(
        "DB_CONNECTION_TIMEOUT_MS",
        5_000,
      ),
      idleTimeoutMillis: positiveIntEnv("DB_IDLE_TIMEOUT_MS", 10_000),
    });
  }
  return poolInstance;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!dbInstance) dbInstance = drizzle(getPool(), { schema });
  return dbInstance;
}

export * from "./schema";
