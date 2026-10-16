/**
 * What every countdown counts at each moment of the night: the app's home
 * screen, the widgets and the Live Activity all read it from here, so they
 * agree at the same moment.
 *
 * - "leave": before the leave time, the count is to the leave time (ここを出るまで).
 * - "train": after it, to the chosen train's departure (23:33発まで), since the
 *   user is on the way and that is the deadline left.
 * - Once that train departs, the plan moves on to the next later one (2本前 →
 *   1本前 → 終電), in "leave" again if its leave time is still ahead.
 * - After the last train has gone there is no phase.
 */
import { lastTrainLeftAt, type NightPlan } from '@/lib/planner';
import { recommendedLeaveTime } from '@/lib/reliability';
import { formatJstTime } from '@/lib/time';
import { nextTrainFallback, trainChoiceLabel } from '@/lib/trainChoice';

export type PhasePlan = Pick<
  NightPlan,
  | 'leaveByMs'
  | 'recommendedLeaveByMs'
  | 'safetyMarginMinutes'
  | 'lastTrain'
  | 'walkingMinutes'
  | 'walkHomeMinutes'
  | 'arriveHomeMs'
  | 'trainChoice'
  | 'nightLastTrain'
  | 'nightLastLeaveAt'
  | 'nightLaterTrains'
>;

export type NightPhase<P extends PhasePlan = PhasePlan> = {
  kind: 'leave' | 'train';
  /** Epoch ms the phase starts and ends. */
  from: number;
  until: number;
  /** Epoch ms the count runs to: the leave time, or the train's departure. */
  countdownTo: number;
  /** The plan in force: heading for this phase's train. */
  plan: P;
  /** This phase's train is the real last train. */
  last: boolean;
};

/** When `plan`'s own train counts as gone: its departure, capped like the last train's (01:30). */
function goneAt(plan: PhasePlan): number {
  return plan.trainChoice ? plan.lastTrain.departsAt : lastTrainLeftAt(plan);
}

/** The night's phases from `fromMs` on, in order, following the fallbacks. */
export function nightPhases<P extends PhasePlan>(plan: P, fromMs: number): NightPhase<P>[] {
  const phases: NightPhase<P>[] = [];
  let current: P | null = plan;
  let start = fromMs;
  while (current) {
    const departs = goneAt(current);
    if (departs > start) {
      const leaveAt = recommendedLeaveTime(current);
      const last = !current.trainChoice;
      if (leaveAt > start) phases.push({ kind: 'leave', from: start, until: leaveAt, countdownTo: leaveAt, plan: current, last });
      phases.push({ kind: 'train', from: Math.max(start, leaveAt), until: departs, countdownTo: current.lastTrain.departsAt, plan: current, last });
      start = departs;
    }
    current = nextTrainFallback(current);
  }
  return phases;
}

/** The phase at `nowMs`, or null once the last train has gone. */
export function phaseAt<P extends PhasePlan>(plan: P, nowMs: number): NightPhase<P> | null {
  return nightPhases(plan, nowMs)[0] ?? null;
}

export type RailStop = {
  /** "leave": when to leave for the chosen train; "train": a train; "last": the real last train. */
  kind: 'leave' | 'train' | 'last';
  at: number;
  /** For trains: 1 = 1本前, 2 = 2本前. */
  choice?: number;
};

/**
 * The timeline rail: leave → the chosen train → any later ones → 終電. With
 * the last train chosen there are just two stops.
 */
export function railStops(plan: PhasePlan): RailStop[] {
  const stops: RailStop[] = [{ kind: 'leave', at: recommendedLeaveTime(plan) }];
  if (!plan.trainChoice) return [...stops, { kind: 'last', at: plan.lastTrain.departsAt }];
  stops.push({ kind: 'train', at: plan.lastTrain.departsAt, choice: plan.trainChoice });
  (plan.nightLaterTrains ?? []).forEach((train, index) =>
    stops.push({ kind: 'train', at: train.departsAt, choice: plan.trainChoice! - 1 - index }),
  );
  if (plan.nightLastTrain) stops.push({ kind: 'last', at: plan.nightLastTrain.departsAt });
  return stops;
}

/** Where each stop stands at `nowMs`: passed, the one being counted to, or still ahead. */
export function stopState(stop: RailStop, phase: NightPhase | null, nowMs: number): 'done' | 'next' | 'later' {
  if (!phase) return 'done';
  if (nowMs >= stop.at) return 'done';
  if (stop.kind === 'leave') return 'next';
  return phase.kind === 'train' && phase.countdownTo === stop.at ? 'next' : 'later';
}

/**
 * What the count is for, worded the same everywhere. 「出る」 is the user
 * leaving, 「発」 the train departing, so the two never read alike.
 * `label` goes over the countdown; `island` is the Dynamic Island's short form.
 */
export function phaseLabel(phase: NightPhase, ja: boolean): { label: string; island: string } {
  const time = formatJstTime(phase.countdownTo);
  if (phase.kind === 'leave') return ja ? { label: 'ここを出るまで', island: '出るまで' } : { label: 'Leave in', island: 'Leave in' };
  if (phase.last) return ja ? { label: `終電 ${time}発まで`, island: '終電' } : { label: `Last train ${time} in`, island: 'Last train' };
  return ja ? { label: `${time}発まで`, island: `${time}発` } : { label: `${time} train in`, island: 'Train in' };
}

/** A stop's words: `label` beside its time in a list, `short` under its dot on the rail. */
export function stopLabel(stop: RailStop, state: 'done' | 'next' | 'later', ja: boolean): { label: string; short: string } {
  const time = formatJstTime(stop.at);
  if (stop.kind === 'leave') {
    const label = state === 'done' ? (ja ? '出た' : 'Left') : ja ? '出る' : 'Leave';
    return { label, short: state === 'next' ? `${label} ${time}` : label };
  }
  if (stop.kind === 'last') {
    const label = ja ? '終電' : 'Last';
    return { label, short: state === 'next' ? `${label} ${time}` : label };
  }
  if (state === 'done') return ja ? { label: '発車済', short: '発車済' } : { label: 'Gone', short: 'Gone' };
  return { label: trainChoiceLabel(stop.choice, ja), short: ja ? `${time}発` : time };
}
