/**
 * Train times from Apple Maps (MapKit transit ETAs), iOS only.
 *
 * "Arrive at the destination by 03:00" returns the latest trip that still
 * gets there — tonight's last train — and its departure. MapKit gives times
 * only (no line, legs or fare), so plans from this source show less detail.
 * Used for routes the server's ODPT timetable doesn't cover (JR, private
 * railways), in iOS builds with modules/apple-maps;
 * EXPO_PUBLIC_TRANSIT_PROVIDER=server turns it off.
 *
 * MapKit's transit ETA also counts walking as a trip: over short distances
 * after the last train, the latest way to arrive by 03:00 is to walk, and it
 * answers with the walk (関内→みなとみらい: "02:27", two hours after the real
 * last train). The response doesn't say which it is, but trains run at fixed
 * times and walks don't: ask again 7 minutes earlier, and a walk moves with
 * the deadline while a train stays put. When the answer is a walk, move the
 * deadline back past it and ask again until a train turns up.
 *
 * Apple's terms: show results with an Apple map and don't keep them past the
 * night. Nothing here is persisted beyond the night's plan.
 */
import { AppleMaps } from '@/modules/apple-maps/src';
import type { StationOption } from '@/lib/stations';
import type { TrainTime } from '@/lib/timetable';
import { HOUR_MS, MINUTE_MS, serviceDayStart } from '@/lib/time';

export const appleTransitEnabled = AppleMaps !== null && process.env.EXPO_PUBLIC_TRANSIT_PROVIDER !== 'server';

export type Eta = { departureMs: number; arrivalMs: number; arrivesAtStation?: boolean };
export type EtaQuery = (when: { arriveBy?: number; departAt?: number }) => Promise<Eta>;

/** How far apart the two questions are when checking for a walk. */
const PROBE_MS = 7 * MINUTE_MS;
/** A walk arrives right at the deadline (or leaves right away); a train usually doesn't. */
const NEAR_MS = 2 * MINUTE_MS;
/** Tolerance when comparing how far an answer moved. */
const SLACK_MS = MINUTE_MS;
/** Most questions per lookup, so a walkable route can't run up MapKit's request limit. */
const MAX_STEPS = 6;

/** 03:00 at the end of the service day that `nowMs` falls in (service days start at 04:00). */
export function lastTrainArriveBy(nowMs: number): number {
  return serviceDayStart(nowMs) + 23 * HOUR_MS;
}

/** Whether `eta`, the answer for "arrive by `arriveBy`", is a walk rather than a train. */
async function isWalkArriving(query: EtaQuery, eta: Eta, arriveBy: number): Promise<boolean | null> {
  if (arriveBy - eta.arrivalMs > NEAR_MS) return false;
  const probe = await query({ arriveBy: arriveBy - PROBE_MS }).catch(() => null);
  if (!probe) return null;
  return Math.abs(eta.departureMs - probe.departureMs - PROBE_MS) <= SLACK_MS;
}

/** Whether `eta`, the answer for "leave at `departAt`", is a walk rather than a train. */
async function isWalkLeaving(query: EtaQuery, eta: Eta, departAt: number): Promise<boolean | null> {
  if (eta.departureMs - departAt > NEAR_MS) return false;
  const probe = await query({ departAt: departAt + PROBE_MS }).catch(() => null);
  if (!probe) return null;
  return Math.abs(probe.departureMs - eta.departureMs - PROBE_MS) <= SLACK_MS;
}

/**
 * Tonight's last train by asking `query`, stepping the deadline back past
 * walking answers. Null when there's no train left to find (or none tonight).
 * An answer that couldn't be checked is returned as approximate (目安).
 */
export async function searchLastTrain(query: EtaQuery, nowMs: number): Promise<Omit<TrainTime, 'source'> | null> {
  const dayStart = serviceDayStart(nowMs);
  // Trains arriving before this left long before anyone needs a last train.
  const floor = dayStart + 18 * HOUR_MS;
  let arriveBy = lastTrainArriveBy(nowMs);
  for (let step = 0; step < MAX_STEPS; step++) {
    // Past the deadline MapKit doesn't say "none"; it answers with a later trip.
    if (arriveBy <= nowMs || arriveBy < floor) return null;
    const eta = await query({ arriveBy });
    // Not tonight's: it left before this service day began, or misses the deadline.
    if (eta.departureMs < dayStart || eta.arrivalMs > arriveBy + SLACK_MS) return null;
    const walk = await isWalkArriving(query, eta, arriveBy);
    if (walk === null) return { ...times(eta), approximate: true };
    if (!walk) return times(eta);
    // A train must arrive before this walk would have to set out.
    arriveBy = eta.departureMs;
  }
  return null;
}

/**
 * When to start looking for a first train from `ms`: no earlier than 04:00,
 * since nothing runs between the last trains and then (and asking MapKit at
 * 01:00 would only find walks).
 */
export function firstTrainSearchStart(ms: number): number {
  const dayStart = serviceDayStart(ms);
  // From 20:00 (around the earliest last trains) until 04:00, the next first train is the morning's.
  const morning = dayStart + 24 * HOUR_MS;
  return ms >= dayStart + 16 * HOUR_MS ? Math.max(ms, morning) : ms;
}

/** The next first train by asking `query`, stepping the start forward past walking answers. */
export async function searchFirstTrain(query: EtaQuery, nowMs: number): Promise<Omit<TrainTime, 'source'> | null> {
  let departAt = firstTrainSearchStart(nowMs);
  for (let step = 0; step < MAX_STEPS; step++) {
    const eta = await query({ departAt });
    const walk = await isWalkLeaving(query, eta, departAt);
    if (walk === null) return { ...times(eta), approximate: true };
    if (!walk) return times(eta);
    // A walk beats any train leaving soon; a train only wins once it leaves well after now.
    departAt += 15 * MINUTE_MS;
  }
  return null;
}

/** Both names, so MapKit can match the station whatever language it answers in. */
export function stationNames(station: { name?: string; nameJa?: string }): string[] {
  return [station.nameJa, station.name].filter((name): name is string => !!name?.trim());
}

function times(eta: Eta): Omit<TrainTime, 'source'> {
  return { departsAt: eta.departureMs, arrivesAt: eta.arrivalMs, ...(eta.arrivesAtStation ? { arrivesAtStation: true } : {}) };
}

function etaQuery(from: StationOption, to: StationOption): EtaQuery | null {
  const maps = AppleMaps;
  if (!maps) return null;
  // Named, so MapKit routes between the station places: arrival is then when the train gets in.
  const origin = { latitude: from.latitude, longitude: from.longitude, stationNames: stationNames(from) };
  const destination = { latitude: to.latitude, longitude: to.longitude, stationNames: stationNames(to) };
  return (when) => maps.transitEta({ from: origin, to: destination, ...when });
}

export async function appleLastTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  const query = etaQuery(from, to);
  const found = query ? await searchLastTrain(query, nowMs) : null;
  return found ? { ...found, source: 'apple' } : null;
}

export async function appleFirstTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  const query = etaQuery(from, to);
  const found = query ? await searchFirstTrain(query, nowMs) : null;
  return found ? { ...found, source: 'apple' } : null;
}
