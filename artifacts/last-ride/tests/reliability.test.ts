import { describe, expect, test } from "vitest";
import {
  BASE_SAFETY_MARGIN_MINUTES,
  matchingDisruptionLines,
  planFreshness,
  recommendedLeaveTime,
  recommendedSafetyMarginMinutes,
  riskAdjustedLeaveTime,
} from "@/lib/reliability";
import { MINUTE_MS } from "@/lib/time";

function choice(
  overrides: Partial<{
    leaveByMs: number;
    recommendedLeaveByMs: number;
    safetyMarginMinutes: number;
    walkingMinutes: number;
    disruptionLines: string[];
    lastTrain: {
      transfers?: number;
      legs?: Array<{ line: string }>;
    };
  }> = {},
) {
  return {
    leaveByMs: 1_000_000,
    walkingMinutes: 8,
    lastTrain: { transfers: 0, legs: [{ line: "ＪＲ山手線外回り" }] },
    ...overrides,
  };
}

describe("recommended deadline", () => {
  test("a direct short walk keeps a four-minute safety margin", () => {
    expect(recommendedSafetyMarginMinutes(choice())).toBe(
      BASE_SAFETY_MARGIN_MINUTES,
    );
    expect(recommendedLeaveTime(choice())).toBe(1_000_000 - 4 * MINUTE_MS);
  });

  test("transfers and a long walk add bounded uncertainty", () => {
    expect(
      recommendedSafetyMarginMinutes(
        choice({ walkingMinutes: 18, lastTrain: { transfers: 4 } }),
      ),
    ).toBe(12);
  });

  test("a persisted explicit recommendation wins but can never exceed the hard deadline", () => {
    expect(
      recommendedLeaveTime(
        choice({ recommendedLeaveByMs: 900_000, safetyMarginMinutes: 99 }),
      ),
    ).toBe(900_000);
    expect(
      recommendedLeaveTime(choice({ recommendedLeaveByMs: 1_100_000 })),
    ).toBe(1_000_000);
  });

  test("a disrupted route is penalized for automatic selection only", () => {
    const clean = choice();
    const disrupted = choice({ disruptionLines: ["JR Yamanote Line"] });
    expect(
      riskAdjustedLeaveTime(clean) - riskAdjustedLeaveTime(disrupted),
    ).toBe(15 * MINUTE_MS);
    expect(recommendedLeaveTime(disrupted)).toBe(recommendedLeaveTime(clean));
  });
});

describe("plan freshness", () => {
  test("ages from fresh to aging to stale", () => {
    const now = 20 * MINUTE_MS;
    expect(planFreshness(now - 4 * MINUTE_MS, now)).toBe("fresh");
    expect(planFreshness(now - 8 * MINUTE_MS, now)).toBe("aging");
    expect(planFreshness(now - 13 * MINUTE_MS, now)).toBe("stale");
  });
});

describe("disruption matching", () => {
  test("matches provider line names despite direction suffixes", () => {
    expect(
      matchingDisruptionLines(choice(), [
        { line: "ＪＲ山手線" },
        { line: "東京メトロ銀座線" },
      ]),
    ).toEqual(["ＪＲ山手線"]);
  });
});
