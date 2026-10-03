/**
 * Changing trains. Each operator gives its part of a station its own ID (JR
 * Shibuya, Tokyo Metro Shibuya, Tokyu Shibuya …), so stations with the same
 * Japanese name close together are linked by a walk whose length grows with
 * the distance between them. Changing trains within one ID still takes time.
 */
import type { Station } from "./model";

/** Minutes to change between two trains at the same station ID. */
export const SAME_STATION_CHANGE_MINUTES = 2;
/** Stations further apart than this are not treated as one interchange. */
const MAX_INTERCHANGE_METERS = 700;
/** Fastest walk between two operators' stations, platform to platform. */
const MIN_INTERCHANGE_MINUTES = 4;
/** Walking pace inside big stations, including stairs and gates. */
const INTERCHANGE_METERS_PER_MINUTE = 60;

export type Footpath = { to: number; minutes: number };

/** "渋谷駅", "渋谷（東京都）" and " 渋谷 " all become "渋谷". */
export function normalizeStationName(nameJa: string): string {
  return nameJa
    .normalize("NFKC")
    .replace(/[(（〈<][^)）〉>]*[)）〉>]$/, "")
    .replace(/駅$/, "")
    .replace(/\s+/g, "")
    .trim();
}

export function distanceMeters(
  a: Pick<Station, "lat" | "lon">,
  b: Pick<Station, "lat" | "lon">,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function interchangeMinutes(meters: number): number {
  return Math.max(
    MIN_INTERCHANGE_MINUTES,
    Math.ceil(2 + meters / INTERCHANGE_METERS_PER_MINUTE),
  );
}

/** Station indexes grouped by normalised Japanese name. */
export function stationsByName(stations: Station[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  stations.forEach((station, index) => {
    const key = normalizeStationName(station.nameJa);
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });
  return groups;
}

/** Walks between same-named stations, indexed by the station walked from. */
export function buildFootpaths(stations: Station[]): Footpath[][] {
  const footpaths: Footpath[][] = stations.map(() => []);
  for (const group of stationsByName(stations).values()) {
    for (const from of group) {
      for (const to of group) {
        if (from === to) continue;
        const meters = distanceMeters(stations[from], stations[to]);
        if (meters > MAX_INTERCHANGE_METERS) continue;
        footpaths[from].push({ to, minutes: interchangeMinutes(meters) });
      }
    }
  }
  return footpaths;
}
