import {
  personalStationResidualSeconds,
  personalizedPackupSeconds,
  personalizedWalkingSeconds,
  type PersonalTimingProfile,
} from "@/lib/mobilityLearning";

export const DEFAULT_STATION_ACCESS_SECONDS = 3 * 60;
export const FINAL_SAFETY_BUFFER_MINUTES = 10;
const MIN_STATION_ACCESS_SECONDS = 60;
const MAX_STATION_ACCESS_SECONDS = 15 * 60;

export type TimingPredictionSource =
  | "provider"
  | "aggregate"
  | "personalized";

export type TimingPrediction = {
  providerWalkingSeconds: number;
  walkingSeconds: number;
  packupSeconds: number;
  aggregateStationSeconds: number;
  stationAccessSeconds: number;
  requiredSeconds: number;
  source: TimingPredictionSource;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Combines provider routing, aggregate station traversal data, and the local
 * user's residual profile. This function is intentionally deterministic and
 * pure so it can be regression-tested independently of networking/storage.
 */
export function buildTimingPrediction(input: {
  providerWalkingMinutes: number;
  aggregateStationP90Seconds?: number | null;
  personalProfile: PersonalTimingProfile;
}): TimingPrediction {
  const providerWalkingSeconds = Math.max(
    60,
    Math.round(input.providerWalkingMinutes * 60),
  );
  const walkingSeconds = personalizedWalkingSeconds(
    providerWalkingSeconds,
    input.personalProfile,
  );
  const packupSeconds = personalizedPackupSeconds(input.personalProfile);

  const aggregateStationSeconds =
    input.aggregateStationP90Seconds === null ||
    input.aggregateStationP90Seconds === undefined
      ? DEFAULT_STATION_ACCESS_SECONDS
      : clamp(
          Math.round(input.aggregateStationP90Seconds),
          MIN_STATION_ACCESS_SECONDS,
          MAX_STATION_ACCESS_SECONDS,
        );
  const stationAccessSeconds = clamp(
    aggregateStationSeconds +
      personalStationResidualSeconds(input.personalProfile),
    MIN_STATION_ACCESS_SECONDS,
    MAX_STATION_ACCESS_SECONDS,
  );

  const personalized =
    input.personalProfile.walkingRatios.length >= 5 ||
    input.personalProfile.packupSeconds.length >= 5 ||
    input.personalProfile.stationResidualSeconds.length >= 5;
  const source: TimingPredictionSource = personalized
    ? "personalized"
    : input.aggregateStationP90Seconds !== null &&
        input.aggregateStationP90Seconds !== undefined
      ? "aggregate"
      : "provider";

  return {
    providerWalkingSeconds,
    walkingSeconds,
    packupSeconds,
    aggregateStationSeconds,
    stationAccessSeconds,
    requiredSeconds: walkingSeconds + packupSeconds + stationAccessSeconds,
    source,
  };
}
