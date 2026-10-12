/**
 * 終電 / 1本前 / 2本前: which of tonight's trains the user is heading for.
 *
 * The preference is kept for the night and re-applied to every new plan (the
 * user moving, a re-plan in the background), so reminders, the lock screen,
 * widgets and groups all follow it. It is a preference, not a promise: once a
 * chosen train can no longer be made (its latest leave time has passed, or a
 * move to another station made it earlier), the plan falls back to the next
 * later train that still can, down to the last train itself.
 */
import { STATION_BUFFER_MINUTES, withMargin, type NightPlan, type StationChoice } from '@/lib/planner';
import type { LeaveMargin } from '@/lib/reliability';
import { recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS } from '@/lib/time';
import type { TrainTime } from '@/lib/timetable';

/** 0 = 終電 (the last train), 1 = 1本前, 2 = 2本前. */
export type TrainChoice = 0 | 1 | 2;
export const TRAIN_CHOICES: TrainChoice[] = [0, 1, 2];

/** "終電" / "1本前" / "2本前" (English: "Last" / "1 before" / "2 before"). */
export function trainChoiceLabel(choice: number | undefined, ja: boolean): string {
  if (!choice) return ja ? '終電' : 'Last';
  return ja ? `${choice}本前` : `${choice} before`;
}

/**
 * The plan for the real last train, rebuilt from one heading for an earlier
 * train: what the app falls back to once the earlier train can't be made.
 */
export function lastTrainFallback<T extends Pick<NightPlan, 'lastTrain' | 'nightLastTrain' | 'nightLastLeaveAt' | 'walkingMinutes' | 'walkHomeMinutes' | 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'arriveHomeMs' | 'trainChoice'>>(plan: T): T | null {
  const last = plan.nightLastTrain;
  if (!last || plan.nightLastLeaveAt === undefined) return null;
  return {
    ...plan,
    lastTrain: last,
    leaveByMs: last.departsAt - (plan.walkingMinutes + STATION_BUFFER_MINUTES) * MINUTE_MS,
    recommendedLeaveByMs: plan.nightLastLeaveAt,
    safetyMarginMinutes: undefined,
    arriveHomeMs: last.arrivesAt === undefined ? undefined : last.arrivesAt + (plan.walkHomeMinutes ?? 0) * MINUTE_MS,
    nightLastTrain: undefined,
    nightLastLeaveAt: undefined,
    trainChoice: undefined,
  };
}

export type TrainOption = {
  choice: TrainChoice;
  /** The plan's station with this train. */
  station: StationChoice;
  /** Its latest leave time hasn't passed. The last train is always offered. */
  catchable: boolean;
};

/** The same station and walk, heading for `train` instead. */
function choiceFor(plan: StationChoice, train: TrainTime, leaveMargin: LeaveMargin): StationChoice {
  const leaveByMs = train.departsAt - (plan.walkingMinutes + STATION_BUFFER_MINUTES) * MINUTE_MS;
  return withMargin(
    {
      ...plan,
      lastTrain: train,
      leaveByMs,
      arriveHomeMs: train.arrivesAt === undefined ? undefined : train.arrivesAt + (plan.walkHomeMinutes ?? 0) * MINUTE_MS,
    },
    leaveMargin,
  );
}

/** Tonight's trains from the plan's station: the last train, then up to two before it. */
export function trainOptions(plan: StationChoice, leaveMargin: LeaveMargin, nowMs: number): TrainOption[] {
  const earlier = (plan.lastTrain.before ?? []).slice(0, 2);
  return [
    { choice: 0, station: plan, catchable: true },
    ...earlier.map((train, index): TrainOption => {
      const station = choiceFor(plan, train, leaveMargin);
      return { choice: (index + 1) as TrainChoice, station, catchable: nowMs <= station.leaveByMs };
    }),
  ];
}

/**
 * The train actually used for `preferred`: that one while it can still be
 * made, else the next later one that can (1本前 gone → 終電).
 */
export function effectiveTrainChoice(options: TrainOption[], preferred: number): TrainChoice {
  let index = Math.max(0, Math.min(preferred, options.length - 1));
  while (index > 0 && !options[index].catchable) index--;
  return options[index].choice;
}

/**
 * The plan heading for the chosen train. The real last train is kept as
 * `nightLastTrain` (and its leave time for the backup reminder), so the night
 * still ends with the last train, not the earlier one.
 */
export function applyTrainChoice(plan: NightPlan, options: TrainOption[], choice: TrainChoice): NightPlan {
  if (choice === 0) return plan;
  const chosen = options[choice]?.station;
  if (!chosen) return plan;
  return {
    ...plan,
    ...chosen,
    coordinates: plan.coordinates,
    alternatives: plan.alternatives,
    autoPick: plan.autoPick,
    pinned: plan.pinned,
    computedAt: plan.computedAt,
    trainChoice: choice,
    nightLastTrain: plan.lastTrain,
    nightLastLeaveAt: recommendedLeaveTime(plan),
  };
}
