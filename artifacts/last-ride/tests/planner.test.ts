/**
 * Tests for the night plan: what the app tells the user to do, when it
 * notifies them, and when it stops tracking their location.
 *
 * These are the decisions with consequences. A wrong `rideStatus` tells
 * someone to relax when they should be running; a wrong `trackingEndsAt`
 * leaves background location running all night and flattens their battery.
 *
 * Several of the rules here are product decisions that currently live only in
 * comments — the 3-minute station buffer, the 30-minute warning, the
 * 10-minute gain needed to justify a farther station, the 01:30/04:00/05:00
 * backstops. Pinning them down is the point: they should not be able to change
 * by accident.
 */
import { describe, expect, test } from 'vitest';
import {
  STATION_BUFFER_MINUTES,
  buildReminderPlans,
  lastTrainLeftAt,
  missedCheckInAt,
  nightEndsAt,
  repick,
  rideStatus,
  sameStation,
  shouldExpandStationSearch,
  shouldReplan,
  trackingEndsAt,
  trackingHardStopAt,
  type NightPlan,
  type StationChoice,
} from '@/lib/planner';
import type { StationOption } from '@/lib/stations';
import type { TrainTime } from '@/lib/timetable';
import { MINUTE_MS } from '@/lib/time';

/** A Japan wall-clock time as epoch ms. JST is UTC+9. */
function jst(year: number, month: number, day: number, hours: number, minutes = 0, seconds = 0) {
  return Date.UTC(year, month - 1, day, hours - 9, minutes, seconds);
}

// One canonical night: the last train home leaves Shibuya at 23:52 on 23 Sept,
// an 8-minute walk away. 23:41 is the absolute deadline (8 + 3 station
// buffer); the reliability layer recommends 23:37 with four more minutes of margin.
const LAST_TRAIN = jst(2026, 9, 23, 23, 52);
const LEAVE_BY = jst(2026, 9, 23, 23, 41);
const RECOMMENDED_LEAVE_BY = jst(2026, 9, 23, 23, 37);

function train(departsAt: number): TrainTime {
  return { departsAt, source: 'sample' };
}

function station(name: string, nameJa: string, latitude = 35.658, longitude = 139.701): StationOption {
  return { name, nameJa, latitude, longitude };
}

function choice(overrides: Partial<StationChoice> = {}): StationChoice {
  return {
    station: station('Shibuya', '渋谷'),
    walkingMinutes: 8,
    distanceMeters: 640,
    lastTrain: train(LAST_TRAIN),
    leaveByMs: LEAVE_BY,
    destination: station('Kichijoji', '吉祥寺'),
    ...overrides,
  };
}

/** A plan whose first choice is the current one and the rest are alternatives. */
function planFrom(choices: StationChoice[], overrides: Partial<NightPlan> = {}): NightPlan {
  const [current, ...alternatives] = choices;
  return {
    ...current,
    coordinates: { latitude: 35.658, longitude: 139.701 },
    alternatives,
    autoPick: current,
    pinned: false,
    computedAt: jst(2026, 9, 23, 23, 0),
    ...overrides,
  };
}

