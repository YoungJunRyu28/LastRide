/**
 * 終電 / 1本前 / 2本前: which of tonight's trains the user is heading for.
 *
 * The preference is kept for the night and re-applied to every new plan (the
 * user moving, a re-plan in the background), so reminders, the lock screen,
 * widgets and groups all follow it. It is a preference, not a promise: once a
 * chosen train has departed, the plan falls back to the next later train,
 * down to the last train itself. Between its leave time and its departure the
 * chosen train is kept ("on the way"), so the times don't jump mid-walk.
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
    nightLaterTrains: undefined,
    trainChoice: undefined,
  };
}

type FallbackPlan = Pick<NightPlan, 'lastTrain' | 'nightLastTrain' | 'nightLastLeaveAt' | 'nightLaterTrains' | 'walkingMinutes' | 'walkHomeMinutes' | 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'arriveHomeMs' | 'trainChoice'>;

/**
 * The plan for the next later train, once the chosen one has left: 2本前 →
 * 1本前 → 終電. Its leave time keeps the chosen train's margin. Null when the
 * plan already heads for the last train.
 */
export function nextTrainFallback<T extends FallbackPlan>(plan: T): T | null {
  const [next, ...rest] = plan.nightLaterTrains ?? [];
  if (!next || !plan.trainChoice) return lastTrainFallback(plan);
  const margin = plan.leaveByMs - recommendedLeaveTime(plan);
  const leaveByMs = next.departsAt - (plan.walkingMinutes + STATION_BUFFER_MINUTES) * MINUTE_MS;
  return {
    ...plan,
    lastTrain: next,
    leaveByMs,
    recommendedLeaveByMs: leaveByMs - margin,
    safetyMarginMinutes: undefined,
    arriveHomeMs: next.arrivesAt === undefined ? undefined : next.arrivesAt + (plan.walkHomeMinutes ?? 0) * MINUTE_MS,
    nightLaterTrains: rest,
    trainChoice: plan.trainChoice - 1,
  };
}

export type TrainOption = {
  choice: TrainChoice;
  /** The plan's station with this train. */
  station: StationChoice;
  /**
   * The train hasn't left yet. Someone who left on time may still be walking to
   * it, so a train stays usable until it departs, not just until its latest
   * leave time. The last train is always offered.
   */
  catchable: boolean;
  /** Its latest leave time has passed: only made by hurrying (or already on the way). */
  late: boolean;
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
    { choice: 0, station: plan, catchable: true, late: nowMs > plan.leaveByMs },
    ...earlier.map((train, index): TrainOption => {
      const station = choiceFor(plan, train, leaveMargin);
      return { choice: (index + 1) as TrainChoice, station, catchable: nowMs < train.departsAt, late: nowMs > station.leaveByMs };
    }),
  ];
}

/**
 * After the station changes automatically: the same slot at the new station
 * (2本前 stays 2本前), unless its leave time there has already passed; then
 * the next later train still on time, down to the last train.
 */
export function slotAtNewStation(options: TrainOption[], slot: number): TrainChoice {
  let index = Math.max(0, Math.min(slot, options.length - 1));
  while (index > 0 && (options[index].late || !options[index].catchable)) index--;
  return options[index].choice;
}

/** The slot in force at `stationNameJa`: an override for that station, else the user's choice. */
export function choiceAt(
  preference: number,
  override: { station: string; choice: number } | null,
  stationNameJa: string,
): number {
  return override && override.station === stationNameJa ? override.choice : preference;
}

/**
 * The train actually used for `preferred`: that one until it departs, then
 * the next later one (2本前 gone → 1本前 → 終電), as lib/nightPhase.ts does.
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
    // `before` is latest first; the trains after the chosen one, earliest first.
    nightLaterTrains: (plan.lastTrain.before ?? []).slice(0, choice - 1).reverse(),
  };
}
