/**
 * /stations, /walk, /taxi, /places and /addresses over HTTP. They answer from
 * the fixture snapshot and straight-line estimates, so no database or network
 * is needed.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import pinoHttp from "pino-http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { taxiEstimate, walkEstimate } from "../src/lib/estimates";
import { logger } from "../src/lib/logger";
import { resetTimetableEngine } from "../src/lib/timetableEngine";
import addressesRouter from "../src/routes/addresses";
import placesRouter from "../src/routes/places";
import stationsRouter from "../src/routes/stations";
import taxiRouter from "../src/routes/taxi";
import walkRouter from "../src/routes/walk";
import { STATION, writeFixtureSnapshot } from "./helpers/transitFixture";

let server: Server;
let baseUrl: string;
let fixturePath: string;
const savedPath = process.env.TRANSIT_SNAPSHOT_PATH;

beforeAll(async () => {
  fixturePath = await writeFixtureSnapshot();
  process.env.TRANSIT_SNAPSHOT_PATH = fixturePath;
  resetTimetableEngine();
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use("/api", stationsRouter, walkRouter, taxiRouter, placesRouter, addressesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(() => {
  process.env.TRANSIT_SNAPSHOT_PATH = fixturePath;
  resetTimetableEngine();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (savedPath === undefined) delete process.env.TRANSIT_SNAPSHOT_PATH;
  else process.env.TRANSIT_SNAPSHOT_PATH = savedPath;
  resetTimetableEngine();
  await rm(path.dirname(fixturePath), { recursive: true, force: true });
});

const get = async (pathAndQuery: string) => {
  const response = await fetch(`${baseUrl}${pathAndQuery}`);
  return { status: response.status, body: (await response.json()) as unknown };
};

describe("stations", () => {
  it("searches the snapshot by name", async () => {
    const { status, body } = await get(`/stations/search?q=${encodeURIComponent("渋谷駅")}`);
    expect(status).toBe(200);
    expect(body).toEqual([
      {
        id: "odpt.Station:TokyoMetro.Hanzomon.Shibuya",
        name: "Shibuya",
        nameJa: "渋谷",
        latitude: STATION.shibuya.lat,
        longitude: STATION.shibuya.lon,
      },
    ]);
  });

  it("lists nearby stations with walking estimates", async () => {
    const { status, body } = await get(
      `/stations/nearby?lat=${STATION.shibuya.lat}&lon=${STATION.shibuya.lon}&pace=normal&limit=1`,
    );
    expect(status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({ nameJa: "渋谷", walkingMeters: 0, walkingMinutes: 1 }),
    ]);
  });

  it("rejects invalid queries", async () => {
    expect((await get("/stations/search?q=")).status).toBe(400);
    expect((await get("/stations/nearby?lat=35&lon=139&pace=jog")).status).toBe(400);
  });

  it("answers 502 without a snapshot", async () => {
    process.env.TRANSIT_SNAPSHOT_PATH = path.join(path.dirname(fixturePath), "missing.json.gz");
    resetTimetableEngine();
    const { status } = await get(`/stations/search?q=shibuya`);
    expect(status).toBe(502);
  });
});

describe("walk and taxi", () => {
  const coords = `fromLat=${STATION.shibuya.lat}&fromLon=${STATION.shibuya.lon}&toLat=${STATION.oshiage.lat}&toLon=${STATION.oshiage.lon}`;
  const from = { latitude: STATION.shibuya.lat, longitude: STATION.shibuya.lon };
  const to = { latitude: STATION.oshiage.lat, longitude: STATION.oshiage.lon };

  it("estimates a walk", async () => {
    const { status, body } = await get(`/walk?${coords}&pace=fast`);
    expect(status).toBe(200);
    expect(body).toEqual(walkEstimate(from, to, "fast"));
  });

  it("estimates a taxi at the given start time", async () => {
    const { status, body } = await get(`/taxi?${coords}&startTime=2026-10-09T23:30:00`);
    expect(status).toBe(200);
    expect(body).toEqual(taxiEstimate(from, to, "2026-10-09T23:30:00"));
  });

  it("rejects invalid queries", async () => {
    expect((await get(`/walk?${coords}`)).status).toBe(400);
    expect((await get(`/taxi?${coords}&startTime=tonight`)).status).toBe(400);
  });
});

describe("places and addresses", () => {
  it("answer empty lists (done on the device)", async () => {
    expect(await get("/places/nearby?lat=35.658&lon=139.7016")).toEqual({ status: 200, body: [] });
    expect(await get(`/addresses/search?q=${encodeURIComponent("東京都渋谷区")}`)).toEqual({
      status: 200,
      body: [],
    });
  });

  it("still validate their queries", async () => {
    expect((await get("/places/nearby?lat=91&lon=139.7")).status).toBe(400);
    expect((await get("/addresses/search?q=")).status).toBe(400);
  });
});
