/**
 * 駅すぱあと API (Ekispert) client for last/first train searches.
 *
 * Results are cached in the shared bounded Postgres cache: station metadata
 * changes rarely, and timetable answers are stable for a service date, so
 * repeated plans (and background tracking) rarely reach the paid API.
 */
import { ProviderError, TtlCache } from "./cache";
import { lineNameEn } from "./lineNames";
import { logger } from "./logger";
import { kanaToRomaji } from "./romaji";
import { recordCall } from "./usage";
import { providerTimeoutMs } from "./runtimeConfig";

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
export type TrainRoute = {
  departsAt: string;
  arrivesAt: string;
  transfers: number;
  fareYen: number | null;
  legs: TrainLeg[];
};
export type TrainStopRef = { code: string; name: string; nameEn: string };
export type TrainRouteWithStops = TrainRoute & { stopRefs: TrainStopRef[] };

function apiKey(): string {
  const key = process.env["EKISPERT_KEY"];
  if (!key) throw new ProviderError("EKISPERT_KEY is not configured");
  return key;
}

async function call(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE_URL}${path}`);
  url.search = new URLSearchParams({ key: apiKey(), ...params }).toString();
  await recordCall("ekispert", path);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(providerTimeoutMs()) });
  } catch (err) {
    throw new ProviderError(
      `Ekispert request failed: ${(err as Error).message}`,
    );
  }
  const body = (await response.json().catch(() => null)) as {
    ResultSet?: Record<string, unknown>;
  } | null;
  const resultSet = body?.ResultSet;
  if (!response.ok || !resultSet) {
    // Never log the URL: it carries the access key.
    logger.warn(
      { path, status: response.status, error: resultSet?.["Error"] },
      "Ekispert error",
    );
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
      if (typeof condition !== "string")
        throw new ProviderError("Ekispert returned no search condition");
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
const stationCodes = new TtlCache<string>(
  30 * 24 * 60 * 60 * 1000,
  "ekispert-stations",
);

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
  const points = list(
    resultSet["Point"] as
      Array<{ Station: { code: string; Name: string } }> | undefined,
  );
  // Prefer the same-named station (results are nearest first); otherwise the nearest one.
  const match =
    points.find(
      (point) => baseName(point.Station.Name) === baseName(station.name),
    ) ?? points[0];
  const resolved = match?.Station.code ?? station.name;
  await stationCodes.set(cacheKey, resolved);
  return resolved;
}

type EkispertStop = {
  Point?: {
    Station?: { code?: string; Name?: string; Yomi?: string };
  };
};

type EkispertLine = {
  Name: string;
  Type: string | { text: string };
  DepartureState?: { Datetime?: { text: string } };
  ArrivalState?: { Datetime?: { text: string } };
  Stop?: EkispertStop | EkispertStop[];
};
/** Ekispert prices: "Fare" is the base ticket, "Charge" the express/reserved-seat extras. */
type EkispertPrice = { kind?: string; Oneway?: string; selected?: string };

/** One-way total a passenger actually pays: base fare plus the selected charges. */
function onewayFare(course: EkispertCourse): number | null {
  const prices = list(course.Price);
  const summary = (kind: string) =>
    Number(prices.find((price) => price.kind === kind)?.Oneway ?? NaN);
  const fare = summary("FareSummary");
  if (!Number.isFinite(fare)) return null;
  const charge = summary("ChargeSummary");
  return fare + (Number.isFinite(charge) ? charge : 0);
}

type EkispertCourse = {
  Price?: EkispertPrice | EkispertPrice[];
  Route: {
    transferCount?: string;
    Line: EkispertLine | EkispertLine[];
    Point: Array<{ Station?: { Name: string; Yomi?: string }; Name?: string }>;
  };
};

function toTrainRoute(course: EkispertCourse): TrainRouteWithStops | null {
  const lines = list(course.Route.Line);
  const points = list(course.Route.Point);
  const legs: TrainLeg[] = [];
  const stopRefs: TrainStopRef[] = [];
  const seenStops = new Set<string>();
  lines.forEach((line, index) => {
    const type = typeof line.Type === "string" ? line.Type : line.Type.text;
    const departsAt = line.DepartureState?.Datetime?.text;
    const arrivesAt = line.ArrivalState?.Datetime?.text;
    if (type === "walk" || !departsAt || !arrivesAt) return;
    const pointName = (point: (typeof points)[number] | undefined) =>
      point?.Station?.Name ?? point?.Name ?? "";
    // Station readings are kana ("しぶや"), which romanize cleanly to sign-style names.
    const pointNameEn = (point: (typeof points)[number] | undefined) =>
      point?.Station?.Yomi
        ? kanaToRomaji(point.Station.Yomi)
        : pointName(point);
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
    for (const stop of list(line.Stop)) {
      const station = stop.Point?.Station;
      if (!station?.code || !station.Name || seenStops.has(station.code))
        continue;
      seenStops.add(station.code);
      stopRefs.push({
        code: station.code,
        name: station.Name,
        nameEn: station.Yomi ? kanaToRomaji(station.Yomi) : station.Name,
      });
    }
  });
  if (legs.length === 0) return null;
  return {
    departsAt: legs[0].departsAt,
    arrivesAt: legs[legs.length - 1].arrivesAt,
    transfers: Number(course.Route.transferCount ?? legs.length - 1),
    fareYen: onewayFare(course),
    legs,
    stopRefs,
  };
}

// Bump the cache name when TrainRoute changes shape, so stale entries are ignored.
const routes = new TtlCache<TrainRouteWithStops | null>(
  ROUTE_TTL_MS,
  "ekispert-routes-v4",
);
const departureRoutes = new TtlCache<TrainRouteWithStops | null>(
  ROUTE_TTL_MS,
  "ekispert-departure-routes-v1",
);

/**
 * Last or first train between two stations on a service date (YYYYMMDD).
 * Returns null when no rail route exists that day.
 */
export async function searchTrain(
  kind: "last" | "first",
  from: StationRef,
  to: StationRef,
  date: string,
): Promise<TrainRouteWithStops | null> {
  const [fromVia, toVia, condition] = await Promise.all([
    resolveStation(from),
    resolveStation(to),
    trainOnlyCondition(),
  ]);
  const cacheKey = `${kind}|${fromVia}|${toVia}|${date}`;
  const cached = await routes.get(cacheKey);
  if (cached !== undefined) return cached;

  const resultSet = await call("/search/course/extreme", {
    viaList: `${fromVia}:${toVia}`,
    searchType: kind === "last" ? "lastTrain" : "firstTrain",
    date,
    answerCount: "5",
    addStop: "true",
    conditionDetail: condition,
  });
  const candidates = list(
    resultSet["Course"] as EkispertCourse | EkispertCourse[] | undefined,
  )
    .map(toTrainRoute)
    .filter((route): route is TrainRouteWithStops => route !== null);
  // Last train: the latest departure that still gets home. First train: the earliest departure.
  candidates.sort(
    (first, second) =>
      Date.parse(first.departsAt) - Date.parse(second.departsAt),
  );
  const best = (kind === "last" ? candidates.at(-1) : candidates[0]) ?? null;
  await routes.set(cacheKey, best);
  return best;
}

type StationPoint = {
  GeoPoint?: { lati_d?: string; longi_d?: string };
  Station?: { code?: string; Name?: string; Yomi?: string };
};

const stationDetails = new TtlCache<StationRef & { code: string }>(
  30 * 24 * 60 * 60 * 1000,
  "ekispert-station-details",
);

export async function stationByCode(
  stop: TrainStopRef,
): Promise<StationRef & { code: string }> {
  const cached = await stationDetails.get(stop.code);
  if (cached) return cached;
  const resultSet = await call("/station", { code: stop.code });
  const point = list(
    resultSet["Point"] as StationPoint | StationPoint[] | undefined,
  )[0];
  const latitude = Number(point?.GeoPoint?.lati_d);
  const longitude = Number(point?.GeoPoint?.longi_d);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ProviderError("Ekispert station coordinates were unavailable");
  }
  const station = point?.Station;
  const resolved = {
    code: station?.code ?? stop.code,
    name: station?.Name ?? stop.name,
    latitude,
    longitude,
  };
  await stationDetails.set(stop.code, resolved);
  return resolved;
}

function jstSearchParts(ms: number): { date: string; time: string } {
  const rounded = Math.ceil(ms / 60_000) * 60_000;
  const shifted = new Date(rounded + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date:
      String(shifted.getUTCFullYear()) +
      pad(shifted.getUTCMonth() + 1) +
      pad(shifted.getUTCDate()),
    time: pad(shifted.getUTCHours()) + pad(shifted.getUTCMinutes()),
  };
}

/** Earliest timetable route departing no sooner than the user can board. */
export async function searchDepartureTrain(
  from: StationRef,
  to: TrainStopRef | StationRef,
  earliestBoardAtMs: number,
): Promise<TrainRouteWithStops | null> {
  const [fromVia, condition] = await Promise.all([
    resolveStation(from),
    trainOnlyCondition(),
  ]);
  const toVia = "code" in to ? to.code : await resolveStation(to);
  const { date, time } = jstSearchParts(earliestBoardAtMs);
  const cacheKey = fromVia + "|" + toVia + "|" + date + "|" + time;
  const cached = await departureRoutes.get(cacheKey);
  if (cached !== undefined) return cached;

  const resultSet = await call("/search/course/extreme", {
    viaList: fromVia + ":" + toVia,
    searchType: "departure",
    date,
    time,
    answerCount: "5",
    conditionDetail: condition,
  });
  const candidates = list(
    resultSet["Course"] as EkispertCourse | EkispertCourse[] | undefined,
  )
    .map(toTrainRoute)
    .filter(
      (route): route is TrainRouteWithStops =>
        route !== null && Date.parse(route.departsAt) >= earliestBoardAtMs,
    )
    .sort(
      (first, second) =>
        Date.parse(first.departsAt) - Date.parse(second.departsAt),
    );

  const best = candidates[0] ?? null;
  await departureRoutes.set(cacheKey, best);
  return best;
}

export type TrainDisruption = {
  line: string;
  lineCode: string | null;
  status: string;
  title: string;
  comment: string | null;
  updatedAt: string | null;
};

type EkispertServiceInformation = {
  status?: string;
  Line?: { code?: string; Name?: string };
  Title?: string;
  Comment?:
    | { text?: string; status?: string }
    | Array<{ text?: string; status?: string }>;
  Datetime?: string;
};

const disruptionCache = new TtlCache<TrainDisruption[]>(
  60 * 1000,
  "ekispert-disruptions-v1",
);

export function normalizeRailLineName(name: string): string {
  return name
    .split("・")[0]
    .replace(/[\s　]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(外回り|内回り)$/u, "")
    .toLowerCase();
}

export function disruptionMatchesLine(
  disruptionLine: string,
  requestedLine: string,
): boolean {
  const disruption = normalizeRailLineName(disruptionLine);
  const requested = normalizeRailLineName(requestedLine);
  return (
    disruption === requested ||
    disruption.includes(requested) ||
    requested.includes(disruption)
  );
}

export async function trainDisruptionsForLines(
  lineNames: string[],
): Promise<TrainDisruption[]> {
  if (lineNames.length === 0) return [];
  let all = await disruptionCache.get("all");
  if (all === undefined) {
    const resultSet = await call(
      "/operationLine/service/rescuenow/information",
      {},
    );
    all = list(
      resultSet["Information"] as
        EkispertServiceInformation | EkispertServiceInformation[] | undefined,
    )
      .map((info): TrainDisruption | null => {
        const line = info.Line?.Name;
        const status = info.status;
        const title = info.Title;
        if (!line || !status || !title) return null;
        const comments = list(info.Comment);
        const short =
          comments.find((comment) => comment.status === "short")?.text ??
          comments.find((comment) => typeof comment.text === "string")?.text ??
          null;
        return {
          line,
          lineCode: info.Line?.code ?? null,
          status,
          title,
          comment: short,
          updatedAt: info.Datetime ?? null,
        };
      })
      .filter((item): item is TrainDisruption => item !== null);
    await disruptionCache.set("all", all);
  }
  return all.filter((incident) =>
    lineNames.some((line) => disruptionMatchesLine(incident.line, line)),
  );
}
