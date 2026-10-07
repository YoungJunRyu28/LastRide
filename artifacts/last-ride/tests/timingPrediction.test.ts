import { describe, expect, test } from "vitest";
import {
  buildTimingPrediction,
  DEFAULT_STATION_ACCESS_SECONDS,
  FINAL_SAFETY_BUFFER_MINUTES,
} from "@/lib/timingPrediction";

const emptyProfile = {
  walkingRatios: [],
  packupSeconds: [],
  stationResidualSeconds: [],
};

describe("buildTimingPrediction", () => {
  test("falls back to provider walk plus the conservative station-access prior", () => {
    const prediction = buildTimingPrediction({
      providerWalkingMinutes: 10,
      personalProfile: emptyProfile,
    });

    expect(prediction.walkingSeconds).toBe(600);
    expect(prediction.packupSeconds).toBe(0);
    expect(prediction.stationAccessSeconds).toBe(DEFAULT_STATION_ACCESS_SECONDS);
    expect(prediction.requiredSeconds).toBe(780);
    expect(prediction.source).toBe("provider");
    expect(FINAL_SAFETY_BUFFER_MINUTES).toBe(10);
  });

  test("uses aggregate p90 station traversal instead of the generic prior", () => {
    const prediction = buildTimingPrediction({
      providerWalkingMinutes: 8,
      aggregateStationP90Seconds: 480,
      personalProfile: emptyProfile,
    });

    expect(prediction.stationAccessSeconds).toBe(480);
    expect(prediction.requiredSeconds).toBe(960);
    expect(prediction.source).toBe("aggregate");
  });

  test("uses p90 personal behavior only after enough local samples exist", () => {
    const prediction = buildTimingPrediction({
      providerWalkingMinutes: 10,
      aggregateStationP90Seconds: 300,
      personalProfile: {
        walkingRatios: [1.0, 1.05, 1.1, 1.2, 1.3],
        packupSeconds: [60, 120, 180, 240, 300],
        stationResidualSeconds: [0, 30, 60, 90, 120],
      },
    });

    expect(prediction.walkingSeconds).toBeGreaterThan(600);
    expect(prediction.packupSeconds).toBeGreaterThan(0);
    expect(prediction.stationAccessSeconds).toBeGreaterThan(300);
    expect(prediction.source).toBe("personalized");
  });

  test("bounds learned station traversal so bad aggregate data cannot create absurd deadlines", () => {
    const tooLow = buildTimingPrediction({
      providerWalkingMinutes: 5,
      aggregateStationP90Seconds: 1,
      personalProfile: emptyProfile,
    });
    const tooHigh = buildTimingPrediction({
      providerWalkingMinutes: 5,
      aggregateStationP90Seconds: 99_999,
      personalProfile: emptyProfile,
    });

    expect(tooLow.stationAccessSeconds).toBe(60);
    expect(tooHigh.stationAccessSeconds).toBe(15 * 60);
  });
});
