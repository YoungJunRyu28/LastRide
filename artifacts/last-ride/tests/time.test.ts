/**
 * Tests for the Japan-time / service-day helpers.
 *
 * This is the riskiest arithmetic in the app: everything downstream (when to
 * leave, when the last train has gone, when the night is over) is derived from
 * it, and an off-by-one here is invisible until 00:30 on a weeknight.
 *
 * Two rules are being pinned down:
 *   - JST is always UTC+9, regardless of the device's own time zone.
 *   - A rail "service day" starts at 04:00, so a 00:31 train belongs to the
 *     previous evening.
 */
import { describe, expect, test } from 'vitest';
import {
  MINUTE_MS,
  formatDuration,
  formatJstDateTime,
  formatJstTime,
  jstDate,
  minutesUntil,
  nextOccurrence,
  serviceDate,
  serviceDayStart,
  serviceTimeToMs,
} from '@/lib/time';

/** A Japan wall-clock time as epoch ms. JST is UTC+9, so subtract 9 hours. */
function jst(year: number, month: number, day: number, hours: number, minutes = 0) {
  return Date.UTC(year, month - 1, day, hours - 9, minutes);
}

describe('the service day', () => {
  test('starts at 04:00 JST', () => {
    // 04:00 exactly starts its own service day.
    expect(serviceDayStart(jst(2026, 9, 23, 4, 0))).toBe(jst(2026, 9, 23, 4, 0));
    // Late evening belongs to the day it started on.
    expect(serviceDayStart(jst(2026, 9, 23, 23, 59))).toBe(jst(2026, 9, 23, 4, 0));
  });

  test('still counts after midnight as the previous evening', () => {
    // 02:00 on the 23rd is still the night of the 22nd.
    expect(serviceDayStart(jst(2026, 9, 23, 2, 0))).toBe(jst(2026, 9, 22, 4, 0));
    // 03:59 is the last minute of the previous service day.
    expect(serviceDayStart(jst(2026, 9, 23, 3, 59))).toBe(jst(2026, 9, 22, 4, 0));
  });

  test('rolls over across a month boundary', () => {
    // 01:30 on 1 October is the night of 30 September.
    expect(serviceDayStart(jst(2026, 10, 1, 1, 30))).toBe(jst(2026, 9, 30, 4, 0));
  });

  test('gives the date a timetable query should use', () => {
    expect(serviceDate(jst(2026, 9, 23, 2, 0))).toBe('20260922');
    expect(serviceDate(jst(2026, 9, 23, 5, 0))).toBe('20260923');
    expect(serviceDate(jst(2026, 9, 23, 23, 30))).toBe('20260923');
  });
});

describe('the calendar date in Japan', () => {
  test('changes at midnight, not at the 04:00 service-day start', () => {
    expect(jstDate(jst(2026, 10, 13, 23, 59))).toBe('2026-10-13');
    expect(jstDate(jst(2026, 10, 14, 0, 30))).toBe('2026-10-14');
    expect(serviceDate(jst(2026, 10, 14, 0, 30))).toBe('20261013');
  });
});

describe('placing a timetable time', () => {
  test('a past-midnight time lands on the following calendar day', () => {
    const now = jst(2026, 9, 23, 23, 0);
    // 00:31 is after tonight, not 23 hours ago.
    expect(serviceTimeToMs('00:31', now)).toBe(jst(2026, 9, 24, 0, 31));
    // An evening time stays on the same calendar day.
    expect(serviceTimeToMs('23:52', now)).toBe(jst(2026, 9, 23, 23, 52));
  });

  test('times anchor to the service day, not the clock day', () => {
    // Asked at 01:00 on the 24th — still the night of the 23rd, so the 00:31
    // train is the one that has just gone, not tomorrow's.
    const afterMidnight = jst(2026, 9, 24, 1, 0);
    expect(serviceTimeToMs('00:31', afterMidnight)).toBe(jst(2026, 9, 24, 0, 31));
  });

  test('nextOccurrence finds the next time the clock reads HH:MM', () => {
    const now = jst(2026, 9, 23, 23, 0);
    expect(nextOccurrence('23:52', now)).toBe(jst(2026, 9, 23, 23, 52));
    // A morning time rolls to tomorrow.
    expect(nextOccurrence('05:04', now)).toBe(jst(2026, 9, 24, 5, 4));
    // The current minute counts as the next occurrence.
    expect(nextOccurrence('23:00', now)).toBe(now);
  });
});

describe('formatting', () => {
  test('minutesUntil rounds down and goes negative once the moment has passed', () => {
    const now = jst(2026, 9, 23, 23, 0);
    expect(minutesUntil(now + 90 * 1000, now)).toBe(1);
    expect(minutesUntil(now + 59 * 1000, now)).toBe(0);
    expect(minutesUntil(now - MINUTE_MS, now)).toBe(-1);
  });

  test('times render in Japan time, not the device time zone', () => {
    expect(formatJstTime(jst(2026, 9, 24, 0, 31))).toBe('00:31');
    expect(formatJstTime(jst(2026, 9, 23, 23, 52))).toBe('23:52');
    // The API's taxi startTime is local Japan time with no offset.
    expect(formatJstDateTime(jst(2026, 9, 24, 0, 31))).toBe('2026-09-24T00:31:00');
  });

  test('durations read naturally in both languages', () => {
    expect(formatDuration(0, false)).toBe('0 min');
    expect(formatDuration(59, false)).toBe('59 min');
    expect(formatDuration(60, false)).toBe('1h 0m');
    expect(formatDuration(95, false)).toBe('1h 35m');
    expect(formatDuration(95, true)).toBe('1時間35分');
    expect(formatDuration(35, true)).toBe('35分');
    // A negative duration never shows as negative.
    expect(formatDuration(-5, false)).toBe('0 min');
  });
});
