import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "@/lib/api";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import type { StationOption } from "@/lib/stations";

export const LEARNING_CONSENT_VERSION = 1;
export const LEARNING_MODEL_VERSION = "mobility-v1";
const TOKEN_KEY = "lastride-learning-token-v1";
const QUEUE_KEY = "lastride-learning-queue-v1";
const PERSONAL_PROFILE_KEY = "lastride-learning-personal-profile-v1";
const STATION_PROFILE_CACHE_KEY = "lastride-station-profile-cache-v1";
const MAX_QUEUE = 100;
const MAX_PERSONAL_SAMPLES = 50;
const PROFILE_CACHE_MS = 24 * 60 * 60 * 1000;

export type LearningDayType = "weekday" | "weekend" | "holiday";

export type MobilityLearningObservation = {
  clientObservationId: string;
  kind: "trip_timing" | "station_traversal";
  stationKey?: string;
  lineKey?: string;
  hourBucket: number;
  dayType: LearningDayType;
  packupSeconds?: number;
  walkingDistanceMeters?: number;
  providerWalkingSeconds?: number;
  actualWalkingSeconds?: number;
  elevationGainMeters?: number;
  elevationLossMeters?: number;
  stationTraversalSeconds?: number;
  caughtTrain?: boolean;
  confidencePermille: number;
  modelVersion: string;
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
  source: "station-line-context" | "station-line" | "station" | "insufficient";
  lookbackDays: number;
};

type StationProfileCache = Record<
  string,
  { fetchedAt: number; profile: StationAccessProfile }
>;

export type PersonalTimingProfile = {
  walkingRatios: number[];
  packupSeconds: number[];
  stationResidualSeconds: number[];
};

const EMPTY_PERSONAL_PROFILE: PersonalTimingProfile = {
  walkingRatios: [],
  packupSeconds: [],
  stationResidualSeconds: [],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function trimSamples(values: number[]): number[] {
  return values.slice(-MAX_PERSONAL_SAMPLES);
}

function profileCacheKey(
  stationKey: string,
  lineKey: string | undefined,
  hourBucket: number,
  dayType: LearningDayType,
): string {
  return `${stationKey}|${lineKey ?? ""}|${hourBucket}|${dayType}`;
}

function normalizedPublicName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Stable identifier for public station infrastructure. Coordinates are rounded
 * station coordinates supplied by the transport provider, never the user's GPS.
 */
export function stationLearningKey(station: StationOption): string {
  return [
    "station-v1",
    normalizedPublicName(station.nameJa),
    station.latitude.toFixed(4),
    station.longitude.toFixed(4),
  ].join(":");
}

export function lineLearningKey(line: string | undefined): string | undefined {
  if (!line?.trim()) return undefined;
  return `line-v1:${normalizedPublicName(line)}`;
}

async function randomToken(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateLearningToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const existing = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (existing && /^[a-f0-9]{64}$/i.test(existing)) return existing;
  const token = await randomToken();
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return token;
}

async function readQueue(): Promise<MobilityLearningObservation[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed as MobilityLearningObservation[]).slice(-MAX_QUEUE)
      : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: MobilityLearningObservation[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(QUEUE_KEY).catch(() => undefined);
    return;
  }
  await AsyncStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(queue.slice(-MAX_QUEUE)),
  );
}

export function makeObservationId(): string {
  // Idempotency only: deliberately contains no wall-clock component so the
  // server cannot recover an exact observation time from the identifier.
  return `lr-${Crypto.randomUUID()}`;
}

export async function discardPendingLearningObservations(): Promise<void> {
  await writeQueue([]);
}

export async function enqueueLearningObservation(
  observation: MobilityLearningObservation,
): Promise<void> {
  const queue = await readQueue();
  if (queue.some((entry) => entry.clientObservationId === observation.clientObservationId))
    return;
  queue.push(observation);
  await writeQueue(queue);
}

export async function flushLearningQueue(): Promise<number> {
  if (!apiBaseUrl || Platform.OS === "web") return 0;
  const [token, queue] = await Promise.all([
    getOrCreateLearningToken(),
    readQueue(),
  ]);
  if (!token || queue.length === 0) return 0;

  const batch = queue.slice(0, 20);
  const response = await fetchWithTimeout(
    `${apiBaseUrl}/api/learning/observations`,
    8_000,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Learning-Token": token,
      },
      body: JSON.stringify({
        consentVersion: LEARNING_CONSENT_VERSION,
        observations: batch,
      }),
    },
  );
  if (!response.ok) return 0;

  const sent = new Set(batch.map((entry) => entry.clientObservationId));
  await writeQueue(
    queue.filter((entry) => !sent.has(entry.clientObservationId)),
  );
  return batch.length;
}

export async function deleteSharedLearningData(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!token) {
    await writeQueue([]);
    return true;
  }
  if (!apiBaseUrl) return false;
  const response = await fetchWithTimeout(
    `${apiBaseUrl}/api/learning/contributor`,
    8_000,
    {
      method: "DELETE",
      headers: { "X-Learning-Token": token },
    },
  ).catch(() => null);
  if (!response || (!response.ok && response.status !== 404)) return false;
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined),
    writeQueue([]),
  ]);
  return true;
}