describe('rideStatus', () => {
  const tonight = choice();

  test('counts down against the recommended departure, not the hard deadline', () => {
    expect(rideStatus(tonight, jst(2026, 9, 23, 23, 6))).toBe('relaxed');
    expect(rideStatus(tonight, jst(2026, 9, 23, 23, 7))).toBe('soon');
    expect(rideStatus(tonight, jst(2026, 9, 23, 23, 36))).toBe('soon');
  });

  test('the warning begins exactly 30 minutes before the recommended departure', () => {
    expect(rideStatus(tonight, RECOMMENDED_LEAVE_BY - 30 * MINUTE_MS)).toBe('soon');
    expect(rideStatus(tonight, RECOMMENDED_LEAVE_BY - 30 * MINUTE_MS - 1000)).toBe('relaxed');
  });

  test('the recommended departure itself reads "now", not "soon"', () => {
    expect(rideStatus(tonight, RECOMMENDED_LEAVE_BY - 1000)).toBe('soon');
    expect(rideStatus(tonight, RECOMMENDED_LEAVE_BY)).toBe('now');
  });

  test('the absolute deadline is the boundary between "now" and "hurry"', () => {
    // The fixed station-entry/platform buffer remains part of the hard deadline.
    expect(STATION_BUFFER_MINUTES).toBe(3);
    expect(rideStatus(tonight, LEAVE_BY)).toBe('now');
    expect(rideStatus(tonight, LEAVE_BY + 1000)).toBe('hurry');
  });

  test('departed starts the moment the train leaves', () => {
    expect(rideStatus(tonight, LAST_TRAIN - 1000)).toBe('hurry');
    expect(rideStatus(tonight, LAST_TRAIN)).toBe('departed');
    expect(rideStatus(tonight, LAST_TRAIN + MINUTE_MS)).toBe('departed');
  });

  test('departed wins even when leave-by is still ahead', () => {
    // A re-plan can push leave-by into the future after the train has gone;
    // the user still cannot catch it.
    const stale = choice({ leaveByMs: jst(2026, 9, 24, 1, 0) });
    expect(rideStatus(stale, LAST_TRAIN + MINUTE_MS)).toBe('departed');
  });
});

describe('backstops', () => {
  test('a normal last train is treated as gone when it departs', () => {
    expect(lastTrainLeftAt(choice())).toBe(LAST_TRAIN);
  });

  test('no train counts as still waiting after 01:30', () => {
    const late = choice({ lastTrain: train(jst(2026, 9, 24, 1, 45)) });
    expect(lastTrainLeftAt(late)).toBe(jst(2026, 9, 24, 1, 30));

    const exactly = choice({ lastTrain: train(jst(2026, 9, 24, 1, 30)) });
    expect(lastTrainLeftAt(exactly)).toBe(jst(2026, 9, 24, 1, 30));
  });

  test('the "missed it?" check-in follows three minutes later', () => {
    expect(missedCheckInAt(choice())).toBe(jst(2026, 9, 23, 23, 55));

    const late = choice({ lastTrain: train(jst(2026, 9, 24, 1, 45)) });
    expect(missedCheckInAt(late)).toBe(jst(2026, 9, 24, 1, 33));
  });

  test('tracking stops a minute after the check-in, and never past 04:00', () => {
    expect(trackingEndsAt(choice())).toBe(jst(2026, 9, 23, 23, 56));

    const late = choice({ lastTrain: train(jst(2026, 9, 24, 1, 45)) });
    expect(trackingEndsAt(late)).toBe(jst(2026, 9, 24, 1, 34));
    expect(trackingEndsAt(late)).toBeLessThanOrEqual(jst(2026, 9, 24, 4, 0));
  });

  test('tracking always stops by 04:00, even with no plan at all', () => {
    // This is the battery backstop: it does not depend on a plan existing.
    expect(trackingHardStopAt(jst(2026, 9, 23, 23, 0))).toBe(jst(2026, 9, 24, 4, 0));
    // Switched on after midnight — still the same service day, same 04:00.
    expect(trackingHardStopAt(jst(2026, 9, 24, 1, 0))).toBe(jst(2026, 9, 24, 4, 0));
  });
});

describe('nightEndsAt', () => {
  const tonight = choice();

  test('without a first train, the night ends when the service day rolls over', () => {
    expect(nightEndsAt(tonight, null)).toBe(jst(2026, 9, 24, 4, 0));
  });

  test('otherwise it ends when the first train goes', () => {
    expect(nightEndsAt(tonight, train(jst(2026, 9, 24, 4, 30)))).toBe(jst(2026, 9, 24, 4, 30));
  });

  test('a first train before 04:00 cannot end the night early', () => {
    // Guards against re-planning the same night: the rollover always wins.
    expect(nightEndsAt(tonight, train(jst(2026, 9, 24, 3, 0)))).toBe(jst(2026, 9, 24, 4, 0));
  });

  test('and the night is over by 05:00 regardless', () => {
    expect(nightEndsAt(tonight, train(jst(2026, 9, 24, 6, 0)))).toBe(jst(2026, 9, 24, 5, 0));
  });
});

