import { describe, expect, test } from 'vitest';
import type { ReminderPlan } from '@/lib/planner';
import { planDelivery, reminderKind, type DeliveryContext } from '@/lib/reminderLedger';

const MIN = 60_000;
const at = (minutes: number) => Date.UTC(2026, 9, 16, 14, 0) + minutes * MIN; // 23:00 JST + minutes

/** Reminders 30/15/5 minutes before, and at, a leave time `leave` minutes after 23:00. */
function reminders(leave: number): ReminderPlan[] {
  return [30, 15, 5, 0].map((minutesBefore) => ({ minutesBefore, fireAt: at(leave - minutesBefore) }));
}

const context = (overrides: Partial<DeliveryContext> = {}): DeliveryContext => ({
  night: '20261016',
  choiceKey: '1',
  stationKey: '渋谷',
  leaveAtMs: at(31),
  trainDepartsAtMs: at(45),
  ...overrides,
});

describe('tonight’s reminder record', () => {
  test('first schedule: everything still ahead is scheduled', () => {
    const plan = planDelivery(null, context(), reminders(31), at(0));
    expect(plan.schedule.map(reminderKind)).toEqual(['m30', 'm15', 'm5', 'm0']);
    expect(plan.catchUp).toBeNull();
    expect(plan.stationChanged).toBe(false);
  });

  test('walking toward the station moves the leave time later, but 今すぐ出発 is not sent twice', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    // 23:32: the leave-now reminder (23:31) has gone out; the leave time now moves to 23:34.
    const replanned = planDelivery(first.ledger, context({ leaveAtMs: at(34) }), reminders(34), at(32));
    expect(replanned.schedule.map(reminderKind)).toEqual([]);
    expect(replanned.catchUp).toBeNull();
  });

  test('walking away pulls reminders into the past: only the latest is sent, at once', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    // 23:10: a re-plan moves the leave time to 23:18, so 30分前 (22:48) and 15分前 (23:03) are now past.
    const replanned = planDelivery(first.ledger, context({ leaveAtMs: at(18) }), reminders(18), at(10));
    expect(replanned.catchUp && reminderKind(replanned.catchUp)).toBe('m15');
    expect(replanned.schedule.map(reminderKind)).toEqual(['m5', 'm0']);
    // …and the skipped 30分前 never arrives later.
    expect(replanned.ledger.sent).toEqual(expect.arrayContaining(['m30', 'm15']));
  });

  test('no catch-up once the train has gone', () => {
    const plan = planDelivery(null, context({ trainDepartsAtMs: at(20) }), reminders(18), at(25));
    expect(plan.catchUp).toBeNull();
  });

  test('the user picking another train gets a fresh set, including 今すぐ出発', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    const afterLeaveNow = planDelivery(first.ledger, context(), reminders(31), at(32));
    const switched = planDelivery(afterLeaveNow.ledger, context({ choiceKey: '0', leaveAtMs: at(41) }), reminders(41), at(33));
    expect(switched.schedule.map(reminderKind)).toEqual(['m5', 'm0']);
  });

  test('a station change is reported once', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    const moved = planDelivery(first.ledger, context({ stationKey: '表参道' }), reminders(31), at(5));
    expect(moved.stationChanged).toBe(true);
    expect(planDelivery(moved.ledger, context({ stationKey: '表参道' }), reminders(31), at(6)).stationChanged).toBe(false);
  });

  test('a big leave-time move after a reminder went out gets one notice; before any reminder it does not', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    expect(planDelivery(first.ledger, context({ leaveAtMs: at(38) }), reminders(38), at(0.5)).timeShifted).toBe(false);
    const reminded = planDelivery(first.ledger, context(), reminders(31), at(2)); // 30分前 (23:01) went out
    expect(planDelivery(reminded.ledger, context({ leaveAtMs: at(38) }), reminders(38), at(3)).timeShifted).toBe(true);
    expect(planDelivery(reminded.ledger, context({ leaveAtMs: at(33) }), reminders(33), at(3)).timeShifted).toBe(false);
  });

  test('a new night starts from scratch', () => {
    const first = planDelivery(null, context(), reminders(31), at(32));
    const tomorrow = planDelivery(first.ledger, context({ night: '20261017' }), reminders(31 + 24 * 60), at(60 * 20));
    expect(tomorrow.stationChanged).toBe(false);
    expect(tomorrow.schedule).toHaveLength(4);
  });

  test('the held train departs: the next train gets its own reminders, still ahead only, with no catch-up or time notice', () => {
    // Heading for 1本前 (leave 23:21, departs 23:36); the question at 23:36.
    const held = [...reminders(21), { minutesBefore: 0, fireAt: at(36), boardedCheck: true as const }];
    const first = planDelivery(null, context({ leaveAtMs: at(21), trainDepartsAtMs: at(36) }), held, at(-20));
    expect(first.schedule.map(reminderKind)).toEqual(['m30', 'm15', 'm5', 'm0', `b${at(36)}`]);
    // 23:37: 1本前 has gone; re-planned from here for 終電 (leave 23:40, departs 23:45).
    const next = planDelivery(first.ledger, context({ leaveAtMs: at(40), trainDepartsAtMs: at(45) }), reminders(40), at(37));
    expect(next.trainSwitched).toBe(true);
    expect(next.schedule.map(reminderKind)).toEqual(['m0']);
    expect(next.catchUp).toBeNull();
    expect(next.timeShifted).toBe(false);
    // Later re-plans for the same train are ordinary again.
    const again = planDelivery(next.ledger, context({ leaveAtMs: at(40), trainDepartsAtMs: at(45) }), reminders(40), at(38));
    expect(again.trainSwitched).toBe(false);
    expect(again.schedule.map(reminderKind)).toEqual(['m0']);
  });

  test('the question is never sent as a catch-up', () => {
    const held = [{ minutesBefore: 0, fireAt: at(36), boardedCheck: true as const }];
    const plan = planDelivery(null, context({ trainDepartsAtMs: at(45) }), held, at(40));
    expect(plan.catchUp).toBeNull();
  });

  test('after 「出る時刻が変わりました」, reminders still ahead come again at the new times', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    // 23:20: 30分前 (23:01) and 15分前 (23:16) went out; the leave time moves to 23:40.
    const moved = planDelivery(first.ledger, context({ leaveAtMs: at(40) }), reminders(40), at(20));
    expect(moved.timeShifted).toBe(true);
    // 15分前 is 23:25 now: again. 30分前 (23:10) has passed: not resent.
    expect(moved.schedule.map(reminderKind)).toEqual(['m15', 'm5', 'm0']);
    expect(moved.catchUp).toBeNull();
  });

  test('after 「出発駅が変わりました」, the same', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    const moved = planDelivery(first.ledger, context({ stationKey: '神泉', leaveAtMs: at(33) }), reminders(33), at(20));
    expect(moved.stationChanged).toBe(true);
    expect(moved.schedule.map(reminderKind)).toEqual(['m5', 'm0']);
    // 15分前 (23:16) already went out and its new time (23:18) has passed: not again.
    expect(moved.catchUp).toBeNull();
  });

  test('small drifts bring nothing back', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    const drift = planDelivery(first.ledger, context({ leaveAtMs: at(33) }), reminders(33), at(20));
    expect(drift.timeShifted).toBe(false);
    expect(drift.schedule.map(reminderKind)).toEqual(['m5', 'm0']);
  });

  test('乗れましたか？ unanswered: one follow-up from the fresh plan, in place of the station notice', () => {
    const first = planDelivery(null, context({ leaveAtMs: at(21), trainDepartsAtMs: at(36) }), reminders(21), at(-20));
    const next = planDelivery(
      first.ledger,
      context({ stationKey: '神泉', leaveAtMs: at(40), trainDepartsAtMs: at(45), followUpFor: at(36) }),
      reminders(40),
      at(37),
    );
    expect(next.followUp).toBe(true);
    expect(next.stationChanged).toBe(false);
    const again = planDelivery(next.ledger, context({ stationKey: '神泉', leaveAtMs: at(40), trainDepartsAtMs: at(45), followUpFor: at(36) }), reminders(40), at(38));
    expect(again.followUp).toBe(false);
  });

  test('switching train yourself: no catch-up, only reminders still ahead', () => {
    // Heading for 2本前 (leave 23:10); at 23:25 the user picks 1本前 (leave 23:15, already past).
    const first = planDelivery(null, context({ choiceKey: '2', leaveAtMs: at(10), trainDepartsAtMs: at(27) }), reminders(10), at(-30));
    const switched = planDelivery(first.ledger, context({ choiceKey: '1', leaveAtMs: at(15), trainDepartsAtMs: at(36) }), reminders(15), at(25));
    expect(switched.catchUp).toBeNull();
    expect(switched.schedule).toEqual([]);
    // Picking a train whose reminders are still ahead schedules them as usual.
    const later = planDelivery(first.ledger, context({ choiceKey: '0', leaveAtMs: at(40), trainDepartsAtMs: at(50) }), reminders(40), at(25));
    expect(later.schedule.map(reminderKind)).toEqual(['m5', 'm0']);
    expect(later.catchUp).toBeNull();
  });

  test('choosing the station yourself: no notice, no catch-up, reminders still ahead come again', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    // 23:20: the user picks 神泉 (leave 23:33); 15分前 (23:18) is now past.
    const chosen = planDelivery(first.ledger, context({ stationKey: '神泉', leaveAtMs: at(33), userStationChange: true }), reminders(33), at(20));
    expect(chosen.stationChanged).toBe(false);
    expect(chosen.catchUp).toBeNull();
    expect(chosen.schedule.map(reminderKind)).toEqual(['m5', 'm0']);
  });

  test('small moves that add up still get one notice: compared with what the user was told', () => {
    const first = planDelivery(null, context(), reminders(31), at(0));
    // 30分前 (23:01) goes out with 23:31; then the leave time drifts 3 minutes, twice.
    const drift1 = planDelivery(first.ledger, context({ leaveAtMs: at(34) }), reminders(34), at(2));
    expect(drift1.timeShifted).toBe(false);
    const drift2 = planDelivery(drift1.ledger, context({ leaveAtMs: at(37) }), reminders(37), at(3));
    expect(drift2.timeShifted).toBe(true);
    // Told now: another small move doesn't repeat it.
    const drift3 = planDelivery(drift2.ledger, context({ leaveAtMs: at(39) }), reminders(39), at(4));
    expect(drift3.timeShifted).toBe(false);
  });
});
