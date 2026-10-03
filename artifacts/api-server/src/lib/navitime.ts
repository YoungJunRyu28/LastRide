/**
 * NAVITIME (via RapidAPI) client: nearby stations with walking times, station
 * name search, taxi estimates, and places to wait out the night. The RapidAPI
 * Basic plans allow 500 calls a month per API, so every answer is cached.
 */
import { ProviderError, TtlCache } from "./cache";
import { CircuitBreaker, ProviderOutageError } from "./circuitBreaker";
import { logger } from "./logger";
import { isJapaneseQuery, searchStationsPhoton } from "./photon";
import { kanaToRomaji } from "./romaji";
import { recordCall, type Provider } from "./usage";
import { providerTimeoutMs } from "./runtimeConfig";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOSTS = {
  transport: "navitime-transport.p.rapidapi.com",
  car: "navitime-route-car.p.rapidapi.com",
  walk: "navitime-route-walk.p.rapidapi.com",
  spot: "navitime-spot.p.rapidapi.com",
  geocoding: "navitime-geocoding.p.rapidapi.com",
} as const;

/** Walking speed (km/h) for each pace setting; NAVITIME's default is 4.8. */
export const WALK_SPEED_KMH = { relaxed: 3.8, normal: 4.8, fast: 5.8 } as const;
export type Pace = keyof typeof WALK_SPEED_KMH;

export type Station = {
  id: string;
  name: string;
  nameJa: string;
  latitude: number;
  longitude: number;
  region?: string;
  walkingMeters?: number;
  walkingMinutes?: number;
};

export type TaxiEstimate = { distanceMeters: number; minutes: number; fareYen: number | null };

export type WalkRoute = { distanceMeters: number; minutes: number };

export type Address = { name: string; postalCode?: string; latitude: number; longitude: number };

// One breaker per RapidAPI host: each NAVITIME API is a separate service.
const breakers = new Map<string, CircuitBreaker>();

