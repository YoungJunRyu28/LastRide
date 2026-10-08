import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueueLearningObservation,
  flushLearningQueue,
  lineLearningKey,
  makeObservationId,
  stationLearningKey,
  updatePersonalTimingProfile,
  LEARNING_MODEL_VERSION,
  type LearningDayType,
} from "@/lib/mobilityLearning";
import type { NightPlan } from "@/lib/planner";
import { recommendedLeaveTime } from "@/lib/reliability";
import { STORAGE_KEYS } from "@/lib/settings";
import { distanceBetween, type Coordinates } from "@/lib/stations";

const SESSION_KEY = "lastride-learning-active-trip-v1";
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
const MOVEMENT_DISTANCE_METERS = 40;
const MOVEMENT_SPEED_MPS = 0.5;
const STATION_REACHED_RADIUS_METERS = 140;
const TRAIN_SPEED_MPS = 5.5;
const BOARDING_WINDOW_BEFORE_MS = 2 * 60 * 1000;
const BOARDING_WINDOW_AFTER_MS = 20 * 60 * 1000;

export type LearningLocationSignal = {
  coordinates: Coordinates;
  timestamp: number;
  speedMps?: number | null;
  accuracyMeters?: number | null;
  altitudeMeters?: number | null;
  altitudeAccuracyMeters?: number | null;
};

type ActiveLearningSession = {
  version: 1;
  id: string;
  createdAt: number;
  advisedLeaveAt: number;
  hardLeaveAt: number;
  lastTrainDepartsAt: number;
  origin: Coordinates;
  station: Coordinates;
  stationKey: string;
  lineKey?: string;
  walkingDistanceMeters: number;
  providerWalkingSeconds: number;
  aggregateStationSeconds: number;
  movementStartedAt?: number;
  stationArrivedAt?: number;
  boardedAt?: number;
  previousSignal?: LearningLocationSignal;
  lastAltitudeMeters?: number;
  elevationGainMeters?: number;
  elevationLossMeters?: number;
};

let sessionQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = sessionQueue.then(work, work);
  sessionQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function learningEnabled(): Promise<boolean> {
  return (
    (await AsyncStorage.getItem(STORAGE_KEYS.mobilityLearning).catch(
      () => null,
    )) === "true"
  );
}

