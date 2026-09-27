import type { NextFunction, Request, Response } from "express";

type Entry = { count: number; resetAt: number };
const MAX_TRACKED_KEYS = 5_000;

export class FixedWindowLimiter {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(
    key: string,
    nowMs = Date.now(),
  ): { allowed: boolean; retryAfterMs: number } {
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

export function requestAddress(req: Request): string {
  // Express resolves req.ip through its configured trust-proxy boundary.
  // Never consume X-Forwarded-For directly here: it is spoofable without that boundary.
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function rateLimitMiddleware(input: {
  limit: number;
  windowMs: number;
  key: (req: Request) => string;
}) {
  const limiter = new FixedWindowLimiter(input.limit, input.windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const result = limiter.check(input.key(req));
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
