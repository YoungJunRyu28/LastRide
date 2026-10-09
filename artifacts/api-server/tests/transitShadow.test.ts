import { describe, expect, test } from "vitest";
import {
  compareShadowRoutes,
  normalizeServiceDate,
} from "../src/lib/transitShadow";

describe("transit shadow comparison", () => {
  test("normalizes API and ISO service dates", () => {
    expect(normalizeServiceDate("20261009")).toBe("2026-10-09");
    expect(normalizeServiceDate("2026-10-09")).toBe("2026-10-09");
    expect(normalizeServiceDate("2026/10/09")).toBeNull();
  });

  test("reports aggregate time and transfer deltas only", () => {
    const comparison = compareShadowRoutes(
      {
        departsAt: "2026-10-09T14:45:00.000Z",
        arrivesAt: "2026-10-09T15:43:00.000Z",
        transfers: 1,
        fareYen: 1000,
        legs: [],
      },
      {
        departsAt: Date.parse("2026-10-09T14:47:00.000Z"),
        arrivesAt: Date.parse("2026-10-09T15:46:00.000Z"),
        transfers: 2,
        legs: [],
      },
    );

    expect(comparison).toEqual({
      providerHasRoute: true,
      shadowHasRoute: true,
      departureDeltaMinutes: 2,
      arrivalDeltaMinutes: 3,
      transferDelta: 1,
    });
  });

  test("represents coverage mismatches without inventing deltas", () => {
    expect(compareShadowRoutes(null, null)).toEqual({
      providerHasRoute: false,
      shadowHasRoute: false,
      departureDeltaMinutes: null,
      arrivalDeltaMinutes: null,
      transferDelta: null,
    });
  });
});