async function readSession(): Promise<ActiveLearningSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveLearningSession;
    if (
      parsed?.version !== 1 ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > MAX_SESSION_AGE_MS
    ) {
      await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeSession(
  session: ActiveLearningSession | null,
): Promise<void> {
  if (!session) {
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
    return;
  }
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function sameTrip(first: ActiveLearningSession, plan: NightPlan): boolean {
  return (
    first.lastTrainDepartsAt === plan.lastTrain.departsAt &&
    first.stationKey === stationLearningKey(plan.station)
  );
}

function dayTypeJst(timestamp: number): LearningDayType {
  const day = new Date(timestamp + 9 * 60 * 60 * 1000).getUTCDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

function hourBucketJst(timestamp: number): number {
  return new Date(timestamp + 9 * 60 * 60 * 1000).getUTCHours();
}

/**
 * Start or refresh a local-only training session. Raw origin coordinates never
 * leave the device and are deleted when the session completes/expires.
 */
export async function beginLearningSession(
  plan: NightPlan,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  return serialized(async () => {
    if (!(await learningEnabled())) return;
    const existing = await readSession();
    if (existing && sameTrip(existing, plan)) {
      // Before movement starts, a re-plan should refresh the baseline from the
      // user's latest stationary position. Once walking begins, preserve the
      // original baseline so the outcome remains measurable.
      if (!existing.movementStartedAt) {
        existing.origin = plan.coordinates;
        existing.advisedLeaveAt = recommendedLeaveTime(plan);
        existing.hardLeaveAt = plan.leaveByMs;
        existing.walkingDistanceMeters = Math.round(plan.distanceMeters);
        existing.providerWalkingSeconds = Math.round(
          (plan.providerWalkingMinutes ?? plan.walkingMinutes) * 60,
        );
        existing.aggregateStationSeconds = Math.round(
          (plan.aggregateStationAccessMinutes ?? 3) * 60,
        );
        await writeSession(existing);
      }
      return;
    }

    const session: ActiveLearningSession = {
      version: 1,
      id: makeObservationId(),
      createdAt: Date.now(),
      advisedLeaveAt: recommendedLeaveTime(plan),
      hardLeaveAt: plan.leaveByMs,
      lastTrainDepartsAt: plan.lastTrain.departsAt,
      origin: plan.coordinates,
      station: {
        latitude: plan.station.latitude,
        longitude: plan.station.longitude,
      },
      stationKey: stationLearningKey(plan.station),
      lineKey: lineLearningKey(plan.lastTrain.legs?.[0]?.line),
      walkingDistanceMeters: Math.round(plan.distanceMeters),
      providerWalkingSeconds: Math.round(
        (plan.providerWalkingMinutes ?? plan.walkingMinutes) * 60,
      ),
      aggregateStationSeconds: Math.round(
        (plan.aggregateStationAccessMinutes ?? 3) * 60,
      ),
    };
    await writeSession(session);
  });
}

function usableSignal(signal: LearningLocationSignal): boolean {
  return (
    Number.isFinite(signal.timestamp) &&
    signal.timestamp > 0 &&
    (signal.accuracyMeters === null ||
      signal.accuracyMeters === undefined ||
      signal.accuracyMeters <= 100)
  );
}

function sustainedMovement(
  session: ActiveLearningSession,
  signal: LearningLocationSignal,
): boolean {
  const fromOrigin = distanceBetween(session.origin, signal.coordinates);
  const speed = signal.speedMps;
  if (
    fromOrigin >= MOVEMENT_DISTANCE_METERS &&
    (speed === null || speed === undefined || speed < 0 || speed >= MOVEMENT_SPEED_MPS)
  ) {
    return true;
  }
  const previous = session.previousSignal;
  if (!previous) return false;
  const delta = distanceBetween(previous.coordinates, signal.coordinates);
  const elapsedSeconds = Math.max(1, (signal.timestamp - previous.timestamp) / 1000);
  return delta >= 35 && delta / elapsedSeconds >= MOVEMENT_SPEED_MPS;
}


function updateElevationSummary(
  session: ActiveLearningSession,
  signal: LearningLocationSignal,
): void {
  if (!session.movementStartedAt) return;
  const altitude = signal.altitudeMeters;
  const accuracy = signal.altitudeAccuracyMeters;
  if (altitude === null || altitude === undefined || !Number.isFinite(altitude)) return;
  if (accuracy !== null && accuracy !== undefined && accuracy > 25) return;
  const previous = session.lastAltitudeMeters;
  session.lastAltitudeMeters = altitude;
  if (previous === undefined) return;
  const delta = altitude - previous;
  // Reject implausible GPS/barometer jumps between nearby samples and ignore
  // sub-meter noise so one bad fix cannot create a fake hill.
  if (Math.abs(delta) > 20 || Math.abs(delta) < 1) return;
  if (delta > 0) session.elevationGainMeters = (session.elevationGainMeters ?? 0) + delta;
  else session.elevationLossMeters = (session.elevationLossMeters ?? 0) + Math.abs(delta);
}

function inferredBoarding(
  session: ActiveLearningSession,
  signal: LearningLocationSignal,
): boolean {
  if (!session.stationArrivedAt) return false;
  if (
    signal.timestamp <
      session.lastTrainDepartsAt - BOARDING_WINDOW_BEFORE_MS ||
    signal.timestamp >
      session.lastTrainDepartsAt + BOARDING_WINDOW_AFTER_MS
  ) {
    return false;
  }
  const speed = signal.speedMps ?? -1;
  if (speed < TRAIN_SPEED_MPS) return false;
  return distanceBetween(signal.coordinates, session.station) >= 200;
}

async function completeSession(
  session: ActiveLearningSession,
  input: { caughtTrain: boolean; completedAt: number; confidencePermille: number },
): Promise<void> {
  const actualWalkingSeconds =
    session.movementStartedAt && session.stationArrivedAt
      ? Math.max(
          0,
          Math.round((session.stationArrivedAt - session.movementStartedAt) / 1000),
        )
      : undefined;
  const packupSeconds = session.movementStartedAt
    ? Math.max(
        0,
        Math.round((session.movementStartedAt - session.advisedLeaveAt) / 1000),
      )
    : undefined;
  const stationTraversalSeconds =
    input.caughtTrain && session.stationArrivedAt && session.boardedAt
      ? Math.max(
          0,
          Math.round((session.boardedAt - session.stationArrivedAt) / 1000),
        )
      : undefined;

  const walkingRatio =
    actualWalkingSeconds &&
    session.providerWalkingSeconds >= 60 &&
    actualWalkingSeconds >= 30
      ? actualWalkingSeconds / session.providerWalkingSeconds
      : undefined;
  await updatePersonalTimingProfile({
    walkingRatio,
    packupSeconds,
    stationResidualSeconds:
      stationTraversalSeconds === undefined
        ? undefined
        : stationTraversalSeconds - session.aggregateStationSeconds,
  }).catch(() => undefined);

  await enqueueLearningObservation({
    clientObservationId: session.id,
    kind:
      stationTraversalSeconds === undefined
        ? "trip_timing"
        : "station_traversal",
    stationKey: session.stationKey,
    lineKey: session.lineKey,
    hourBucket: hourBucketJst(
      session.stationArrivedAt ?? input.completedAt,
    ),
    dayType: dayTypeJst(session.stationArrivedAt ?? input.completedAt),
    packupSeconds,
    walkingDistanceMeters: session.walkingDistanceMeters,
    providerWalkingSeconds: session.providerWalkingSeconds,
    actualWalkingSeconds,
    elevationGainMeters: session.elevationGainMeters === undefined ? undefined : Math.round(session.elevationGainMeters),
    elevationLossMeters: session.elevationLossMeters === undefined ? undefined : Math.round(session.elevationLossMeters),
    stationTraversalSeconds,
    caughtTrain: input.caughtTrain,
    confidencePermille: input.confidencePermille,
    modelVersion: LEARNING_MODEL_VERSION,
  });
  await writeSession(null);
  void flushLearningQueue();
}

/**
 * Consume a foreground/background location sample. This only updates local
 * state unless a completed high-confidence outcome can be derived.
 */
export async function recordLearningLocationSignal(
  signal: LearningLocationSignal,
): Promise<void> {
  if (!(await learningEnabled()) || !usableSignal(signal)) return;
  return serialized(async () => {
    if (!(await learningEnabled())) return;
    const session = await readSession();
    if (!session) return;

    if (!session.movementStartedAt && sustainedMovement(session, signal)) {
      session.movementStartedAt = signal.timestamp;
    }

    if (
      session.movementStartedAt &&
      !session.stationArrivedAt &&
      distanceBetween(signal.coordinates, session.station) <=
        STATION_REACHED_RADIUS_METERS
    ) {
      session.stationArrivedAt = signal.timestamp;
    }

    updateElevationSummary(session, signal);

    if (!session.boardedAt && inferredBoarding(session, signal)) {
      // Speed around a station could also be a bus or taxi. Keep this as a
      // tentative boarding timestamp until the passenger explicitly confirms.
      session.boardedAt = signal.timestamp;
    }

    session.previousSignal = signal;
    await writeSession(session);
  });
}

/**
 * Explicit user label for underground/ambiguous cases. For a confirmed catch,
 * scheduled train departure is the conservative proxy for boarding time.
 */
export async function confirmLearningTrainOutcome(
  caughtTrain: boolean,
  now = Date.now(),
): Promise<boolean> {
  if (!(await learningEnabled())) return false;
  return serialized(async () => {
    if (!(await learningEnabled())) return false;
    const session = await readSession();
    if (!session) return false;
    const confirmedWithMotion = caughtTrain && session.boardedAt !== undefined;
    if (caughtTrain && session.stationArrivedAt && !session.boardedAt) {
      session.boardedAt = Math.max(
        session.stationArrivedAt,
        session.lastTrainDepartsAt,
      );
    }
    await completeSession(session, {
      caughtTrain,
      completedAt: now,
      // An explicit catch plus an inferred movement transition can be used
      // for aggregate estimates. Confirmation with timetable proxy alone is
      // too imprecise to contribute an entrance-to-platform training label.
      confidencePermille: caughtTrain ? (confirmedWithMotion ? 850 : 750) : 1000,
    });
    return true;
  });
}

export async function clearActiveLearningSession(): Promise<void> {
  await serialized(() => writeSession(null));
}
