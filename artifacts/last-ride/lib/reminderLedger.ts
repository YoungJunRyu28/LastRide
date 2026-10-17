/**
 * Tonight's reminder record, so re-plans never repeat or silently drop a reminder.
 *
 * Every re-plan (walking, a station change, the background task) reschedules
 * the reminders from new times. Without a record of what already went out:
 * - walking toward the station moves the leave time later and 出る時間です (leave now) is sent again;
 * - walking away moves it earlier, past "now", and the reminder is never sent.
 *
 * The record (shared by the app and background tracking) remembers what was
 * scheduled and what went out, per night and per train the user chose:
 * - a reminder already sent is never sent again (automatic changes keep the record);
 * - the user picking another train starts a fresh set for it, with no catch-up:
 *   they're looking at its leave time in the app, so only reminders still ahead go;
 * - reminders a re-plan pushed into the past: only the latest goes out, now;
 * - a station change, or a leave time moving 5+ minutes after a reminder already
 *   went out, gets one notice instead of silent new times, and then every
 *   reminder still ahead can go out again at its new time;
 * - the train being headed for departed and the plan moved on to the next one
 *   (2本前 → 1本前 → 終電): that train gets its own reminders, only those still
 *   ahead (no catch-up, no "time changed" notice); while 乗れましたか？ is
 *   unanswered, one follow-up with the times from here replaces the station notice.
 * Pure: lib/notifications.ts stores it and delivers what it decides.
 */
import type { ReminderPlan } from '@/lib/planner';
import { MINUTE_MS } from '@/lib/time';

export type ReminderLedger = {
  /** Service date of the night (YYYYMMDD). */
  night: string;
  /** The train the user chose (終電 / 1本前 / 2本前): changes only by their own choice. */
  choiceKey: string;
  /** Station the reminders are for (its Japanese name). */
  stationKey: string;
  /** The leave time the reminders were last scheduled for. */
  leaveAtMs: number;
  /** Departure of the train they were for (older records may lack it). */
  trainDepartsAtMs?: number;
  /** Reminder kinds scheduled, with when they fire. */
  scheduled: Record<string, number>;
  /** Kinds that went out tonight (for this choice). */
  sent: string[];
};

export type DeliveryContext = {
  night: string;
  choiceKey: string;
  stationKey: string;
  leaveAtMs: number;
  /** When the train being headed for departs: no catch-up once it has gone. */
  trainDepartsAtMs: number;
  /**
   * The earlier train headed for has departed and 乗れましたか？ isn't answered:
   * its departure. Gets one follow-up with the new times (lib/boarding.ts).
   */
  followUpFor?: number;
  /**
   * The user chose the station themselves (駅を選ぶ, この駅に固定, another
   * station, 自動に戻す): a station change then gets no notice and no catch-up,
   * since they're looking at it in the app.
   */
  userStationChange?: boolean;
};

export type DeliveryPlan = {
  ledger: ReminderLedger;
  /** Reminders to schedule at their times. */
  schedule: ReminderPlan[];
  /** The one overdue reminder to send right away (latest of those pushed into the past). */
  catchUp: ReminderPlan | null;
  /** The station changed since the last schedule (automatically or not). */
  stationChanged: boolean;
  /** Same station, but the leave time moved 5+ minutes after a reminder already went out. */
  timeShifted: boolean;
  /** The train the reminders were for departed, and these are for the next one. */
  trainSwitched: boolean;
  /** Send the 「…に乗れなかったなら」 follow-up now (once per departed train). */
  followUp: boolean;
};

/** A leave-time move smaller than this after a reminder isn't worth a notice. */
export const SHIFT_NOTICE_MS = 5 * MINUTE_MS;

export function reminderKind(plan: Pick<ReminderPlan, 'minutesBefore' | 'fireAt' | 'missedCheckIn' | 'boardedCheck'>): string {
  // One question per train (its departure time), so 2本前 and then 1本前 each get theirs.
  if (plan.boardedCheck) return `b${plan.fireAt}`;
  if (plan.missedCheckIn) return 'missed';
  return `m${plan.minutesBefore}`;
}

export function planDelivery(
  previous: ReminderLedger | null,
  context: DeliveryContext,
  plans: ReminderPlan[],
  nowMs: number,
): DeliveryPlan {
  const known = previous && previous.night === context.night ? previous : null;
  const sent = new Set(known?.sent ?? []);
  // Anything scheduled for a time that has passed went out.
  for (const [kind, fireAt] of Object.entries(known?.scheduled ?? {})) {
    if (fireAt <= nowMs) sent.add(kind);
  }
  // The user chose another train: it gets its own full set.
  const userSwitched = !!known && known.choiceKey !== context.choiceKey;
  if (userSwitched) sent.clear();
  // The train departed and the plan moved on to the next one: a fresh set for it
  // (questions already asked stay asked).
  const trainSwitched =
    !!known &&
    known.choiceKey === context.choiceKey &&
    known.trainDepartsAtMs !== undefined &&
    nowMs >= known.trainDepartsAtMs &&
    context.trainDepartsAtMs > known.trainDepartsAtMs;
  if (trainSwitched) for (const kind of [...sent]) if (kind.startsWith('m')) sent.delete(kind);

  const stationMoved = !!known && known.stationKey !== context.stationKey;
  // Told only when the app moved the station by itself.
  const stationChanged = stationMoved && !context.userStationChange;
  const remindedAlready = [...sent].some((kind) => kind.startsWith('m'));
  const timeShifted =
    !!known && !trainSwitched && !stationChanged && remindedAlready && Math.abs(context.leaveAtMs - known.leaveAtMs) >= SHIFT_NOTICE_MS;
  // Told about the change (or chose it): reminders still ahead at the new times can go out again.
  if (stationMoved || timeShifted)
    for (const plan of plans) if (plan.fireAt > nowMs + 1000 && reminderKind(plan).startsWith('m')) sent.delete(reminderKind(plan));
  const followUpKind = context.followUpFor === undefined ? null : `f${context.followUpFor}`;
  const followUp = followUpKind !== null && !sent.has(followUpKind);
  if (followUpKind) sent.add(followUpKind);

  const remaining = plans.filter((plan) => !sent.has(reminderKind(plan)));
  const due = remaining.filter((plan) => plan.fireAt <= nowMs + 1000);
  const schedule = remaining.filter((plan) => plan.fireAt > nowMs + 1000);

  // Pushed into the past by a re-plan (or tracking started late): only the latest
  // one, never after the train has gone, and never the missed-train check-in.
  let catchUp: ReminderPlan | null = null;
  const userStation = stationMoved && !!context.userStationChange;
  if (nowMs < context.trainDepartsAtMs && !trainSwitched && !userSwitched && !userStation) {
    for (const plan of due) {
      if (plan.missedCheckIn || plan.boardedCheck) continue;
      if (!catchUp || plan.fireAt > catchUp.fireAt) catchUp = plan;
    }
  }
  for (const plan of due) sent.add(reminderKind(plan));

  return {
    ledger: {
      night: context.night,
      choiceKey: context.choiceKey,
      stationKey: context.stationKey,
      leaveAtMs: context.leaveAtMs,
      trainDepartsAtMs: context.trainDepartsAtMs,
      scheduled: Object.fromEntries(schedule.map((plan) => [reminderKind(plan), plan.fireAt])),
      sent: [...sent],
    },
    schedule,
    catchUp,
    // The follow-up names the station: no separate station notice with it.
    stationChanged: stationChanged && !followUp,
    timeShifted,
    trainSwitched,
    followUp,
  };
}
