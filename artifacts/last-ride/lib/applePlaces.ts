/**
 * Stations, addresses, walking, nearby places and driving time from Apple
 * Maps on the iPhone (modules/apple-maps). Free, and the main source on iOS;
 * the API server's versions (ODPT stations and distance estimates) cover
 * Android and the case where Apple can't answer. Every function returns null
 * when Apple Maps isn't available here, so callers fall through to the server.
 *
 * Apple's terms: show results with an Apple map where map data is shown, and
 * don't keep them long-term. Saved destinations keep only the station the user
 * chose (a name and a point), as they would type it in themselves.
 */
import { stationNames } from '@/lib/appleTransit';
import { AppleMaps, type Place } from '@/modules/apple-maps/src';
import type { Coordinates, NearbyStation, StationOption, WalkingRoute, WalkingSpeed } from '@/lib/stations';

const SPEED_MULTIPLIER: Record<WalkingSpeed, number> = { relaxed: 0.8, normal: 1, fast: 1.2 };
/** How far to look for stations around the user. */
const NEARBY_RADIUS_METERS = 2500;

export const appleMapsAvailable = AppleMaps !== null;

/**
 * MapKit names places in the app's iOS language, not LastRide's in-app one.
 * Keeps the two in step (from the next launch); true when a restart is needed.
 */
export function syncAppleLanguage(language: 'ja' | 'en'): boolean {
  try {
    return AppleMaps?.setPreferredLanguage(language) ?? false;
  } catch {
    return false;
  }
}

/** "渋谷駅 (東京メトロ)" → "渋谷": one name per station complex. */
export function stationBaseName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(駅|Station|Sta\.)$/i, '')
    .trim();
}

/**
 * Apple's public-transport places include bus stops, taxi ranks ("渋谷駅
 * タクシー乗り場") and exits. Keep names that end in 駅 / Station once any
 * bracketed operator is removed.
 */
export function isRailwayStation(place: Pick<Place, 'name'>): boolean {
  const name = place.name.replace(/[（(][^）)]*[）)]/g, '').trim();
  return /(駅|station)$/i.test(name) && !/バス|bus/i.test(name);
}

function toStation(place: Place): StationOption {
  const base = stationBaseName(place.name);
  const region = [place.administrativeArea, place.locality].filter(Boolean).join('');
  return {
    name: base,
    nameJa: base,
    latitude: place.latitude,
    longitude: place.longitude,
    ...(region ? { regionJa: region } : {}),
  };
}

