import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../src/lib/cache";
import {
  searchDepartureTrain,
  searchTrain,
  stationByCode,
} from "../src/lib/ekispert";
import { taxiEstimate } from "../src/lib/navitime";
import {
  findPartwayTrainTaxi,
  partwayCandidateStops,
} from "../src/lib/partway";

vi.mock("../src/lib/ekispert", () => ({
  searchTrain: vi.fn(),
  searchDepartureTrain: vi.fn(),
  stationByCode: vi.fn(),
}));
vi.mock("../src/lib/navitime", () => ({ taxiEstimate: vi.fn() }));

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
    expect(partwayCandidateStops(many, "駅0", "駅11")).toHaveLength(4);
  });
});

describe("partway train + taxi search", () => {
  const from = { name: "渋谷", latitude: 35.658, longitude: 139.701 };
  const to = { name: "三鷹", latitude: 35.702, longitude: 139.56 };
  const train = (arrivesAt: string) => ({
    departsAt: "2026-10-03T00:10:00+09:00",
    arrivesAt,
    transfers: 0,
    fareYen: 300,
    legs: [],
    stopRefs: [],
  });

  beforeEach(() => {
    vi.mocked(searchTrain).mockReset().mockResolvedValue({
      ...train("2026-10-03T00:30:00+09:00"),
      stopRefs: route.stopRefs,
    });
    // First call: the full rail route is gone. Later calls: partway trains.
    vi.mocked(searchDepartureTrain)
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(train("2026-10-03T00:40:00+09:00"));
    vi.mocked(stationByCode)
      .mockReset()
      .mockImplementation(async (stop) => ({
        code: stop.code,
        name: stop.name,
        latitude: 35.7,
        longitude: 139.6,
      }));
    vi.mocked(taxiEstimate)
      .mockReset()
      .mockResolvedValue({ distanceMeters: 4_000, minutes: 12, fareYen: 2_000 });
  });

  const search = () =>
    findPartwayTrainTaxi({
      from,
      to,
      taxiTo: to,
      serviceDate: "20261002",
      earliestBoardAtMs: Date.parse("2026-10-03T00:05:00+09:00"),
    });

  it("evaluates the bounded candidates and selects the cheapest known total fare", async () => {
    vi.mocked(taxiEstimate)
      .mockReset()
      // Farthest is not always cheapest once road geometry and taxi fares are included.
      .mockResolvedValueOnce({ distanceMeters: 3_000, minutes: 10, fareYen: 2_600 })
      .mockResolvedValueOnce({ distanceMeters: 4_000, minutes: 12, fareYen: 1_400 })
      .mockResolvedValueOnce({ distanceMeters: 5_000, minutes: 14, fareYen: 1_800 });

    const option = await search();

    expect(option?.taxiFrom.nameJa).toBe("中野");
    expect(option?.totalFareYen).toBe(1_700);
    expect(searchTrain).toHaveBeenCalledTimes(1);
    // One full-route check plus one departure search for each bounded candidate.
    expect(searchDepartureTrain).toHaveBeenCalledTimes(4);
    expect(stationByCode).toHaveBeenCalledTimes(3);
    expect(taxiEstimate).toHaveBeenCalledTimes(3);
  });

  it("continues after one provider failure and still chooses the cheapest remaining option", async () => {
    vi.mocked(taxiEstimate)
      .mockReset()
      .mockRejectedValueOnce(new ProviderError("NAVITIME responded 503"))
      .mockResolvedValueOnce({ distanceMeters: 6_000, minutes: 15, fareYen: 2_800 })
      .mockResolvedValueOnce({ distanceMeters: 7_000, minutes: 17, fareYen: 1_600 });

    const option = await search();

    expect(option?.taxiFrom.nameJa).toBe("新宿");
    expect(option?.totalFareYen).toBe(1_900);
    expect(taxiEstimate).toHaveBeenCalledTimes(3);
  });

  it("surfaces the provider error when no candidate works", async () => {
    vi.mocked(taxiEstimate)
      .mockReset()
      .mockRejectedValue(new ProviderError("NAVITIME responded 503"));

    await expect(search()).rejects.toBeInstanceOf(ProviderError);
    expect(taxiEstimate).toHaveBeenCalledTimes(3);
  });
});
