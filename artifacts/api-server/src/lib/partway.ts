/**
 * "Train partway, then taxi": once tonight's last train to the destination
 * is gone, find the farthest station on that route the user can still reach
 * by train, and estimate a taxi from there. The rail part comes from
 * LastRide's own timetable engine; the taxi part is a straight-line estimate
 * on the Tokyo-area meter (lib/estimates.ts).
 */
import { taxiEstimate, type TaxiEstimate } from "./estimates";
import {
  matchStations,
  normalizeServiceDate,
  sameStationGroup,
  timetableEngine,
  toTrainRoute,
  type StationRef,
  type TrainRoute,
} from "./timetableEngine";
import type { Station } from "./transit/model";
import {
  earliestTrainBetween,
  epochOf,
  lastTrainBetween,
  type JourneyAt,
} from "./transit/snapshot";
import { normalizeStationName } from "./transit/transfers";

/** Each attempt is a timetable search, so only the farthest few stops are tried. */
const MAX_STOP_ATTEMPTS = 4;

export type PartwayTrainTaxi = {
  train: TrainRoute;
  taxiFrom: {
    name: string;
    nameJa: string;
    latitude: number;
    longitude: number;
  };
  taxi: TaxiEstimate;
  totalFareYen: number | null;
};

/**
 * Stations the last-train journey passes through, farthest first, without
 * the origin and destination (by name, so other operators' platforms of the
 * same station don't count).
 */
export function partwayCandidateStops(
  journey: Pick<JourneyAt, "legs">,
  fromName: string,
  toName: string,
  limit = MAX_STOP_ATTEMPTS,
): Station[] {
  const excluded = new Set([
    normalizeStationName(fromName),
    normalizeStationName(toName),
  ]);
  const seen = new Set<string>();
  const stops: Station[] = [];
  for (const leg of journey.legs) {
    if (leg.kind !== "train") continue;
    for (const station of [leg.from, ...leg.via, leg.to]) {
      const key = normalizeStationName(station.nameJa);
      if (excluded.has(key) || seen.has(key)) continue;
      seen.add(key);
      stops.push(station);
    }
  }
  return stops.reverse().slice(0, limit);
}

function formatJstDateTime(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) + ":00";
}

export async function findPartwayTrainTaxi(input: {
  from: StationRef;
  to: StationRef;
  taxiTo: { latitude: number; longitude: number };
  serviceDate: string;
  earliestBoardAtMs: number;
}): Promise<PartwayTrainTaxi | null> {
  const { snapshot } = await timetableEngine();
  const date = normalizeServiceDate(input.serviceDate);
  if (!date) return null;
  const origins = matchStations(snapshot, input.from);
  const targets = matchStations(snapshot, input.to);
  if (origins.length === 0 || targets.length === 0) return null;

  const lastTrain = lastTrainBetween(snapshot, date, origins, targets);
  if (!lastTrain) return null;

  // Minutes after the service day's midnight, so 00:20 that night is 24:20.
  const notBefore = (input.earliestBoardAtMs - epochOf(date, 0)) / 60_000;

  // A stale mobile plan can say "departed" even though rail still reaches
  // the final station; don't replace that with a taxi.
  if (earliestTrainBetween(snapshot, date, origins, targets, notBefore))
    return null;

  // Farthest-first, so the first stop a train still reaches is the best one.
  for (const stop of partwayCandidateStops(
    lastTrain,
    input.from.name,
    input.to.name,
  )) {
    const stopIndex = snapshot.stations.indexOf(stop);
    const journey = earliestTrainBetween(
      snapshot,
      date,
      origins,
      sameStationGroup(snapshot, stopIndex),
      notBefore,
    );
    const train = journey && toTrainRoute(journey);
    if (!journey || !train) continue;

    // The train's own alighting station, which may be another operator's platform.
    const lastLeg = [...journey.legs]
      .reverse()
      .find((leg) => leg.kind === "train");
    const alightAt = lastLeg?.to ?? stop;
    const taxi = taxiEstimate(
      { latitude: alightAt.lat, longitude: alightAt.lon },
      input.taxiTo,
      formatJstDateTime(journey.arrivesAt),
    );
    return {
      train,
      taxiFrom: {
        name: alightAt.name,
        nameJa: alightAt.nameJa,
        latitude: alightAt.lat,
        longitude: alightAt.lon,
      },
      taxi,
      // ODPT has no fares, so the rail part (and the total) is unknown.
      totalFareYen: null,
    };
  }
  return null;
}
