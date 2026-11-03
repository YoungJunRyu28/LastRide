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
import { bilingualStationName } from '@/lib/stationNames';
import { isValidMapCoordinate } from '@/lib/mapSnapshotGuard';
import { isKnownStation, knownStationsNear } from '@/lib/stationIndex';

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
 * Gondolas, ropeways and cable cars: Apple files their stops as public
 * transport named 「…駅」 too, and a route "from" one is just a walk to a real
 * station. Matched on the whole name, operator brackets included.
 */
const AERIAL_LIFT = /ロープ[ウう][ェエ][イー]?|ゴンドラ|ケーブル|エアキャビン|リフト|air\s*cabin|ropeway|gondola|cable\s*car/i;
/** Lift stops whose names look just like a station's (no lift word in Apple's name). */
const LIFT_STOPS = new Set(['運河パーク', 'Unga Park']);

/**
 * Apple's public-transport places include bus stops, taxi ranks ("渋谷駅
 * タクシー乗り場"), exits, and gondola stops (運河パーク駅, YOKOHAMA AIR
 * CABIN). Keep names that end in 駅 / Station once any bracketed operator is
 * removed, and that aren't a bus or a lift.
 */
export function isRailwayStation(place: Pick<Place, 'name'>): boolean {
  const name = place.name.replace(/[（(][^）)]*[）)]/g, '').trim();
  return (
    /(駅|station)$/i.test(name) &&
    !/バス|bus/i.test(name) &&
    !AERIAL_LIFT.test(place.name) &&
    !LIFT_STOPS.has(stationBaseName(place.name))
  );
}

