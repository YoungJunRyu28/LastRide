/**
 * 駅すぱあと API (Ekispert) client for last/first train searches.
 *
 * Results are cached in memory: station codes never change, and a timetable
 * answer for a station pair only changes by service date, so repeated plans
 * (and background tracking) rarely reach the paid API.
 */
import { ProviderError, TtlCache } from "./cache";
import { lineNameEn } from "./lineNames";
import { logger } from "./logger";
import { kanaToRomaji } from "./romaji";
import { recordCall } from "./usage";

const BASE_URL = "https://api.ekispert.jp/v1/json";
const ROUTE_TTL_MS = 6 * 60 * 60 * 1000;
/** How far from the app's station coordinates to look for the matching Ekispert station. */
const STATION_MATCH_RADIUS_METERS = 800;

export type StationRef = { latitude: number; longitude: number; name: string };

export type TrainLeg = {
  line: string;
  lineEn: string;
  from: string;
  fromEn: string;
  to: string;
  toEn: string;
  departsAt: string;
  arrivesAt: string;
};
export type TrainRoute = { departsAt: string; arrivesAt: string; transfers: number; fareYen: number | null; legs: TrainLeg[] };

function apiKey(): string {
  const key = process.env["EKISPERT_KEY"];
  if (!key) throw new ProviderError("EKISPERT_KEY is not configured");
  return key;
}

