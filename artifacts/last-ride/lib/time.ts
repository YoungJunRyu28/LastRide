/**
 * Japan-time helpers. All app times are epoch milliseconds; these convert to and
 * from what a rail timetable shows.
 *
 * Japan has no daylight saving, so JST is always UTC+9 — computing it by offset
 * keeps times correct even when the phone is set to another time zone.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;

/**
 * Rail timetables run on a "service day" that rolls over in the early morning:
 * a 00:31 last train belongs to the previous evening's service.
 */
const SERVICE_DAY_START_HOUR = 4;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** Wall-clock parts of an instant in Japan time. */
function jstParts(ms: number) {
  const shifted = new Date(ms + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/** "HH:MM" in Japan time. */
export function formatJstTime(ms: number): string {
  const { hours, minutes } = jstParts(ms);
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Japan local date-time without offset, "YYYY-MM-DDThh:mm:ss" — the format NAVITIME expects. */
export function formatJstDateTime(ms: number): string {
  const { year, month, day, hours, minutes } = jstParts(ms);
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
}

/** Start (04:00 JST) of the service day that `nowMs` falls in. */
export function serviceDayStart(nowMs: number): number {
  const { year, month, day } = jstParts(nowMs);
  const start = Date.UTC(year, month, day) - JST_OFFSET_MS + SERVICE_DAY_START_HOUR * HOUR_MS;
  return nowMs < start ? start - DAY_MS : start;
}

/** Service date as YYYYMMDD — the date a timetable query should use. */
export function serviceDate(nowMs: number): string {
  const { year, month, day } = jstParts(serviceDayStart(nowMs));
  return `${year}${pad(month + 1)}${pad(day)}`;
}

function timetableMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

/** A timetable "HH:MM" placed within the current service day (e.g. "00:31" → after midnight tonight). */
export function serviceTimeToMs(hhmm: string, nowMs: number): number {
  const minutesAfterStart = (timetableMinutes(hhmm) - SERVICE_DAY_START_HOUR * 60 + 1440) % 1440;
  return serviceDayStart(nowMs) + minutesAfterStart * MINUTE_MS;
}

/** The next time the clock reads "HH:MM" in Japan, at or after `nowMs`. */
export function nextOccurrence(hhmm: string, nowMs: number): number {
  const { year, month, day } = jstParts(nowMs);
  const candidate = Date.UTC(year, month, day) - JST_OFFSET_MS + timetableMinutes(hhmm) * MINUTE_MS;
  return candidate >= nowMs ? candidate : candidate + DAY_MS;
}

/** Whole minutes from `fromMs` to `toMs`, rounded down (negative once `toMs` has passed). */
export function minutesUntil(toMs: number, fromMs: number): number {
  return Math.floor((toMs - fromMs) / MINUTE_MS);
}

export function formatDuration(minutes: number, ja: boolean): string {
  const safe = Math.max(0, minutes);
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return ja ? `${rest}分` : `${rest} min`;
  return ja ? `${hours}時間${rest}分` : `${hours}h ${rest}m`;
}
