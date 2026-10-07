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
export const TRANSFER_SAFETY_MARGIN_MINUTES = 2;
export const MAX_TRANSFER_SAFETY_MARGIN_MINUTES = 6;
export const LONG_WALK_MINUTES = 15;
export const LONG_WALK_SAFETY_MARGIN_MINUTES = 2;
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
  return BASE_SAFETY_MARGIN_MINUTES + transferMargin + walkMargin;
}

export function recommendedLeaveTime(choice: DeadlineChoice): number {
  if (Number.isFinite(choice.recommendedLeaveByMs)) {
    return Math.min(choice.leaveByMs, choice.recommendedLeaveByMs!);
  }
  const margin =
    choice.safetyMarginMinutes ?? recommendedSafetyMarginMinutes(choice);
  return choice.leaveByMs - margin * MINUTE_MS;
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
    for (const incident of incidents) {
      const disrupted = normalizeLineName(incident.line);
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
