/**
 * Saved places without long-term Apple Maps data.
 *
 * Apple only allows Map Data (positions found through MapKit) to be kept
 * temporarily (Program License Agreement, Attachment 6, 2.5). So saved
 * destinations keep names only: the station name and area, and the address
 * text. Positions are looked up again when needed and kept in a per-night cache
 * that is dropped when the service day changes (04:00). Stations matched to our
 * server's ODPT data (`source: "odpt"`) are ours and keep their position.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { stationBaseName } from '@/lib/applePlaces';
import { searchAddresses, searchStations } from '@/lib/placeSearch';
import type { HomeAddress } from '@/lib/settings';
import type { Coordinates, StationOption } from '@/lib/stations';
import { serviceDate } from '@/lib/time';

const CACHE_KEY = 'lastride-place-cache';
/** Don't hold up the app (or the background task) for a slow lookup. */
const LOOKUP_TIMEOUT_MS = 4000;

type PlaceCache = { serviceDate: string; places: Record<string, Coordinates> };

export function hasPosition(place: Coordinates | null | undefined): boolean {
  return !!place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && (place.latitude !== 0 || place.longitude !== 0);
}

const stationKey = (station: Pick<StationOption, 'nameJa' | 'regionJa'>) => `station:${station.nameJa}|${station.regionJa ?? ''}`;
const addressKey = (address: Pick<HomeAddress, 'label'>) => `address:${address.label}`;

/** What is written to long-term storage: ODPT stations as they are, other stations by name and area only. */
export function stationForDisk(station: StationOption): StationOption {
  if (station.source === 'odpt') return station;
  return { name: station.name, nameJa: station.nameJa, region: station.region, regionJa: station.regionJa, latitude: 0, longitude: 0 };
}

/** Addresses are stored as the text only. */
export function addressForDisk(address: HomeAddress | null): HomeAddress | null {
  return address ? { label: address.label, latitude: 0, longitude: 0 } : null;
}

async function readCache(nowMs: number): Promise<PlaceCache> {
  const today = serviceDate(nowMs);
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PlaceCache) : null;
    if (parsed?.serviceDate === today && parsed.places && typeof parsed.places === 'object') return parsed;
    if (raw) await AsyncStorage.removeItem(CACHE_KEY); // last night's positions: drop them
  } catch {
    // Unreadable cache: start again.
  }
  return { serviceDate: today, places: {} };
}

/** Keeps tonight's positions of these places (not ODPT stations, which are stored anyway). */
export async function rememberTonight(
  stations: StationOption[],
  addresses: HomeAddress[],
  nowMs = Date.now(),
): Promise<void> {
  const entries: Array<[string, Coordinates]> = [
    ...stations.filter((station) => station.source !== 'odpt' && hasPosition(station)).map((station) => [stationKey(station), { latitude: station.latitude, longitude: station.longitude }] as [string, Coordinates]),
    ...addresses.filter(hasPosition).map((address) => [addressKey(address), { latitude: address.latitude, longitude: address.longitude }] as [string, Coordinates]),
  ];
  if (entries.length === 0) return;
  const cache = await readCache(nowMs);
  for (const [key, position] of entries) cache.places[key] = position;
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache)).catch(() => undefined);
}

export async function clearPlaceCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => undefined);
}

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), LOOKUP_TIMEOUT_MS))]);
}

const prefecture = (region: string) => /^.+?[都道府県]/.exec(region)?.[0] ?? region;

/** Same area: one locality contains the other, or they share a prefecture. */
function sameArea(first: string | undefined, second: string | undefined): boolean {
  if (!first || !second) return true;
  return first.startsWith(second) || second.startsWith(first) || prefecture(first) === prefecture(second);
}

/**
 * `station` with a position: as stored (ODPT), from tonight's cache, or found
 * again by name and area. Without a match it comes back unchanged (no position).
 */
export async function resolveStation(
  station: StationOption,
  search: (query: string) => Promise<StationOption[]> = searchStations,
  nowMs = Date.now(),
): Promise<StationOption> {
  if (hasPosition(station)) return station;
  const cached = (await readCache(nowMs)).places[stationKey(station)];
  if (cached) return { ...station, ...cached };
  const base = stationBaseName(station.nameJa);
  const results = await withTimeout(search(base), [] as StationOption[]);
  const sameName = results.filter((candidate) => stationBaseName(candidate.nameJa) === base && hasPosition(candidate));
  // Station names repeat (府中 in Tokyo and Hiroshima), so the area has to agree when both are known.
  const match = station.regionJa
    ? sameName.find((candidate) => sameArea(candidate.regionJa, station.regionJa))
    : sameName[0];
  if (!match) return station;
  const resolved = { ...station, latitude: match.latitude, longitude: match.longitude };
  await rememberTonight([resolved], [], nowMs);
  return resolved;
}

/** `address` with a position: from tonight's cache or found again from its text. */
export async function resolveAddress(
  address: HomeAddress,
  search: (query: string) => Promise<HomeAddress[]> = searchAddresses,
  nowMs = Date.now(),
): Promise<HomeAddress> {
  if (hasPosition(address)) return address;
  const cached = (await readCache(nowMs)).places[addressKey(address)];
  if (cached) return { ...address, ...cached };
  const results = await withTimeout(search(address.label), [] as HomeAddress[]);
  const match = results.find((result) => result.label === address.label && hasPosition(result)) ?? results.find(hasPosition);
  if (!match) return address;
  const resolved = { label: address.label, latitude: match.latitude, longitude: match.longitude };
  await rememberTonight([], [resolved], nowMs);
  return resolved;
}
