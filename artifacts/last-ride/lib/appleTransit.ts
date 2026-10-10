/**
 * Train times from Apple Maps (MapKit transit ETAs), iOS only.
 *
 * One request per station: "arrive at the destination by 03:00" returns the
 * latest trip that still gets there — tonight's last train — and its
 * departure. MapKit gives times only (no line, legs or fare), so plans from
 * this source show less detail. On by EXPO_PUBLIC_TRANSIT_PROVIDER=apple in a
 * build with modules/apple-maps; otherwise the server timetable is used.
 *
 * Apple's terms: show results with an Apple map and don't keep them past the
 * night. Nothing here is persisted beyond the night's plan.
 */
import { AppleMaps } from '@/modules/apple-maps/src';
import type { StationOption } from '@/lib/stations';
import type { TrainTime } from '@/lib/timetable';
import { HOUR_MS, serviceDayStart } from '@/lib/time';

export const appleTransitEnabled = AppleMaps !== null && process.env.EXPO_PUBLIC_TRANSIT_PROVIDER === 'apple';

/** 03:00 at the end of the service day that `nowMs` falls in (service days start at 04:00). */
export function lastTrainArriveBy(nowMs: number): number {
  return serviceDayStart(nowMs) + 23 * HOUR_MS;
}

function point(station: StationOption) {
  return { latitude: station.latitude, longitude: station.longitude };
}

/**
 * MapKit's transit ETA counts walking as a trip: when walking is the latest
 * way to arrive by the cutoff (short distances after the last train), it
 * answers with the walk. Its response doesn't say which, so compare with the
 * walking time — a "transit" trip not clearly faster than walking is a walk.
 */
export function looksLikeWalking(transitSeconds: number, walkingSeconds: number): boolean {
  return transitSeconds >= walkingSeconds * 0.85;
}

async function isWalkingOnly(from: StationOption, to: StationOption, transitSeconds: number): Promise<boolean> {
  if (!AppleMaps) return false;
  const walk = await AppleMaps.walkingRoute(point(from), point(to)).catch(() => null);
  // No walking route (e.g. across water): it can't have been a walk.
  return walk !== null && looksLikeWalking(transitSeconds, walk.seconds);
}

export async function appleLastTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  if (!AppleMaps) return null;
  const arriveBy = lastTrainArriveBy(nowMs);
  // Past the cutoff MapKit doesn't say "none"; it answers with a later trip. Use the server then.
  if (nowMs >= arriveBy) return null;
  const eta = await AppleMaps.transitEta({ from: point(from), to: point(to), arriveBy });
  // Not tonight's last train: it left before this service day began, or misses the cutoff.
  if (eta.departureMs < serviceDayStart(nowMs) || eta.arrivalMs > arriveBy) return null;
  if (await isWalkingOnly(from, to, eta.travelSeconds)) return null;
  return { departsAt: eta.departureMs, arrivesAt: eta.arrivalMs, source: 'apple' };
}

export async function appleFirstTrain(from: StationOption, to: StationOption, nowMs: number): Promise<TrainTime | null> {
  if (!AppleMaps) return null;
  const eta = await AppleMaps.transitEta({ from: point(from), to: point(to), departAt: nowMs });
  return { departsAt: eta.departureMs, arrivesAt: eta.arrivalMs, source: 'apple' };
}
