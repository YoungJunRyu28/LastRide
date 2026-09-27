import { describe, expect, it } from "vitest";
import { partwayCandidateStops } from "../src/lib/partway";

const route = {
  stopRefs: [
    { code: "1", name: "渋谷", nameEn: "Shibuya" },
    { code: "2", name: "新宿", nameEn: "Shinjuku" },
    { code: "3", name: "中野", nameEn: "Nakano" },
    { code: "4", name: "吉祥寺", nameEn: "Kichijoji" },
    { code: "5", name: "三鷹", nameEn: "Mitaka" },
  ],
};

describe("partway train candidates", () => {
  it("tries the farthest intermediate stop first", () => {
    expect(
      partwayCandidateStops(route, "渋谷", "三鷹").map((stop) => stop.name),
    ).toEqual(["吉祥寺", "中野", "新宿"]);
  });

  it("excludes provider-decorated origin and destination names", () => {
    expect(
      partwayCandidateStops(route, "渋谷(東京都)", "三鷹（東京都）").map(
        (stop) => stop.name,
      ),
    ).toEqual(["吉祥寺", "中野", "新宿"]);
  });

  it("caps paid route-search attempts", () => {
    const many = {
      stopRefs: Array.from({ length: 12 }, (_, index) => ({
        code: String(index),
        name: `駅${index}`,
        nameEn: `Station ${index}`,
      })),
    };
    expect(partwayCandidateStops(many, "駅0", "駅11")).toHaveLength(6);
  });
});
