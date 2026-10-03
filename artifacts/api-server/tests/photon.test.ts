import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, kvCacheTable } from "@workspace/db";
import { searchStations } from "../src/lib/navitime";
import { isJapaneseQuery } from "../src/lib/photon";

const CACHE_NAME = "photon-station-search";

async function clearPhotonCache() {
  await getDb().delete(kvCacheTable).where(eq(kvCacheTable.cacheName, CACHE_NAME));
}

function feature(osmId: number, name: string, extra: Record<string, string> = {}) {
  return {
    properties: { osm_id: osmId, name, ...extra },
    geometry: { coordinates: [139.7016, 35.658] },
  };
}

function photonFetch() {
  return vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    const english = url.searchParams.get("lang") === "en";
    return new Response(
      JSON.stringify({
        features: [
          feature(1, english ? "Shibuya" : "渋谷", {
            state: english ? "Tokyo" : "東京都",
            city: english ? "Shibuya" : "渋谷区",
          }),
          // Same station complex from another operator: collapsed.
          feature(2, english ? "Shibuya" : "渋谷", {
            state: english ? "Tokyo" : "東京都",
            city: english ? "Shibuya" : "渋谷区",
          }),
        ],
      }),
      { status: 200 },
    );
  });
}

beforeEach(clearPhotonCache);
afterEach(() => vi.unstubAllGlobals());
afterAll(clearPhotonCache);

describe("romaji station search", () => {
  it("detects Japanese queries that NAVITIME can search", () => {
    expect(isJapaneseQuery("渋谷")).toBe(true);
    expect(isJapaneseQuery("しぶや")).toBe(true);
    expect(isJapaneseQuery("シブヤ")).toBe(true);
    expect(isJapaneseQuery("Shibuya")).toBe(false);
  });

  it("uses Photon for Latin-script queries and returns the Station shape", async () => {
    const fetchMock = photonFetch();
    vi.stubGlobal("fetch", fetchMock);

    const stations = await searchStations("Shibuya");

    expect(stations).toEqual([
      {
        id: "1",
        name: "Shibuya",
        nameJa: "渋谷",
        latitude: 35.658,
        longitude: 139.7016,
        region: "東京都渋谷区",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.every((url) => url.host === "photon.komoot.io")).toBe(true);
    expect(urls.map((url) => url.searchParams.get("lang")).sort()).toEqual([
      "default",
      "en",
    ]);
    expect(urls[0].searchParams.get("osm_tag")).toBe("railway:station");
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/LastRide/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("caches Photon answers", async () => {
    const fetchMock = photonFetch();
    vi.stubGlobal("fetch", fetchMock);

    await searchStations("Shibuya");
    await searchStations("Shibuya");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
