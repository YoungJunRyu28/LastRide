/**
 * Serves /trains/last and /trains/first from LastRide's own timetable engine
 * (src/lib/transit, docs/last-train-engine.md) instead of a paid provider.
 *
 * The snapshot is built offline from ODPT open data (`pnpm run transit:build`)
 * and shipped next to the server bundle (build.mjs copies it into dist/). It
 * is loaded once per process and filtered to the operators whose licence lets
 * us use it commercially. A request whose stations are not in the snapshot,
 * or with no journey that night, answers null, which the route turns into a
 * 404 so the app can fall back to Apple Maps.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";
import type { Station, TransitSnapshot, Trip } from "./transit/model";
import {
  findStations,
  firstTrainBetween,
  lastTrainBetween,
  readSnapshot,
  type JourneyAt,
} from "./transit/snapshot";
import { distanceMeters, normalizeStationName } from "./transit/transfers";

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

/**
 * Operators whose ODPT data may be used commercially. This must match the
 * "Usable commercially: Yes" rows of the licence table in
 * docs/last-train-engine.md ("What the data covers"); anything else in a
 * snapshot (e.g. Yurikamome, or the challenge-only JR East / private railway
 * data) is dropped at load time. Re-check the licences before adding one.
 */
export const LICENSED_OPERATORS: readonly string[] = [
  "odpt.Operator:TokyoMetro",
  "odpt.Operator:Toei",
  "odpt.Operator:MIR",
  "odpt.Operator:TWR",
  "odpt.Operator:TamaMonorail",
  "odpt.Operator:YokohamaMunicipal",
];

/** A same-named station further than this from the app's coordinates is a different place. */
const NAME_MATCH_MAX_METERS = 2_000;
/** Without a name match, the nearest snapshot station within this radius is used. */
const NEAREST_STATION_METERS = 400;
/** Other operators' platforms of the matched station (same as transfers.ts). */
const SAME_STATION_METERS = 700;

export const SNAPSHOT_FILE_NAME = "transit-snapshot.json.gz";

/** The snapshot is missing or unreadable: the server can't answer train questions. */
export class TimetableUnavailableError extends Error {
  constructor(message = "Timetable snapshot unavailable") {
    super(message);
    this.name = "TimetableUnavailableError";
  }
}

export type Railway = { nameJa: string; name: string; operator: string };

export type TimetableEngine = {
  snapshot: TransitSnapshot;
  /** "odpt.Railway:TokyoMetro.Hanzomon" → its display names, for operation information. */
  railways: Map<string, Railway>;
};

/** Drop every station, trip and source of an operator not in `allowed`. */
export function filterLicensedOperators(
  snapshot: TransitSnapshot,
  allowed: readonly string[] = LICENSED_OPERATORS,
): TransitSnapshot {
  const allowedSet = new Set(allowed);
  const newIndex = new Int32Array(snapshot.stations.length).fill(-1);
  const stations: Station[] = [];
  snapshot.stations.forEach((station, index) => {
    if (!allowedSet.has(station.operator)) return;
    newIndex[index] = stations.length;
    stations.push(station);
  });
  const trips: Trip[] = [];
  for (const trip of snapshot.trips) {
    // A trip touching an excluded operator's station is that operator's data.
    if (trip.stops.some(([station]) => newIndex[station] < 0)) continue;
    trips.push({
      ...trip,
      stops: trip.stops.map(([station, arrive, depart]) => [
        newIndex[station],
        arrive,
        depart,
      ]),
    });
  }
  return {
    ...snapshot,
    sources: snapshot.sources.filter((source) =>
      allowedSet.has(source.operator),
    ),
    stations,
    trips,
  };
}

/** ODPT trip IDs are "odpt.TrainTimetable:<Operator>.<Railway>.<train>…". */
function railwaysOf(snapshot: TransitSnapshot): Map<string, Railway> {
  const railways = new Map<string, Railway>();
  for (const trip of snapshot.trips) {
    const match = /^odpt\.TrainTimetable:([^.]+)\.([^.]+)\./.exec(trip.id);
    if (!match) continue;
    const id = `odpt.Railway:${match[1]}.${match[2]}`;
    if (railways.has(id)) continue;
    const operator = `odpt.Operator:${match[1]}`;
    railways.set(id, { ...lineLabel(operator, trip.line), operator });
  }
  return railways;
}