export async function readPersonalTimingProfile(): Promise<PersonalTimingProfile> {
  try {
    const raw = await AsyncStorage.getItem(PERSONAL_PROFILE_KEY);
    if (!raw) return EMPTY_PERSONAL_PROFILE;
    const parsed = JSON.parse(raw) as Partial<PersonalTimingProfile>;
    return {
      walkingRatios: Array.isArray(parsed.walkingRatios)
        ? parsed.walkingRatios.filter(Number.isFinite).slice(-MAX_PERSONAL_SAMPLES)
        : [],
      packupSeconds: Array.isArray(parsed.packupSeconds)
        ? parsed.packupSeconds.filter(Number.isFinite).slice(-MAX_PERSONAL_SAMPLES)
        : [],
      stationResidualSeconds: Array.isArray(parsed.stationResidualSeconds)
        ? parsed.stationResidualSeconds
            .filter(Number.isFinite)
            .slice(-MAX_PERSONAL_SAMPLES)
        : [],
    };
  } catch {
    return EMPTY_PERSONAL_PROFILE;
  }
}

export async function updatePersonalTimingProfile(input: {
  walkingRatio?: number;
  packupSeconds?: number;
  stationResidualSeconds?: number;
}): Promise<void> {
  const profile = await readPersonalTimingProfile();
  if (input.walkingRatio !== undefined && Number.isFinite(input.walkingRatio)) {
    profile.walkingRatios = trimSamples([
      ...profile.walkingRatios,
      clamp(input.walkingRatio, 0.5, 2.5),
    ]);
  }
  if (input.packupSeconds !== undefined && Number.isFinite(input.packupSeconds)) {
    profile.packupSeconds = trimSamples([
      ...profile.packupSeconds,
      clamp(input.packupSeconds, 0, 3600),
    ]);
  }
  if (
    input.stationResidualSeconds !== undefined &&
    Number.isFinite(input.stationResidualSeconds)
  ) {
    profile.stationResidualSeconds = trimSamples([
      ...profile.stationResidualSeconds,
      clamp(input.stationResidualSeconds, -600, 1200),
    ]);
  }
  await AsyncStorage.setItem(PERSONAL_PROFILE_KEY, JSON.stringify(profile));
}

/**
 * Conservative personalized p90 walking prediction. Until five observations
 * exist, the contracted routing provider remains authoritative.
 */
export function personalizedWalkingSeconds(
  providerSeconds: number,
  profile: PersonalTimingProfile,
): number {
  if (profile.walkingRatios.length < 5) return providerSeconds;
  const p90Ratio = quantile(profile.walkingRatios, 0.9) ?? 1;
  return Math.round(providerSeconds * clamp(p90Ratio, 0.8, 1.8));
}

/** p90 delay between "leave now" and sustained movement, once enough data exists. */
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

async function readStationProfileCache(): Promise<StationProfileCache> {
  try {
    const raw = await AsyncStorage.getItem(STATION_PROFILE_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StationProfileCache) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function getStationAccessProfiles(
  queries: Array<{ stationKey: string; lineKey?: string; hourBucket: number; dayType: LearningDayType }>,
): Promise<StationAccessProfile[]> {
  const unique = [
    ...new Map(
      queries.map((query) => [profileCacheKey(query.stationKey, query.lineKey, query.hourBucket, query.dayType), query]),
    ).values(),
  ].slice(0, 12);
  if (unique.length === 0) return [];

  const now = Date.now();
  const cache = await readStationProfileCache();
  const result = new Map<string, StationAccessProfile>();
  const missing: typeof unique = [];
  for (const query of unique) {
    const key = profileCacheKey(query.stationKey, query.lineKey, query.hourBucket, query.dayType);
    const cached = cache[key];
    if (cached && now - cached.fetchedAt < PROFILE_CACHE_MS) {
      result.set(key, cached.profile);
    } else {
      missing.push(query);
    }
  }

  if (missing.length > 0 && apiBaseUrl) {
    try {
      const response = await fetchWithTimeout(
        `${apiBaseUrl}/api/learning/station-profiles`,
        6_000,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: missing }),
        },
      );
      if (response.ok) {
        const profiles = (await response.json()) as StationAccessProfile[];
        for (const profile of profiles) {
          const key = profileCacheKey(
            profile.stationKey,
            profile.lineKey ?? undefined,
            profile.hourBucket,
            profile.dayType,
          );
          result.set(key, profile);
          cache[key] = { fetchedAt: now, profile };
        }
        await AsyncStorage.setItem(
          STATION_PROFILE_CACHE_KEY,
          JSON.stringify(cache),
        ).catch(() => undefined);
      }
    } catch {
      // Aggregate learning is optional; routing must work without it.
    }
  }

  return unique.map((query) => {
    const key = profileCacheKey(query.stationKey, query.lineKey, query.hourBucket, query.dayType);
    return (
      result.get(key) ?? {
        stationKey: query.stationKey,
        lineKey: query.lineKey ?? null,
        hourBucket: query.hourBucket,
        dayType: query.dayType,
        sampleCount: 0,
        contributorCount: 0,
        p50Seconds: null,
        p90Seconds: null,
        p95Seconds: null,
        source: "insufficient" as const,
        lookbackDays: 180,
      }
    );
  });
}

export async function clearLocalLearningState(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(QUEUE_KEY).catch(() => undefined),
    AsyncStorage.removeItem(PERSONAL_PROFILE_KEY).catch(() => undefined),
    AsyncStorage.removeItem(STATION_PROFILE_CACHE_KEY).catch(() => undefined),
  ]);
}
