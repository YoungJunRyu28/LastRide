import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../src/lib/rateLimit";

describe("FixedWindowLimiter", () => {
  it("allows requests through the configured limit", () => {
    const limiter = new FixedWindowLimiter(2, 1_000);
    expect(limiter.check("client", 10_000).allowed).toBe(true);
    expect(limiter.check("client", 10_100).allowed).toBe(true);
  });

  it("blocks requests above the limit until the window resets", () => {
    const limiter = new FixedWindowLimiter(2, 1_000);
    limiter.check("client", 10_000);
    limiter.check("client", 10_100);

    const blocked = limiter.check("client", 10_200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(800);
  });

  it("starts a fresh window after expiry", () => {
    const limiter = new FixedWindowLimiter(1, 1_000);
    expect(limiter.check("client", 10_000).allowed).toBe(true);
    expect(limiter.check("client", 10_500).allowed).toBe(false);
    expect(limiter.check("client", 11_000).allowed).toBe(true);
  });

  it("tracks limiter keys independently", () => {
    const limiter = new FixedWindowLimiter(1, 1_000);
    expect(limiter.check("first", 10_000).allowed).toBe(true);
    expect(limiter.check("second", 10_000).allowed).toBe(true);
    expect(limiter.check("first", 10_100).allowed).toBe(false);
  });
});
