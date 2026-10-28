import { describe, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { trustedProxySettings } from "../src/lib/trustedProxy";
import { requestAddress } from "../src/lib/rateLimit";

async function servedIp(settings: string[] | number, forwarded: string): Promise<string> {
  const app = express();
  app.set("trust proxy", settings);
  app.get("/ip", (req, res) => res.send(requestAddress(req)));
  const server: Server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch("http://127.0.0.1:" + port + "/ip", {
      headers: { "X-Forwarded-For": forwarded },
    });
    return response.text();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("trusted proxy address attribution", () => {
  test("default refuses untrusted X-Forwarded-For", async () => {
    expect(await servedIp(trustedProxySettings({ NODE_ENV: "production" }), "203.0.113.11"))
      .toMatch(/(?:^|:)127\.0\.0\.1$/);
  });
  test("trusted localhost ingress stops at first untrusted forwarded hop", async () => {
    expect(await servedIp(trustedProxySettings({
      NODE_ENV: "production", TRUST_PROXY_CIDRS: "127.0.0.1/32",
    }), "203.0.113.11, 198.51.100.12")).toBe("198.51.100.12");
  });
  test("production rejects numeric hops without explicit source addresses", () => {
    expect(() => trustedProxySettings({ NODE_ENV: "production", TRUST_PROXY_HOPS: "1" }))
      .toThrow("unsafe");
    expect(trustedProxySettings({ NODE_ENV: "development", TRUST_PROXY_HOPS: "1" })).toBe(1);
  });
  test("rejects invalid, wildcard and excessively broad ranges", () => {
    for (const value of ["0.0.0.0/0", "::/0", "1.1.1.1/4", "::1/8", "invalid",
      "127.0.0.1/-1", "127.0.0.1/33", "127.0.0.1/foo", "127.0.0.1/",
      "10.0.0.0/24, garbage"]) {
      expect(() => trustedProxySettings({ NODE_ENV: "production", TRUST_PROXY_CIDRS: value })).toThrow();
    }
    expect(trustedProxySettings({ NODE_ENV: "production", TRUST_PROXY_CIDRS: "10.0.0.0/16, ::1/128" }))
      .toEqual(["10.0.0.0/16", "::1/128"]);
  });
});
