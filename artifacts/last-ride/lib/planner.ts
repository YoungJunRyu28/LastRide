/**
 * "Plan my night": from the user's position, pick the station to leave from and
 * work out when they must start walking. Shared by the React app and the
 * headless background-location task so both always agree.
 */
import { getTrainDisruptions } from '@workspace/api-client-react';
import type { HomeAddress } from '@/lib/settings';
import { matchingDisruptionLines, recommendedLeaveTime, recommendedSafetyMarginMinutes, riskAdjustedLeaveTime } from '@/lib/reliability';
import { getStationAccessProfiles, lineLearningKey, readPersonalTimingProfile, stationLearningKey, type StationAccessProfile } from '@/lib/mobilityLearning';
import { buildTimingPrediction, FINAL_SAFETY_BUFFER_MINUTES, type TimingPredictionSource } from '@/lib/timingPrediction';
import { distanceBetween, findNearbyStations, LocationError, walkingRoute, type Coordinates, type NearbyStation, type StationOption, type WalkingSpeed } from '@/lib/stations';
import { MINUTE_MS, serviceDayStart } from '@/lib/time';
import { getLastTrain, type TrainTime } from '@/lib/timetable';

/** Time from the station entrance to the platform (gates, stairs, finding the right line). */
export const STATION_BUFFER_MINUTES = 3;
const CANDIDATE_STATIONS_INITIAL = 3;
const CANDIDATE_STATIONS_EXPANDED = 6;
/** Search a wider station ring when the current plan is risky or time-critical. */
const EXPAND_SEARCH_WITHIN_MINUTES = 30;
/** While tracking, re-plan only after moving this far from the last plan, or once it is this old. */
const REPLAN_DISTANCE_METERS = 300;
const REPLAN_AFTER_MS = 10 * MINUTE_MS;

/** Location updates arrive every 150–200 m; most don't change the plan, so skip them to save API calls. */
export function shouldReplan(previous: NightPlan | null, coordinates: Coordinates, nowMs: number): boolean {
  if (!previous) return true;
  return distanceBetween(previous.coordinates, coordinates) >= REPLAN_DISTANCE_METERS || nowMs - previous.computedAt >= REPLAN_AFTER_MS;
}

/** A farther station must let the user leave at least this much later to be worth a longer walk at night. */
const FARTHER_STATION_MIN_GAIN_MINUTES = 10;

/** One station the user could head for, and the train home from it. */
export type StationChoice = {
  station: StationOption;
  walkingMinutes: number;
  distanceMeters: number;
  lastTrain: TrainTime;
  /** Absolute/latest practical time to start walking, epoch ms. */
  leaveByMs: number;
  /** Recommended departure with uncertainty margin. Older saved plans may omit it. */
  recommendedLeaveByMs?: number;
  /** Minutes between the recommended and absolute deadlines. */
  safetyMarginMinutes?: number;
  /** Provider walking estimate before personalization, for outcome learning. */
  providerWalkingMinutes?: number;
  /** Learned delay from the leave-now moment until sustained walking begins. */
  packupMinutes?: number;
  /** Aggregate/fallback station traversal before personal residual adjustment. */
  aggregateStationAccessMinutes?: number;
  /** Predicted station entrance-to-platform/boarding traversal. */
  stationAccessMinutes?: number;
  /** Aggregate samples supporting the station traversal estimate. */
  stationAccessSampleCount?: number;
  /** Which timing layer materially changed the deadline. */
  timingPredictionSource?: TimingPredictionSource;
  /** Current provider-reported service incidents affecting this route. */
  disruptionLines?: string[];
  /** Station this train arrives at — the home station unless a home address opened up a better one. */
  destination: StationOption;
  /** Walk from that station to the home address, when one is set. */
  walkHomeMinutes?: number;
  /** At the user's door, epoch ms — arrival plus that walk. */
  arriveHomeMs?: number;
};

/** Arrival stations worth comparing: the saved home station, plus this many near the home address. */
const DESTINATION_CANDIDATES = 2;

export type NightPlan = StationChoice & {
  coordinates: Coordinates;
  /** Other nearby stations that also reach home, closest first. */
  alternatives: StationChoice[];
  /** The station the app would pick on its own; differs from the plan's while one is pinned. */
  autoPick: StationChoice;
  /** True when the user chose this station instead of the automatic pick. */
  pinned: boolean;
  computedAt: number;
};