async function call(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE_URL}${path}`);
  url.search = new URLSearchParams({ key: apiKey(), ...params }).toString();
  // Not awaited: recording usage should never add a database round-trip to
  // the critical path of an upstream call, and recordCall handles its own
  // errors internally, so nothing here goes unhandled.
  void recordCall("ekispert", path);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new ProviderError(`Ekispert request failed: ${(err as Error).message}`);
  }
  const body = (await response.json().catch(() => null)) as { ResultSet?: Record<string, unknown> } | null;
  const resultSet = body?.ResultSet;
  if (!response.ok || !resultSet) {
    // Never log the URL: it carries the access key.
    logger.warn({ path, status: response.status, error: resultSet?.["Error"] }, "Ekispert error");
    throw new ProviderError(`Ekispert responded ${response.status}`);
  }
  return resultSet;
}

/** Ekispert returns a bare object when there is one result and an array when there are several. */
function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Trains only: the app answers "can I still get home by rail tonight",
// so planes, ships and buses must never stand in for a missed last train.
let conditionDetail: Promise<string> | null = null;
function trainOnlyCondition(): Promise<string> {
  conditionDetail ??= call("/toolbox/course/condition", {
    plane: "never",
    ship: "never",
    highwayBus: "never",
    localBus: "never",
    connectionBus: "never",
  })
    .then((resultSet) => {
      const condition = resultSet["Condition"];
      if (typeof condition !== "string") throw new ProviderError("Ekispert returned no search condition");
      return condition;
    })
    .catch((err) => {
      conditionDetail = null; // retry on the next request
      throw err;
    });
  return conditionDetail;
}

/**
 * "府中(広島県)" → "府中", "押上〈スカイツリー前〉" → "押上": providers add
 * prefectures or alternate names in brackets.
 */
function baseName(name: string) {
  return name.replace(/[（(〈<].*[）)〉>]$/, "").trim();
}

// Station codes never change; keep them for a month.
const stationCodes = new TtlCache<string>(30 * 24 * 60 * 60 * 1000, "ekispert-stations");

/**
 * Resolves a station the app found (via OpenStreetMap) to an Ekispert
 * `viaList` entry: its station code, or the plain name if no station matches nearby.
 */
async function resolveStation(station: StationRef): Promise<string> {
  const hasCoordinates = station.latitude !== 0 || station.longitude !== 0;
  if (!hasCoordinates) return station.name;
  const cacheKey = `${station.name}|${station.latitude.toFixed(4)}|${station.longitude.toFixed(4)}`;
  const cached = await stationCodes.get(cacheKey);
  if (cached) return cached;

  const resultSet = await call("/geo/station", {
    geoPoint: `${station.latitude},${station.longitude},wgs84,${STATION_MATCH_RADIUS_METERS}`,
    type: "train",
    stationCount: "5",
  });
  const points = list(resultSet["Point"] as Array<{ Station: { code: string; Name: string } }> | undefined);
  // Prefer the same-named station (results are nearest first); otherwise the nearest one.
  const match = points.find((point) => baseName(point.Station.Name) === baseName(station.name)) ?? points[0];
  const resolved = match?.Station.code ?? station.name;
  await stationCodes.set(cacheKey, resolved);
  return resolved;
}

type EkispertLine = {
  Name: string;
  Type: string | { text: string };
  DepartureState?: { Datetime?: { text: string } };
  ArrivalState?: { Datetime?: { text: string } };
};
/** Ekispert prices: "Fare" is the base ticket, "Charge" the express/reserved-seat extras. */
type EkispertPrice = { kind?: string; Oneway?: string; selected?: string };

/** One-way total a passenger actually pays: base fare plus the selected charges. */
function onewayFare(course: EkispertCourse): number | null {
  const prices = list(course.Price);
  const summary = (kind: string) => Number(prices.find((price) => price.kind === kind)?.Oneway ?? NaN);
  const fare = summary("FareSummary");
  if (!Number.isFinite(fare)) return null;
  const charge = summary("ChargeSummary");
  return fare + (Number.isFinite(charge) ? charge : 0);
}

type EkispertCourse = {
  Price?: EkispertPrice | EkispertPrice[];
  Route: { transferCount?: string; Line: EkispertLine | EkispertLine[]; Point: Array<{ Station?: { Name: string; Yomi?: string }; Name?: string }> };
};

function toTrainRoute(course: EkispertCourse): TrainRoute | null {
  const lines = list(course.Route.Line);
  const points = list(course.Route.Point);
  const legs: TrainLeg[] = [];
  lines.forEach((line, index) => {
    const type = typeof line.Type === "string" ? line.Type : line.Type.text;
    const departsAt = line.DepartureState?.Datetime?.text;
    const arrivesAt = line.ArrivalState?.Datetime?.text;
    if (type === "walk" || !departsAt || !arrivesAt) return;
    const pointName = (point: (typeof points)[number] | undefined) => point?.Station?.Name ?? point?.Name ?? "";
    // Station readings are kana ("しぶや"), which romanize cleanly to sign-style names.
    const pointNameEn = (point: (typeof points)[number] | undefined) => (point?.Station?.Yomi ? kanaToRomaji(point.Station.Yomi) : pointName(point));
    legs.push({
      line: line.Name,
      lineEn: lineNameEn(line.Name),
      from: pointName(points[index]),
      fromEn: pointNameEn(points[index]),
      to: pointName(points[index + 1]),
      toEn: pointNameEn(points[index + 1]),
      departsAt,
      arrivesAt,
    });
  });
  if (legs.length === 0) return null;
  return {
    departsAt: legs[0].departsAt,
    arrivesAt: legs[legs.length - 1].arrivesAt,
    transfers: Number(course.Route.transferCount ?? legs.length - 1),
    fareYen: onewayFare(course),
    legs,
  };
}

// Bump the cache name when TrainRoute changes shape, so stale entries are ignored.
const routes = new TtlCache<TrainRoute | null>(ROUTE_TTL_MS, "ekispert-routes-v3");

/**
 * Last or first train between two stations on a service date (YYYYMMDD).
 * Returns null when no rail route exists that day.
 */
export async function searchTrain(kind: "last" | "first", from: StationRef, to: StationRef, date: string): Promise<TrainRoute | null> {
  const [fromVia, toVia, condition] = await Promise.all([resolveStation(from), resolveStation(to), trainOnlyCondition()]);
  const cacheKey = `${kind}|${fromVia}|${toVia}|${date}`;
  const cached = await routes.get(cacheKey);
  if (cached !== undefined) return cached;

  const resultSet = await call("/search/course/extreme", {
    viaList: `${fromVia}:${toVia}`,
    searchType: kind === "last" ? "lastTrain" : "firstTrain",
    date,
    answerCount: "5",
    conditionDetail: condition,
  });
  const candidates = list(resultSet["Course"] as EkispertCourse | EkispertCourse[] | undefined)
    .map(toTrainRoute)
    .filter((route): route is TrainRoute => route !== null);
  // Last train: the latest departure that still gets home. First train: the earliest departure.
  candidates.sort((first, second) => Date.parse(first.departsAt) - Date.parse(second.departsAt));
  const best = (kind === "last" ? candidates.at(-1) : candidates[0]) ?? null;
  await routes.set(cacheKey, best);
  return best;
}
