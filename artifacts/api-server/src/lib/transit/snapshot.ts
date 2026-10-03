/**
 * Building, storing and querying a timetable snapshot.
 */
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  buildTimetable,
  firstTrain,
  lastTrains,
  type Journey,
  type Leg,
  type Timetable,
} from "./csa";
import {
  formatClock,
  MINUTES_PER_DAY,
  type Service,
  type SnapshotSource,
  type Station,
  type TransitSnapshot,
  type Trip,
} from "./model";
import { normalizeStationName, stationsByName } from "./transfers";

export function assembleSnapshot(
  sources: SnapshotSource[],
  stations: Station[],
  services: Record<string, Service>,
  trips: Trip[],
  generatedAt = new Date().toISOString(),
): TransitSnapshot {
  return { version: 1, generatedAt, sources, stations, services, trips };
}

export async function writeSnapshot(
  path: string,
  snapshot: TransitSnapshot,
): Promise<void> {
  await writeFile(path, gzipSync(JSON.stringify(snapshot)));
}

export async function readSnapshot(path: string): Promise<TransitSnapshot> {
  const snapshot = JSON.parse(
    gunzipSync(await readFile(path)).toString("utf8"),
  ) as TransitSnapshot;
  if (snapshot.version !== 1)
    throw new Error(`Unsupported snapshot version ${String(snapshot.version)}`);
  return snapshot;
}

/** Every station index matching a name, in Japanese ("渋谷") or English ("Shibuya"). */
export function findStations(
  snapshot: TransitSnapshot,
  name: string,
): number[] {
  const byName = stationsByName(snapshot.stations);
  const japanese = byName.get(normalizeStationName(name));
  if (japanese) return japanese;
  const english = name.trim().toLowerCase();
  const key = snapshot.stations.find(
    (station) => station.name.toLowerCase() === english,
  )?.nameJa;
  return key ? (byName.get(normalizeStationName(key)) ?? []) : [];
}

const timetables = new Map<string, Timetable>();

/** One built timetable per (snapshot, date); the last few are kept. */
export function timetableFor(
  snapshot: TransitSnapshot,
  date: string,
): Timetable {
  const key = `${snapshot.generatedAt}|${date}`;
  let timetable = timetables.get(key);
  if (!timetable) {
    timetable = buildTimetable(snapshot, date);
    timetables.set(key, timetable);
    if (timetables.size > 3) timetables.delete(timetables.keys().next().value!);
  }
  return timetable;
}

export type JourneyAt = {
  /** Epoch ms. */
  departsAt: number;
  arrivesAt: number;
  transfers: number;
  legs: Array<
    | {
        kind: "train";
        from: Station;
        to: Station;
        departsAt: number;
        arrivesAt: number;
        lines: { name: string; nameJa: string }[];
        headsign?: { name: string; nameJa: string };
      }
    | { kind: "walk"; from: Station; to: Station; minutes: number }
  >;
};

/** Service-day minutes → epoch ms, Japan being UTC+9 all year. */
export function epochOf(date: string, minutes: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return (
    Date.UTC(year, month - 1, day) -
    9 * 60 * 60_000 +
    Math.round(minutes * 60_000)
  );
}

function withTimes(
  snapshot: TransitSnapshot,
  date: string,
  journey: Journey,
): JourneyAt {
  const at = (minutes: number) => epochOf(date, minutes);
  return {
    departsAt: at(journey.departs),
    arrivesAt: at(journey.arrives),
    transfers: journey.transfers,
    legs: journey.legs.map((leg: Leg) =>
      leg.kind === "train"
        ? {
            kind: "train" as const,
            from: snapshot.stations[leg.from],
            to: snapshot.stations[leg.to],
            departsAt: at(leg.departs),
            arrivesAt: at(leg.arrives),
            lines: leg.lines,
            headsign: leg.headsign,
          }
        : {
            kind: "walk" as const,
            from: snapshot.stations[leg.from],
            to: snapshot.stations[leg.to],
            minutes: leg.minutes,
          },
    ),
  };
}

/**
 * Tonight's last train from any station named `from` to any named `to`, for
 * the service day `date` (a 00:30 train on the 10th belongs to the 9th).
 */
export function lastTrainBetween(
  snapshot: TransitSnapshot,
  date: string,
  from: number[],
  to: number[],
): JourneyAt | null {
  const result = lastTrains(timetableFor(snapshot, date), to);
  let best: Journey | null = null;
  for (const origin of from) {
    const journey = result.journeyFrom(origin);
    if (journey && (!best || journey.departs > best.departs)) best = journey;
  }
  return best ? withTimes(snapshot, date, best) : null;
}

/** The first train of the morning after service day `date`, from 04:00. */
export function firstTrainBetween(
  snapshot: TransitSnapshot,
  date: string,
  from: number[],
  to: number[],
): JourneyAt | null {
  const next = new Date(epochOf(date, MINUTES_PER_DAY + 9 * 60))
    .toISOString()
    .slice(0, 10);
  const journey = firstTrain(timetableFor(snapshot, next), from, to, 4 * 60);
  return journey ? withTimes(snapshot, next, journey) : null;
}

export function describeJourney(
  journey: JourneyAt,
  language: "ja" | "en" = "ja",
): string {
  const clock = (ms: number) =>
    formatClock(
      (((ms / 60_000 + 9 * 60) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
        MINUTES_PER_DAY,
    );
  const name = (station: Station) =>
    language === "ja" ? station.nameJa : station.name;
  return journey.legs
    .map((leg) =>
      leg.kind === "walk"
        ? `  walk ${name(leg.from)} → ${name(leg.to)} (${leg.minutes} min)`
        : `  ${clock(leg.departsAt)} ${name(leg.from)} → ${clock(leg.arrivesAt)} ${name(leg.to)}  [${leg.lines
            .map((line) => (language === "ja" ? line.nameJa : line.name))
            .join(" → ")}]`,
    )
    .join("\n");
}
