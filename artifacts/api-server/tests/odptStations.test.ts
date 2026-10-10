import { describe, expect, it } from "vitest";
import {
  latinKey,
  nearbyStationsIn,
  searchStationsIn,
  stationGroups,
} from "../src/lib/odptStations";
import { filterLicensedOperators } from "../src/lib/timetableEngine";
import { distanceMeters } from "../src/lib/transit/transfers";
import { fixtureSnapshot, STATION } from "./helpers/transitFixture";

const snapshot = filterLicensedOperators(fixtureSnapshot);
const names = (query: string) => searchStationsIn(snapshot, query).map((station) => station.nameJa);

describe("station groups", () => {
  it("collapses the operators' platforms of one station", () => {
    const groups = stationGroups(snapshot);
    expect(groups.map((group) => group.nameJa)).toEqual([
      "渋谷",
      "表参道",
      "大手町",
      "日本橋",
      "押上〈スカイツリー前〉",
    ]);
    const otemachi = groups.find((group) => group.nameJa === "大手町")!;
    expect(otemachi.id).toBe("odpt.Station:TokyoMetro.Hanzomon.Otemachi");
    // Centroid of the Metro and Toei platforms.
    expect(otemachi.lat).toBeCloseTo((35.6862 + 35.6849) / 2, 6);
    expect(otemachi.lon).toBeCloseTo((139.766 + 139.7668) / 2, 6);
  });

  it("folds romanization variants", () => {
    expect(latinKey("Omote-sando")).toBe(latinKey("Omotesando"));
    expect(latinKey("Nihonbashi")).toBe(latinKey("Nihombashi"));
    expect(latinKey("Tōkyō")).toBe(latinKey("Tokyo"));
    expect(latinKey("Shibuya Station")).toBe("shibuya");
  });
});

describe("station search", () => {
  it("finds Japanese names with or without 駅 and bracketed alternates", () => {
    expect(names("渋谷")).toEqual(["渋谷"]);
    expect(names("渋谷駅")).toEqual(["渋谷"]);
    expect(names("押上")).toEqual(["押上〈スカイツリー前〉"]);
    expect(names("押上（スカイツリー前）")).toEqual(["押上〈スカイツリー前〉"]);
    expect(names("スカイツリー")).toEqual(["押上〈スカイツリー前〉"]);
  });

  it("finds English names regardless of case and punctuation", () => {
    expect(names("shibuya")).toEqual(["渋谷"]);
    expect(names("OMOTESANDO")).toEqual(["表参道"]);
    expect(names("Nihonbashi")).toEqual(["日本橋"]);
  });

  it("finds kana readings through romaji", () => {
    expect(names("しぶや")).toEqual(["渋谷"]);
    expect(names("オテマチ")).toEqual(["大手町"]);
  });

  it("returns each station once, in the Station shape", () => {
    const [otemachi, ...rest] = searchStationsIn(snapshot, "大手町");
    expect(rest).toEqual([]);
    expect(otemachi).toEqual({
      id: "odpt.Station:TokyoMetro.Hanzomon.Otemachi",
      name: "Otemachi",
      nameJa: "大手町",
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
  });

  it("lists prefix matches before contains matches", () => {
    expect(searchStationsIn(snapshot, "o").map((station) => station.name)).toEqual([
      "Omote-sando",
      "Otemachi",
      "Oshiage (SKYTREE)",
      "Nihombashi",
    ]);
  });

  it("finds nothing for uncovered or unlicensed stations", () => {
    expect(names("吉祥寺")).toEqual([]);
    expect(names("Kichijoji")).toEqual([]);
    // Yurikamome is in the raw snapshot but not licensed.
    expect(names("新橋")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });
});

describe("nearby stations", () => {
  it("lists stations within 2.5 km, nearest first, with walking estimates", () => {
    const nearby = nearbyStationsIn(snapshot, STATION.shibuya.lat, STATION.shibuya.lon, "normal", 5);
    expect(nearby.map((station) => station.nameJa)).toEqual(["渋谷", "表参道"]);
    expect(nearby[0]).toMatchObject({ walkingMeters: 0, walkingMinutes: 1 });
    const straight = distanceMeters(STATION.shibuya, { lat: 35.6653, lon: 139.7123 });
    const walkingMeters = Math.round(straight * 1.3);
    expect(nearby[1]).toMatchObject({
      walkingMeters,
      walkingMinutes: Math.ceil(walkingMeters / 80),
    });
  });

  it("uses the pace and limit", () => {
    const relaxed = nearbyStationsIn(snapshot, STATION.shibuya.lat, STATION.shibuya.lon, "relaxed", 1);
    const fast = nearbyStationsIn(snapshot, STATION.shibuya.lat, STATION.shibuya.lon, "fast", 2);
    expect(relaxed).toHaveLength(1);
    expect(fast[1].walkingMinutes!).toBeLessThan(
      nearbyStationsIn(snapshot, STATION.shibuya.lat, STATION.shibuya.lon, "relaxed", 2)[1].walkingMinutes!,
    );
  });

  it("lists a station with several platforms once", () => {
    const nearby = nearbyStationsIn(snapshot, STATION.otemachiMetro.lat, STATION.otemachiMetro.lon, "normal", 10);
    // 押上 is ~5 km away, beyond the radius.
    expect(nearby.map((station) => station.nameJa)).toEqual(["大手町", "日本橋"]);
  });

  it("is empty outside coverage", () => {
    expect(nearbyStationsIn(snapshot, 35.7031, 139.5798, "normal", 5)).toEqual([]);
  });
});
