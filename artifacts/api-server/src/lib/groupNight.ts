/**
 * Night window for a group's "tonight".
 *
 * Japan rail service days roll over at 04:00 JST, so a night activated at
 * 22:00 and one activated at 01:00 the next morning belong to the same
 * service date. A night ends automatically at 08:00 JST the following
 * morning. JST has no daylight saving, so fixed +9h arithmetic is exact.
 */
const HOUR_MS = 60 * 60_000;
const JST_OFFSET_HOURS = 9;
const SERVICE_DAY_START_HOUR_JST = 4;
const NIGHT_END_HOUR_JST = 8;

/** Service date (YYYY-MM-DD) for the given instant. */
export function serviceDateFor(now: Date): string {
  const shifted = new Date(
    now.getTime() + (JST_OFFSET_HOURS - SERVICE_DAY_START_HOUR_JST) * HOUR_MS,
  );
  return shifted.toISOString().slice(0, 10);
}

/**
 * The window a night covers: from the start of its service day (04:00 JST)
 * to 08:00 JST the following morning. Leave-by times must fall inside it.
 */
export function nightWindow(serviceDate: string): {
  startsAt: Date;
  endsAt: Date;
} {
  const [year, month, day] = serviceDate.split("-").map(Number);
  return {
    startsAt: new Date(
      Date.UTC(year, month - 1, day, SERVICE_DAY_START_HOUR_JST - JST_OFFSET_HOURS),
    ),
    endsAt: new Date(
      Date.UTC(year, month - 1, day + 1, NIGHT_END_HOUR_JST - JST_OFFSET_HOURS),
    ),
  };
}

export function isLeaveByInNight(leaveBy: Date, serviceDate: string): boolean {
  const { startsAt, endsAt } = nightWindow(serviceDate);
  const value = leaveBy.getTime();
  return value >= startsAt.getTime() && value <= endsAt.getTime();
}
