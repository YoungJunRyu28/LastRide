/**
 * Reliability rules for the part of LastRide that users act on.
 *
 * `leaveByMs` remains the absolute/latest practical departure deadline so
 * plans saved by older app versions still deserialize correctly. The
 * recommended deadline is intentionally earlier and is what the UI,
 * notifications and Business presence should use.
 */
import { MINUTE_MS } from "@/lib/time";

export const BASE_SAFETY_MARGIN_MINUTES = 4;

/**
 * How much time to spare the user wants (Settings → 余裕), in minutes between
 * the recommended and latest leave times, before transfers and long walks.
 */
export type LeaveMargin = number;
export const MAX_LEAVE_MARGIN_MINUTES = 30;
/** Older versions saved a preset: ぎりぎり, ふつう or 余裕あり. */
const LEGACY_LEAVE_MARGINS: Record<string, number> = { tight: 0, normal: BASE_SAFETY_MARGIN_MINUTES, relaxed: 10 };

export function clampLeaveMargin(minutes: number): LeaveMargin {
  if (!Number.isFinite(minutes)) return BASE_SAFETY_MARGIN_MINUTES;
  return Math.min(MAX_LEAVE_MARGIN_MINUTES, Math.max(0, Math.round(minutes)));
}

/** A saved 余裕: minutes, or an older version's preset. */
export function parseLeaveMargin(raw: string | null | undefined): LeaveMargin {
  if (raw && raw in LEGACY_LEAVE_MARGINS) return LEGACY_LEAVE_MARGINS[raw];
  if (raw && /^\d+$/.test(raw.trim())) return clampLeaveMargin(Number(raw));
  return BASE_SAFETY_MARGIN_MINUTES;
}
export const TRANSFER_SAFETY_MARGIN_MINUTES = 2;
export const MAX_TRANSFER_SAFETY_MARGIN_MINUTES = 6;
export const LONG_WALK_MINUTES = 15;
export const LONG_WALK_SAFETY_MARGIN_MINUTES = 2;
/** An unverified straight-line walk can be substantially longer around rail
 * yards, rivers, overpasses or blocked station exits. This is a pragmatic
 * precaution, NOT a statistical confidence bound or verified route ETA. */
export const UNVERIFIED_WALK_MIN_MARGIN = 3;
export const UNVERIFIED_WALK_MAX_MARGIN = 15;
export function walkingUncertaintyMarginMinutes(
  minutes: number,
  source: 'routed' | 'estimated' | undefined,
): number {
  if (source === 'routed') return 0;
  if (!Number.isFinite(minutes) || minutes < 0) return UNVERIFIED_WALK_MAX_MARGIN;
  return Math.max(UNVERIFIED_WALK_MIN_MARGIN,
    Math.min(UNVERIFIED_WALK_MAX_MARGIN, Math.ceil(minutes * 0.35)));
}

export const DISRUPTION_SELECTION_PENALTY_MINUTES = 15;

export const PLAN_AGING_AFTER_MS = 5 * MINUTE_MS;
export const PLAN_STALE_AFTER_MS = 12 * MINUTE_MS;

type DeadlineChoice = {
  leaveByMs: number;
  recommendedLeaveByMs?: number;
  safetyMarginMinutes?: number;
  walkingMinutes: number;
  lastTrain: {
    transfers?: number;
    legs?: Array<{ line: string }>;
  };
  disruptionLines?: string[];
};

export type PlanFreshness = "fresh" | "aging" | "stale";

export function recommendedSafetyMarginMinutes(
  choice: Pick<DeadlineChoice, "walkingMinutes" | "lastTrain">,
  leaveMargin: LeaveMargin = BASE_SAFETY_MARGIN_MINUTES,
): number {
  const transfers = Math.max(0, choice.lastTrain.transfers ?? 0);
  const transferMargin = Math.min(
    MAX_TRANSFER_SAFETY_MARGIN_MINUTES,
    transfers * TRANSFER_SAFETY_MARGIN_MINUTES,
  );
  const walkMargin =
    choice.walkingMinutes >= LONG_WALK_MINUTES
      ? LONG_WALK_SAFETY_MARGIN_MINUTES
      : 0;
  return clampLeaveMargin(leaveMargin) + transferMargin + walkMargin;
}

/**
 * When to leave, on the whole minute (rounded down): the time shown has no
 * seconds, so reminders and countdowns must not either.
 */
export function recommendedLeaveTime(choice: DeadlineChoice): number {
  const exact = Number.isFinite(choice.recommendedLeaveByMs)
    ? Math.min(choice.leaveByMs, choice.recommendedLeaveByMs!)
    : choice.leaveByMs - (choice.safetyMarginMinutes ?? recommendedSafetyMarginMinutes(choice)) * MINUTE_MS;
  return Math.floor(exact / MINUTE_MS) * MINUTE_MS;
}

/**
 * Used only to rank automatic station choices. A route with a current service
 * incident needs a meaningful time advantage before it can beat a clean route.
 */
export function riskAdjustedLeaveTime(choice: DeadlineChoice): number {
  const disruptionPenalty =
    (choice.disruptionLines?.length ?? 0) > 0
      ? DISRUPTION_SELECTION_PENALTY_MINUTES * MINUTE_MS
      : 0;
  return recommendedLeaveTime(choice) - disruptionPenalty;
}

export function planFreshness(
  computedAt: number,
  nowMs: number,
): PlanFreshness {
  const age = Math.max(0, nowMs - computedAt);
  if (age > PLAN_STALE_AFTER_MS) return "stale";
  if (age > PLAN_AGING_AFTER_MS) return "aging";
  return "fresh";
}

export function planAgeMinutes(computedAt: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - computedAt) / MINUTE_MS));
}

export function normalizeLineName(name: string): string {
  return name
    .split("・")[0]
    .replace(/[\s　]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(外回り|内回り)$/u, "")
    .toLowerCase();
}

export function matchingDisruptionLines(
  choice: Pick<DeadlineChoice, "lastTrain">,
  incidents: Array<{ line: string }>,
): string[] {
  const routeLines = choice.lastTrain.legs?.map((leg) => leg.line) ?? [];
  const matches = new Set<string>();
  for (const routeLine of routeLines) {
    const route = normalizeLineName(routeLine);
    // A name that normalises to nothing would "include" every incident.
    if (!route) continue;
    for (const incident of incidents) {
      const disrupted = normalizeLineName(incident.line);
      if (!disrupted) continue;
      if (
        route === disrupted ||
        route.includes(disrupted) ||
        disrupted.includes(route)
      ) {
        matches.add(incident.line);
      }
    }
  }
  return [...matches];
}
