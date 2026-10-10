import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { resetTimetableEngine } from "../src/lib/timetableEngine";
import { writeFixtureSnapshot } from "./helpers/transitFixture";

let server: Server;
let baseUrl: string;
let snapshotPath: string;

beforeAll(async () => {
  // Readiness requires a loadable timetable snapshot.
  snapshotPath = await writeFixtureSnapshot();
  process.env.TRANSIT_SNAPSHOT_PATH = snapshotPath;
  resetTimetableEngine();

  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  delete process.env.TRANSIT_SNAPSHOT_PATH;
  resetTimetableEngine();
  await rm(path.dirname(snapshotPath), { recursive: true, force: true });
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

  it("fails readiness when required configuration is missing", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const response = await fetch(`${baseUrl}/api/readyz`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "not-ready" });
    } finally {
      process.env.DATABASE_URL = databaseUrl;
    }
  });

  it("fails readiness without a timetable snapshot", async () => {
    process.env.TRANSIT_SNAPSHOT_PATH = path.join(path.dirname(snapshotPath), "missing.json.gz");
    resetTimetableEngine();
    try {
      const response = await fetch(`${baseUrl}/api/readyz`);
      expect(response.status).toBe(503);
    } finally {
      process.env.TRANSIT_SNAPSHOT_PATH = snapshotPath;
      resetTimetableEngine();
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
});