async function call<T>(host: string, path: string, params: Record<string, string>): Promise<T> {
  const key = process.env["RAPIDAPI_KEY"];
  if (!key) throw new ProviderError("RAPIDAPI_KEY is not configured");
  const url = new URL(`https://${host}${path}`);
  url.search = new URLSearchParams(params).toString();
  const provider = host.split(".")[0] as Provider;
  let breaker = breakers.get(provider);
  if (!breaker) breakers.set(provider, (breaker = new CircuitBreaker(provider)));
  // The breaker runs before quota reservation, so an open circuit costs nothing.
  return breaker.run(async () => {
    await recordCall(provider, path);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "x-rapidapi-key": key, "x-rapidapi-host": host },
        signal: AbortSignal.timeout(providerTimeoutMs()),
      });
    } catch (err) {
      throw new ProviderOutageError(`NAVITIME request failed: ${(err as Error).message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logger.warn({ host, path, status: response.status, detail: detail.slice(0, 200) }, "NAVITIME error");
      const ErrorType = response.status >= 500 ? ProviderOutageError : ProviderError;
      throw new ErrorType(`NAVITIME responded ${response.status}`);
    }
    return (await response.json()) as T;
  });
}

type TransportNode = {
  id: string;
  name: string;
  ruby?: string;
  address_name?: string;
  coord: { lat: number; lon: number };
  distance?: number;
  time?: number;
};

function toStation(node: TransportNode): Station {
  return {
    id: node.id,
    nameJa: node.name,
    name: node.ruby ? kanaToRomaji(node.ruby) : node.name,
    latitude: node.coord.lat,
    longitude: node.coord.lon,
    region: node.address_name,
    walkingMeters: node.distance,
    walkingMinutes: node.time,
  };
}

// ~110 m grid: a user moving a few metres re-uses the answer.
const nearbyCache = new TtlCache<Station[]>(DAY_MS, "navitime-nearby");

/** Closest stations by actual walking route (NAVITIME accounts for station exits), nearest first. */
export async function nearbyStations(latitude: number, longitude: number, pace: Pace, limit: number): Promise<Station[]> {
  const cacheKey = `${latitude.toFixed(3)}|${longitude.toFixed(3)}|${pace}|${limit}`;
  const cached = await nearbyCache.get(cacheKey);
  if (cached) return cached;
  const body = await call<{ items?: TransportNode[] }>(HOSTS.transport, "/transport_node/around", {
    coord: `${latitude},${longitude}`,
    type: "station",
    walk_speed: String(WALK_SPEED_KMH[pace]),
    term: "45", // walking minutes to search within
    limit: String(limit),
  });
  const stations = (body.items ?? []).map(toStation);
  await nearbyCache.set(cacheKey, stations);
  return stations;
}

// Station-name queries return public station data, not anything about the
// person searching, so they may outlive the 24-hour personal-data cap.
const searchCache = new TtlCache<Station[]>(7 * DAY_MS, "navitime-search", { containsPersonalData: false });

/** Stations whose name matches `word`: Japanese/kana via NAVITIME, romaji via Photon. */
export async function searchStations(word: string): Promise<Station[]> {
  const cacheKey = word.trim();
  // NAVITIME's transport_node search only understands Japanese and kana.
  if (!isJapaneseQuery(cacheKey)) return searchStationsPhoton(cacheKey);
  const cached = await searchCache.get(cacheKey);
  if (cached) return cached;
  const body = await call<{ items?: TransportNode[] }>(HOSTS.transport, "/transport_node", {
    word: cacheKey,
    type: "station",
    limit: "8",
  });
  const stations = (body.items ?? []).map(toStation);
  await searchCache.set(cacheKey, stations);
  return stations;
}

type CarRoute = { items?: Array<{ summary?: { move?: { distance?: number; time?: number; other_fare?: { taxi?: number } } } }> };

const taxiCache = new TtlCache<TaxiEstimate | null>(DAY_MS, "navitime-taxi");

/** Driving distance/time and NAVITIME's taxi fare estimate (regional rates, late-night surcharge). */
export async function taxiEstimate(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }, startTime: string): Promise<TaxiEstimate | null> {
  // The fare depends on the hour (late-night surcharge), so the hour is part of the key.
  const cacheKey = `${from.latitude.toFixed(3)}|${from.longitude.toFixed(3)}|${to.latitude.toFixed(3)}|${to.longitude.toFixed(3)}|${startTime.slice(0, 13)}`;
  const cached = await taxiCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const body = await call<CarRoute>(HOSTS.car, "/route_car", {
    start: `${from.latitude},${from.longitude}`,
    goal: `${to.latitude},${to.longitude}`,
    start_time: startTime,
  });
  const move = body.items?.[0]?.summary?.move;
  const estimate =
    move?.distance !== undefined && move.time !== undefined
      ? { distanceMeters: move.distance, minutes: move.time, fareYen: move.other_fare?.taxi ?? null }
      : null;
  await taxiCache.set(cacheKey, estimate);
  return estimate;
}

export type PlaceKind = "net-cafe" | "karaoke" | "capsule" | "hotel";

export type Place = {
  name: string;
  kind: PlaceKind;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  phone?: string;
  /** Only set when NAVITIME knows the hours; most spots have none on this plan. */
  open24h?: boolean;
};

/** NAVITIME spot categories, most specific first (a capsule hotel is also a "business/capsule hotel"). */
const PLACE_CATEGORIES: Array<[prefix: string, kind: PlaceKind]> = [
  ["0104002", "net-cafe"], // インターネットカフェ/まんが喫茶
  ["0104001", "karaoke"], // カラオケボックス/ルーム
  ["0608001001", "capsule"], // カプセルホテル
  ["0608001", "hotel"], // ビジネスホテル
  ["0608002", "hotel"], // ホテル
];

type Spot = {
  name: string;
  phone?: string;
  coord: { lat: number; lon: number };
  distance?: number;
  categories?: Array<{ code: string }>;
  opening_hours?: { open24h?: boolean } | null;
};

function placeKind(spot: Spot): PlaceKind | null {
  const codes = (spot.categories ?? []).map((category) => category.code);
  for (const [prefix, kind] of PLACE_CATEGORIES) {
    if (codes.some((code) => code.startsWith(prefix))) return kind;
  }
  return null;
}

// ~220 m grid: nearby users share answers, and places rarely change.
const placesCache = new TtlCache<Place[]>(12 * 60 * 60 * 1000, "navitime-places");

/** Net cafés, karaoke, capsule and other hotels within walking distance, nearest first. */
export async function nearbyPlaces(latitude: number, longitude: number): Promise<Place[]> {
  // Search from the grid point so every cached answer is measured from the same place.
  const gridLat = (Math.round(latitude * 500) / 500).toFixed(3);
  const gridLon = (Math.round(longitude * 500) / 500).toFixed(3);
  const cacheKey = `${gridLat}|${gridLon}`;
  const cached = await placesCache.get(cacheKey);
  if (cached) return cached;
  const body = await call<{ items?: Spot[] }>(HOSTS.spot, "/spot/category_code", {
    category: [...new Set(PLACE_CATEGORIES.map(([prefix]) => prefix.slice(0, 7)))].join("."),
    coord: `${gridLat},${gridLon}`,
    radius: "1500",
    limit: "40",
    options: "opening_hours",
  });
  const places: Place[] = [];
  for (const spot of body.items ?? []) {
    const kind = placeKind(spot);
    if (!kind) continue;
    places.push({
      name: spot.name,
      kind,
      latitude: spot.coord.lat,
      longitude: spot.coord.lon,
      distanceMeters: spot.distance ?? 0,
      phone: spot.phone || undefined,
      open24h: spot.opening_hours?.open24h,
    });
  }
  await placesCache.set(cacheKey, places);
  return places;
}

type WalkRouteResponse = { items?: Array<{ summary?: { move?: { distance?: number; time?: number } } }> };

const walkCache = new TtlCache<WalkRoute | null>(7 * DAY_MS, "navitime-walk");

/** Walking distance and time along the pedestrian network, at the user's pace. */
export async function walkRoute(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  pace: Pace,
): Promise<WalkRoute | null> {
  const cacheKey = `${from.latitude.toFixed(3)}|${from.longitude.toFixed(3)}|${to.latitude.toFixed(4)}|${to.longitude.toFixed(4)}|${pace}`;
  const cached = await walkCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const body = await call<WalkRouteResponse>(HOSTS.walk, "/route_walk", {
    start: `${from.latitude},${from.longitude}`,
    goal: `${to.latitude},${to.longitude}`,
    speed: String(WALK_SPEED_KMH[pace]),
  });
  const move = body.items?.[0]?.summary?.move;
  const route = move?.distance !== undefined && move.time !== undefined ? { distanceMeters: move.distance, minutes: move.time } : null;
  await walkCache.set(cacheKey, route);
  return route;
}

type AddressItem = { name: string; postal_code?: string; coord: { lat: number; lon: number } };

const addressCache = new TtlCache<Address[]>(30 * DAY_MS, "navitime-address");

/** Japanese addresses matching `word`, most relevant first. */
export async function geocodeAddress(word: string): Promise<Address[]> {
  const cacheKey = word.trim();
  const cached = await addressCache.get(cacheKey);
  if (cached) return cached;
  const body = await call<{ items?: AddressItem[] }>(HOSTS.geocoding, "/address", { word: cacheKey, limit: "8" });
  const addresses = (body.items ?? []).map((item) => ({
    name: item.name,
    postalCode: item.postal_code || undefined,
    latitude: item.coord.lat,
    longitude: item.coord.lon,
  }));
  await addressCache.set(cacheKey, addresses);
  return addresses;
}