function distance(first: Coordinates, second: Coordinates) {
  const toRad = Math.PI / 180;
  const a =
    Math.sin(((second.latitude - first.latitude) * toRad) / 2) ** 2 +
    Math.cos(first.latitude * toRad) * Math.cos(second.latitude * toRad) * Math.sin(((second.longitude - first.longitude) * toRad) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Railway stations, one per name, nearest first. */
export function distinctStations(origin: Coordinates, places: Place[], limit: number): Array<{ station: StationOption; straightMeters: number }> {
  const seen = new Set<string>();
  return places
    .filter(isRailwayStation)
    .map((place) => ({ station: toStation(place), straightMeters: distance(origin, place) }))
    .sort((first, second) => first.straightMeters - second.straightMeters)
    .filter(({ station }) => {
      if (!station.nameJa || seen.has(station.nameJa)) return false;
      seen.add(station.nameJa);
      return true;
    })
    .slice(0, limit);
}

export async function appleWalkingRoute(
  from: Coordinates,
  to: Coordinates & { name?: string; nameJa?: string },
  walkingSpeed: WalkingSpeed,
): Promise<WalkingRoute | null> {
  if (!AppleMaps) return null;
  // A station (it has a name): walk to the station place itself, as Apple Maps would.
  const route = await AppleMaps.walkingRoute(
    { latitude: from.latitude, longitude: from.longitude },
    { latitude: to.latitude, longitude: to.longitude, stationNames: stationNames(to) },
  );
  return {
    distanceMeters: route.distanceMeters,
    // Apple's times assume an ordinary pace.
    walkingMinutes: Math.max(1, Math.round(route.seconds / 60 / SPEED_MULTIPLIER[walkingSpeed])),
  };
}

export async function appleNearbyStations(coordinates: Coordinates, walkingSpeed: WalkingSpeed, limit: number): Promise<NearbyStation[] | null> {
  if (!AppleMaps) return null;
  const places = await AppleMaps.nearbyStations(coordinates, NEARBY_RADIUS_METERS);
  const stations = distinctStations(coordinates, places, limit);
  return Promise.all(
    stations.map(async (candidate) => ({
      ...candidate,
      walk: (await appleWalkingRoute(coordinates, candidate.station, walkingSpeed).catch(() => null)) ?? undefined,
    })),
  );
}

export async function appleSearchStations(query: string): Promise<StationOption[] | null> {
  if (!AppleMaps) return null;
  const places = await AppleMaps.searchStations(/駅$/.test(query) ? query : `${query}駅`);
  const seen = new Set<string>();
  return places
    .filter(isRailwayStation)
    .map(toStation)
    .filter((station) => {
      const key = `${station.nameJa}|${station.regionJa ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function appleSearchAddresses(query: string): Promise<Array<Coordinates & { label: string }> | null> {
  if (!AppleMaps) return null;
  const results = await AppleMaps.searchAddresses(query);
  return results.map((place) => ({ label: place.label || place.name, latitude: place.latitude, longitude: place.longitude }));
}

/** Search words per kind of place to wait until morning. */
export const STAY_QUERIES = {
  'net-cafe': 'ネットカフェ',
  karaoke: 'カラオケ',
  capsule: 'カプセルホテル',
  hotel: 'ホテル',
} as const;

export type AppleStay = Place & { kind: keyof typeof STAY_QUERIES };

export async function appleNearbyStays(coordinates: Coordinates, radiusMeters = 1500): Promise<AppleStay[] | null> {
  if (!AppleMaps) return null;
  const maps = AppleMaps;
  const kinds = Object.keys(STAY_QUERIES) as Array<keyof typeof STAY_QUERIES>;
  const results = await Promise.all(
    kinds.map(async (kind) => (await maps.searchPlaces(STAY_QUERIES[kind], coordinates, radiusMeters).catch(() => [])).map((place) => ({ ...place, kind }))),
  );
  const seen = new Set<string>();
  return results
    .flat()
    .filter((place) => distance(coordinates, place) <= radiusMeters * 1.2)
    .filter((place) => {
      if (seen.has(place.name)) return false;
      seen.add(place.name);
      return true;
    });
}

export async function appleDrivingEta(from: Coordinates, to: Coordinates): Promise<{ minutes: number; distanceMeters: number } | null> {
  if (!AppleMaps) return null;
  const eta = await AppleMaps.drivingEta(from, to);
  return { minutes: Math.max(1, Math.round(eta.seconds / 60)), distanceMeters: eta.distanceMeters };
}

export type TaxiStand = Coordinates & { name: string; meters: number };

/** Taxi stands (タクシー乗り場) near `coordinates`, nearest first. */
export async function appleNearbyTaxiStands(coordinates: Coordinates, radiusMeters = 800, limit = 3): Promise<TaxiStand[] | null> {
  if (!AppleMaps) return null;
  const places = await AppleMaps.searchPlaces('タクシー乗り場', coordinates, radiusMeters);
  const seen = new Set<string>();
  return places
    .filter((place) => /タクシー|taxi/i.test(place.name))
    .map((place) => ({ name: place.name, latitude: place.latitude, longitude: place.longitude, meters: distance(coordinates, place) }))
    .filter((stand) => stand.meters <= radiusMeters * 1.2)
    .sort((first, second) => first.meters - second.meters)
    .filter((stand) => {
      if (seen.has(stand.name)) return false;
      seen.add(stand.name);
      return true;
    })
    .slice(0, limit);
}
