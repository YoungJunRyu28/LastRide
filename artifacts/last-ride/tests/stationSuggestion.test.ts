/**
 * The farther-station suggestion: what is suggested on screen, and when the
 * background task may send it as a notification (once a night per reason).
 */
import { describe, expect, test, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

import type { NightPlan, StationChoice } from '@/lib/planner';
import { markDismissed, markSeen, readSuggestionLog, shouldNotifySuggestion, stationSuggestion, suggestionText, type SuggestionLog } from '@/lib/stationSuggestion';
import { MINUTE_MS } from '@/lib/time';

const jst = (hours: number, minutes = 0) => Date.UTC(2026, 9, 9, hours - 9, minutes);
const NOW = jst(22);
const station = (name: string, nameJa: string) => ({ name, nameJa, latitude: 35.7, longitude: 139.7 });
const nishiwaseda = station('Nishi-Waseda', '西早稲田');
const takadanobaba = station('Takadanobaba', '高田馬場');
const mejiro = station('Mejiro', '目白');

/** A station whose recommended leave time is `leave` (no margin, to keep the numbers plain). */
function option(at: ReturnType<typeof station>, walkingMinutes: number, leave: number, extra: Partial<StationChoice> = {}): StationChoice {
  return {
    station: at,
    walkingMinutes,
    distanceMeters: walkingMinutes * 80,
    walkingSource: 'routed',
    lastTrain: { departsAt: leave + (walkingMinutes + 3) * MINUTE_MS, source: 'live' },
    leaveByMs: leave,
    recommendedLeaveByMs: leave,
    safetyMarginMinutes: 0,
    destination: station('Kikuna', '菊名'),
    ...extra,
  };
}

function plan(closest: StationChoice, others: StationChoice[], extra: Partial<NightPlan> = {}): NightPlan {
  return { ...closest, coordinates: { latitude: 35.7, longitude: 139.7 }, alternatives: others, autoPick: closest, pinned: false, computedAt: NOW, ...extra };
}

const close = option(nishiwaseda, 1, jst(23, 30));

describe('what is suggested', () => {
  test('a farther station 10+ minutes later is suggested; less is not', () => {
    expect(stationSuggestion(plan(close, [option(takadanobaba, 13, jst(23, 39))]), NOW)).toBeNull();
    const suggestion = stationSuggestion(plan(close, [option(takadanobaba, 13, jst(23, 40))]), NOW);
    expect(suggestion).toMatchObject({ reason: 'later', gainMinutes: 10, option: { station: { nameJa: '高田馬場' } } });
    expect(suggestionText(suggestion!, true).title).toBe('高田馬場駅なら終電で10分遅く出られます');
  });

  test('with several, the latest leave time wins (then the shorter walk)', () => {
    const suggestion = stationSuggestion(plan(close, [option(takadanobaba, 13, jst(23, 45)), option(mejiro, 18, jst(23, 55))]), NOW);
    expect(suggestion?.option.station.nameJa).toBe('目白');
    const tie = stationSuggestion(plan(close, [option(mejiro, 18, jst(23, 45)), option(takadanobaba, 13, jst(23, 45))]), NOW);
    expect(tie?.option.station.nameJa).toBe('高田馬場');
  });

  test('never a 目安 time, a walk over 20 minutes, a line with a service problem, or a leave time too close to act on', () => {
    expect(stationSuggestion(plan(close, [option(takadanobaba, 13, jst(24), { lastTrain: { departsAt: jst(24, 20), source: 'apple', approximate: true } })]), NOW)).toBeNull();
    expect(stationSuggestion(plan(close, [option(takadanobaba, 21, jst(24))]), NOW)).toBeNull();
    expect(stationSuggestion(plan(close, [option(takadanobaba, 13, jst(24), { disruptionLines: ['山手線'] })]), NOW)).toBeNull();
    // 23:28 now: 高田馬場's leave time (23:31) is 3 minutes away.
    const late = jst(23, 28);
    expect(stationSuggestion(plan(option(nishiwaseda, 1, jst(23, 20)), [option(takadanobaba, 13, jst(23, 31))]), late)).toBeNull();
  });

  test('none while a station is locked or on the way to the train', () => {
    const later = [option(takadanobaba, 13, jst(24))];
    expect(stationSuggestion(plan(close, later, { pinned: true }), NOW)).toBeNull();
    expect(stationSuggestion(plan(close, later, { frozenUntil: jst(23, 40) }), NOW)).toBeNull();
  });

  test('a service problem at the closest station: the clean route, even leaving earlier', () => {
    const disrupted = option(nishiwaseda, 1, jst(23, 30), { disruptionLines: ['副都心線'] });
    const suggestion = stationSuggestion(plan(disrupted, [option(takadanobaba, 13, jst(23, 25))]), NOW);
    expect(suggestion).toMatchObject({ reason: 'clean', gainMinutes: -5 });
    expect(suggestionText(suggestion!, true).body).toBe('徒歩13分 · 23:25に出る');
  });

  test('compares last trains, whatever train the user heads for', () => {
    // Heading for 2本前 from 西早稲田 (plan times 23:00), the automatic pick still holds its last train.
    const headed = { ...close, leaveByMs: jst(23), recommendedLeaveByMs: jst(23), trainChoice: 2 };
    const suggestion = stationSuggestion({ ...plan(close, [option(takadanobaba, 13, jst(23, 42))]), ...headed, autoPick: close }, NOW);
    expect(suggestion?.gainMinutes).toBe(12);
  });
});

describe('when it is sent as a notification', () => {
  const later = (gain: number) => stationSuggestion(plan(close, [option(takadanobaba, 13, jst(23, 30) + gain * MINUTE_MS)]), NOW)!;
  const log = (extra: Partial<SuggestionLog> = {}): SuggestionLog => ({ night: '20261009', notified: [], seen: [], dismissed: [], ...extra });
  const leaveAt = jst(23, 30);

  test('from 15 minutes later only (10–14 stays on screen)', () => {
    expect(shouldNotifySuggestion(later(14), log(), leaveAt, NOW)).toBe(false);
    expect(shouldNotifySuggestion(later(15), log(), leaveAt, NOW)).toBe(true);
  });

  test('once a night per reason, never for a station seen in the app or dismissed', () => {
    expect(shouldNotifySuggestion(later(20), log({ notified: ['later'] }), leaveAt, NOW)).toBe(false);
    expect(shouldNotifySuggestion(later(20), log({ notified: ['clean'] }), leaveAt, NOW)).toBe(true);
    expect(shouldNotifySuggestion(later(20), log({ seen: ['高田馬場'] }), leaveAt, NOW)).toBe(false);
    expect(shouldNotifySuggestion(later(20), log({ dismissed: ['高田馬場'] }), leaveAt, NOW)).toBe(false);
    // Another station seen: this one can still go out.
    expect(shouldNotifySuggestion(later(20), log({ seen: ['目白'] }), leaveAt, NOW)).toBe(true);
  });

  test('not in the last 10 minutes before the user’s own leave time', () => {
    expect(shouldNotifySuggestion(later(20), log(), NOW + 10 * MINUTE_MS, NOW)).toBe(true);
    expect(shouldNotifySuggestion(later(20), log(), NOW + 9 * MINUTE_MS, NOW)).toBe(false);
  });

  test('the record is per night', async () => {
    await markSeen('20261009', '高田馬場');
    await markDismissed('20261009', '目白');
    expect(await readSuggestionLog('20261009')).toEqual({ night: '20261009', notified: [], seen: ['高田馬場'], dismissed: ['目白'] });
    expect(await readSuggestionLog('20261010')).toEqual({ night: '20261010', notified: [], seen: [], dismissed: [] });
  });
});
