import { createHash } from "node:crypto";
import { lte, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  apiRateLimitsTable,
  getDb,
  isDatabaseConfigured,
} from "@workspace/db";
import { logger } from "./logger";

type RateLimitResult = { allowed: boolean; retryAfterMs: number };
type Entry = { count: number; resetAt: number };
const MAX_TRACKED_KEYS = 5_000;

function hashRateLimitKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** In-memory fallback for local development without a database. */
export class FixedWindowLimiter {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, nowMs = Date.now()): RateLimitResult {
    const current = this.entries.get(key);
    if (!current || current.resetAt <= nowMs) {
      this.prune(nowMs);
      if (!this.entries.has(key) && this.entries.size >= MAX_TRACKED_KEYS) {
        const oldestKey = this.entries.keys().next().value as
          string | undefined;
        if (oldestKey) this.entries.delete(oldestKey);
      }
      this.entries.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, current.resetAt - nowMs),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(nowMs: number) {
    if (this.entries.size < 2_000) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= nowMs) this.entries.delete(key);
    }
  }
}

/**
 * Atomic shared limiter used in production. Parallel Lambda instances upsert
 * the same database row, so they cannot each grant a separate allowance.
 */
export async function checkSharedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = windowStartMs + windowMs;
  const expiresAt = new Date(resetAt + windowMs);
  const keyHash = hashRateLimitKey(key);

  const [row] = await getDb()
    .insert(apiRateLimitsTable)
    .values({ keyHash, windowStart, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: [apiRateLimitsTable.keyHash, apiRateLimitsTable.windowStart],
      set: {
        count: sql`${apiRateLimitsTable.count} + 1`,
        expiresAt,
      },
    })
    .returning({ count: apiRateLimitsTable.count });

  return {
    allowed: row.count <= limit,
    retryAfterMs: row.count <= limit ? 0 : Math.max(1, resetAt - nowMs),
  };
}

export async function purgeExpiredRateLimits(
  now = new Date(),
): Promise<number> {
  const deleted = await getDb()
    .delete(apiRateLimitsTable)
    .where(lte(apiRateLimitsTable.expiresAt, now))
    .returning({ keyHash: apiRateLimitsTable.keyHash });
  return deleted.length;
}

export function requestAddress(req: Request): string {
  // Express resolves req.ip through its configured trust-proxy boundary.
  // Never consume X-Forwarded-For directly here.
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function rateLimitMiddleware(input: {
  limit: number;
  windowMs: number;
  key: (req: Request) => string;
}) {
  const localFallback = new FixedWindowLimiter(input.limit, input.windowMs);

  return async (req: Request, res: Response, next: NextFunction) => {
    let result: RateLimitResult;
    try {
      result = isDatabaseConfigured()
        ? await checkSharedRateLimit(
            input.key(req),
            input.limit,
            input.windowMs,
          )
        : localFallback.check(input.key(req));
    } catch (err) {
      logger.error({ err }, "Shared rate limiter unavailable");
      if (process.env.NODE_ENV === "production") {
        res.status(503).json({ error: "Request protection unavailable" });
        return;
      }
      result = localFallback.check(input.key(req));
    }

    if (result.allowed) {
      next();
      return;
    }

    res.setHeader(
      "Retry-After",
      String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
    );
    res.status(429).json({ error: "Too many requests. Try again shortly." });
  };
}
