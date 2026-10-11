/**
 * The server's adapter around the timetable engine: matching the app's
 * stations to snapshot stations, dropping unlicensed operators, and turning
 * a journey into the API's TrainRoute. Uses the small fixture snapshot.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  filterLicensedOperators,
  jstIso,
  lineLabel,
  matchStations,
  normalizeServiceDate,
  resetTimetableEngine,
  searchTrain,
  searchTrainIn,
  TimetableUnavailableError,
  timetableEngine,
  toTrainRoute,
} from "../src/lib/timetableEngine";
import { lastTrainBetween } from "../src/lib/transit/snapshot";
import { fixtureSnapshot, STATION, writeFixtureSnapshot } from "./helpers/transitFixture";

const snapshot = filterLicensedOperators(fixtureSnapshot);
const at = (
  name: string,
  point: { lat: number; lon: number } = { lat: 0, lon: 0 },
) => ({ name, latitude: point.lat, longitude: point.lon });
/** About 110 m north of a point. */
const near = (point: { lat: number; lon: number }) => ({
  lat: point.lat + 0.001,
  lon: point.lon,
});
const nameOf = (index: number) => snapshot.stations[index].id;

describe("licensed operators", () => {
  it("drops Yurikamome's stations, trips and source", () => {
    expect(snapshot.stations.some((s) => s.operator.includes("Yurikamome"))).toBe(false);
    expect(snapshot.trips.some((trip) => trip.id.includes("Yurikamome"))).toBe(false);
    expect(snapshot.sources.map((source) => source.operator)).toEqual([
      "odpt.Operator:TokyoMetro",
      "odpt.Operator:Toei",
    ]);
    expect(snapshot.stations).toHaveLength(6);
    // Stops are re-indexed onto the remaining stations.
    for (const trip of snapshot.trips)
      for (const [station] of trip.stops)
        expect(snapshot.stations[station]).toBeDefined();
  });

  it("does not serve trips on excluded operators", () => {
    expect(
      searchTrainIn(
        snapshot,
        "last",
        at("新橋", STATION.shimbashi),
        at("お台場海浜公園"),
        "20261009",
      ),
    ).toBeNull();
  });
});

describe("station matching", () => {
  it("matches by Japanese name, ignoring 駅 and bracketed alternates", () => {
    expect(matchStations(snapshot, at("渋谷駅")).map(nameOf)).toEqual([
      "odpt.Station:TokyoMetro.Hanzomon.Shibuya",
    ]);
    expect(matchStations(snapshot, at("押上")).map(nameOf)).toEqual([
      "odpt.Station:Toei.Asakusa.Oshiage",
    ]);
    // Every operator's platforms of a same-named station.
    expect(matchStations(snapshot, at("大手町", STATION.otemachiMetro))).toHaveLength(2);
  });

  it("falls back to the nearest station within 400 m when the name differs", () => {
    expect(
      matchStations(snapshot, at("Shibuya Sta.", near(STATION.shibuya))).map(nameOf),
    ).toEqual(["odpt.Station:TokyoMetro.Hanzomon.Shibuya"]);
    // The nearest platform brings its same-named neighbours with it.
    expect(
      matchStations(snapshot, at("Otemachi (Tokyo)", near(STATION.otemachiMetro))),
    ).toHaveLength(2);
  });

  it("does not match a same-named station far from the given coordinates", () => {
    // A 渋谷 in another city, ~30 km away, with no covered station nearby.
    expect(matchStations(snapshot, at("渋谷", { lat: 35.4, lon: 139.5 }))).toEqual([]);
  });

  it("returns nothing for uncovered stations", () => {
    expect(matchStations(snapshot, at("吉祥寺", { lat: 35.7031, lon: 139.5798 }))).toEqual([]);
    expect(matchStations(snapshot, at("吉祥寺"))).toEqual([]);
  });
});