const OPERATOR_PREFIX: Record<string, { ja: string; en: string }> = {
  "odpt.Operator:TokyoMetro": { ja: "東京メトロ", en: "Tokyo Metro" },
  "odpt.Operator:Toei": { ja: "都営", en: "Toei" },
  "odpt.Operator:YokohamaMunicipal": {
    ja: "横浜市営地下鉄",
    en: "Yokohama Municipal Subway",
  },
};

/**
 * ODPT names subway lines without their operator ("新宿線"), which is
 * ambiguous next to other railways (西武新宿線) and unlike what people and
 * Apple Maps call them, so the operator goes in front: "都営新宿線",
 * "東京メトロ半蔵門線". Names that already stand alone (つくばエクスプレス,
 * 日暮里・舎人ライナー, 東京さくらトラム) are left as they are.
 */
export function lineLabel(
  operator: string,
  line: { name: string; nameJa: string },
): { nameJa: string; name: string } {
  const prefix = OPERATOR_PREFIX[operator];
  const isPlainLine = /(線|ライン)$/.test(line.nameJa) && !/[（(]/.test(line.nameJa);
  if (!prefix || !isPlainLine || line.nameJa.startsWith(prefix.ja))
    return { nameJa: line.nameJa, name: line.name };
  return {
    nameJa: `${prefix.ja}${line.nameJa}`,
    name: `${prefix.en} ${line.name}`,
  };
}

/** Where the snapshot is looked for, first match wins. */
export function snapshotPathCandidates(): string[] {
  const configured =
    process.env.TRANSIT_SNAPSHOT_PATH?.trim() ||
    process.env.TRANSIT_SHADOW_SNAPSHOT_PATH?.trim();
  if (configured) return [configured];
  return [
    // Production: build.mjs copies the snapshot next to the bundle in dist/.
    path.join(path.dirname(fileURLToPath(import.meta.url)), SNAPSHOT_FILE_NAME),
    // Running from source (tsx, vitest) in artifacts/api-server.
    path.resolve(process.cwd(), "data", SNAPSHOT_FILE_NAME),
  ];
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

let enginePromise: Promise<TimetableEngine> | null = null;

async function loadEngine(): Promise<TimetableEngine> {
  const candidates = snapshotPathCandidates();
  const found = await firstExisting(candidates);
  if (!found) {
    throw new TimetableUnavailableError(
      `Timetable snapshot not found (looked in ${candidates.join(", ")}). ` +
        "Build it with `pnpm run transit:build` (needs ODPT_KEY) or set TRANSIT_SNAPSHOT_PATH.",
    );
  }
  let raw: TransitSnapshot;
  try {
    raw = await readSnapshot(found);
  } catch (err) {
    throw new TimetableUnavailableError(
      `Timetable snapshot at ${found} could not be read: ${(err as Error).message}`,
    );
  }
  const snapshot = filterLicensedOperators(raw);
  logger.info(
    {
      path: found,
      generatedAt: snapshot.generatedAt,
      stations: snapshot.stations.length,
      trips: snapshot.trips.length,
      droppedStations: raw.stations.length - snapshot.stations.length,
    },
    "Timetable snapshot loaded",
  );
  return { snapshot, railways: railwaysOf(snapshot) };
}

/**
 * The loaded engine, shared by every request in this process. A failed load
 * is logged and retried on the next request rather than cached.
 */
export function timetableEngine(): Promise<TimetableEngine> {
  enginePromise ??= loadEngine().catch((err: unknown) => {
    enginePromise = null;
    logger.error(
      { err: (err as Error).message },
      "Timetable snapshot unavailable; train endpoints answer 503",
    );
    throw err instanceof TimetableUnavailableError
      ? err
      : new TimetableUnavailableError((err as Error).message);
  });
  return enginePromise;
}

/** Forget the loaded snapshot (tests switch TRANSIT_SNAPSHOT_PATH). */
export function resetTimetableEngine(): void {
  enginePromise = null;
}

/** API dates are YYYYMMDD; the engine uses YYYY-MM-DD. */
export function normalizeServiceDate(date: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (/^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return null;
}

function hasCoordinates(ref: StationRef): boolean {
  return (
    Number.isFinite(ref.latitude) &&
    Number.isFinite(ref.longitude) &&
    (ref.latitude !== 0 || ref.longitude !== 0)
  );
}

/** `station` and the other operators' platforms of the same station. */
export function sameStationGroup(
  snapshot: TransitSnapshot,
  station: number,
): number[] {
  const origin = snapshot.stations[station];
  return findStations(snapshot, origin.nameJa).filter(
    (index) =>
      index === station ||
      distanceMeters(snapshot.stations[index], origin) <= SAME_STATION_METERS,
  );
}

/**
 * Snapshot stations for a station the app picked. The app's names come from
 * other sources (Apple MapKit, OpenStreetMap, the server's own search), so the Japanese name is
 * tried first (ignoring "駅" and bracketed alternates), keeping only matches
 * near the given coordinates; otherwise the nearest snapshot station within
 * 400 m stands in. An empty result means the station isn't covered.
 */
export function matchStations(
  snapshot: TransitSnapshot,
  ref: StationRef,
): number[] {
  const located = hasCoordinates(ref);
  const point = { lat: ref.latitude, lon: ref.longitude };
  const named = findStations(snapshot, ref.name).filter(
    (index) =>
      !located ||
      distanceMeters(snapshot.stations[index], point) <= NAME_MATCH_MAX_METERS,
  );
  if (named.length > 0) return named;
  if (!located) return [];

  let nearest = -1;
  let nearestMeters = NEAREST_STATION_METERS;
  snapshot.stations.forEach((station, index) => {
    const meters = distanceMeters(station, point);
    if (meters <= nearestMeters) {
      nearest = index;
      nearestMeters = meters;
    }
  });
  return nearest < 0 ? [] : sameStationGroup(snapshot, nearest);
}

/** Epoch ms → "2026-10-10T00:31:00+09:00". */
export function jstIso(ms: number): string {
  const seconds = Math.floor(ms / 1000) * 1000;
  return (
    new Date(seconds + 9 * 60 * 60_000).toISOString().slice(0, 19) + "+09:00"
  );
}

/**
 * The engine's journey in the API's TrainRoute shape. Walks between
 * operators' stations are part of a change, not legs of their own; the
 * transfer count is the number of changes between trains. ODPT has no fares.
 */
export function toTrainRoute(journey: JourneyAt): TrainRoute | null {
  const legs: TrainLeg[] = [];
  for (const leg of journey.legs) {
    if (leg.kind !== "train") continue;
    const line = lineLabel(leg.from.operator, leg.lines[0] ?? {
      name: "",
      nameJa: "",
    });
    legs.push({
      line: line.nameJa,
      lineEn: line.name || line.nameJa,
      from: leg.from.nameJa,
      fromEn: leg.from.name || leg.from.nameJa,
      to: leg.to.nameJa,
      toEn: leg.to.name || leg.to.nameJa,
      departsAt: jstIso(leg.departsAt),
      arrivesAt: jstIso(leg.arrivesAt),
    });
  }
  if (legs.length === 0) return null;
  return {
    departsAt: jstIso(journey.departsAt),
    arrivesAt: jstIso(journey.arrivesAt),
    transfers: legs.length - 1,
    fareYen: null,
    legs,
  };
}

/** The day before a "YYYY-MM-DD" date. */
function previousDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Last train that night, or the first train of the morning of the service
 * day `date` (from 04:00), as the API's TrainRoute. Null: not covered or no
 * route.
 */
export function searchTrainIn(
  snapshot: TransitSnapshot,
  kind: "last" | "first",
  from: StationRef,
  to: StationRef,
  serviceDate: string,
): TrainRoute | null {
  const date = normalizeServiceDate(serviceDate);
  if (!date) return null;
  const origins = matchStations(snapshot, from);
  const targets = matchStations(snapshot, to);
  if (origins.length === 0 || targets.length === 0) return null;
  // Same station on both ends: nothing to ride.
  if (origins.some((origin) => targets.includes(origin))) return null;
  const journey =
    kind === "last"
      ? lastTrainBetween(snapshot, date, origins, targets)
      : // firstTrainBetween answers for the morning after its date.
        firstTrainBetween(snapshot, previousDay(date), origins, targets);
  return journey ? toTrainRoute(journey) : null;
}

export async function searchTrain(
  kind: "last" | "first",
  from: StationRef,
  to: StationRef,
  serviceDate: string,
): Promise<TrainRoute | null> {
  const { snapshot } = await timetableEngine();
  return searchTrainIn(snapshot, kind, from, to, serviceDate);
}
