/**
 * Train timetable lookups. This is the only place the app gets last/first
 * train times from. Real times come from the LastRide API server (駅すぱあと API);
 * in development builds with no server it falls back to fixed sample times
 * flagged `source: 'sample'`, which the UI labels so they are never mistaken
 * for a real schedule. Production builds never use sample times: without a
 * server, lookups fail and the UI reports train times as unavailable.
 */
import { getFirstTrain as fetchFirstTrain, getLastTrain as fetchLastTrain, type GetLastTrainParams, type TrainRoute } from '@workspace/api-client-react';
import { apiBaseUrl, isDevelopment } from '@/lib/api';
import type { StationOption } from '@/lib/stations';
import { nextOccurrence, serviceDate, serviceDayStart, serviceTimeToMs } from '@/lib/time';

export type TrainLeg = {
  line: string;
  from: string;
  to: string;
  /** English names; absent in plans saved by older app versions. */
  lineEn?: string;
  fromEn?: string;
  toEn?: string;
  departsAt: number;
  arrivesAt: number;
};

export type TrainTime = {
  /** Departure from the boarding station, epoch ms. */
  departsAt: number;
  /** Arrival at the destination, when known. */
  arrivesAt?: number;
  transfers?: number;
  /** One-way fare including express charges, in yen. */
  fareYen?: number | null;
  legs?: TrainLeg[];
  source: 'sample' | 'live';
};

const SAMPLE_LAST_TRAIN = '23:52';
const SAMPLE_FIRST_TRAIN = '05:04';

function toParams(from: StationOption, to: StationOption, nowMs: number): GetLastTrainParams {
  return {
    fromLat: from.latitude,
    fromLon: from.longitude,
    fromName: from.nameJa,
    toLat: to.latitude,
    toLon: to.longitude,
    toName: to.nameJa,
    date: serviceDate(nowMs),
  };
}

function toTrainTime(route: TrainRoute): TrainTime {
  return {
    departsAt: Date.parse(route.departsAt),
    arrivesAt: Date.parse(route.arrivesAt),
    transfers: route.transfers,
    fareYen: route.fareYen,
    legs: route.legs.map((leg) => ({ ...leg, departsAt: Date.parse(leg.departsAt), arrivesAt: Date.parse(leg.arrivesAt) })),
    source: 'live',
  };
}

/** Production builds without a server: fail rather than show sample times. */
function requireServer(): void {
  if (!isDevelopment) throw new Error('Train times are unavailable: no API server is configured.');
}

/** Runs a lookup; a 404 means "no train route that day" and becomes null. */
async function lookup(request: () => Promise<TrainRoute>): Promise<TrainTime | null> {
  try {
    return toTrainTime(await request());
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

/** The last departure from `from` tonight that still reaches `to`, or null if no train goes there. */
export async function getLastTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  if (!apiBaseUrl) {
    requireServer();
    return { departsAt: serviceTimeToMs(SAMPLE_LAST_TRAIN, nowMs), source: 'sample' };
  }
  return lookup(() => fetchLastTrain(toParams(from, to, nowMs)));
}

/** The next first train from `from` toward `to` after `nowMs`, or null if no train goes there. */
export async function getFirstTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  if (!apiBaseUrl) {
    requireServer();
    return { departsAt: nextOccurrence(SAMPLE_FIRST_TRAIN, nowMs), source: 'sample' };
  }
  // Usually today's first train has already left, so this is the next service day's.
  const today = await lookup(() => fetchFirstTrain(toParams(from, to, nowMs)));
  if (today && today.departsAt > nowMs) return today;
  const nextServiceDay = serviceDayStart(nowMs) + 24 * 60 * 60 * 1000;
  return lookup(() => fetchFirstTrain(toParams(from, to, nextServiceDay)));
}

/** Short line name for display: "ＪＲ山手線外回り・新宿・池袋方面" → "ＪＲ山手線外回り". */
export function shortLineName(line: string): string {
  return line.split('・')[0];
}
