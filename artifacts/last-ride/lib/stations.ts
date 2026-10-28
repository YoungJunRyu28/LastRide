/**
 * Shared station/geo helpers usable from both React context and the
 * background-location task (which runs headless, without React).
 *
 * Stations and walking times come from Apple Maps on iOS (lib/applePlaces.ts),
 * then the LastRide API server (ODPT stations, distance-based walking), then —
 * in development only — free OpenStreetMap services.
 */
import { getNearbyStations, getWalkRoute } from "@workspace/api-client-react";
import { apiBaseUrl, communityFallbacksEnabled } from "@/lib/api";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { appleNearbyStations, appleWalkingRoute } from "@/lib/applePlaces";

export type Coordinates = { latitude: number; longitude: number };

export type StationOption = {
  name: string;
  nameJa: string;
  latitude: number;
  longitude: number;
  /** English locality, e.g. "Yokohama, Kanagawa" — distinguishes same-named stations. */
  region?: string;
  /** Japanese locality, e.g. "神奈川県横浜市西区". */
  regionJa?: string;
  /** "odpt": position from our server's ODPT data, which may be kept long-term (see lib/storedPlaces). */
  source?: "odpt";
};

export type WalkingSpeed = "relaxed" | "normal" | "fast";

/** "routed" comes from pedestrian street routing; "estimated" is a
 * straight-line multiplier with no sidewalk/bridge/entrance verification. */
export type WalkingRoute = {
  distanceMeters: number;
  walkingMinutes: number;
  source: 'routed' | 'estimated';
  /** The route's shape (Apple's, thinned to ~40 points), drawn on the map card; absent for estimates. */
  path?: Coordinates[];
};

export type NearbyStation = {
  station: StationOption;
  straightMeters: number;
  walk?: WalkingRoute;
};

/** Thrown with a machine-readable code so the UI can show a localized message. */
export class LocationError extends Error {
  constructor(
    public code:
      | "permission"
      | "unsupported"
      | "no-station"
      | "no-route"
      | "near-home"
      | "unavailable",
  ) {
    super(code);
  }
}

/** Station aliases from different providers can have the same Japanese name.
 * Their positions distinguish distant namesakes, while small centroid
 * differences still identify the same physical station complex. */
const SAME_STATION_MAX_METERS = 1500;

export function samePhysicalStation(a: StationOption, b: StationOption): boolean {
  if (!a.nameJa || a.nameJa !== b.nameJa) return false;
  const positioned = (station: StationOption) =>
    Number.isFinite(station.latitude) && Number.isFinite(station.longitude) &&
    Math.abs(station.latitude) <= 90 && Math.abs(station.longitude) <= 180 &&
    (station.latitude !== 0 || station.longitude !== 0);
  if (positioned(a) && positioned(b)) {
    return distanceBetween(a, b) <= SAME_STATION_MAX_METERS;
  }
  // Offline/legacy saved stations omit coordinates under MapKit licensing.
  // Compare locality where both names have one; otherwise preserve the
  // old name-only fallback for saved records missing all other identity.
  const localA = a.regionJa?.trim() || a.region?.trim();
  const localB = b.regionJa?.trim() || b.region?.trim();
  return !localA || !localB || localA === localB ||
    localA.startsWith(localB) || localB.startsWith(localA);
}

const SPEED_MULTIPLIER: Record<WalkingSpeed, number> = {
  relaxed: 0.8,
  normal: 1,
  fast: 1.2,
};
const BASE_WALKING_METERS_PER_MINUTE = 80;

