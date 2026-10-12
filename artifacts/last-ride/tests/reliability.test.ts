import { describe, expect, test } from "vitest";
import {
  parseLeaveMargin,
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

  test("the 余裕 setting sets the base margin; transfers and long walks still add to it", () => {
    expect(recommendedSafetyMarginMinutes(choice(), 0)).toBe(0);
    expect(recommendedSafetyMarginMinutes(choice(), 4)).toBe(4);
    expect(recommendedSafetyMarginMinutes(choice(), 7)).toBe(7);
    expect(recommendedSafetyMarginMinutes(choice({ lastTrain: { transfers: 1 } }), 0)).toBe(2);
    // Out of range is clamped to 0–30.
    expect(recommendedSafetyMarginMinutes(choice(), 99)).toBe(30);
  });

  test("a saved 余裕 reads as minutes, and older presets convert", () => {
    expect(parseLeaveMargin("tight")).toBe(0);
    expect(parseLeaveMargin("normal")).toBe(4);
    expect(parseLeaveMargin("relaxed")).toBe(10);
    expect(parseLeaveMargin("7")).toBe(7);
    expect(parseLeaveMargin("45")).toBe(30);
    expect(parseLeaveMargin(null)).toBe(4);
    expect(parseLeaveMargin("nonsense")).toBe(4);
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

  test("never matches through a line name that normalises to nothing", () => {
    const blank = {
      lastTrain: { transfers: 0, legs: [{ line: "（臨時）" }] },
    };
    expect(matchingDisruptionLines(blank, [{ line: "ＪＲ山手線" }])).toEqual([]);
    expect(
      matchingDisruptionLines(choice(), [{ line: "（運休）" }]),
    ).toEqual([]);
  });
});
