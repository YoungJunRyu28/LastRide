import { describe, expect, test } from 'vitest';
import type { NightPlan } from '@/lib/planner';
import { holdOnTheWay, keepOnTheWay, onTheWay } from '@/lib/onTheWay';
import { shouldReplan } from '@/lib/planner';
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
// Last 23:45; 1本前 23:36. Walk 8 min + 3 min buffer; 余裕 4 min: 1本前 leave 23:21.
const last = train(jst(23, 45), jst(24, 37), [train(jst(23, 36), jst(24, 28))]);

function night(walkingMinutes = 8, station = shibuya, computedAt = jst(23, 0)): NightPlan {
  const leaveByMs = last.departsAt - (walkingMinutes + 3) * MINUTE_MS;
  const base = {
    station,
    walkingMinutes,
    distanceMeters: 600,
    lastTrain: last,
    leaveByMs,
    safetyMarginMinutes: 4,
    recommendedLeaveByMs: leaveByMs - 4 * MINUTE_MS,
    destination: kikuna,
  };
  return { ...base, coordinates: shibuya, alternatives: [], autoPick: base, pinned: false, computedAt };
}
const chosen = applyTrainChoice(night(), trainOptions(night(), 4, jst(23, 0)), 1);

describe('on the way', () => {
  test('from the leave time until the train departs', () => {
    expect(onTheWay(chosen, jst(23, 20))).toBe(false);
    expect(onTheWay(chosen, jst(23, 21))).toBe(true);
    expect(onTheWay(chosen, jst(23, 35))).toBe(true);
    expect(onTheWay(chosen, jst(23, 36))).toBe(false);
  });

  test('keeps the station and times as they are, with only the new position', () => {
    const here = { latitude: 35.6585, longitude: 139.7005 };
    const kept = keepOnTheWay(night(), here, jst(23, 25), jst(23, 36));
    expect(kept.leaveByMs).toBe(night().leaveByMs);
    expect(kept.station).toEqual(shibuya);
    expect(kept.lastTrain).toEqual(last);
    expect(kept.coordinates).toEqual(here);
    expect(kept.computedAt).toBe(jst(23, 25));
    expect(kept.frozenUntil).toBe(jst(23, 36));
  });

  test('holds until the train departs, then lets the night be re-planned from here', () => {
    const here = { latitude: 35.6585, longitude: 139.7005 };
    const kept = keepOnTheWay(night(), here, jst(23, 25), jst(23, 36));
    expect(holdOnTheWay(kept, chosen, jst(23, 30))).toBe(true);
    // 1本前 has gone: no hold for the plan carried over to the last train, and a re-plan is due at once.
    const lastTrainPlan = night();
    expect(holdOnTheWay(kept, lastTrainPlan, jst(23, 37))).toBe(false);
    expect(shouldReplan(kept, here, jst(23, 36))).toBe(true);
    expect(shouldReplan(kept, here, jst(23, 30))).toBe(false);
    // The fresh plan has no mark: past its own leave time it is held again.
    expect(holdOnTheWay(night(), lastTrainPlan, jst(23, 37))).toBe(true);
  });
});
