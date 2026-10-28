import { describe, expect, it } from "vitest";
import { distinctStations, isRailwayStation, stationBaseName } from "@/lib/applePlaces";

const place = (name: string, latitude: number, longitude: number) => ({
  name,
  latitude,
  longitude,
  phone: null,
  category: "MKPOICategoryPublicTransport",
  locality: "渋谷区",
  administrativeArea: "東京都",
});

describe("stationBaseName", () => {
  it("reduces Apple's station names to one name per complex", () => {
    expect(stationBaseName("渋谷駅")).toBe("渋谷");
    expect(stationBaseName("渋谷駅 (東京メトロ)")).toBe("渋谷");
    expect(stationBaseName("元町・中華街駅（みなとみらい線）")).toBe("元町・中華街");
    expect(stationBaseName("Shibuya Station")).toBe("Shibuya");
  });
});

describe("isRailwayStation", () => {
  it("drops bus stops", () => {
    expect(isRailwayStation({ name: "渋谷駅" })).toBe(true);
    expect(isRailwayStation({ name: "渋谷駅前バス停" })).toBe(false);
    expect(isRailwayStation({ name: "道玄坂上" })).toBe(false);
  });

  it("drops taxi ranks and exits named after a station", () => {
    expect(isRailwayStation({ name: "渋谷駅 タクシー乗り場" })).toBe(false);
    expect(isRailwayStation({ name: "渋谷駅 ハチ公口" })).toBe(false);
    expect(isRailwayStation({ name: "渋谷駅 (東京メトロ)" })).toBe(true);
    expect(isRailwayStation({ name: "Shibuya Station" })).toBe(true);
  });
});

describe("distinctStations", () => {
  it("discards an invalid MapKit coordinate rather than computing NaN distance", () => {
    const origin = { latitude: 35.6595, longitude: 139.7005 };
    const stations = distinctStations(origin, [
      place('東京都外駅', Infinity, 139.7),
      place('渋谷駅', 35.658, 139.701),
    ], 3);
    expect(stations).toHaveLength(1);
    expect(stations[0].station.nameJa).toBe('渋谷');
  });

  it("keeps one entry per station, nearest first", () => {
    const origin = { latitude: 35.6595, longitude: 139.7005 };
    const stations = distinctStations(
      origin,
      [
        place("神泉駅", 35.6572, 139.6934),
        place("渋谷駅 (東京メトロ)", 35.6590, 139.7030),
        place("渋谷駅", 35.6580, 139.7016),
        place("渋谷駅前バス停", 35.6585, 139.7010),
      ],
      3,
    );
    expect(stations.map(({ station }) => station.nameJa)).toEqual(["渋谷", "神泉"]);
    expect(stations[0].station.regionJa).toBe("東京都渋谷区");
  });
});