describe('buildReminderPlans', () => {
  const tonight = choice();
  const evening = jst(2026, 9, 23, 22, 0);

  test('one reminder per interval, newest last, plus the check-in', () => {
    const plans = buildReminderPlans(tonight, [30, 10], evening);

    expect(plans.map((plan) => plan.fireAt)).toEqual([
      jst(2026, 9, 23, 23, 7), // 30 minutes before recommended departure
      jst(2026, 9, 23, 23, 27), // 10 minutes before
      RECOMMENDED_LEAVE_BY, //     "leave now"
      jst(2026, 9, 23, 23, 55), // "missed it?"
    ]);
    expect(plans.at(-1)?.missedCheckIn).toBe(true);
  });

  test('"leave now" is always included, even if not asked for', () => {
    const plans = buildReminderPlans(tonight, [30], evening);
    expect(plans.map((plan) => plan.minutesBefore)).toEqual([30, 0, 0]);
  });

  test('duplicate intervals collapse', () => {
    const plans = buildReminderPlans(tonight, [30, 30, 10], evening);
    expect(plans).toHaveLength(4);
  });

  test('reminders that have already passed are dropped', () => {
    const plans = buildReminderPlans(tonight, [30, 10], jst(2026, 9, 23, 23, 35));
    expect(plans.map((plan) => plan.fireAt)).toEqual([RECOMMENDED_LEAVE_BY, jst(2026, 9, 23, 23, 55)]);
  });

  test('a reminder due within five seconds is not worth scheduling', () => {
    const plans = buildReminderPlans(tonight, [30, 10], RECOMMENDED_LEAVE_BY - 3000);
    expect(plans.map((plan) => plan.fireAt)).toEqual([jst(2026, 9, 23, 23, 55)]);
  });
});

describe('shouldReplan', () => {
  // 1 degree of latitude is ~111km, so 0.004 is ~445m and 0.002 is ~222m.
  const here = { latitude: 35.658, longitude: 139.701 };
  const far = { latitude: 35.662, longitude: 139.701 };
  const near = { latitude: 35.66, longitude: 139.701 };
  const recent = planFrom([choice()], {
    computedAt: jst(2026, 9, 23, 23, 0),
    coordinates: here,
  });

  test('with no previous plan there is nothing to reuse', () => {
    expect(shouldReplan(null, here, jst(2026, 9, 23, 23, 1))).toBe(true);
  });

  test('a small move soon after is not worth new lookups', () => {
    expect(shouldReplan(recent, near, jst(2026, 9, 23, 23, 2))).toBe(false);
  });

  test('but a long move is', () => {
    expect(shouldReplan(recent, far, jst(2026, 9, 23, 23, 2))).toBe(true);
  });

  test('and so is an old plan, however little the user moved', () => {
    expect(shouldReplan(recent, here, jst(2026, 9, 23, 23, 11))).toBe(true);
    expect(shouldReplan(recent, here, jst(2026, 9, 23, 23, 9))).toBe(false);
  });
});

