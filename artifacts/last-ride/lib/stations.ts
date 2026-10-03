/**
 * Shared station/geo helpers usable from both React context and the
 * background-location task (which runs headless, without React).
 *
 * Stations and walking times come from the LastRide API server (NAVITIME) when
 * it is available, falling back to free OpenStreetMap services otherwise.
 */
import { getNearbyStations, getWalkRoute } from "@workspace/api-client-react";
import { apiBaseUrl, communityFallbacksEnabled } from "@/lib/api";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

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
};

export type WalkingSpeed = "relaxed" | "normal" | "fast";

export type WalkingRoute = { distanceMeters: number; walkingMinutes: number };

export type NearbyStation = {
  station: StationOption;
  straightMeters: number;
  walk?: WalkingRoute;
};

/** Thrown with a machine-readable code so the UI can show a localized message. */
export class LocationError extends Error {
  constructor(
    public code:
      "permission" | "unsupported" | "no-station" | "no-route" | "unavailable",
  ) {
    super(code);
  }
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

/**
 * The closest distinct stations to `coordinates`, nearest first. From the API
 * server they come with walking routes already worked out; the OpenStreetMap
 * fallback is ordered by straight-line distance and has no walk.
 */
export async function findNearbyStations(
  coordinates: Coordinates,
  walkingSpeed: WalkingSpeed,
  limit = 3,
): Promise<NearbyStation[]> {
  if (apiBaseUrl) {
    try {
      const stations = await getNearbyStations({
        lat: coordinates.latitude,
        lon: coordinates.longitude,
        pace: walkingSpeed,
        limit: limit + 2,
      });
      const distinct = collapseByName(
        stations.map(
          ({ id: _id, walkingMeters, walkingMinutes, ...station }) => ({
            station,
            straightMeters: distanceBetween(coordinates, station),
            walk:
              walkingMeters !== undefined && walkingMinutes !== undefined
                ? {
                    distanceMeters: walkingMeters,
                    walkingMinutes: Math.max(1, walkingMinutes),
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

/** Station complexes can appear several times (one per operator or entrance); keep the first of each name. */
function collapseByName<T extends { station: StationOption }>(
  candidates: T[],
  limit: number,
): T[] {
  const seen = new Set<string>();
  const distinct: T[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.station.nameJa)) continue;
    seen.add(candidate.station.nameJa);
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
  return collapseByName(candidates, limit);
}

/**
 * Walking distance and time: from the API server (NAVITIME) when available,
 * then the free OpenStreetMap router, then a straight-line estimate.
 */
export async function walkingRoute(
  from: Coordinates,
  to: Coordinates,
  walkingSpeed: WalkingSpeed,
): Promise<WalkingRoute> {
  const multiplier = SPEED_MULTIPLIER[walkingSpeed];
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
  };
}
