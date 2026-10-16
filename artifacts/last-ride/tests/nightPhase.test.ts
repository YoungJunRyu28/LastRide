import { describe, expect, test } from 'vitest';
import type { NightPlan } from '@/lib/planner';
import { nightPhases, phaseAt, phaseLabel, railStops, stopLabel, stopState } from '@/lib/nightPhase';
import { applyTrainChoice, trainOptions } from '@/lib/trainChoice';
import type { TrainTime } from '@/lib/timetable';
import { MINUTE_MS } from '@/lib/time';

function jst(hours: number, minutes = 0) {
  return Date.UTC(2026, 9, 9, hours - 9, minutes);
}

function train(dep: number, arr: number, before?: TrainTime[]): TrainTime {
  return { departsAt: dep, arrivesAt: arr, source: 'live', ...(before ? { before } : {}) };
}

const shibuya = { name: 'Shibuya', nameJa: '渋谷', latitude: 35.658, longitude: 139.701 };
const kikuna = { name: 'Kikuna', nameJa: '菊名', latitude: 35.51, longitude: 139.63 };

// Last 23:45 (leave 23:36); 1本前 23:36 (leave 23:27); 2本前 23:27 (leave 23:18).
const last = train(jst(23, 45), jst(24, 37), [train(jst(23, 36), jst(24, 28)), train(jst(23, 27), jst(24, 19))]);

function night(): NightPlan {
  const leaveByMs = last.departsAt - 5 * MINUTE_MS;
  const base = {
    station: shibuya,
    walkingMinutes: 2,
    distanceMeters: 150,
    lastTrain: last,
    leaveByMs,
    safetyMarginMinutes: 4,
    recommendedLeaveByMs: leaveByMs - 4 * MINUTE_MS,
    destination: kikuna,
  };
  return { ...base, coordinates: shibuya, alternatives: [], autoPick: base, pinned: false, computedAt: jst(23, 0) };
}

function chosen(choice: 1 | 2) {
  return applyTrainChoice(night(), trainOptions(night(), 4, jst(23, 0)), choice);
}

describe('the night phases', () => {
  test('last train: leave, then the train, then nothing', () => {
    const phases = nightPhases(night(), jst(23, 0));
    expect(phases.map((p) => [p.kind, p.countdownTo])).toEqual([
      ['leave', jst(23, 36)],
      ['train', jst(23, 45)],
    ]);
    expect(phaseAt(night(), jst(23, 45))).toBeNull();
  });

  test('2本前: after its departure the count moves to 1本前, then 終電', () => {
    const phases = nightPhases(chosen(2), jst(23, 0));
    expect(phases.map((p) => [p.kind, p.countdownTo, p.plan.trainChoice ?? 0])).toEqual([
      ['leave', jst(23, 18), 2],
      ['train', jst(23, 27), 2],
      // 1本前's leave time (23:27) has passed by the time 2本前 departs: straight to its train.
      ['train', jst(23, 36), 1],
      ['train', jst(23, 45), 0],
    ]);
    expect(phases[3].last).toBe(true);
  });

  test('the same phase at the same moment, from any starting point', () => {
    const plan = chosen(1);
    const at = jst(23, 30);
    const whole = nightPhases(plan, jst(22, 0)).find((p) => p.from <= at && at < p.until)!;
    const now = phaseAt(plan, at)!;
    expect([now.kind, now.countdownTo, now.until, now.plan]).toEqual([whole.kind, whole.countdownTo, whole.until, whole.plan]);
  });

  test('labels say who is leaving: 出る for the user, 発 for the train', () => {
    const plan = chosen(1);
    expect(phaseLabel(phaseAt(plan, jst(23, 0))!, true)).toEqual({ label: 'ここを出るまで', island: '出るまで' });
    expect(phaseLabel(phaseAt(plan, jst(23, 30))!, true)).toEqual({ label: '23:36発まで', island: '23:36発' });
    expect(phaseLabel(phaseAt(plan, jst(23, 40))!, true)).toEqual({ label: '終電 23:45発まで', island: '終電' });
    expect(phaseLabel(phaseAt(plan, jst(23, 40))!, false)).toEqual({ label: 'Last train 23:45 in', island: 'Last train' });
    expect(phaseLabel(phaseAt(plan, jst(23, 30))!, false).island).toBe('Train in');
  });
});

describe('the timeline rail', () => {
  test('two stops with the last train chosen; leave, trains and 終電 otherwise', () => {
    expect(railStops(night()).map((s) => s.kind)).toEqual(['leave', 'last']);
    expect(railStops(chosen(2)).map((s) => [s.kind, s.at, s.choice])).toEqual([
      ['leave', jst(23, 18), undefined],
      ['train', jst(23, 27), 2],
      ['train', jst(23, 36), 1],
      ['last', jst(23, 45), undefined],
    ]);
  });

  test('marks what has passed and what is being counted to', () => {
    const plan = chosen(1);
    const states = (at: number) => railStops(plan).map((stop) => stopState(stop, phaseAt(plan, at), at));
    expect(states(jst(23, 0))).toEqual(['next', 'later', 'later']);
    expect(states(jst(23, 30))).toEqual(['done', 'next', 'later']);
    expect(states(jst(23, 40))).toEqual(['done', 'done', 'next']);
    const [leave, train1] = railStops(plan);
    expect(stopLabel(leave, 'next', true)).toEqual({ label: '出る', short: '出る 23:27' });
    expect(stopLabel(train1, 'later', true)).toEqual({ label: '1本前', short: '23:36発' });
    expect(stopLabel(train1, 'done', false).label).toBe('Gone');
  });
});
