import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  authenticateEnterpriseRequest,
  EnterpriseAuthUnavailableError,
} from "../src/lib/enterpriseAuth";

function requestWithBearer(token: string): Request {
  return {
    header(name: string) {
      return name.toLowerCase() === "authorization"
        ? `Bearer ${token}`
        : undefined;
    },
  } as unknown as Request;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.ENTERPRISE_DEV_BEARER_TOKEN;
});

describe("enterprise authentication", () => {
  it("distinguishes missing auth configuration from an invalid bearer", async () => {
    await expect(
      authenticateEnterpriseRequest(requestWithBearer("missing-config-token")),
    ).rejects.toBeInstanceOf(EnterpriseAuthUnavailableError);
  });

  it("returns null for a bearer rejected by Supabase", async () => {
    process.env.SUPABASE_URL = "https://auth.example";
    process.env.SUPABASE_ANON_KEY = "public-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );

    await expect(
      authenticateEnterpriseRequest(requestWithBearer("invalid-token")),
    ).resolves.toBeNull();
  });

  it("surfaces provider outages instead of misreporting them as bad credentials", async () => {
    process.env.SUPABASE_URL = "https://auth.example";
    process.env.SUPABASE_ANON_KEY = "public-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(
      authenticateEnterpriseRequest(requestWithBearer("outage-token")),
    ).rejects.toBeInstanceOf(EnterpriseAuthUnavailableError);
  });

  it("accepts and normalizes a valid Supabase user", async () => {
    process.env.SUPABASE_URL = "https://auth.example";
    process.env.SUPABASE_ANON_KEY = "public-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ id: "user-123", email: "owner@example.com" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );

    await expect(
      authenticateEnterpriseRequest(requestWithBearer("valid-token")),
    ).resolves.toEqual({
      authUserId: "user-123",
      email: "owner@example.com",
    });
  });
});
