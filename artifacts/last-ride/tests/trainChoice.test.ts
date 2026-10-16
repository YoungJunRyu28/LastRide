import { describe, expect, test } from 'vitest';
import { buildReminderPlans, lastTrainLeftAt, missedCheckInAt, rideStatus, type NightPlan } from '@/lib/planner';
import { recommendedLeaveTime } from '@/lib/reliability';
import { applyTrainChoice, effectiveTrainChoice, trainOptions } from '@/lib/trainChoice';
import type { TrainTime } from '@/lib/timetable';
import { MINUTE_MS } from '@/lib/time';

/** Epoch ms for a Japan clock time on the night of 9 Oct 2026; 24:10 is 00:10 after midnight. */
function jst(hours: number, minutes = 0) {
  return Date.UTC(2026, 9, 9, hours - 9, minutes);
}

function train(dep: number, arr: number, before?: TrainTime[]): TrainTime {
  return { departsAt: dep, arrivesAt: arr, source: 'live', ...(before ? { before } : {}) };
}

const shibuya = { name: 'Shibuya', nameJa: '渋谷', latitude: 35.658, longitude: 139.701 };
const home = { name: 'Oshiage', nameJa: '押上', latitude: 35.71, longitude: 139.813 };

// Last 23:45; 1本前 23:36; 2本前 23:27. Walk 2 min + 3 min station buffer; 余裕 4 min.
const last = train(jst(23, 45), jst(24, 37), [train(jst(23, 36), jst(24, 28)), train(jst(23, 27), jst(24, 19))]);

function plan(lastTrain: TrainTime = last, walkingMinutes = 2): NightPlan {
  const leaveByMs = lastTrain.departsAt - (walkingMinutes + 3) * MINUTE_MS;
  const base = {
    station: shibuya,
    walkingMinutes,
    distanceMeters: 150,
    lastTrain,
    leaveByMs,
    safetyMarginMinutes: 4,
    recommendedLeaveByMs: leaveByMs - 4 * MINUTE_MS,
    destination: home,
  };
  return { ...base, coordinates: shibuya, alternatives: [], autoPick: base, pinned: false, computedAt: jst(23, 0) };
}

describe('the train options', () => {
  test('lists the last train and the two before it, each with its own leave time', () => {
    const options = trainOptions(plan(), 4, jst(23, 0));
    expect(options.map((option) => option.choice)).toEqual([0, 1, 2]);
    // 23:36 − (2 + 3) min = 23:31 latest; − 4 min 余裕 = 23:27.
    expect(options[1].station.leaveByMs).toBe(jst(23, 31));
    expect(recommendedLeaveTime(options[1].station)).toBe(jst(23, 27));
    expect(options[1].station.arriveHomeMs).toBe(jst(24, 28));
  });

  test('a station with no earlier trains offers only the last train', () => {
    expect(trainOptions(plan(train(jst(23, 45), jst(24, 37), [])), 4, jst(23, 0))).toHaveLength(1);
    // Not looked up yet (Apple): also just the last train for now.
    expect(trainOptions(plan(train(jst(23, 45), jst(24, 37))), 4, jst(23, 0))).toHaveLength(1);
  });
});

describe('falling back when a chosen train has left', () => {
  test('keeps the chosen train while its latest leave time is ahead', () => {
    const options = trainOptions(plan(), 4, jst(23, 30));
    expect(effectiveTrainChoice(options, 1)).toBe(1);
    expect(options[1].late).toBe(false);
  });

  test('keeps it after the leave time, on the way, until the train departs', () => {
    // 2本前 latest is 23:22, departs 23:27: at 23:25 still 2本前, marked late.
    const options = trainOptions(plan(), 4, jst(23, 25));
    expect(effectiveTrainChoice(options, 2)).toBe(2);
    expect(options[2].late).toBe(true);
  });

  test('moves to the next later train once the chosen one has departed', () => {
    expect(effectiveTrainChoice(trainOptions(plan(), 4, jst(23, 27)), 2)).toBe(1);
    // 1本前 departs 23:36: from then on, the last train.
    expect(effectiveTrainChoice(trainOptions(plan(), 4, jst(23, 36)), 2)).toBe(0);
  });

  test('a move to a farther station makes the chosen train late, not gone', () => {
    // Same trains, but now a 12-minute walk: 1本前 latest is 23:21.
    const options = trainOptions(plan(last, 12), 4, jst(23, 25));
    expect(effectiveTrainChoice(options, 1)).toBe(1);
    expect(options[1].late).toBe(true);
  });

  test('asks for 2本前 where only 1本前 exists: uses 1本前', () => {
    const oneEarlier = train(jst(23, 45), jst(24, 37), [train(jst(23, 36), jst(24, 28))]);
    expect(effectiveTrainChoice(trainOptions(plan(oneEarlier), 4, jst(23, 0)), 2)).toBe(1);
  });
});

describe('a plan heading for an earlier train', () => {
  const night = plan();
  const options = trainOptions(night, 4, jst(23, 0));
  const chosen = applyTrainChoice(night, options, 1);

  test('uses the earlier train, but remembers the real last train', () => {
    expect(chosen.lastTrain.departsAt).toBe(jst(23, 36));
    expect(chosen.trainChoice).toBe(1);
    expect(chosen.nightLastTrain?.departsAt).toBe(jst(23, 45));
    expect(recommendedLeaveTime(chosen)).toBe(jst(23, 27));
  });

  test('the night still ends with the real last train', () => {
    expect(lastTrainLeftAt(chosen)).toBe(jst(23, 45));
    expect(missedCheckInAt(chosen)).toBe(jst(23, 48));
    expect(rideStatus(chosen, jst(23, 40))).not.toBe('departed');
  });

  test('reminders follow the chosen train, then ask at its departure whether it was caught', () => {
    const reminders = buildReminderPlans(chosen, [15, 0], jst(23, 0), { missedCheckIn: true });
    expect(reminders).toEqual([
      { minutesBefore: 15, fireAt: jst(23, 12) },
      { minutesBefore: 0, fireAt: jst(23, 27) },
      // 乗れましたか？ when 1本前 departs; no last-train leave time (it depends on where you'll be).
      { minutesBefore: 0, fireAt: jst(23, 36), boardedCheck: true },
      { minutesBefore: 0, fireAt: jst(23, 48), missedCheckIn: true },
    ]);
  });

  test('choosing the last train changes nothing', () => {
    expect(applyTrainChoice(night, options, 0)).toBe(night);
    expect(buildReminderPlans(night, [0], jst(23, 0), { missedCheckIn: false })).toEqual([{ minutesBefore: 0, fireAt: jst(23, 36) }]);
  });
});
