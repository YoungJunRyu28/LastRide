/**
 * Walking and taxi estimates from straight-line distance, for Android and as
 * a fallback for iOS (which asks Apple MapKit on the device). No routing
 * provider is called. The 30% (walking) and 35% (driving) multipliers are
 * heuristics, NOT verified walkable paths or safe last-train ETAs. Barriers,
 * river crossings and station entrances can make actual routes much longer.
 * Callers must expose the estimate provenance and leave precautionary time.
 *
 * The taxi fare matches the app's own fallback (estimateTaxiFare in
 * artifacts/last-ride/app/alternatives.tsx); keep the two in step.
 */
import { distanceMeters } from "./transit/transfers";

/** Walking speed (km/h) for each pace setting. */
export const WALK_SPEED_KMH = { relaxed: 3.8, normal: 4.8, fast: 5.8 } as const;
export type Pace = keyof typeof WALK_SPEED_KMH;

/** Walking routes are about 30% longer than the straight line. */
export const WALK_ROUTE_FACTOR = 1.3;
/** Roads are about 35% longer than the straight line. */
export const TAXI_ROAD_FACTOR = 1.35;
/** Average door-to-door taxi speed in the city at night. */
export const TAXI_SPEED_KMH = 25;
/** Waiting for / hailing the taxi. */
export const TAXI_PICKUP_MINUTES = 2;

/** Tokyo-area meter: ¥500 for the first 1.096 km, then ¥100 per 255 m. */
const METER_BASE_YEN = 500;
const METER_BASE_METERS = 1_096;
const METER_STEP_YEN = 100;
const METER_STEP_METERS = 255;
/** 20% late-night surcharge between 22:00 and 05:00. */
const LATE_NIGHT_MULTIPLIER = 1.2;

export type Point = { latitude: number; longitude: number };
export type WalkRoute = { distanceMeters: number; minutes: number };
export type TaxiEstimate = {
  distanceMeters: number;
  minutes: number;
  fareYen: number | null;
};

function straightMeters(from: Point, to: Point): number {
  return distanceMeters(
    { lat: from.latitude, lon: from.longitude },
    { lat: to.latitude, lon: to.longitude },
  );
}

/** Minutes to walk `meters` (already along the route) at `pace`, at least 1. */
export function walkingMinutes(meters: number, pace: Pace): number {
  const metersPerMinute = (WALK_SPEED_KMH[pace] * 1000) / 60;
  return Math.max(1, Math.ceil(meters / metersPerMinute));
}

/** Estimated walking route: straight line × 1.3 at the pace's speed. */
export function walkEstimate(from: Point, to: Point, pace: Pace): WalkRoute {
  const meters = Math.round(straightMeters(from, to) * WALK_ROUTE_FACTOR);
  return { distanceMeters: meters, minutes: walkingMinutes(meters, pace) };
}

/** Meter fare in yen for a road distance, before any surcharge. */
export function meterFareYen(roadMeters: number): number {
  const steps = Math.ceil(
    Math.max(0, roadMeters - METER_BASE_METERS) / METER_STEP_METERS,
  );
  return METER_BASE_YEN + steps * METER_STEP_YEN;
}

/** JST hour of "YYYY-MM-DDThh:mm:ss" (already Japan time), or of now. */
function jstHour(startTime: string | undefined, nowMs: number): number {
  const hour = startTime ? Number(startTime.slice(11, 13)) : NaN;
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;
  return new Date(nowMs + 9 * 60 * 60 * 1000).getUTCHours();
}

export function isLateNightHour(hour: number): boolean {
  return hour >= 22 || hour < 5;
}

/**
 * Estimated taxi: straight line × 1.35 road factor, Tokyo-area meter, +20%
 * from 22:00 to 05:00 JST (at `startTime`, Japan time, when given), and
 * minutes at ~25 km/h plus 2 minutes to get the taxi. Tolls are excluded.
 */
export function taxiEstimate(
  from: Point,
  to: Point,
  startTime?: string,
  nowMs = Date.now(),
): TaxiEstimate {
  const roadMeters = Math.round(straightMeters(from, to) * TAXI_ROAD_FACTOR);
  const metered = meterFareYen(roadMeters);
  const lateNight = isLateNightHour(jstHour(startTime, nowMs));
  const fareYen = lateNight
    ? Math.round(metered * LATE_NIGHT_MULTIPLIER)
    : metered;
  const minutes =
    Math.ceil((roadMeters / 1000 / TAXI_SPEED_KMH) * 60) + TAXI_PICKUP_MINUTES;
  return { distanceMeters: roadMeters, minutes, fareYen };
}
