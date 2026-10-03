import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { rateLimitMiddleware } from "../src/lib/rateLimit";

// Simulate a database outage: the shared limiter's query always fails.
vi.mock("@workspace/db", () => ({
  apiRateLimitsTable: {},
  isDatabaseConfigured: () => true,
  getDb: () => {
    throw new Error("connect ECONNREFUSED");
  },
}));

function fakeResponse() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

describe("rateLimitMiddleware during a database outage", () => {
  it("falls back to a tighter per-instance limit instead of failing with 503", async () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const middleware = rateLimitMiddleware({
        limit: 8,
        windowMs: 60_000,
        key: () => "client",
      });
      const outcomes: number[] = [];
      for (let request = 0; request < 3; request += 1) {
        const res = fakeResponse();
        const next = vi.fn();
        await middleware(
          {} as Request,
          res as unknown as Response,
          next,
        );
        outcomes.push(next.mock.calls.length > 0 ? 200 : res.statusCode);
      }
      // A quarter of the normal budget (8 / 4 = 2), then 429 — never 503.
      expect(outcomes).toEqual([200, 200, 429]);
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });
});
