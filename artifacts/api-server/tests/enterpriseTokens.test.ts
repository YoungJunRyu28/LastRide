import { describe, expect, it } from "vitest";
import {
  constantTimeTextEqual,
  createCapabilityToken,
  createJoinCode,
  hashCapability,
  normalizeJoinCode,
} from "../src/lib/enterpriseTokens";

describe("enterprise capability tokens", () => {
  it("creates high-entropy URL-safe participant tokens", () => {
    const token = createCapabilityToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("creates human-friendly join codes without ambiguous characters", () => {
    const code = createJoinCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });

  it("normalizes typed join codes before hashing", () => {
    expect(normalizeJoinCode(" ab-c 23 ")).toBe("ABC23");
    expect(hashCapability("ABC23")).toBe(
      hashCapability(normalizeJoinCode("ab-c 23")),
    );
  });

  it("compares equal text safely and rejects different lengths", () => {
    expect(constantTimeTextEqual("secret", "secret")).toBe(true);
    expect(constantTimeTextEqual("secret", "different")).toBe(false);
  });
});