function toStation(place: Place): StationOption {
  // Apple names it in the iPhone's language: fill in the other one (lib/stationNames).
  const { name, nameJa } = bilingualStationName(stationBaseName(place.name));
  const region = [place.administrativeArea, place.locality].filter(Boolean).join('');
  return {
    name,
    nameJa,
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

/** 「JR関内駅」 and 「関内駅」 this close together are one station. */
const SAME_COMPLEX_METERS = 300;
const withoutJr = (nameJa: string) => nameJa.replace(/^JR\s*/, '');

/** Merge entrances to one physical station, not all stations sharing a
 * Japanese name across different neighborhoods. */
export function distinctStations(origin: Coordinates, places: Place[], limit: number): Array<{ station: StationOption; straightMeters: number }> {
  const accepted: Array<{ station: StationOption; straightMeters: number }> = [];
  const candidates = places
    .filter((place) => isValidMapCoordinate(place))
    .filter(isRailwayStation)
    .map((place) => ({ station: toStation(place), straightMeters: distance(origin, place) }))
    .sort((first, second) => first.straightMeters - second.straightMeters);

  for (const candidate of candidates) {
    if (!candidate.station.nameJa) continue;
    if (accepted.some((existing) =>
      existing.station.nameJa === candidate.station.nameJa &&
      distance(existing.station, candidate.station) <= 1500)) continue;
    // 「JR関内駅」 beside 「関内駅」: one station, not two of the closest three,
    // under the plain name (the one timetables know). Only side by side:
    // JR難波 and 難波 are different stations.
    const twin = accepted.findIndex((existing) =>
      withoutJr(existing.station.nameJa) === withoutJr(candidate.station.nameJa) &&
      distance(existing.station, candidate.station) <= SAME_COMPLEX_METERS);
    if (twin >= 0) {
      if (accepted[twin].station.nameJa !== withoutJr(accepted[twin].station.nameJa) && candidate.station.nameJa === withoutJr(candidate.station.nameJa))
        accepted[twin] = candidate;
      continue;
    }
    accepted.push(candidate);
    if (accepted.length >= limit) break;
  }
  return accepted;
}

export async function appleWalkingRoute(
  from: Coordinates,
  to: Coordinates & { name?: string; nameJa?: string },
  walkingSpeed: WalkingSpeed,
): Promise<WalkingRoute | null> {
  if (!AppleMaps) return null;
  // A station (it has a name): walk to the station place itself, as Apple Maps would.
  if (!isValidMapCoordinate(from) || !isValidMapCoordinate(to)) return null;
  const route = await AppleMaps.walkingRoute(
    { latitude: from.latitude, longitude: from.longitude },
    { latitude: to.latitude, longitude: to.longitude, stationNames: stationNames(to) },
  );
  // Malformed native ETA must not be promoted to a street-routed result.
  if (!Number.isFinite(route.seconds) || route.seconds < 0 ||
      !Number.isFinite(route.distanceMeters) || route.distanceMeters < 0) return null;
  return {
    distanceMeters: route.distanceMeters,
    // Apple's times assume an ordinary pace.
    walkingMinutes: Math.max(1, Math.round(route.seconds / 60 / SPEED_MULTIPLIER[walkingSpeed])),
    source: 'routed', // MapKit pedestrian street route, not straight-line approximation.
    // The street route itself, for the map card's walking line (which never draws a straight line).
    path: Array.isArray(route.path) ? route.path.filter(isValidMapCoordinate) : undefined,
  };
}

const PUBLIC_TRANSPORT = 'MKPOICategoryPublicTransport';

/**
 * Railway stations from a 「駅」 search around `origin`: transit places only,
 * within the radius (Apple's region is a hint, not a limit).
 */
export function stationsFromSearch(origin: Coordinates, places: Place[], radiusMeters = NEARBY_RADIUS_METERS): Place[] {
  return places.filter((place) => place.category === PUBLIC_TRANSPORT && isValidMapCoordinate(place) && distance(origin, place) <= radiusMeters);
}

/** No station this close: look this far for the nearest ones (本牧, the harbour). */
const WIDER_RADIUS_METERS = 5000;
/**
 * Also searched over this small an area: in central Tokyo a 「駅」 search over
 * the 2.5 km area answers the big-name stations a few km off first (from 渋谷:
 * 飯田橋, 大手町, 永田町…, nothing within 2.5 km), while over 1 km it answers
 * 渋谷, 神泉, 表参道. Apple ranks by relevance and treats the area as a hint.
 */
const CLOSE_RADIUS_METERS = 1000;

type StationSearch = Pick<NonNullable<typeof AppleMaps>, 'searchPlaces' | 'nearbyStations'>;

/**
 * Stations around `coordinates`. A 「駅」 search, not Apple's nearby
 * public-transport places: those stop at 50, nearly all bus stops in a
 * residential area (near 山手 it listed only two stations, at times none, and
 * the subway-only server list then gave a 30-minute walk), and on a Japanese
 * iPhone a bus stop named after a station is called 「横浜本牧駅」 too. The
 * search answers railway stations; it runs over 1 km and 2.5 km together
 * (see CLOSE_RADIUS_METERS), and with none within 2.5 km looks up to 5 km out.
 * Only if the searches themselves fail, the nearby places as before (never
 * just because they found none: there they'd be bus stops).
 */
export async function stationPlaces(maps: StationSearch, coordinates: Coordinates): Promise<Place[]> {
  const search = async (radius: number, within = radius) => {
    const found = await maps.searchPlaces('駅', coordinates, radius);
    return stationsFromSearch(coordinates, found, within).filter(isRailwayStation);
  };
  // The close search's answers count out to 2.5 km too (it lists 恵比寿 at 1.7 km).
  const [close, nearby] = await Promise.allSettled([
    search(CLOSE_RADIUS_METERS, NEARBY_RADIUS_METERS),
    search(NEARBY_RADIUS_METERS),
  ]);
  if (close.status === 'rejected' && nearby.status === 'rejected') {
    return preferKnownStations(await maps.nearbyStations(coordinates, NEARBY_RADIUS_METERS));
  }
  const near = [
    ...(close.status === 'fulfilled' ? close.value : []),
    ...(nearby.status === 'fulfilled' ? nearby.value : []),
  ];
  // Real passenger stations first (lib/stationIndex): a bus stop or gondola stop
  // called 「…駅」 is used only when no known station is within 5 km.
  const knownNear = near.filter(isKnownPlace);
  if (knownNear.length > 0) return knownNear;
  if (near.length === 0) {
    const wider = preferKnownStations(await search(WIDER_RADIUS_METERS));
    // Apple answered with no stations at all: the bundled list's (lib/stationIndex).
    return wider.length > 0 ? wider : listedStationPlaces(coordinates);
  }
  const wider = await search(WIDER_RADIUS_METERS).catch(() => [] as Place[]);
  const knownWider = wider.filter(isKnownPlace);
  return knownWider.length > 0 ? knownWider : near;
}

const isKnownPlace = (place: Place) => isKnownStation(toStation(place));

/** The bundled passenger stations near here, as places (2.5 km, else 5 km). */
function listedStationPlaces(coordinates: Coordinates): Place[] {
  const near = knownStationsNear(coordinates, NEARBY_RADIUS_METERS);
  const points = near.length > 0 ? near : knownStationsNear(coordinates, WIDER_RADIUS_METERS);
  return points.map((point) => ({
    name: `${point.nameJa}駅`,
    latitude: point.latitude,
    longitude: point.longitude,
    phone: null,
    category: PUBLIC_TRANSPORT,
    locality: null,
    administrativeArea: null,
  }));
}

/** The known passenger stations among `places` (lib/stationIndex) when there are any; else all of them. */
export function preferKnownStations(places: Place[]): Place[] {
  const known = places.filter(isKnownPlace);
  return known.length > 0 ? known : places;
}

/** How far to look for the nearest station when none is within walking reach. */
const FARTHEST_RADIUS_METERS = 30_000;

export type FarStation = {
  station: StationOption;
  straightMeters: number;
  /** Apple's driving time there, when it answers. */
  drive: { minutes: number; distanceMeters: number } | null;
};

/**
 * No station within 5 km (the walking reach): the nearest one anyway, with the
 * drive there, so the app can say 「最寄りの○○駅まで約12km（車で約20分）」
 * and point to a taxi instead of a dead end. Never planned as a walk.
 */
export async function appleNearestStationByCar(coordinates: Coordinates): Promise<FarStation | null> {
  if (!AppleMaps) return null;
  const found = await AppleMaps.searchPlaces('駅', coordinates, FARTHEST_RADIUS_METERS);
  const [nearest] = distinctStations(coordinates, preferKnownStations(stationsFromSearch(coordinates, found, FARTHEST_RADIUS_METERS).filter(isRailwayStation)), 1);
  if (!nearest) return null;
  const drive = await appleDrivingEta(coordinates, nearest.station).catch(() => null);
  return { ...nearest, drive };
}

export async function appleNearbyStations(coordinates: Coordinates, walkingSpeed: WalkingSpeed, limit: number, knownWalks?: Map<string, WalkingRoute>): Promise<NearbyStation[] | null> {
  if (!AppleMaps) return null;
  const places = await stationPlaces(AppleMaps, coordinates);
  const stations = distinctStations(coordinates, places, limit);
  return Promise.all(
    stations.map(async (candidate) => ({
      ...candidate,
      walk: knownWalks?.get(candidate.station.nameJa) ?? (await appleWalkingRoute(coordinates, candidate.station, walkingSpeed).catch(() => null)) ?? undefined,
    })),
  );
}

export async function appleSearchStations(query: string): Promise<StationOption[] | null> {
  if (!AppleMaps) return null;
  const places = await AppleMaps.searchStations(/駅$/.test(query) ? query : `${query}駅`);
  const result: StationOption[] = [];
  for (const station of preferKnownStations(places
    .filter((place) => isValidMapCoordinate(place))
    .filter(isRailwayStation))
    .map(toStation)) {
    if (result.some((seen) =>
      seen.nameJa === station.nameJa && distance(seen, station) <= 1500)) continue;
    result.push(station);
  }
  return result;
}

export async function appleSearchAddresses(query: string): Promise<Array<Coordinates & { label: string }> | null> {
  if (!AppleMaps) return null;
  const results = await AppleMaps.searchAddresses(query);
  return results.filter((place) => isValidMapCoordinate(place)).map((place) => ({
    label: place.label || place.name, latitude: place.latitude, longitude: place.longitude,
  }));
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
    .filter((place) => isValidMapCoordinate(place))
    .filter((place) => distance(coordinates, place) <= radiusMeters * 1.2)
    .filter((place) => {
      if (seen.has(place.name)) return false;
      seen.add(place.name);
      return true;
    });
}

export async function appleDrivingEta(from: Coordinates, to: Coordinates): Promise<{ minutes: number; distanceMeters: number } | null> {
  if (!AppleMaps) return null;
  if (!isValidMapCoordinate(from) || !isValidMapCoordinate(to)) return null;
  const eta = await AppleMaps.drivingEta(from, to);
  return { minutes: Math.max(1, Math.round(eta.seconds / 60)), distanceMeters: eta.distanceMeters };
}

export type TaxiStand = Coordinates & { name: string; meters: number };

export type TaxiCompany = { name: string; phone: string; meters: number };

/** Japanese numbers as dialled at home: "+81 494 22 5611" → "0494-22-5611". */
export function domesticPhone(phone: string): string {
  const number = phone.trim().replace(/^\+81\s*/, '0').replace(/\s+/g, '-');
  // Free dial (0120 / 0800) comes without spaces: 0120-598-802.
  return /^0(120|800)\d{6}$/.test(number) ? `${number.slice(0, 4)}-${number.slice(4, 7)}-${number.slice(7)}` : number;
}

/**
 * Taxi companies from Apple's answer to 「タクシー」: with a phone number, within
 * `radiusMeters` (Apple's region is only a hint: from 房総 it answers Yokohama),
 * not a stand (no phone to call), not a 代行 (a driver for your own car).
 */
export function taxiCompaniesFrom(origin: Coordinates, places: Place[], radiusMeters: number, limit: number): TaxiCompany[] {
  const seen = new Set<string>();
  return places
    .filter((place) => !!place.phone && isValidMapCoordinate(place) && place.category !== PUBLIC_TRANSPORT)
    .filter((place) => /タクシー|交通|ハイヤー|自動車|taxi/i.test(place.name) && !/代行/.test(place.name))
    .map((place) => ({ name: place.name, phone: domesticPhone(place.phone!), meters: distance(origin, place) }))
    .filter((company) => company.meters <= radiusMeters)
    .sort((first, second) => first.meters - second.meters)
    .filter((company) => {
      if (seen.has(company.phone)) return false;
      seen.add(company.phone);
      return true;
    })
    .slice(0, limit);
}

/** Local taxi companies to call where there's no stand to walk to (the countryside). */
export async function appleTaxiCompanies(coordinates: Coordinates, radiusMeters = 20_000, limit = 3): Promise<TaxiCompany[] | null> {
  if (!AppleMaps) return null;
  const places = await AppleMaps.searchPlaces('タクシー', coordinates, radiusMeters);
  return taxiCompaniesFrom(coordinates, places, radiusMeters, limit);
}

/** Taxi stands (タクシー乗り場) near `coordinates`, nearest first. */
export async function appleNearbyTaxiStands(coordinates: Coordinates, radiusMeters = 800, limit = 3): Promise<TaxiStand[] | null> {
  if (!AppleMaps) return null;
  const places = await AppleMaps.searchPlaces('タクシー乗り場', coordinates, radiusMeters);
  const seen = new Set<string>();
  return places
    .filter((place) => isValidMapCoordinate(place))
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
