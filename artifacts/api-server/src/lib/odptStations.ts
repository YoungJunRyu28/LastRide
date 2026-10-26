/**
 * Station search and nearby stations from the ODPT timetable snapshot the
 * server already loads (timetableEngine: licensed operators only). iOS does
 * these with Apple MapKit on the device; this answers Android and the
 * fallback path without any paid provider.
 *
 * Coverage limit: only stations of the licensed ODPT operators (Tokyo Metro,
 * Toei, Rinkai, TX, Tama Monorail, Yokohama Municipal Subway) are known. JR
 * and private-railway stations are not found by search or nearby — accepted
 * for now; those users rely on the device (Apple MapKit) instead.
 *
 * Platforms of the same station from different operators/lines (same
 * normalized Japanese name within 700 m) are collapsed into one result placed
 * at their centroid. Walking distance/time are estimates (straight line ×
 * 1.3 at the pace's speed), not routed.
 */
import { WALK_ROUTE_FACTOR, walkingMinutes, type Pace } from "./estimates";
import { kanaToRomaji } from "./romaji";
import { timetableEngine } from "./timetableEngine";
import type { TransitSnapshot } from "./transit/model";
import { distanceMeters, normalizeStationName } from "./transit/transfers";

/** The API's Station shape. */
export type Station = {
  id: string;
  name: string;
  nameJa: string;
  latitude: number;
  longitude: number;
  region?: string;
  walkingMeters?: number;
  walkingMinutes?: number;
  walkingSource?: 'estimated';
};

/** Same-named platforms closer than this are one station (as in transfers.ts). */
const SAME_STATION_METERS = 700;
/** Nearby search radius (straight line). */
export const NEARBY_RADIUS_METERS = 2_500;
export const SEARCH_LIMIT = 8;

type StationGroup = {
  id: string;
  name: string;
  nameJa: string;
  lat: number;
  lon: number;
  /** normalizeStationName of the Japanese name ("押上〈スカイツリー前〉" → "押上"). */
  jaKey: string;
  /** The full Japanese name, NFKC, without spaces (keeps bracketed parts). */
  jaFull: string;
  latinKey: string;
};

/**
 * Comparable form of a Latin-script name: accents and punctuation dropped,
 * lower case, and the spelling variations of station signs folded together
 * ("Nihonbashi"/"Nihombashi", "Toukyou"/"Tokyo", "Omote-sando"/"Omotesando").
 */
export function latinKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+station$/, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/n(?=[bmp])/g, "m")
    .replace(/ou/g, "o")
    .replace(/oo/g, "o")
    .replace(/uu/g, "u");
}

function jaFullKey(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "");
}

const KANA_ONLY = /^[ぁ-ヿ\s]+$/;

const groupsBySnapshot = new WeakMap<TransitSnapshot, StationGroup[]>();

/** The snapshot's stations with each station's platforms collapsed, in snapshot order. */
export function stationGroups(snapshot: TransitSnapshot): StationGroup[] {
  const cached = groupsBySnapshot.get(snapshot);
  if (cached) return cached;

  const building: Array<{
    first: TransitSnapshot["stations"][number];
    jaKey: string;
    lats: number[];
    lons: number[];
  }> = [];
  const byName = new Map<string, typeof building>();
  for (const station of snapshot.stations) {
    const jaKey = normalizeStationName(station.nameJa);
    const sameName = byName.get(jaKey) ?? [];
    const group = sameName.find(
      (candidate) =>
        distanceMeters(candidate.first, station) <= SAME_STATION_METERS,
    );
    if (group) {
      group.lats.push(station.lat);
      group.lons.push(station.lon);
    } else {
      const created = {
        first: station,
        jaKey,
        lats: [station.lat],
        lons: [station.lon],
      };
      building.push(created);
      sameName.push(created);
      byName.set(jaKey, sameName);
    }
  }

  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const groups = building.map(({ first, jaKey, lats, lons }) => ({
    id: first.id,
    name: first.name,
    nameJa: first.nameJa,
    lat: mean(lats),
    lon: mean(lons),
    jaKey,
    jaFull: jaFullKey(first.nameJa),
    latinKey: latinKey(first.name),
  }));
  groupsBySnapshot.set(snapshot, groups);
  return groups;
}

function toStation(group: StationGroup): Station {
  return {
    id: group.id,
    name: group.name,
    nameJa: group.nameJa,
    latitude: group.lat,
    longitude: group.lon,
  };
}

/** 0 = exact, 1 = prefix, 2 = contains, null = no match. */
function matchRank(candidate: string, query: string): number | null {
  if (!query || !candidate) return null;
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;
  if (candidate.includes(query)) return 2;
  return null;
}

/**
 * Stations whose name matches `query`: Japanese (with or without 駅 or a
 * bracketed alternate), English (case/accents/hyphens ignored), or a kana
 * reading (converted to romaji and matched against the English name).
 * Exact matches first, then prefix, then contains.
 */
export function searchStationsIn(
  snapshot: TransitSnapshot,
  query: string,
  limit = SEARCH_LIMIT,
): Station[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const jaKey = normalizeStationName(trimmed);
  const jaFull = jaFullKey(trimmed);
  const latinKeys = [latinKey(trimmed)];
  if (KANA_ONLY.test(trimmed)) latinKeys.push(latinKey(kanaToRomaji(trimmed)));

  const ranked: Array<{ group: StationGroup; rank: number; order: number }> =
    [];
  stationGroups(snapshot).forEach((group, order) => {
    const ranks = [
      matchRank(group.jaKey, jaKey),
      matchRank(group.jaFull, jaFull),
      ...latinKeys.map((key) => matchRank(group.latinKey, key)),
    ].filter((rank): rank is number => rank !== null);
    if (ranks.length > 0) ranked.push({ group, rank: Math.min(...ranks), order });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ group }) => toStation(group));
}

/**
 * Stations within 2.5 km of the point, nearest first, with walking estimates
 * at `pace`. Empty where the snapshot has no stations (outside coverage).
 */
export function nearbyStationsIn(
  snapshot: TransitSnapshot,
  latitude: number,
  longitude: number,
  pace: Pace,
  limit: number,
): Station[] {
  const point = { lat: latitude, lon: longitude };
  return stationGroups(snapshot)
    .map((group) => ({ group, meters: distanceMeters(group, point) }))
    .filter(({ meters }) => meters <= NEARBY_RADIUS_METERS)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit)
    .map(({ group, meters }) => {
      const walkingMeters = Math.round(meters * WALK_ROUTE_FACTOR);
      return {
        ...toStation(group),
        walkingMeters,
        walkingMinutes: walkingMinutes(walkingMeters, pace),
        walkingSource: 'estimated' as const,
      };
    });
}

/** searchStationsIn on the loaded snapshot (throws TimetableUnavailableError). */
export async function searchStations(query: string): Promise<Station[]> {
  const { snapshot } = await timetableEngine();
  return searchStationsIn(snapshot, query);
}

/** nearbyStationsIn on the loaded snapshot (throws TimetableUnavailableError). */
export async function nearbyStations(
  latitude: number,
  longitude: number,
  pace: Pace,
  limit: number,
): Promise<Station[]> {
  const { snapshot } = await timetableEngine();
  return nearbyStationsIn(snapshot, latitude, longitude, pace, limit);
}
