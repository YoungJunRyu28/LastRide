/** Run-time timetable freshness gate. A deploy-time snapshot preflight does not
 * stop a long-running server from serving outdated train schedules weeks later.
 * Failing closed makes /trains routes return 503 so iOS can fall back to MapKit.
 * Freshness is not a guarantee of licensed operator coverage or live disruption.
 */
export const DEFAULT_TRANSIT_MAX_AGE_DAYS = 30;
export const TRANSIT_FUTURE_TOLERANCE_MS = 15 * 60_000;

export function maxTransitSnapshotAgeDays(configured: string | undefined): number {
  if (configured === undefined || configured.trim() === '') return DEFAULT_TRANSIT_MAX_AGE_DAYS;
  const days = Number(configured);
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    throw new Error('TRANSIT_SNAPSHOT_MAX_AGE_DAYS must be between 0 and 365');
  }
  return days;
}

export function assertRuntimeTransitFresh(
  generatedAt: unknown,
  nowMs = Date.now(),
  maxAgeDays = DEFAULT_TRANSIT_MAX_AGE_DAYS,
): void {
  if (typeof generatedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(generatedAt) ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(generatedAt)) {
    throw new Error('Timetable snapshot has no timezone-aware generatedAt');
  }
  const createdMs = Date.parse(generatedAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs) ||
      !Number.isFinite(maxAgeDays) || maxAgeDays <= 0 || maxAgeDays > 365) {
    throw new Error('Timetable freshness metadata is invalid');
  }
  if (createdMs > nowMs + TRANSIT_FUTURE_TOLERANCE_MS) {
    throw new Error('Timetable snapshot timestamp is in the future');
  }
  if (nowMs - createdMs > maxAgeDays * 86400000) {
    throw new Error('Timetable snapshot is expired; new timetable data required');
  }
}