/**
 * relaxed/soon: time to spare · now: time to go · hurry: past leave-by with no
 * margin left, but the train hasn't gone · departed: the last train has left.
 * The app can't know whether the user boarded, so "departed" never means "missed".
 */
export type RideStatus = 'relaxed' | 'soon' | 'now' | 'hurry' | 'departed';

/** Start warning the user this long before leave-by. */
const SOON_MINUTES = 30;

/*
 * Hard backups, as Japan clock times, so every stage of the night ends even if
 * re-planning keeps moving the target (e.g. walking between stations near the
 * last or first train). Whichever comes first — the real event or the backup — wins.
 */
const HOUR_MS = 60 * MINUTE_MS;
/** "Last train left" by 01:30 at the latest (a few lines run a little past 01:00). */
const LAST_TRAIN_LEFT_BY = 21.5 * HOUR_MS;
/** Night-out tracking off by 04:00 at the latest. */
const TRACKING_OFF_BY = 24 * HOUR_MS;
/** Move on to the next night by 05:00 at the latest. */
const NIGHT_OVER_BY = 25 * HOUR_MS;
/** The "missed it?" check-in goes out this long after the last train has left. */
const MISSED_CHECK_IN_AFTER_MINUTES = 3;

/** A clock time in the plan's night, as an offset from that service day's 04:00 start. */
function nightClock(choice: Pick<StationChoice, 'lastTrain'>, offsetMs: number) {
  return serviceDayStart(choice.lastTrain.departsAt) + offsetMs;
}

/** When the app treats the last train as gone: its departure, or 01:30 at the latest. */
export function lastTrainLeftAt(choice: Pick<StationChoice, 'lastTrain'>): number {
  return Math.min(choice.lastTrain.departsAt, nightClock(choice, LAST_TRAIN_LEFT_BY));
}

/** When the "missed the last train?" check-in is sent. */
export function missedCheckInAt(choice: Pick<StationChoice, 'lastTrain'>): number {
  return lastTrainLeftAt(choice) + MISSED_CHECK_IN_AFTER_MINUTES * MINUTE_MS;
}

/** Night-out tracking ends right after the check-in (nothing is left to notify), or at 04:00 at the latest. */
export function trackingEndsAt(choice: Pick<StationChoice, 'lastTrain'>): number {
  return Math.min(missedCheckInAt(choice) + MINUTE_MS, nightClock(choice, TRACKING_OFF_BY));
}

/**
 * 04:00 after tracking was switched on: the backup that ends tracking even when
 * no plan could be made (no signal, lookups failing).
 */
export function trackingHardStopAt(startedAt: number): number {
  return serviceDayStart(startedAt) + TRACKING_OFF_BY;
}

export function rideStatus(choice: Pick<StationChoice, 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'walkingMinutes' | 'lastTrain'>, nowMs: number): RideStatus {
  if (nowMs >= lastTrainLeftAt(choice)) return 'departed';
  const recommended = recommendedLeaveTime(choice);
  const minutesLeft = (recommended - nowMs) / MINUTE_MS;
  if (nowMs > choice.leaveByMs) return 'hurry';
  if (minutesLeft <= 0) return 'now';
  if (minutesLeft <= SOON_MINUTES) return 'soon';
  return 'relaxed';
}

/**
 * When a night is over and the app should move on to the next one: once the
 * first train of the morning has left — never before the service day rolls over
 * at 04:00 (so a very early first train can't make it re-plan the same night),
 * and no later than 05:00.
 */
export function nightEndsAt(plan: Pick<NightPlan, 'lastTrain'>, firstTrain: TrainTime | null): number {
  const serviceDayEnd = nightClock(plan, 24 * HOUR_MS);
  return Math.min(Math.max(serviceDayEnd, firstTrain?.departsAt ?? 0), nightClock(plan, NIGHT_OVER_BY));
}

export function sameStation(first: StationOption, second: StationOption) {
  return first.nameJa === second.nameJa;
}

