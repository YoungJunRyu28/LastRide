import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const original = {
  origins: process.env.CORS_ALLOWED_ORIGINS,
  nodeEnv: process.env.NODE_ENV,
};
let server: Server;
let url: string;

beforeAll(async () => {
  // The production origin allowlist is captured during app import.
  process.env.CORS_ALLOWED_ORIGINS = "https://lastride.example";
  process.env.NODE_ENV = "production";
  const { default: app } = await import("../src/app");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (original.origins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = original.origins;
  if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original.nodeEnv;
});

async function preflight(origin: string, headers: string, path = "/api/groups/join") {
  return fetch(url + path, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": headers,
    },
  });
}

describe("production CORS for durable group operations", () => {
  it("allows valid browser join and create keys during preflight", async () => {
    const requested = "content-type,x-group-join-key,x-group-create-key";
    const result = await preflight("https://lastride.example", requested);
    expect(result.status).toBe(204);
    expect(result.headers.get("access-control-allow-origin")).toBe("https://lastride.example");
    expect(result.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("x-group-join-key");
    expect(result.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("x-group-create-key");
    expect(result.headers.get("access-control-allow-credentials")).toBeNull();
  });
  it("allows the actual purchase-proof and crash-safe group-create headers", async () => {
    const requested = "content-type,x-revenuecat-app-user-id,x-premium-device-secret,x-group-create-key";
    const response = await preflight("https://lastride.example", requested, "/api/groups");
    expect(response.status).toBe(204);
    const allowed = response.headers.get("access-control-allow-headers")?.toLowerCase();
    expect(allowed).toContain("x-group-create-key");
    expect(allowed).toContain("x-premium-device-secret");
    expect(allowed).toContain("x-revenuecat-app-user-id");
  });

  it("does not grant CORS permissions to arbitrary origins", async () => {
    const result = await preflight("https://attacker.invalid", "x-group-join-key");
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: "Origin not allowed" });
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
  });
});