describe("journey → TrainRoute", () => {
  it("formats Japan times with +09:00", () => {
    expect(jstIso(Date.parse("2026-10-09T15:31:00Z"))).toBe("2026-10-10T00:31:00+09:00");
  });

  it("normalizes the API's service date", () => {
    expect(normalizeServiceDate("20261009")).toBe("2026-10-09");
    expect(normalizeServiceDate("2026-10-09")).toBe("2026-10-09");
    expect(normalizeServiceDate("2026/10/09")).toBeNull();
  });

  it("names subway lines with their operator", () => {
    expect(lineLabel("odpt.Operator:Toei", { nameJa: "新宿線", name: "Shinjuku Line" })).toEqual({
      nameJa: "都営新宿線",
      name: "Toei Shinjuku Line",
    });
    expect(
      lineLabel("odpt.Operator:YokohamaMunicipal", { nameJa: "ブルーライン", name: "Blue Line" }),
    ).toEqual({ nameJa: "横浜市営地下鉄ブルーライン", name: "Yokohama Municipal Subway Blue Line" });
    expect(
      lineLabel("odpt.Operator:MIR", { nameJa: "つくばエクスプレス", name: "Tsukuba Express Line" }).nameJa,
    ).toBe("つくばエクスプレス");
    expect(
      lineLabel("odpt.Operator:Toei", { nameJa: "日暮里・舎人ライナー", name: "Nippori-Toneri Liner" }).nameJa,
    ).toBe("日暮里・舎人ライナー");
  });

  it("answers tonight's last train with after-midnight times on the next calendar day", () => {
    const route = searchTrainIn(snapshot, "last", at("渋谷", STATION.shibuya), at("押上", STATION.oshiage), "20261009");
    expect(route).toEqual({
      departsAt: "2026-10-09T23:50:00+09:00",
      arrivesAt: "2026-10-10T00:35:00+09:00",
      transfers: 1,
      fareYen: null,
      legs: [
        {
          line: "東京メトロ半蔵門線",
          lineEn: "Tokyo Metro Hanzomon Line",
          from: "渋谷",
          fromEn: "Shibuya",
          to: "大手町",
          toEn: "Otemachi",
          departsAt: "2026-10-09T23:50:00+09:00",
          arrivesAt: "2026-10-10T00:10:00+09:00",
        },
        {
          line: "都営浅草線",
          lineEn: "Toei Asakusa Line",
          from: "大手町",
          fromEn: "Otemachi",
          to: "押上〈スカイツリー前〉",
          toEn: "Oshiage (SKYTREE)",
          departsAt: "2026-10-10T00:20:00+09:00",
          arrivesAt: "2026-10-10T00:35:00+09:00",
        },
      ],
    });
  });

  it("does not turn the interchange walk into a leg, but counts the change", () => {
    const origins = matchStations(snapshot, at("渋谷"));
    const targets = matchStations(snapshot, at("押上"));
    const journey = lastTrainBetween(snapshot, "2026-10-09", origins, targets)!;
    expect(journey.legs.map((leg) => leg.kind)).toEqual(["train", "walk", "train"]);
    const route = toTrainRoute(journey)!;
    expect(route.legs).toHaveLength(2);
    expect(route.transfers).toBe(1);
  });

  it("answers the first train of the morning of the service date", () => {
    const route = searchTrainIn(snapshot, "first", at("渋谷"), at("押上"), "20261010");
    expect(route?.departsAt).toBe("2026-10-10T05:00:00+09:00");
    expect(route?.arrivesAt).toBe("2026-10-10T05:45:00+09:00");
  });

  it("answers a single-train trip with no transfers", () => {
    const route = searchTrainIn(snapshot, "last", at("渋谷"), at("表参道"), "20261009");
    expect(route?.departsAt).toBe("2026-10-10T00:00:00+09:00");
    expect(route?.transfers).toBe(0);
    expect(route?.legs).toHaveLength(1);
  });

  it("returns null for uncovered stations, identical ends and bad dates", () => {
    expect(searchTrainIn(snapshot, "last", at("渋谷"), at("吉祥寺"), "20261009")).toBeNull();
    expect(searchTrainIn(snapshot, "last", at("渋谷"), at("渋谷"), "20261009")).toBeNull();
    expect(searchTrainIn(snapshot, "last", at("渋谷"), at("押上"), "2026/10/09")).toBeNull();
    // 押上 → 渋谷: no train goes that way in the fixture.
    expect(searchTrainIn(snapshot, "last", at("押上"), at("渋谷"), "20261009")).toBeNull();
  });
});

describe("loading the snapshot", () => {
  let fixturePath: string;
  const saved = {
    path: process.env.TRANSIT_SNAPSHOT_PATH,
    shadow: process.env.TRANSIT_SHADOW_SNAPSHOT_PATH,
  };

  beforeAll(async () => {
    fixturePath = await writeFixtureSnapshot();
  });
  afterEach(() => {
    process.env.TRANSIT_SNAPSHOT_PATH = saved.path ?? "";
    process.env.TRANSIT_SHADOW_SNAPSHOT_PATH = saved.shadow ?? "";
    if (saved.path === undefined) delete process.env.TRANSIT_SNAPSHOT_PATH;
    if (saved.shadow === undefined) delete process.env.TRANSIT_SHADOW_SNAPSHOT_PATH;
    resetTimetableEngine();
  });
  afterAll(async () => {
    await rm(path.dirname(fixturePath), { recursive: true, force: true });
  });

  it("loads from TRANSIT_SNAPSHOT_PATH and filters operators", async () => {
    process.env.TRANSIT_SNAPSHOT_PATH = fixturePath;
    resetTimetableEngine();
    const engine = await timetableEngine();
    expect(engine.snapshot.stations).toHaveLength(6);
    expect(engine.railways.get("odpt.Railway:Toei.Asakusa")?.nameJa).toBe("都営浅草線");
    expect(engine.railways.has("odpt.Railway:Yurikamome.Yurikamome")).toBe(false);
    const route = await searchTrain("last", at("渋谷"), at("押上"), "20261009");
    expect(route?.departsAt).toBe("2026-10-09T23:50:00+09:00");
  });

  it("still accepts the old TRANSIT_SHADOW_SNAPSHOT_PATH", async () => {
    delete process.env.TRANSIT_SNAPSHOT_PATH;
    process.env.TRANSIT_SHADOW_SNAPSHOT_PATH = fixturePath;
    resetTimetableEngine();
    await expect(timetableEngine()).resolves.toBeDefined();
  });

  it("reports a missing snapshot as unavailable instead of crashing", async () => {
    process.env.TRANSIT_SNAPSHOT_PATH = path.join(path.dirname(fixturePath), "missing.json.gz");
    resetTimetableEngine();
    await expect(searchTrain("last", at("渋谷"), at("押上"), "20261009")).rejects.toBeInstanceOf(
      TimetableUnavailableError,
    );
  });
});
