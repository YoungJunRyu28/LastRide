import type { NightPlan } from '@/lib/planner';

const MAX_SNAPSHOT_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

type Dict = Record<string, unknown>;
function isObject(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validCoordinate(value: unknown): boolean {
  return isObject(value) &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}
function validChoice(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.station) || !isObject(value.destination) ||
      !isObject(value.lastTrain)) return false;
  const { station, destination, lastTrain } = value;
  return typeof station.nameJa === 'string' && typeof station.name === 'string' &&
    typeof destination.nameJa === 'string' &&
    typeof value.leaveByMs === 'number' && Number.isFinite(value.leaveByMs) &&
    typeof value.walkingMinutes === 'number' && Number.isFinite(value.walkingMinutes) &&
    value.walkingMinutes >= 0 &&
    typeof lastTrain.departsAt === 'number' && Number.isFinite(lastTrain.departsAt);
}

/**
 * A snapshot is a cache, not a trusted live departure. Truncated, corrupt,
 * clock-skewed and obsolete snapshots must never keep background tracking in
 * its stale-plan state or call trackingEndsAt() with undefined train dates.
 */
export function usableTrackingSnapshot(value: unknown, nowMs = Date.now()): value is NightPlan {
  if (!isObject(value) || !validChoice(value) ||
      typeof value.computedAt !== 'number' || !Number.isFinite(value.computedAt) ||
      nowMs - value.computedAt > MAX_SNAPSHOT_AGE_MS ||
      value.computedAt - nowMs > MAX_FUTURE_SKEW_MS ||
      !validCoordinate(value.coordinates) || typeof value.pinned !== 'boolean' ||
      !Array.isArray(value.alternatives) ||
      !value.alternatives.every(validChoice) || !validChoice(value.autoPick)) return false;
  return true;
}
