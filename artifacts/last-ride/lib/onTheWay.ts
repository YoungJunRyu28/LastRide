/**
 * "On the way": once the leave time for the train in force has passed, the
 * user is taken to be walking to the station. Until that train departs,
 * automatic re-plans (tracking moving, the periodic check) keep tonight's
 * station, train and times as they are, so nothing changes mid-walk, even if
 * the walk from here now looks too long (they may be running).
 *
 * Choices the user makes (the 終電/1本前/2本前 switch, 「駅を選ぶ」) are not
 * re-plans and work as usual. Once the train departs, the freeze ends and the
 * night is re-planned from where the user is.
 */
import type { NightPlan } from '@/lib/planner';
import { recommendedLeaveTime } from '@/lib/reliability';
import type { Coordinates } from '@/lib/stations';

/** The leave time for `effective` (the plan with tonight's train choice) has passed and its train hasn't left. */
export function onTheWay(effective: Pick<NightPlan, 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'walkingMinutes' | 'lastTrain'>, nowMs: number): boolean {
  return nowMs >= recommendedLeaveTime(effective) && nowMs < effective.lastTrain.departsAt;
}

/**
 * Whether an automatic re-plan should keep `previous` as it is: on the way,
 * and not a plan already held for a train that has since left (then the night
 * is re-planned once from the current position; if that plan's leave time has
 * passed too, the next update holds it again).
 */
export function holdOnTheWay(
  previous: Pick<NightPlan, 'frozenUntil'>,
  effective: Pick<NightPlan, 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'walkingMinutes' | 'lastTrain'>,
  nowMs: number,
): boolean {
  if (previous.frozenUntil !== undefined && nowMs >= previous.frozenUntil) return false;
  return onTheWay(effective, nowMs);
}

/**
 * The plan to keep while on the way: `previous` (the plan as found, before the
 * train choice) as it is, with only the new position and check time, marked
 * with the departure it is held for. No re-plan and no "too far to make it"
 * switch: someone running may still make it, and changing their train mid-run
 * would be worse than a tight countdown.
 */
export function keepOnTheWay(previous: NightPlan, coordinates: Coordinates, nowMs: number, trainDepartsAt: number): NightPlan {
  return { ...previous, coordinates, computedAt: nowMs, frozenUntil: trainDepartsAt };
}
