import { describe, expect, test } from "vitest";
import {
  cheapestRecoveryTransitRoute,
  fastestRecoveryTransitRoute,
  paretoRecoveryTransitRoutes,
} from "@/lib/recoveryRanking";
import type { RecoveryTransitRoute } from "@workspace/api-client-react";

function route(
  fareYen: number | null,
  arrivesAt: string,
  walkingMinutes: number,
): RecoveryTransitRoute {
  return {
    departsAt: "2026-10-08T00:10:00+09:00",
    arrivesAt,
    transfers: 1,
    fareYen,
    walkingMinutes,
    durationMinutes: 30,
    modes: ["train"],
    legs: [],
  };
}

describe("recovery route ranking", () => {
  test("cheapest ignores unknown-fare routes", () => {
    const unknown = route(null, "2026-10-08T00:20:00+09:00", 0);
    const cheap = route(800, "2026-10-08T00:50:00+09:00", 4);
    const expensive = route(1600, "2026-10-08T00:30:00+09:00", 2);

    expect(
      cheapestRecoveryTransitRoute([unknown, expensive, cheap]),
    ).toBe(cheap);
  });

  test("fastest is based on actual arrival time", () => {
    const cheap = route(800, "2026-10-08T00:50:00+09:00", 4);
    const fast = route(1800, "2026-10-08T00:25:00+09:00", 8);

    expect(fastestRecoveryTransitRoute([cheap, fast])).toBe(fast);
  });

  test("pareto frontier drops a route that is worse in price, arrival and walking", () => {
    const dominant = route(900, "2026-10-08T00:30:00+09:00", 4);
    const dominated = route(1200, "2026-10-08T00:35:00+09:00", 6);
    const tradeoff = route(700, "2026-10-08T00:45:00+09:00", 9);

    expect(paretoRecoveryTransitRoutes([dominated, tradeoff, dominant])).toEqual([
      tradeoff,
      dominant,
    ]);
  });

  test("unknown-fare routes are never used to support a cheapest claim", () => {
    const unknown = route(null, "2026-10-08T00:20:00+09:00", 0);
    expect(paretoRecoveryTransitRoutes([unknown])).toEqual([]);
    expect(cheapestRecoveryTransitRoute([unknown])).toBeNull();
  });
});
