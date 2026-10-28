/**
 * Train timetable lookups. This is the only place the app gets last/first
 * train times from. Real times come from the LastRide API server (its ODPT
 * timetable) and, on iOS, Apple Maps for routes ODPT doesn't cover;
 * in development builds with no server it falls back to fixed sample times
 * flagged `source: 'sample'`, which the UI labels so they are never mistaken
 * for a real schedule. Production builds never use sample times: without a
 * server, lookups fail and the UI reports train times as unavailable.
 */
import { getFirstTrain as fetchFirstTrain, getLastTrain as fetchLastTrain, type GetLastTrainParams, type TrainRoute } from '@workspace/api-client-react';
import { apiBaseUrl, isDevelopment } from '@/lib/api';
import { appleFirstTrain, appleLastTrain, appleTrainsBefore, appleTransitEnabled, EARLIER_TRAIN_COUNT } from '@/lib/appleTransit';
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
  /** 'apple': MapKit transit ETA — times only, no legs, line or fare. */
  source: 'sample' | 'live' | 'apple';
  /** Apple's answer may be a walk rather than a train (see lib/appleTransit.ts); shown as 目安. */
  approximate?: boolean;
  /**
   * Apple only: `arrivesAt` is the train's arrival at the station. Without it,
   * Apple's arrival may include a walk out to the station's map point (shown
   * as "out of the station").
   */
  arrivesAtStation?: boolean;
  /**
   * Last trains only: the trains before this one tonight (1本前, 2本前), latest
   * first, within 2 hours of it. Undefined = not looked up yet
   * (Apple: fetched for the chosen station only); [] = none.
   */
  before?: TrainTime[];
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

function toTrainTime(route: TrainRoute & { earlier?: TrainRoute[] }): TrainTime {
  return {
    departsAt: Date.parse(route.departsAt),
    arrivesAt: Date.parse(route.arrivesAt),
    transfers: route.transfers,
    fareYen: route.fareYen,
    legs: route.legs.map((leg) => ({ ...leg, departsAt: Date.parse(leg.departsAt), arrivesAt: Date.parse(leg.arrivesAt) })),
    source: 'live',
    ...(route.earlier ? { before: route.earlier.map((train) => toTrainTime(train)) } : {}),
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

/**
 * Asks the server (LastRide's ODPT timetable) first: exact times with lines,
 * for the operators it covers. A route it doesn't cover (404), or a server
 * that can't be reached, goes to Apple Maps where available. Returns
 * `undefined` when the server couldn't answer at all, `null` for "no route".
 */
async function fromServer(request: () => Promise<TrainRoute>): Promise<TrainTime | null | undefined> {
  if (!apiBaseUrl) return undefined;
  try {
    return await lookup(request);
  } catch {
    return undefined;
  }
}

/**
 * ODPT covers only some operators, so its route can be earlier than one on JR
 * or a private railway (渋谷→池袋: 00:08 on the 副都心線, 00:33 on JR). Apple's
 * answer wins when it is later — unless it may be a walk (目安): then the exact
 * ODPT time stays, since leaving too early is the safe mistake.
 */
export function laterLastTrain(server: TrainTime, apple: TrainTime | null): TrainTime {
  return apple && !apple.approximate && apple.departsAt > server.departsAt ? apple : server;
}

/** Same for the first train: Apple's wins when it is earlier and not 目安. */
export function earlierFirstTrain(server: TrainTime, apple: TrainTime | null): TrainTime {
  return apple && !apple.approximate && apple.departsAt < server.departsAt ? apple : server;
}

/**
 * Apple failed on a route our server doesn't cover (JR, private railways): its
 * request limit or no connection. The planner keeps the station's last result if
 * it has one, else treats it as no train. (Builds from before the native module
 * told "no route" apart, ERR_ETA_NO_ROUTE, report both as failures.)
 */
export class AppleLookupFailed extends Error {}

/** The last departure from `from` tonight that still reaches `to`, or null if no train goes there. */
export async function getLastTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  let appleFailed = false;
  const [server, apple] = await Promise.all([
    // The server answers the trains before the last one too (1本前 / 2本前), at no extra cost.
    fromServer(() => fetchLastTrain({ ...toParams(from, to, nowMs), before: EARLIER_TRAIN_COUNT })),
    appleTransitEnabled
      ? appleLastTrain(from, to, nowMs).catch((error: unknown) => {
          // "No route" is an answer: no train from here. Only real failures count.
          if ((error as { code?: string } | null)?.code !== 'ERR_ETA_NO_ROUTE') appleFailed = true;
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (server) return laterLastTrain(server, apple);
  if (apple) return apple;
  if (server === null) {
    if (appleFailed) throw new AppleLookupFailed('Apple transit lookup failed');
    return null;
  }
  if (!apiBaseUrl) {
    requireServer();
    return { departsAt: serviceTimeToMs(SAMPLE_LAST_TRAIN, nowMs), source: 'sample' };
  }
  throw new Error('Train times are unavailable right now.');
}

/**
 * The trains before `last` (1本前, 2本前), latest first. The server sends them
 * with the last train; Apple's are asked for here, only for the station the
 * user is heading to, to stay well inside MapKit's request limits.
 */
export async function trainsBefore(from: StationOption, to: StationOption, last: TrainTime, nowMs: number): Promise<TrainTime[]> {
  if (last.before) return last.before;
  if (last.source !== 'apple' || !appleTransitEnabled) return [];
  return appleTrainsBefore(from, to, last, nowMs).catch(() => []);
}

/** The next first train from `from` toward `to` after `nowMs`, or null if no train goes there. */
export async function getFirstTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  // Usually today's first train has already left, so this is the next service day's.
  const nextServiceDay = serviceDayStart(nowMs) + 24 * 60 * 60 * 1000;
  let server = await fromServer(() => fetchFirstTrain(toParams(from, to, nowMs)));
  if (server && server.departsAt <= nowMs) server = await fromServer(() => fetchFirstTrain(toParams(from, to, nextServiceDay)));
  const apple = appleTransitEnabled ? await appleFirstTrain(from, to, nowMs).catch(() => null) : null;
  if (server) return earlierFirstTrain(server, apple);
  if (apple) return apple;
  if (server === null) return null;
  if (!apiBaseUrl) {
    requireServer();
    return { departsAt: nextOccurrence(SAMPLE_FIRST_TRAIN, nowMs), source: 'sample' };
  }
  throw new Error('Train times are unavailable right now.');
}

export function shortLineName(line: string): string {
  return line.split('・')[0];
}