/**
 * Where the night can end. Without a home address that is simply the saved home
 * station; with one, nearby stations are worth comparing too, since a line that
 * runs later can be worth a longer walk at the other end.
 */
async function destinationOptions(home: StationOption, homeAddress: HomeAddress | null, walkingSpeed: WalkingSpeed): Promise<Array<{ station: StationOption; walkHomeMinutes?: number }>> {
  if (!homeAddress) return [{ station: home }];
  const nearHome = await findNearbyStations(homeAddress, walkingSpeed, DESTINATION_CANDIDATES + 1).catch(() => []);
  const homeWalk = nearHome.find((candidate) => sameStation(candidate.station, home))?.walk;
  const options = [
    {
      station: home,
      walkHomeMinutes: homeWalk?.walkingMinutes ?? (await walkingRoute(homeAddress, home, walkingSpeed).catch(() => null))?.walkingMinutes,
    },
  ];
  for (const candidate of nearHome) {
    if (options.length >= DESTINATION_CANDIDATES) break;
    if (sameStation(candidate.station, home)) continue;
    options.push({
      station: candidate.station,
      walkHomeMinutes: candidate.walk?.walkingMinutes,
    });
  }
  return options;
}

/**
 * The automatic pick: the closest station, unless a farther one buys meaningful
 * extra time (a better line home can beat a shorter walk, but not by a minute or two).
 */
function autoPick(options: StationChoice[]): StationChoice {
  let best = options[0];
  for (const option of options.slice(1)) {
    if (riskAdjustedLeaveTime(option) - riskAdjustedLeaveTime(best) >= FARTHER_STATION_MIN_GAIN_MINUTES * MINUTE_MS) {
      best = option;
    }
  }
  return best;
}

/** Builds the plan from evaluated stations, honouring a pinned station if it can still get the user home. */
function assemble(options: StationChoice[], pinned: StationOption | null, coordinates: Coordinates, computedAt: number): NightPlan {
  const sorted = [...options].sort((first, second) => first.walkingMinutes - second.walkingMinutes);
  const auto = autoPick(sorted);
  const pinnedChoice = pinned ? sorted.find((option) => sameStation(option.station, pinned)) : undefined;
  const chosen = pinnedChoice ?? auto;
  return {
    ...chosen,
    coordinates,
    alternatives: sorted.filter((option) => option !== chosen),
    autoPick: auto,
    pinned: pinnedChoice !== undefined,
    computedAt,
  };
}

/** Switches an existing plan to `pinned` (or back to the automatic pick with null) without new lookups. */
export function repick(plan: NightPlan, pinned: StationOption | null): NightPlan {
  const { coordinates, alternatives, autoPick: _autoPick, pinned: _pinned, computedAt, ...current } = plan;
  return assemble([current, ...alternatives], pinned, coordinates, computedAt);
}

/**
 * Evaluates the few nearest stations (plus a pinned one, even if the user has
 * walked away from it) and picks where to leave from. `nightOf` is any moment
 * in the service day to plan for; it defaults to now, but lets the app keep
 * planning for tonight while the user waits for the first train after 04:00.
 */
type DestinationOption = Awaited<ReturnType<typeof destinationOptions>>[number];

async function evaluateCandidates(
  candidates: NearbyStation[],
  destinations: DestinationOption[],
  coordinates: Coordinates,
  walkingSpeed: WalkingSpeed,
  nightOf: number,
): Promise<{ options: StationChoice[]; lookupFailed: boolean }> {
  let lookupFailed = false;
  const evaluated = await Promise.all(
    candidates.map(async ({ station, walk: knownWalk }) => {
      try {
        const walk = knownWalk ?? (await walkingRoute(coordinates, station, walkingSpeed));
        const legs = await Promise.all(
          destinations.map(async (destination): Promise<StationChoice | null> => {
            const lastTrain = await getLastTrain(station, destination.station, nightOf);
            if (!lastTrain) return null;
            const leaveByMs = lastTrain.departsAt - (walk.walkingMinutes + STATION_BUFFER_MINUTES) * MINUTE_MS;
            const base: StationChoice = {
              station,
              lastTrain,
              destination: destination.station,
              walkHomeMinutes: destination.walkHomeMinutes,
              arriveHomeMs: lastTrain.arrivesAt === undefined ? undefined : lastTrain.arrivesAt + (destination.walkHomeMinutes ?? 0) * MINUTE_MS,
              leaveByMs,
              ...walk,
            };
            const safetyMarginMinutes = recommendedSafetyMarginMinutes(base);
            return {
              ...base,
              safetyMarginMinutes,
              recommendedLeaveByMs: leaveByMs - safetyMarginMinutes * MINUTE_MS,
            };
          }),
        );
        const usable = legs.filter((leg): leg is StationChoice => leg !== null);
        if (usable.length === 0) return null;
        usable.sort((first, second) => recommendedLeaveTime(second) - recommendedLeaveTime(first) || (first.arriveHomeMs ?? Infinity) - (second.arriveHomeMs ?? Infinity));
        return usable[0];
      } catch {
        lookupFailed = true;
        return null;
      }
    }),
  );
  return {
    options: evaluated.filter((option): option is StationChoice => option !== null),
    lookupFailed,
  };
}

