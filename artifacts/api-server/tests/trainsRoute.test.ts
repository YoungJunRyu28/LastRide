/**
 * /trains/* over HTTP, served from the fixture snapshot. Only the trains
 * router is mounted, so no database is needed.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import pinoHttp from "pino-http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "../src/lib/logger";
import { resetTimetableEngine } from "../src/lib/timetableEngine";
import { resetTrainInformationCache } from "../src/lib/trainInformation";
import trainsRouter from "../src/routes/trains";
import { STATION, writeFixtureSnapshot } from "./helpers/transitFixture";

let server: Server;
let baseUrl: string;
let fixturePath: string;
const saved = { path: process.env.TRANSIT_SNAPSHOT_PATH, odpt: process.env.ODPT_KEY };

beforeAll(async () => {
  fixturePath = await writeFixtureSnapshot();
  process.env.TRANSIT_SNAPSHOT_PATH = fixturePath;
  resetTimetableEngine();
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use("/api", trainsRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(() => {
  process.env.TRANSIT_SNAPSHOT_PATH = fixturePath;
  if (saved.odpt === undefined) delete process.env.ODPT_KEY;
  else process.env.ODPT_KEY = saved.odpt;
  resetTimetableEngine();
  resetTrainInformationCache();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (saved.path === undefined) delete process.env.TRANSIT_SNAPSHOT_PATH;
  else process.env.TRANSIT_SNAPSHOT_PATH = saved.path;
  resetTimetableEngine();
  await rm(path.dirname(fixturePath), { recursive: true, force: true });
});

const query = (fromName: string, from: { lat: number; lon: number }, toName: string, to: { lat: number; lon: number }, date: string) =>
  new URLSearchParams({
    fromName,
    fromLat: String(from.lat),
    fromLon: String(from.lon),
    toName,
    toLat: String(to.lat),
    toLon: String(to.lon),
    date,
  }).toString();

describe("GET /trains/last and /trains/first", () => {
  it("answers from the engine in the TrainRoute shape", async () => {
    const response = await fetch(
      `${baseUrl}/trains/last?${query("渋谷", STATION.shibuya, "押上", STATION.oshiage, "20261009")}`,
    );
    expect(response.status).toBe(200);
    const route = await response.json();
    expect(route).toMatchObject({
      departsAt: "2026-10-09T23:50:00+09:00",
      arrivesAt: "2026-10-10T00:35:00+09:00",
      transfers: 1,
      fareYen: null,
    });
    expect(route.legs).toHaveLength(2);

    const first = await fetch(
      `${baseUrl}/trains/first?${query("渋谷", STATION.shibuya, "押上", STATION.oshiage, "20261010")}`,
    );
    expect(first.status).toBe(200);
    expect((await first.json()).departsAt).toBe("2026-10-10T05:00:00+09:00");
  });

  it("answers 404 for stations the engine doesn't cover", async () => {
    const response = await fetch(
      `${baseUrl}/trains/last?${query("吉祥寺", { lat: 35.7031, lon: 139.5798 }, "押上", STATION.oshiage, "20261009")}`,
    );
    expect(response.status).toBe(404);
  });

  it("answers 503 when the snapshot is missing", async () => {
    process.env.TRANSIT_SNAPSHOT_PATH = path.join(path.dirname(fixturePath), "missing.json.gz");
    resetTimetableEngine();
    const response = await fetch(
      `${baseUrl}/trains/last?${query("渋谷", STATION.shibuya, "押上", STATION.oshiage, "20261009")}`,
    );
    expect(response.status).toBe(503);
  });
});

describe("GET /trains/disruptions", () => {
  it("answers 503 rather than claiming no disruption when the ODPT key is missing", async () => {
    delete process.env.ODPT_KEY;
    const response = await fetch(baseUrl + "/trains/disruptions?lines=" + encodeURIComponent("都営浅草線"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Live train disruption information unavailable" });
  });

  it("returns ODPT disruptions on the route's lines", async () => {
    process.env.ODPT_KEY = "test-odpt-key";
    const fetchMock = vi.fn(async (url: URL | string) => {
      const operator = new URL(String(url)).searchParams.get("odpt:operator");
      const body =
        operator === "odpt.Operator:Toei"
          ? [
              {
                "odpt:railway": "odpt.Railway:Toei.Asakusa",
                "dc:date": "2026-10-09T23:40:00+09:00",
                "odpt:trainInformationStatus": { ja: "運転見合わせ" },
                "odpt:trainInformationCause": { ja: "人身事故" },
                "odpt:trainInformationText": { ja: "浅草線は人身事故の影響で運転を見合わせています。" },
              },
              {
                "odpt:railway": "odpt.Railway:Toei.Oedo",
                "odpt:trainInformationText": { ja: "現在、１５分以上の遅延はありません。" },
              },
            ]
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    // fetch is stubbed, so ask the module directly rather than over HTTP.
    vi.stubGlobal("fetch", fetchMock);

    const { trainDisruptionsForLines } = await import("../src/lib/trainInformation");
    const incidents = await trainDisruptionsForLines(["都営浅草線", "東京メトロ半蔵門線"]);
    expect(incidents).toEqual([
      {
        line: "都営浅草線",
        lineCode: "odpt.Railway:Toei.Asakusa",
        status: "運転見合わせ",
        title: "運転見合わせ（人身事故）",
        comment: "浅草線は人身事故の影響で運転を見合わせています。",
        updatedAt: "2026-10-09T23:40:00+09:00",
      },
    ]);
    // Cached: a second request within a minute makes no new ODPT calls.
    const calls = fetchMock.mock.calls.length;
    expect(await trainDisruptionsForLines(["東京メトロ半蔵門線"])).toEqual([]);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("does not claim unsupported JR/private railway lines have no disruptions", async () => {
    process.env.ODPT_KEY = "test-odpt-key";
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { trainDisruptionsForLines, TrainInformationUnavailableError } =
      await import("../src/lib/trainInformation");
    await expect(trainDisruptionsForLines(["ＪＲ山手線"]))
      .rejects.toBeInstanceOf(TrainInformationUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not cache a false no-incidents result when every operator fails", async () => {
    process.env.ODPT_KEY = "test-odpt-key";
    const broken = vi.fn(async () => new Response("oops", { status: 500 }));
    vi.stubGlobal("fetch", broken);
    const { trainDisruptionsForLines, TrainInformationUnavailableError } =
      await import("../src/lib/trainInformation");
    await expect(trainDisruptionsForLines(["都営浅草線"]))
      .rejects.toBeInstanceOf(TrainInformationUnavailableError);
    const failedCalls = broken.mock.calls.length;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    expect(await trainDisruptionsForLines(["都営浅草線"])).toEqual([]);
    expect(failedCalls).toBeGreaterThan(0);
  });

  it("does not hide a partial ODPT outage when other operators report no issues", async () => {
    process.env.ODPT_KEY = "test-odpt-key";
    vi.stubGlobal("fetch", vi.fn(async (url: URL | string) => {
      const operator = new URL(String(url)).searchParams.get("odpt:operator");
      return operator === "odpt.Operator:Toei"
        ? new Response("bad gateway", { status: 502 })
        : new Response("[]", { status: 200 });
    }));
    const { trainDisruptionsForLines, TrainInformationUnavailableError } =
      await import("../src/lib/trainInformation");
    await expect(trainDisruptionsForLines(["都営浅草線"]))
      .rejects.toBeInstanceOf(TrainInformationUnavailableError);
  });

  it("rejects malformed ODPT JSON instead of treating it as normal service", async () => {
    process.env.ODPT_KEY = "test-odpt-key";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "provider error" }), { status: 200 })));
    const { trainDisruptionsForLines, TrainInformationUnavailableError } =
      await import("../src/lib/trainInformation");
    await expect(trainDisruptionsForLines(["都営浅草線"]))
      .rejects.toBeInstanceOf(TrainInformationUnavailableError);
  });
});
