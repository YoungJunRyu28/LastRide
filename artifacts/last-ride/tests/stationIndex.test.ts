import { describe, expect, it } from "vitest";
import { isKnownStation, normalizeStationName } from "@/lib/stationIndex";

describe("normalizeStationName", () => {
  it("drops brackets, 駅, a JR prefix and ヶ/ケ differences", () => {
    expect(normalizeStationName("明治神宮前 <原宿>駅")).toBe("明治神宮前");
    expect(normalizeStationName("明治神宮前〈原宿〉")).toBe("明治神宮前");
    expect(normalizeStationName("JR渋谷駅")).toBe("渋谷");
    expect(normalizeStationName("霞ヶ関")).toBe("霞ケ関");
    expect(normalizeStationName("元町・中華街駅（みなとみらい線）")).toBe("元町・中華街");
  });
});

describe("isKnownStation (国土数値情報, passenger stations)", () => {
  it("knows real stations where Apple puts them", () => {
    expect(isKnownStation({ nameJa: "渋谷", latitude: 35.658, longitude: 139.7016 })).toBe(true);
    expect(isKnownStation({ nameJa: "みなとみらい", latitude: 35.4575, longitude: 139.6325 })).toBe(true);
    expect(isKnownStation({ nameJa: "山手", latitude: 35.4272, longitude: 139.6463 })).toBe(true);
    expect(isKnownStation({ nameJa: "明治神宮前 <原宿>", latitude: 35.669, longitude: 139.7044 })).toBe(true);
    expect(isKnownStation({ nameJa: "元町・中華街", latitude: 35.4428, longitude: 139.6505 })).toBe(true);
    expect(isKnownStation({ nameJa: "ゆりかもめ新橋", latitude: 35.6662, longitude: 139.7596 })).toBe(true); // right there, other spelling
    expect(isKnownStation({ nameJa: "県庁前", latitude: 33.558, longitude: 133.5323 })).toBe(true); // tram stop (とさでん)
  });

  it("doesn't know the gondola, the freight terminal, cable cars or far-off namesakes", () => {
    expect(isKnownStation({ nameJa: "運河パーク", latitude: 35.4538, longitude: 139.6339 })).toBe(false);
    expect(isKnownStation({ nameJa: "横浜本牧", latitude: 35.4234, longitude: 139.6714 })).toBe(false);
    expect(isKnownStation({ nameJa: "高尾山", latitude: 35.6311, longitude: 139.2561 })).toBe(false);
    // 渋谷 exists, but not 5 km from it.
    expect(isKnownStation({ nameJa: "渋谷", latitude: 35.7, longitude: 139.75 })).toBe(false);
  });
});