function learningDayTypeJst(timestamp: number): "weekday" | "weekend" {
  const day = new Date(timestamp + 9 * 60 * 60 * 1000).getUTCDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

function learningHourBucketJst(timestamp: number): number {
  return new Date(timestamp + 9 * 60 * 60 * 1000).getUTCHours();
}

async function applyLearnedTiming(
  options: StationChoice[],
  contextTimeMs: number,
): Promise<StationChoice[]> {
  if (options.length === 0) return options;

  const personalProfile = await readPersonalTimingProfile().catch(() => ({
    walkingRatios: [],
    packupSeconds: [],
    stationResidualSeconds: [],
  }));
  const hourBucket = learningHourBucketJst(contextTimeMs);
  const dayType = learningDayTypeJst(contextTimeMs);
  const queries = options.map((option) => ({
    stationKey: stationLearningKey(option.station),
    lineKey: lineLearningKey(option.lastTrain.legs?.[0]?.line),
    hourBucket,
    dayType,
  }));
  const profiles = await getStationAccessProfiles(queries).catch(
    () => [] as StationAccessProfile[],
  );
  const profileMap = new Map(
    profiles.map((profile) => [
      `${profile.stationKey}|${profile.lineKey ?? ''}`,
      profile,
    ]),
  );

  return options.map((option, index) => {
    const query = queries[index];
    const aggregate = profileMap.get(
      `${query.stationKey}|${query.lineKey ?? ''}`,
    );
    const prediction = buildTimingPrediction({
      providerWalkingMinutes: option.walkingMinutes,
      aggregateStationP90Seconds: aggregate?.p90Seconds,
      personalProfile,
    });
    const walkingMinutes = Math.max(1, Math.ceil(prediction.walkingSeconds / 60));
    const leaveByMs =
      option.lastTrain.departsAt - prediction.requiredSeconds * 1000;
    const safetyMarginMinutes = Math.max(
      FINAL_SAFETY_BUFFER_MINUTES,
      recommendedSafetyMarginMinutes({
        walkingMinutes,
        lastTrain: option.lastTrain,
      }),
    );

    return {
      ...option,
      walkingMinutes,
      providerWalkingMinutes: option.walkingMinutes,
      packupMinutes: prediction.packupSeconds / 60,
      aggregateStationAccessMinutes: prediction.aggregateStationSeconds / 60,
      stationAccessMinutes: prediction.stationAccessSeconds / 60,
      stationAccessSampleCount: aggregate?.sampleCount ?? 0,
      timingPredictionSource: prediction.source,
      leaveByMs,
      safetyMarginMinutes,
      recommendedLeaveByMs:
        leaveByMs - safetyMarginMinutes * MINUTE_MS,
    };
  });
}

async function annotateDisruptions(options: StationChoice[]): Promise<StationChoice[]> {
  const lines = [...new Set(options.flatMap((option) => option.lastTrain.legs?.map((leg) => leg.line) ?? []))].slice(0, 12);
  if (lines.length === 0) return options;

  try {
    const incidents = await getTrainDisruptions({ lines: lines.join(':') });
    if (incidents.length === 0) return options;
    return options.map((option) => ({
      ...option,
      disruptionLines: matchingDisruptionLines(option, incidents),
    }));
  } catch {
    // Disruption data is optional. Core timetable planning must still work.
    return options;
  }
}

/**
 * Broaden station discovery only when it can plausibly change the decision:
 * too few viable routes, a current service incident, or a deadline close
 * enough that another line is worth the extra provider work.
 */
export function shouldExpandStationSearch(options: StationChoice[], nowMs: number): boolean {
  if (options.length < 2) return true;
  if (options.some((option) => (option.disruptionLines?.length ?? 0) > 0)) return true;
  const bestRecommended = Math.max(...options.map((option) => recommendedLeaveTime(option)));
  return bestRecommended - nowMs <= EXPAND_SEARCH_WITHIN_MINUTES * MINUTE_MS;
}

/**
 * Evaluates the nearest stations first, then widens the search only when the
 * first pass is sparse, disrupted, or time-critical. This keeps the normal
 * provider footprint small without assuming the fourth-nearest station is
 * irrelevant in dense Japanese rail networks.
 */
export async function planNight(
  coordinates: Coordinates,
  home: StationOption,
  walkingSpeed: WalkingSpeed,
  nowMs: number,
  {
    pinned = null,
    nightOf = nowMs,
    homeAddress = null,
  }: {
    pinned?: StationOption | null;
    nightOf?: number;
    homeAddress?: HomeAddress | null;
  } = {},
): Promise<NightPlan> {
  const destinations = await destinationOptions(home, homeAddress, walkingSpeed);
  let candidates = await findNearbyStations(coordinates, walkingSpeed, CANDIDATE_STATIONS_INITIAL);
  if (pinned && !candidates.some((candidate) => sameStation(candidate.station, pinned))) {
    candidates.push({
      station: pinned,
      straightMeters: distanceBetween(coordinates, pinned),
    });
  }

  const firstPass = await evaluateCandidates(candidates, destinations, coordinates, walkingSpeed, nightOf);
  let lookupFailed = firstPass.lookupFailed;
  let options = await annotateDisruptions(await applyLearnedTiming(firstPass.options, nowMs));

  if (shouldExpandStationSearch(options, nowMs)) {
    const expanded = await findNearbyStations(coordinates, walkingSpeed, CANDIDATE_STATIONS_EXPANDED).catch(() => []);
    const known = new Set(candidates.map((candidate) => candidate.station.nameJa));
    const extra = expanded.filter((candidate) => !known.has(candidate.station.nameJa));
    if (extra.length > 0) {
      const secondPass = await evaluateCandidates(extra, destinations, coordinates, walkingSpeed, nightOf);
      lookupFailed ||= secondPass.lookupFailed;
      const learnedSecondPass = await applyLearnedTiming(secondPass.options, nowMs);
      options = await annotateDisruptions([...options, ...learnedSecondPass]);
    }
  }

  if (options.length === 0) throw new LocationError(lookupFailed ? 'unavailable' : 'no-route');
  return assemble(options, pinned, coordinates, nowMs);
}

/** A leave reminder (`minutesBefore` leave-by, 0 = "leave now") or the "missed it?" check-in. */
export type ReminderPlan = {
  minutesBefore: number;
  fireAt: number;
  missedCheckIn?: true;
};

/**
 * One reminder per selected interval, a "leave now" at leave-by itself, and a
 * "missed it?" check-in just after the last train leaves; past ones are dropped.
 */
export function buildReminderPlans(
  choice: Pick<StationChoice, 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'walkingMinutes' | 'lastTrain'>,
  intervals: number[],
  nowMs: number,
  { missedCheckIn = true }: { missedCheckIn?: boolean } = {},
): ReminderPlan[] {
  const leaveAt = recommendedLeaveTime(choice);
  const reminders: ReminderPlan[] = [...new Set([...intervals, 0])]
    .sort((first, second) => second - first)
    .map((minutesBefore) => ({
      minutesBefore,
      fireAt: leaveAt - minutesBefore * MINUTE_MS,
    }));
  if (missedCheckIn)
    reminders.push({
      minutesBefore: 0,
      fireAt: missedCheckInAt(choice),
      missedCheckIn: true,
    });
  return reminders.filter((reminder) => reminder.fireAt > nowMs + 5000);
}