describe('choosing between stations', () => {
  const shibuya = station('Shibuya', '渋谷');
  const ebisu = station('Ebisu', '恵比寿', 35.6467, 139.71);

  test('stations are the same when their Japanese names match', () => {
    expect(sameStation(shibuya, station('Shibuya Stn.', '渋谷'))).toBe(true);
    expect(sameStation(shibuya, ebisu)).toBe(false);
  });

  test('a farther station needs to buy real time to be worth it', () => {
    const close = choice({
      station: shibuya,
      walkingMinutes: 5,
      leaveByMs: LEAVE_BY,
    });
    const fartherSmallGain = choice({
      station: ebisu,
      walkingMinutes: 12,
      leaveByMs: LEAVE_BY + 9 * MINUTE_MS,
    });

    const plan = repick(planFrom([close, fartherSmallGain]), null);
    expect(plan.station.nameJa).toBe('渋谷');
  });

  test('ten minutes is enough', () => {
    const close = choice({
      station: shibuya,
      walkingMinutes: 5,
      leaveByMs: LEAVE_BY,
    });
    const fartherRealGain = choice({
      station: ebisu,
      walkingMinutes: 12,
      leaveByMs: LEAVE_BY + 10 * MINUTE_MS,
    });

    const plan = repick(planFrom([close, fartherRealGain]), null);
    expect(plan.station.nameJa).toBe('恵比寿');
  });

  test('a current disruption can make a slightly earlier clean station the automatic pick', () => {
    const disruptedClose = choice({
      station: shibuya,
      walkingMinutes: 5,
      leaveByMs: LEAVE_BY,
      disruptionLines: ['ＪＲ山手線'],
    });
    const cleanFarther = choice({
      station: ebisu,
      walkingMinutes: 12,
      leaveByMs: LEAVE_BY - 5 * MINUTE_MS,
    });

    const plan = repick(planFrom([disruptedClose, cleanFarther]), null);
    expect(plan.station.nameJa).toBe('恵比寿');
  });

  test('pinning overrides the automatic pick, and unpinning restores it', () => {
    const close = choice({
      station: shibuya,
      walkingMinutes: 5,
      leaveByMs: LEAVE_BY,
    });
    const farther = choice({
      station: ebisu,
      walkingMinutes: 12,
      leaveByMs: LEAVE_BY + 2 * MINUTE_MS,
    });
    const base = planFrom([close, farther]);

    const pinned = repick(base, ebisu);
    expect(pinned.station.nameJa).toBe('恵比寿');
    expect(pinned.pinned).toBe(true);
    expect(pinned.autoPick.station.nameJa).toBe('渋谷');

    const unpinned = repick(pinned, null);
    expect(unpinned.station.nameJa).toBe('渋谷');
    expect(unpinned.pinned).toBe(false);
  });

  test('the chosen station never appears in its own alternatives', () => {
    const close = choice({ station: shibuya, walkingMinutes: 5 });
    const farther = choice({ station: ebisu, walkingMinutes: 12 });

    const plan = repick(planFrom([close, farther]), ebisu);
    expect(plan.alternatives.map((option) => option.station.nameJa)).toEqual(['渋谷']);
  });
});

describe('adaptive station search', () => {
  test('keeps the normal three-station pass when there are several healthy options and time', () => {
    const options = [
      choice({ leaveByMs: jst(2026, 9, 24, 0, 30) }),
      choice({
        station: station('Ebisu', '恵比寿'),
        leaveByMs: jst(2026, 9, 24, 0, 20),
      }),
    ];
    expect(shouldExpandStationSearch(options, jst(2026, 9, 23, 23, 0))).toBe(false);
  });

  test('widens when routes are sparse, disrupted, or the deadline is near', () => {
    expect(shouldExpandStationSearch([choice()], jst(2026, 9, 23, 23, 0))).toBe(true);

    const disrupted = [
      choice({ leaveByMs: jst(2026, 9, 24, 0, 30), disruptionLines: ['JR'] }),
      choice({
        station: station('Ebisu', '恵比寿'),
        leaveByMs: jst(2026, 9, 24, 0, 20),
      }),
    ];
    expect(shouldExpandStationSearch(disrupted, jst(2026, 9, 23, 23, 0))).toBe(true);

    const urgent = [
      choice({ leaveByMs: jst(2026, 9, 23, 23, 25) }),
      choice({
        station: station('Ebisu', '恵比寿'),
        leaveByMs: jst(2026, 9, 23, 23, 24),
      }),
    ];
    expect(shouldExpandStationSearch(urgent, jst(2026, 9, 23, 23, 0))).toBe(true);
  });
});
