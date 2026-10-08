import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.EKISPERT_KEY = "test-ekispert-key";
  process.env.RAPIDAPI_KEY = "test-rapidapi-key";

  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  delete process.env.EKISPERT_KEY;
  delete process.env.RAPIDAPI_KEY;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("HTTP runtime perimeter", () => {
  it("separates liveness from database-backed readiness", async () => {
    const live = await fetch(`${baseUrl}/api/healthz`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });

    const ready = await fetch(`${baseUrl}/api/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });

  it("fails readiness when required provider configuration is missing", async () => {
    const key = process.env.RAPIDAPI_KEY;
    delete process.env.RAPIDAPI_KEY;
    try {
      const response = await fetch(`${baseUrl}/api/readyz`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "not-ready" });
    } finally {
      process.env.RAPIDAPI_KEY = key;
    }
  });

  it("returns JSON 404s without exposing Express", async () => {
    const response = await fetch(`${baseUrl}/does-not-exist`);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("rejects oversized request bodies before route handling", async () => {
    const response = await fetch(`${baseUrl}/api/events/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(40 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
  });

  it("returns a bounded JSON error for malformed JSON", async () => {
    const response = await fetch(`${baseUrl}/api/events/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  });

  it("rejects coordinates outside geographic bounds before provider calls", async () => {
    const response = await fetch(
      `${baseUrl}/api/stations/nearby?lat=91&lon=139.7&pace=normal`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: unknown };
    expect(body.error).toBe("Invalid query");
  });

  it("rejects raw-coordinate fields from mobility-learning uploads", async () => {
    const response = await fetch(`${baseUrl}/api/learning/observations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Learning-Token": "a".repeat(64),
      },
      body: JSON.stringify({
        consentVersion: 1,
        observations: [
          {
            clientObservationId: "privacy-contract-test",
            kind: "trip_timing",
            hourBucket: 23,
            dayType: "weekday",
            confidencePermille: 1000,
            modelVersion: "mobility-v1",
            latitude: 35.658,
          },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid learning observation" });
  });

  it("rejects fabricated non-Japanese station identifiers", async () => {
    const response = await fetch(`${baseUrl}/api/learning/observations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Learning-Token": "b".repeat(64),
      },
      body: JSON.stringify({
        consentVersion: 1,
        observations: [{
          clientObservationId: "invalid-station-key",
          kind: "station_traversal",
          stationKey: "station-v1:London:51.5074:-0.1278",
          hourBucket: 23,
          dayType: "weekday",
          stationTraversalSeconds: 480,
          caughtTrain: true,
          confidencePermille: 1000,
          modelVersion: "mobility-v1",
        }],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid learning observation" });
  });

  it("requires an anonymous learning token before accepting observations", async () => {
    const response = await fetch(`${baseUrl}/api/learning/observations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consentVersion: 1,
        observations: [
          {
            clientObservationId: "missing-token",
            kind: "trip_timing",
            hourBucket: 23,
            dayType: "weekday",
            confidencePermille: 1000,
            modelVersion: "mobility-v1",
          },
        ],
      }),
    });
    expect(response.status).toBe(401);
  });
});
