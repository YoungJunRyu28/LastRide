/**
 * Train partway, then taxi, on the fixture snapshot (渋谷 → 押上, changing
 * at 大手町). The last through connection leaves 渋谷 at 23:50; the 24:00
 * still reaches 表参道 and 大手町 but misses the last Toei train.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { taxiEstimate } from "../src/lib/estimates";
import { findPartwayTrainTaxi, partwayCandidateStops } from "../src/lib/partway";
import { filterLicensedOperators, matchStations, resetTimetableEngine } from "../src/lib/timetableEngine";
import { lastTrainBetween } from "../src/lib/transit/snapshot";
import { fixtureSnapshot, STATION, writeFixtureSnapshot } from "./helpers/transitFixture";

const from = { name: "渋谷", latitude: STATION.shibuya.lat, longitude: STATION.shibuya.lon };
const to = { name: "押上", latitude: STATION.oshiage.lat, longitude: STATION.oshiage.lon };

let fixturePath: string;
const savedPath = process.env.TRANSIT_SNAPSHOT_PATH;

beforeAll(async () => {
  fixturePath = await writeFixtureSnapshot();
  process.env.TRANSIT_SNAPSHOT_PATH = fixturePath;
  resetTimetableEngine();
});
afterAll(async () => {
  if (savedPath === undefined) delete process.env.TRANSIT_SNAPSHOT_PATH;
  else process.env.TRANSIT_SNAPSHOT_PATH = savedPath;
  resetTimetableEngine();
  await rm(path.dirname(fixturePath), { recursive: true, force: true });
});

describe("partway train candidates", () => {
  const snapshot = filterLicensedOperators(fixtureSnapshot);
  const journey = lastTrainBetween(
    snapshot,
    "2026-10-09",
    matchStations(snapshot, from),
    matchStations(snapshot, to),
  )!;

  it("lists the stops along the route, farthest first, without the ends", () => {
    expect(partwayCandidateStops(journey, "渋谷", "押上").map((stop) => stop.nameJa)).toEqual([
      "日本橋",
      "大手町",
      "表参道",
    ]);
  });

  it("excludes decorated origin and destination names", () => {
    expect(
      partwayCandidateStops(journey, "渋谷駅", "押上（スカイツリー前）").map((stop) => stop.nameJa),
    ).toEqual(["日本橋", "大手町", "表参道"]);
  });

  it("caps the number of attempts", () => {
    expect(partwayCandidateStops(journey, "渋谷", "押上", 2)).toHaveLength(2);
  });
});

describe("partway train + taxi search", () => {
  const search = (earliestBoard = "2026-10-09T23:55:00+09:00") =>
    findPartwayTrainTaxi({
      from,
      to,
      taxiTo: { latitude: STATION.oshiage.lat, longitude: STATION.oshiage.lon },
      serviceDate: "20261009",
      earliestBoardAtMs: Date.parse(earliestBoard),
    });

  it("rides to the farthest reachable stop and estimates one taxi from there", async () => {
    const option = await search();

    // 日本橋 is unreachable by train, so the taxi starts at 大手町.
    expect(option?.taxiFrom).toEqual({
      name: "Otemachi",
      nameJa: "大手町",
      latitude: STATION.otemachiMetro.lat,
      longitude: STATION.otemachiMetro.lon,
    });
    expect(option?.train.departsAt).toBe("2026-10-10T00:00:00+09:00");
    expect(option?.train.arrivesAt).toBe("2026-10-10T00:20:00+09:00");
    expect(option?.train.legs[0].line).toBe("東京メトロ半蔵門線");
    expect(option?.totalFareYen).toBeNull();
    // Priced at the train's arrival time (00:20, so with the late-night surcharge).
    expect(option?.taxi).toEqual(
      taxiEstimate(
        { latitude: STATION.otemachiMetro.lat, longitude: STATION.otemachiMetro.lon },
        { latitude: STATION.oshiage.lat, longitude: STATION.oshiage.lon },
        "2026-10-10T00:20:00",
      ),
    );
    expect(option?.taxi.fareYen).toBeGreaterThan(0);
  });

  it("returns nothing while the full rail route can still be caught", async () => {
    expect(await search("2026-10-09T23:45:00+09:00")).toBeNull();
  });

  it("returns nothing for stations the engine doesn't cover", async () => {
    const option = await findPartwayTrainTaxi({
      from: { name: "吉祥寺", latitude: 35.7031, longitude: 139.5798 },
      to,
      taxiTo: { latitude: STATION.oshiage.lat, longitude: STATION.oshiage.lon },
      serviceDate: "20261009",
      earliestBoardAtMs: Date.parse("2026-10-09T23:55:00+09:00"),
    });
    expect(option).toBeNull();
  });
});
