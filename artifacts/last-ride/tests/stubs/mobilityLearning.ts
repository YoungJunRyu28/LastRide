import type { StationOption } from "@/lib/stations";

export type LearningDayType = "weekday" | "weekend" | "holiday";

export type PersonalTimingProfile = {
  walkingRatios: number[];
  packupSeconds: number[];
  stationResidualSeconds: number[];
};

export type StationAccessProfile = {
  stationKey: string;
  lineKey: string | null;
  hourBucket: number;
  dayType: LearningDayType;
  sampleCount: number;
  contributorCount: number;
  p50Seconds: number | null;
  p90Seconds: number | null;
  p95Seconds: number | null;
  source:
    | "station-line-context"
    | "station-line"
    | "station"
    | "insufficient";
  lookbackDays: number;
};

export function stationLearningKey(station: StationOption): string {
  return `station-v1:${station.nameJa}:${station.latitude.toFixed(4)}:${station.longitude.toFixed(4)}`;
}

export function lineLearningKey(line: string | undefined): string | undefined {
  return line ? `line-v1:${line}` : undefined;
}

export async function readPersonalTimingProfile(): Promise<PersonalTimingProfile> {
  return { walkingRatios: [], packupSeconds: [], stationResidualSeconds: [] };
}

export async function getStationAccessProfiles(
  queries: Array<{
    stationKey: string;
    lineKey?: string;
    hourBucket: number;
    dayType: LearningDayType;
  }>,
): Promise<StationAccessProfile[]> {
  return queries.map((query) => ({
    stationKey: query.stationKey,
    lineKey: query.lineKey ?? null,
    hourBucket: query.hourBucket,
    dayType: query.dayType,
    sampleCount: 0,
    contributorCount: 0,
    p50Seconds: null,
    p90Seconds: null,
    p95Seconds: null,
    source: "insufficient",
    lookbackDays: 180,
  }));
}

function quantile(values: number[], q: number): number | null {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const index = (valid.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return valid[lower];
  const weight = index - lower;
  return valid[lower] * (1 - weight) + valid[upper] * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function personalizedWalkingSeconds(
  providerSeconds: number,
  profile: PersonalTimingProfile,
): number {
  if (profile.walkingRatios.length < 5) return providerSeconds;
  const p90Ratio = quantile(profile.walkingRatios, 0.9) ?? 1;
  return Math.round(providerSeconds * clamp(p90Ratio, 0.8, 1.8));
}

export function personalizedPackupSeconds(
  profile: PersonalTimingProfile,
): number {
  if (profile.packupSeconds.length < 5) return 0;
  return Math.round(quantile(profile.packupSeconds, 0.9) ?? 0);
}

export function personalStationResidualSeconds(
  profile: PersonalTimingProfile,
): number {
  if (profile.stationResidualSeconds.length < 5) return 0;
  return Math.round(
    clamp(quantile(profile.stationResidualSeconds, 0.9) ?? 0, -180, 600),
  );
}
