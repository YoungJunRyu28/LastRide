import type { RecoveryTransitRoute } from "@workspace/api-client-react";

function arrivalMs(route: RecoveryTransitRoute): number {
  const parsed = Date.parse(route.arrivesAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function fare(route: RecoveryTransitRoute): number {
  return route.fareYen ?? Number.POSITIVE_INFINITY;
}

export function cheapestRecoveryTransitRoute(
  routes: RecoveryTransitRoute[],
): RecoveryTransitRoute | null {
  const known = routes.filter((route) => route.fareYen !== null);
  if (known.length === 0) return null;
  return [...known].sort(
    (first, second) =>
      fare(first) - fare(second) ||
      arrivalMs(first) - arrivalMs(second) ||
      first.walkingMinutes - second.walkingMinutes,
  )[0];
}

export function fastestRecoveryTransitRoute(
  routes: RecoveryTransitRoute[],
): RecoveryTransitRoute | null {
  if (routes.length === 0) return null;
  return [...routes].sort(
    (first, second) =>
      arrivalMs(first) - arrivalMs(second) ||
      fare(first) - fare(second) ||
      first.walkingMinutes - second.walkingMinutes,
  )[0];
}

/**
 * Keep only routes for which no other known-fare route is at least as cheap,
 * arrives at least as early, and requires no more walking (with one strict
 * improvement). Unknown-fare routes cannot support a "cheapest" claim, so
 * callers may show them separately but they are excluded from this frontier.
 */
export function paretoRecoveryTransitRoutes(
  routes: RecoveryTransitRoute[],
): RecoveryTransitRoute[] {
  const known = routes.filter((route) => route.fareYen !== null);
  return known
    .filter((candidate) => {
      const candidateArrival = arrivalMs(candidate);
      return !known.some((other) => {
        if (other === candidate) return false;
        const noWorse =
          fare(other) <= fare(candidate) &&
          arrivalMs(other) <= candidateArrival &&
          other.walkingMinutes <= candidate.walkingMinutes;
        const strictlyBetter =
          fare(other) < fare(candidate) ||
          arrivalMs(other) < candidateArrival ||
          other.walkingMinutes < candidate.walkingMinutes;
        return noWorse && strictlyBetter;
      });
    })
    .sort(
      (first, second) =>
        fare(first) - fare(second) ||
        arrivalMs(first) - arrivalMs(second) ||
        first.walkingMinutes - second.walkingMinutes,
    );
}