export function distanceBetween(first: Coordinates, second: Coordinates) {
  const earthRadius = 6371000;
  const latitudeDelta = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitudeDelta = ((second.longitude - first.longitude) * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos((first.latitude * Math.PI) / 180) *
      Math.cos((second.latitude * Math.PI) / 180) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/**
 * Runs an Overpass (OpenStreetMap) query. The public servers are free but often
 * overloaded, so each endpoint gets one attempt before falling back to the next.
 */
export async function overpassQuery(query: string): Promise<OverpassElement[]> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (response.ok)
        return (
          ((await response.json()) as { elements?: OverpassElement[] })
            .elements ?? []
        );
    } catch {
      // Network error or timeout: try the next endpoint.
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new LocationError("unavailable");
}

function stationsQuery(
  { latitude, longitude }: Coordinates,
  radiusMeters: number,
) {
  return `[out:json][timeout:15];(node(around:${radiusMeters},${latitude},${longitude})["railway"="station"];way(around:${radiusMeters},${latitude},${longitude})["railway"="station"];);out center tags;`;
}

/** A last-plan station stands in for a failed search only within this straight distance (Apple searches 2.5 km). */
const RECENT_STATION_METERS = 2500;

/**
 * The closest distinct stations to `coordinates`, nearest first, with walking
 * routes: from Apple Maps on iOS, otherwise the API server (ODPT stations,
 * which miss JR and private railways). The OpenStreetMap fallback
 * (development only) is ordered by straight-line distance and has no walk.
 *
 * When Apple's search fails (its request limit, a dropped connection), the
 * server's list is no stand-in on iPhone: it has only subway-type lines, so
 * near 元町・中華街 it offered 伊勢佐木長者町, a 32-minute walk. Then
 * `recent` (the last plan's stations, when nearby) are used, or it fails
 * ('unavailable') so the plan in force stays until the next try.
 */
export async function findNearbyStations(
  coordinates: Coordinates,
  walkingSpeed: WalkingSpeed,
  limit = 3,
  /** Walks already known from (about) this spot, by Japanese name: not asked again. */
  knownWalks?: Map<string, WalkingRoute>,
  /** The last plan's stations, when it was made nearby: used if Apple's search fails. */
  recent: StationOption[] = [],
): Promise<NearbyStation[]> {
  let appleFailed = false;
  const apple = await appleNearbyStations(coordinates, walkingSpeed, limit, knownWalks).catch(() => {
    appleFailed = true;
    return null;
  });
  if (apple && apple.length > 0) return apple;
  if (appleFailed) {
    // Only stations still near here: someone moving on while Apple keeps failing
    // mustn't be given stations from where they were.
    const near = recent
      .map((station) => ({ station, straightMeters: distanceBetween(coordinates, station), walk: knownWalks?.get(station.nameJa) }))
      .filter(({ straightMeters }) => straightMeters <= RECENT_STATION_METERS)
      .sort((first, second) => first.straightMeters - second.straightMeters)
      .slice(0, limit);
    if (near.length === 0) throw new LocationError("unavailable");
    return near;
  }
  if (apiBaseUrl) {
    try {
      const stations = await getNearbyStations({
        lat: coordinates.latitude,
        lon: coordinates.longitude,
        pace: walkingSpeed,
        limit: limit + 2,
      });
      const distinct = collapseByStation(
        stations.map(
          ({ id: _id, walkingMeters, walkingMinutes, walkingSource: _walkSource, ...station }) => ({
            station,
            straightMeters: distanceBetween(coordinates, station),
            walk:
              walkingMeters !== undefined && walkingMinutes !== undefined
                ? {
                    distanceMeters: walkingMeters,
                    walkingMinutes: Math.max(1, walkingMinutes),
                    source: 'estimated' as const, // ODPT server only estimates distance.
                  }
                : undefined,
          }),
        ),
        limit,
      );
      if (distinct.length > 0) return distinct;
    } catch {
      // Server or provider unavailable: fall back to OpenStreetMap below.
    }
  }
  if (!communityFallbacksEnabled) throw new LocationError("unavailable");
  return findNearbyStationsOsm(coordinates, limit);
}

/** Merge near-identical platforms, but do NOT discard distant stations
 * just because they share a Japanese name. Candidates arrive nearest first. */
export function collapseByStation<T extends { station: StationOption }>(
  candidates: T[],
  limit: number,
): T[] {
  const distinct: T[] = [];
  for (const candidate of candidates) {
    if (distinct.some((seen) => samePhysicalStation(seen.station, candidate.station))) continue;
    distinct.push(candidate);
    if (distinct.length >= limit) break;
  }
  return distinct;
}

async function findNearbyStationsOsm(
  coordinates: Coordinates,
  limit: number,
): Promise<NearbyStation[]> {
  // A small radius keeps the query light in dense cities; widen only if it finds too few.
  let distinct = distinctStations(
    coordinates,
    await overpassQuery(stationsQuery(coordinates, 1500)),
    limit,
  );
  if (distinct.length < limit)
    distinct = distinctStations(
      coordinates,
      await overpassQuery(stationsQuery(coordinates, 5000)),
      limit,
    );
  if (distinct.length === 0) throw new LocationError("no-station");
  return distinct;
}

function distinctStations(
  coordinates: Coordinates,
  elements: OverpassElement[],
  limit: number,
) {
  const candidates = elements
    .map((element) => {
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      const tags = element.tags ?? {};
      const nameJa = tags["name:ja"] ?? tags.name;
      if (lat === undefined || lon === undefined || !nameJa) return null;
      // In Japan the plain `name` tag is Japanese, so English needs `name:en` (or romaji).
      const name =
        tags["name:en"] ?? tags["name:ja-Latn"] ?? tags["name:ja_rm"] ?? nameJa;
      return {
        station: { name, nameJa, latitude: lat, longitude: lon },
        straightMeters: distanceBetween(coordinates, {
          latitude: lat,
          longitude: lon,
        }),
      };
    })
    .filter(
      (
        candidate,
      ): candidate is { station: StationOption; straightMeters: number } =>
        candidate !== null,
    )
    .sort((first, second) => first.straightMeters - second.straightMeters);
  return collapseByStation(candidates, limit);
}

/**
 * Walking distance and time: Apple Maps on iOS, then the API server's
 * estimate, then (development only) the OpenStreetMap router, then a
 * straight-line estimate.
 */
export async function walkingRoute(
  from: Coordinates,
  to: Coordinates & { name?: string; nameJa?: string },
  walkingSpeed: WalkingSpeed,
): Promise<WalkingRoute> {
  const multiplier = SPEED_MULTIPLIER[walkingSpeed];
  const apple = await appleWalkingRoute(from, to, walkingSpeed).catch(() => null);
  if (apple) return apple;
  if (apiBaseUrl) {
    try {
      const route = await getWalkRoute({
        fromLat: from.latitude,
        fromLon: from.longitude,
        toLat: to.latitude,
        toLon: to.longitude,
        pace: walkingSpeed,
      });
      return {
        distanceMeters: route.distanceMeters,
        walkingMinutes: Math.max(1, route.minutes),
        source: 'estimated', // The backend endpoint offers no pedestrian network routing.
      };
    } catch {
      // Fall through to the free services below.
    }
  }
  if (!communityFallbacksEnabled) {
    const distanceMeters = distanceBetween(from, to) * 1.3;
    return {
      distanceMeters,
      walkingMinutes: Math.max(
        1,
        Math.ceil(
          distanceMeters / (BASE_WALKING_METERS_PER_MINUTE * multiplier),
        ),
      ),
      source: 'estimated',
    };
  }
  try {
    const response = await fetchWithTimeout(
      `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false&alternatives=false&steps=false`,
      8_000,
    );
    if (response.ok) {
      const route = (await response.json()) as {
        routes?: Array<{ distance: number; duration: number }>;
      };
      const first = route.routes?.[0];
      if (first)
        return {
          distanceMeters: first.distance,
          walkingMinutes: Math.max(
            1,
            Math.ceil(first.duration / 60 / multiplier),
          ),
          source: 'routed', // Only development enables this foot-routing provider.
        };
    }
  } catch {
    // The routing service is optional; fall through to the estimate.
  }
  // Streets are rarely straight: pad the straight-line distance by ~30%.
  const distanceMeters = distanceBetween(from, to) * 1.3;
  return {
    distanceMeters,
    walkingMinutes: Math.max(
      1,
      Math.ceil(distanceMeters / (BASE_WALKING_METERS_PER_MINUTE * multiplier)),
    ),
    source: 'estimated',
  };
}
