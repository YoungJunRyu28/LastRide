import {
  searchDepartureTrain,
  searchTrain,
  stationByCode,
  type StationRef,
  type TrainRoute,
  type TrainRouteWithStops,
  type TrainStopRef,
} from "./ekispert";
import { ProviderError } from "./cache";
import { taxiEstimate, type TaxiEstimate } from "./navitime";

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

function baseName(name: string): string {
  return name.replace(/[（(〈<].*[）)〉>]$/, "").trim();
}

export function partwayCandidateStops(
  route: Pick<TrainRouteWithStops, "stopRefs">,
  fromName: string,
  toName: string,
  limit = MAX_STOP_ATTEMPTS,
): TrainStopRef[] {
  const from = baseName(fromName);
  const to = baseName(toName);
  return route.stopRefs
    .filter(
      (stop) => baseName(stop.name) !== from && baseName(stop.name) !== to,
    )
    .reverse()
    .slice(0, limit);
}

function formatJstDateTime(ms: number): string {
  const shifted = new Date(ms + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    String(shifted.getUTCFullYear()) +
    "-" +
    pad(shifted.getUTCMonth() + 1) +
    "-" +
    pad(shifted.getUTCDate()) +
    "T" +
    pad(shifted.getUTCHours()) +
    ":" +
    pad(shifted.getUTCMinutes()) +
    ":00"
  );
}

async function evaluateCandidate(
  candidate: TrainStopRef,
  input: {
    from: StationRef;
    taxiTo: { latitude: number; longitude: number };
    earliestBoardAtMs: number;
  },
): Promise<PartwayTrainTaxi | null> {
  const train = await searchDepartureTrain(
    input.from,
    candidate,
    input.earliestBoardAtMs,
  );
  if (!train) return null;

  const station = await stationByCode(candidate);
  const trainArrivalMs = Date.parse(train.arrivesAt);
  if (!Number.isFinite(trainArrivalMs)) return null;

  const taxi = await taxiEstimate(
    station,
    input.taxiTo,
    formatJstDateTime(trainArrivalMs),
  );
  if (!taxi) return null;

  return {
    train,
    taxiFrom: {
      name: candidate.nameEn,
      nameJa: candidate.name,
      latitude: station.latitude,
      longitude: station.longitude,
    },
    taxi,
    totalFareYen:
      train.fareYen !== null && taxi.fareYen !== null
        ? train.fareYen + taxi.fareYen
        : null,
  };
}

export async function findPartwayTrainTaxi(input: {
  from: StationRef;
  to: StationRef;
  taxiTo: { latitude: number; longitude: number };
  serviceDate: string;
  earliestBoardAtMs: number;
}): Promise<PartwayTrainTaxi | null> {
  const originalLastTrain = await searchTrain(
    "last",
    input.from,
    input.to,
    input.serviceDate,
  );
  if (!originalLastTrain) return null;

  // A stale mobile plan can say "departed" even after a timetable refresh.
  // If rail can still reach the final station, don't replace it with a taxi.
  const fullRail = await searchDepartureTrain(
    input.from,
    input.to,
    input.earliestBoardAtMs,
  );
  if (fullRail) return null;

  const candidates = partwayCandidateStops(
    originalLastTrain,
    input.from.name,
    input.to.name,
  );

  // Evaluate the bounded candidate set rather than stopping at the farthest
  // reachable station. The farthest rail stop often shortens the taxi, but fare
  // zones, road geometry and late-night taxi estimates can make an earlier
  // cutover cheaper. Sequential calls keep paid-provider pressure predictable.
  let firstError: unknown;
  const options: PartwayTrainTaxi[] = [];
  for (const candidate of candidates) {
    try {
      const option = await evaluateCandidate(candidate, input);
      if (option) options.push(option);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      firstError ??= err;
    }
  }

  if (options.length === 0) {
    if (firstError) throw firstError;
    return null;
  }

  options.sort((first, second) => {
    const firstFare = first.totalFareYen ?? Number.POSITIVE_INFINITY;
    const secondFare = second.totalFareYen ?? Number.POSITIVE_INFINITY;
    return (
      firstFare - secondFare ||
      first.taxi.distanceMeters - second.taxi.distanceMeters ||
      first.taxi.minutes - second.taxi.minutes ||
      Date.parse(first.train.arrivesAt) - Date.parse(second.train.arrivesAt)
    );
  });
  return options[0];
}
