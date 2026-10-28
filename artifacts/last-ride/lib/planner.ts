/**
 * "Plan my night": from the user's position, pick the station to leave from and
 * work out when they must start walking. Shared by the React app and the
 * headless background-location task so both always agree.
 */
import { getTrainDisruptions } from '@workspace/api-client-react';
import type { HomeAddress } from '@/lib/settings';
import { matchingDisruptionLines, recommendedLeaveTime, type LeaveMargin, recommendedSafetyMarginMinutes, walkingUncertaintyMarginMinutes, riskAdjustedLeaveTime } from '@/lib/reliability';
import { distanceBetween, findNearbyStations, LocationError, walkingRoute, type Coordinates, type NearbyStation, type StationOption, type WalkingRoute, type WalkingSpeed } from '@/lib/stations';
import { MINUTE_MS, serviceDayStart } from '@/lib/time';
import { AppleLookupFailed, getLastTrain, trainsBefore, type TrainTime } from '@/lib/timetable';
import { hasPosition, resolveAddress, resolveStation } from '@/lib/storedPlaces';

/** Time from the station entrance to the platform (gates, stairs, finding the right line). */
export const STATION_BUFFER_MINUTES = 3;
/** Walking times use an ordinary pace; how much time to spare is the user's 余裕 setting. */
const WALKING_PACE: WalkingSpeed = 'normal';
const CANDIDATE_STATIONS_INITIAL = 3;
const CANDIDATE_STATIONS_EXPANDED = 6;
/** Closer than this to the home station and with no train found, the user is simply near home. */
const NEAR_HOME_METERS = 1500;
/** While tracking, re-plan only after moving this far from the last plan, or once it is this old. */
const REPLAN_DISTANCE_METERS = 300;
const REPLAN_AFTER_MS = 10 * MINUTE_MS;

/** Location updates arrive every 150–200 m; most don't change the plan, so skip them to save API calls. */
export function shouldReplan(previous: NightPlan | null, coordinates: Coordinates, nowMs: number): boolean {
  if (!previous) return true;
  // The train a frozen plan was held for has left: re-plan from here at once.
  if (previous.frozenUntil !== undefined && nowMs >= previous.frozenUntil) return true;
  return distanceBetween(previous.coordinates, coordinates) >= REPLAN_DISTANCE_METERS || nowMs - previous.computedAt >= REPLAN_AFTER_MS;
}

/**
 * How closely to follow the user while the app is closed. More than an hour
 * before leaving, a rough position every ~500 m is enough (the plan barely
 * moves) and saves battery; in the last hour, the usual ~200 m.
 */
export type LocationProfile = 'light' | 'normal';
const LIGHT_TRACKING_BEFORE_MS = 60 * MINUTE_MS;

export function locationProfile(plan: StationChoice | null, nowMs: number): LocationProfile {
  if (!plan) return 'normal';
  // The night's last train has gone: nothing to follow closely until tracking stops.
  if (nowMs >= lastTrainLeftAt(plan)) return 'light';
  return recommendedLeaveTime(plan) - nowMs > LIGHT_TRACKING_BEFORE_MS ? 'light' : 'normal';
}

/**
 * A farther station must let the user leave at least this much later, plus each
 * extra minute of walking, to be worth a longer walk at night.
 */
const FARTHER_STATION_MIN_GAIN_MINUTES = 10;
/** Never an automatic pick past this walk while a closer station gets the user home. */
const LONG_WALK_MINUTES = 20;
/** Re-planning from (about) the same spot: walks found last time are used again. */
const SAME_SPOT_METERS = 100;
/** Apple's station search failed: the last plan's stations stand in when it was made this close. */
const RECENT_STATIONS_METERS = 2000;
/** A station whose lookup fails keeps the result from a plan at most this old. */
const KEEP_RESULT_MS = 20 * MINUTE_MS;

/** One station the user could head for, and the train home from it. */
export type StationChoice = {
  station: StationOption;
  walkingMinutes: number;
  distanceMeters: number;
  /** Optional for older saved plans; unknown walking routes are treated as estimates. */
  walkingSource?: WalkingRoute['source'];
  /** The walk's route shape (Apple's), for the map card's line; absent for estimates and older plans. */
  walkPath?: Coordinates[];
  lastTrain: TrainTime;
  /** Absolute/latest practical time to start walking, epoch ms. */
  leaveByMs: number;
  /** Recommended departure with uncertainty margin. Older saved plans may omit it. */
  recommendedLeaveByMs?: number;
  /** Minutes between the recommended and absolute deadlines. */
  safetyMarginMinutes?: number;
  /** Current provider-reported service incidents affecting this route. */
  disruptionLines?: string[];
  /** Station this train arrives at — the home station unless a home address opened up a better one. */
  destination: StationOption;
  /** Walk from that station to the home address, when one is set. */
  walkHomeMinutes?: number;
  /** At the user's door, epoch ms — arrival plus that walk. */
  arriveHomeMs?: number;
  /**
   * Set when `lastTrain` is an earlier train the user chose (1本前 = 1, 2本前 = 2):
   * the real last train is then `nightLastTrain`, which still decides when the
   * night's last train has gone (status, the "missed it?" check-in, tracking end).
   */
  trainChoice?: number;
  nightLastTrain?: TrainTime;
  /** Recommended leave time for the real last train (when a later slot is used after a station change). */
  nightLastLeaveAt?: number;
  /**
   * With 2本前 chosen: the trains between it and the real last train (1本前),
   * earliest first. Once the chosen train has left, the plan moves on to these.
   */
  nightLaterTrains?: TrainTime[];
  /**
   * Set while "on the way" (lib/onTheWay.ts): the departure of the train the
   * plan is held for. Once it has passed, the next update re-plans from here.
   */
  frozenUntil?: number;
  /**
   * Set on a station's result carried over from an earlier plan because its
   * lookup failed (lib/planner keptResult): when it was really looked up. Kept
   * results older than KEEP_RESULT_MS are dropped, however many plans carried them.
   */
  keptSince?: number;
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

type NightChoice = Pick<StationChoice, 'lastTrain' | 'nightLastTrain'>;

/** When the app treats the night's last train as gone: its departure, or 01:30 at the latest. */
export function lastTrainLeftAt(choice: NightChoice): number {
  const last = choice.nightLastTrain ?? choice.lastTrain;
  return Math.min(last.departsAt, nightClock({ lastTrain: last }, LAST_TRAIN_LEFT_BY));
}

/** When the "missed the last train?" check-in is sent (always after the real last train). */
export function missedCheckInAt(choice: NightChoice): number {
  return lastTrainLeftAt(choice) + MISSED_CHECK_IN_AFTER_MINUTES * MINUTE_MS;
}

/** Night-out tracking ends right after the check-in (nothing is left to notify), or at 04:00 at the latest. */
export function trackingEndsAt(choice: NightChoice): number {
  return Math.min(missedCheckInAt(choice) + MINUTE_MS, nightClock(choice, TRACKING_OFF_BY));
}

/**
 * 04:00 after tracking was switched on: the backup that ends tracking even when
 * no plan could be made (no signal, lookups failing).
 */
export function trackingHardStopAt(startedAt: number): number {
  return serviceDayStart(startedAt) + TRACKING_OFF_BY;
}

export function rideStatus(choice: Pick<StationChoice, 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'walkingMinutes' | 'lastTrain' | 'nightLastTrain'>, nowMs: number): RideStatus {
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
 * and no later than 05:00. While the first train is still being looked up the
 * night stays open until 05:00, so an in-flight lookup can't end it early.
 */
export function nightEndsAt(
  plan: Pick<NightPlan, 'lastTrain'>,
  firstTrain: TrainTime | null,
  { firstTrainPending = false }: { firstTrainPending?: boolean } = {},
): number {
  // Still looking the first train up: don't let "unknown" end the night at 04:00.
  if (firstTrainPending) return nightClock(plan, NIGHT_OVER_BY);
  const serviceDayEnd = nightClock(plan, 24 * HOUR_MS);
  return Math.min(Math.max(serviceDayEnd, firstTrain?.departsAt ?? 0), nightClock(plan, NIGHT_OVER_BY));
}

/**
 * Which night a fresh plan (no plan yet) is for. Between 04:00 and 05:00 it is
 * the night just ending: someone opening the app then is almost certainly
 * still out, waiting for the first train, not planning tomorrow night.
 * nightEndsAt then moves on to the next night once the first train has left.
 */
export function freshPlanNightOf(nowMs: number): number {
  const dayStart = serviceDayStart(nowMs);
  return nowMs - dayStart < NIGHT_OVER_BY - 24 * HOUR_MS ? dayStart - 1 : nowMs;
}

/**
 * When to look for the first train from: after tonight's last train, except
 * between 03:00 and 05:00, when the next one from now is this morning's 始発
 * (someone still out needs it, even if the plan has moved on to the coming night).
 */
export function firstTrainSearchFrom(lastTrainDepartsAt: number, nowMs: number): number {
  const intoServiceDay = nowMs - serviceDayStart(nowMs);
  const earlyMorning = intoServiceDay >= 23 * HOUR_MS || intoServiceDay < NIGHT_OVER_BY - 24 * HOUR_MS;
  return earlyMorning ? nowMs : Math.max(nowMs, lastTrainDepartsAt);
}

/** The latest a night's last train can arrive (03:00 after it): past this, the night is over. */
const NIGHT_DEADLINE = 23 * HOUR_MS;

/**
 * The coming night, when the one being planned is already over (after 03:00).
 * Apple Maps only answers about future trips, so routes it alone covers can't
 * be looked up for a night that has ended; planning the coming night beats
 * showing no train at all.
 */
export function nextNightOf(nightOf: number, nowMs: number): number | null {
  const dayStart = serviceDayStart(nightOf);
  if (nowMs < dayStart + NIGHT_DEADLINE) return null;
  return Math.max(nowMs, dayStart + 24 * HOUR_MS);
}

export function sameStation(first: StationOption, second: StationOption) {
  return first.nameJa === second.nameJa;
}

/**
 * Where the night can end. Without a home address that is simply the saved home
 * station; with one, nearby stations are worth comparing too, since a line that
 * runs later can be worth a longer walk at the other end.
 */
async function destinationOptions(home: StationOption, homeAddress: HomeAddress | null): Promise<Array<{ station: StationOption; walkHomeMinutes?: number }>> {
  if (!homeAddress) return [{ station: home }];
  const nearHome = await findNearbyStations(homeAddress, WALKING_PACE, DESTINATION_CANDIDATES + 1).catch(() => []);
  const homeWalk = nearHome.find((candidate) => sameStation(candidate.station, home))?.walk;
  const options = [
    {
      station: home,
      walkHomeMinutes: homeWalk?.walkingMinutes ?? (await walkingRoute(homeAddress, home, WALKING_PACE).catch(() => null))?.walkingMinutes,
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
 * extra time (a better line home can beat a shorter walk, but not by a minute or
 * two): 10 minutes plus the extra walk. A walk over 20 minutes only when no
 * closer station works. A clean route beating a disrupted one needs just the 10.
 */
function autoPick(options: StationChoice[]): StationChoice {
  let best = options[0];
  for (const option of options.slice(1)) {
    if (option.walkingMinutes > LONG_WALK_MINUTES && best.walkingMinutes <= LONG_WALK_MINUTES) continue;
    // A 目安 time (Apple's answer may be a walk, not a train) never beats a closer station.
    if (option.lastTrain.approximate) continue;
    const avoidsDisruption = (best.disruptionLines?.length ?? 0) > 0 && (option.disruptionLines?.length ?? 0) === 0;
    const extraWalk = avoidsDisruption ? 0 : Math.max(0, option.walkingMinutes - best.walkingMinutes);
    if (riskAdjustedLeaveTime(option) - riskAdjustedLeaveTime(best) >= (FARTHER_STATION_MIN_GAIN_MINUTES + extraWalk) * MINUTE_MS) {
      best = option;
    }
  }
  return best;
}

/** Builds the plan from evaluated stations, honouring a pinned station if it can still get the user home. */
function assemble(options: StationChoice[], pinned: StationOption | null, coordinates: Coordinates, computedAt: number): NightPlan {
  const sorted = [...options].sort((first, second) => first.walkingMinutes - second.walkingMinutes);
  // A station whose last train has already left is never the automatic pick while
  // another still has one (e.g. after missing it, a farther line runs later).
  const running = sorted.filter((option) => option.lastTrain.departsAt > computedAt);
  const auto = autoPick(running.length > 0 ? running : sorted);
  // A pinned station whose last train has gone, while another still runs, can't get
  // the user home: back to automatic (the app and the background task say so).
  const pinnedChoice = pinned ? (running.length > 0 ? running : sorted).find((option) => sameStation(option.station, pinned)) : undefined;
  const chosen = pinnedChoice ?? auto;
  const { station, walkingMinutes, distanceMeters, walkingSource, walkPath, lastTrain, leaveByMs, recommendedLeaveByMs, safetyMarginMinutes, disruptionLines, destination, walkHomeMinutes, arriveHomeMs } = chosen;
  return {
    station,
    walkingMinutes,
    distanceMeters,
    walkingSource,
    walkPath,
    lastTrain,
    leaveByMs,
    recommendedLeaveByMs,
    safetyMarginMinutes,
    disruptionLines,
    destination,
    walkHomeMinutes,
    arriveHomeMs,
    coordinates,
    alternatives: sorted.filter((option) => option !== chosen),
    autoPick: auto,
    pinned: pinnedChoice !== undefined,
    computedAt,
  };
}

/** Always reserve extra time when we could not verify a pedestrian route.
 * A factor-of-1.3 approximation is neither a lower nor upper travel-time bound.
 * This deliberate cushion complements the user's preferred 余裕; it cannot
 * guarantee an accessible route and must be labelled as an estimate in UI. */
export function planSafetyMarginMinutes(
  choice: Pick<StationChoice, 'walkingMinutes' | 'walkingSource' | 'lastTrain'>,
  leaveMargin: LeaveMargin,
): number {
  return recommendedSafetyMarginMinutes(choice, leaveMargin) +
    walkingUncertaintyMarginMinutes(choice.walkingMinutes, choice.walkingSource);
}

/** The same choice with a new 余裕 (no lookups: only the recommended leave time moves). */
export function withMargin<T extends StationChoice>(choice: T, leaveMargin: LeaveMargin): T {
  const safetyMarginMinutes = planSafetyMarginMinutes(choice, leaveMargin);
  return { ...choice, safetyMarginMinutes, recommendedLeaveByMs: choice.leaveByMs - safetyMarginMinutes * MINUTE_MS };
}

/** A plan with a new 余裕 applied to every station in it, instantly. */
export function replanMargin(plan: NightPlan, leaveMargin: LeaveMargin): NightPlan {
  return {
    ...withMargin(plan, leaveMargin),
    alternatives: plan.alternatives.map((option) => withMargin(option, leaveMargin)),
    autoPick: withMargin(plan.autoPick, leaveMargin),
  };
}

/** Switches an existing plan to `pinned` (or back to the automatic pick with null) without new lookups. */
export function repick(plan: NightPlan, pinned: StationOption | null): NightPlan {
  const { station, walkingMinutes, distanceMeters, walkingSource, walkPath, lastTrain, leaveByMs, recommendedLeaveByMs, safetyMarginMinutes, disruptionLines, destination, walkHomeMinutes, arriveHomeMs } = plan;
  const current: StationChoice = {
    station,
    walkingMinutes,
    distanceMeters,
    walkingSource,
    walkPath,
    lastTrain,
    leaveByMs,
    recommendedLeaveByMs,
    safetyMarginMinutes,
    disruptionLines,
    destination,
    walkHomeMinutes,
    arriveHomeMs,
  };
  return assemble([current, ...plan.alternatives], pinned, plan.coordinates, plan.computedAt);
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
  leaveMargin: LeaveMargin,
  nightOf: number,
  earlier: Map<string, StationChoice> = new Map(),
): Promise<{ options: StationChoice[]; lookupFailed: boolean }> {
  let lookupFailed = false;
  const evaluated = await Promise.all(
    candidates.map(async ({ station, walk: knownWalk }) => {
      // The walk from here, once found: a kept result uses it rather than the old one.
      let walkHere = knownWalk;
      try {
        const walk = knownWalk ?? (await walkingRoute(coordinates, station, WALKING_PACE));
        walkHere = walk;
        // A failed destination is set aside, not fatal: another may still answer.
        const failures: unknown[] = [];
        const legs = await Promise.all(
          destinations.map(async (destination): Promise<StationChoice | null> => {
            // A single operator/provider failure must not discard another
            // destination's successful train lookup for this same station.
            let lastTrain: TrainTime | null;
            try {
              lastTrain = await getLastTrain(station, destination.station, nightOf);
            } catch (error) {
              failures.push(error);
              return null;
            }
            if (!lastTrain) return null;
            const leaveByMs = lastTrain.departsAt - (walk.walkingMinutes + STATION_BUFFER_MINUTES) * MINUTE_MS;
            const base: StationChoice = {
              station,
              lastTrain,
              destination: destination.station,
              walkHomeMinutes: destination.walkHomeMinutes,
              arriveHomeMs: lastTrain.arrivesAt === undefined ? undefined : lastTrain.arrivesAt + (destination.walkHomeMinutes ?? 0) * MINUTE_MS,
              leaveByMs,
              walkingMinutes: walk.walkingMinutes,
              distanceMeters: walk.distanceMeters,
              walkingSource: walk.source,
              walkPath: walk.path,
            };
            const safetyMarginMinutes = planSafetyMarginMinutes(base, leaveMargin);
            return {
              ...base,
              safetyMarginMinutes,
              recommendedLeaveByMs: leaveByMs - safetyMarginMinutes * MINUTE_MS,
            };
          }),
        );
        const usable = legs.filter((leg): leg is StationChoice => leg !== null);
        // Every destination failed (none just had no train): the station failed,
        // so the catch below keeps its result from the plan before.
        if (usable.length === 0 && failures.length > 0) throw failures.find((error) => !(error instanceof AppleLookupFailed)) ?? failures[0];
        if (usable.length === 0) return null;
        // Exact times before 目安 ones (an approximate answer may be a walk), then the latest leave time.
        usable.sort((first, second) =>
          Number(!!first.lastTrain.approximate) - Number(!!second.lastTrain.approximate) ||
          recommendedLeaveTime(second) - recommendedLeaveTime(first) ||
          (first.arriveHomeMs ?? Infinity) - (second.arriveHomeMs ?? Infinity));
        return usable[0];
      } catch (error) {
        // Apple's request limit or a dropped connection: keep this station's last
        // result rather than lose it (and let a far station win by default).
        const kept = earlier.get(station.nameJa);
        if (kept) return keptResult(kept, walkHere, leaveMargin);
        // Apple-only route that failed with nothing to keep: as before, no train found.
        if (error instanceof AppleLookupFailed) return null;
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

/** A station's result from the plan before, with this spot's walk when it is known. */
function keptResult(kept: StationChoice, walk: NearbyStation['walk'], leaveMargin: LeaveMargin): StationChoice {
  const { disruptionLines: _disruptionLines, ...choice } = kept;
  if (!walk) return choice;
  const leaveByMs = choice.lastTrain.departsAt - (walk.walkingMinutes + STATION_BUFFER_MINUTES) * MINUTE_MS;
  // The walk's own fields only: whether it's a real route decides 「（推定）」 and the extra margin.
  return withMargin({ ...choice, walkingMinutes: walk.walkingMinutes, distanceMeters: walk.distanceMeters, walkingSource: walk.source, walkPath: walk.path, leaveByMs }, leaveMargin);
}

/**
 * The previous plan's stations, when looked up recently and for the same night.
 * Only a station's own fields (not the whole plan), marked with when they were
 * really looked up, so a result can't ride along from plan to plan for ever.
 */
function earlierResults(previous: NightPlan | null, nightOf: number, nowMs: number): Map<string, StationChoice> {
  const results = new Map<string, StationChoice>();
  if (!previous) return results;
  if (serviceDayStart(previous.lastTrain.departsAt) !== serviceDayStart(nightOf)) return results;
  for (const option of [previous, ...(previous.alternatives ?? [])]) {
    const lookedUpAt = option.keptSince ?? previous.computedAt;
    if (nowMs - lookedUpAt > KEEP_RESULT_MS) continue;
    const { station, walkingMinutes, distanceMeters, walkingSource, walkPath, lastTrain, leaveByMs, recommendedLeaveByMs, safetyMarginMinutes, disruptionLines, destination, walkHomeMinutes, arriveHomeMs } = option;
    results.set(station.nameJa, { station, walkingMinutes, distanceMeters, walkingSource, walkPath, lastTrain, leaveByMs, recommendedLeaveByMs, safetyMarginMinutes, disruptionLines, destination, walkHomeMinutes, arriveHomeMs, keptSince: lookedUpAt });
  }
  return results;
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
 * too few viable routes, or a current service incident on one of them.
 * Not merely because the deadline is near: that is when the app is used most,
 * so it would double provider calls on nearly every plan, and a farther
 * station means a longer walk exactly when there is least time for one.
 */
export function shouldExpandStationSearch(options: StationChoice[]): boolean {
  if (options.length < 2) return true;
  return options.some((option) => (option.disruptionLines?.length ?? 0) > 0);
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
  leaveMargin: LeaveMargin,
  nowMs: number,
  {
    pinned = null,
    nightOf = nowMs,
    homeAddress = null,
    previous = null,
  }: {
    pinned?: StationOption | null;
    nightOf?: number;
    homeAddress?: HomeAddress | null;
    /** The plan before (tracking): its walks are reused from the same spot, and its results kept when a lookup fails. */
    previous?: NightPlan | null;
  } = {},
): Promise<NightPlan> {
  // Saved places are stored by name (lib/storedPlaces): find their positions first.
  const destination = await resolveStation(home);
  if (!hasPosition(destination)) throw new LocationError('unavailable');
  const address = homeAddress ? await resolveAddress(homeAddress) : null;
  const destinations = await destinationOptions(destination, address && hasPosition(address) ? address : null);
  const earlier = earlierResults(previous, nightOf, nowMs);
  // Barely moved: the walks found last time still hold, so Apple isn't asked again.
  const knownWalks = previous && earlier.size > 0 && distanceBetween(previous.coordinates, coordinates) <= SAME_SPOT_METERS
    ? new Map(
        [...earlier]
          // Only Apple's own routes, with their shape: an estimate (or a walk from an
          // older plan that didn't record its source) is looked up again, or it would
          // be passed from plan to plan and never become a real route with a map line.
          .filter(([, option]) => option.walkingSource === 'routed' && (option.walkPath?.length ?? 0) > 1)
          .map(([name, option]) => [name, { walkingMinutes: option.walkingMinutes, distanceMeters: option.distanceMeters, source: 'routed' as const, path: option.walkPath }]),
      )
    : undefined;
  // If Apple's station search fails, the last plan's stations stand in (lib/stations).
  const recent = previous && distanceBetween(previous.coordinates, coordinates) <= RECENT_STATIONS_METERS
    ? [previous, ...previous.alternatives].map((option) => option.station)
    : [];
  let candidates = await findNearbyStations(coordinates, WALKING_PACE, CANDIDATE_STATIONS_INITIAL, knownWalks, recent);
  if (pinned && !candidates.some((candidate) => sameStation(candidate.station, pinned))) {
    candidates.push({
      station: pinned,
      straightMeters: distanceBetween(coordinates, pinned),
    });
  }

  const firstPass = await evaluateCandidates(candidates, destinations, coordinates, leaveMargin, nightOf, earlier);
  let lookupFailed = firstPass.lookupFailed;
  let options = await annotateDisruptions(firstPass.options);

  if (shouldExpandStationSearch(options)) {
    const expanded = await findNearbyStations(coordinates, WALKING_PACE, CANDIDATE_STATIONS_EXPANDED, knownWalks, recent).catch(() => []);
    const known = new Set(candidates.map((candidate) => candidate.station.nameJa));
    const extra = expanded.filter((candidate) => !known.has(candidate.station.nameJa));
    if (extra.length > 0) {
      const secondPass = await evaluateCandidates(extra, destinations, coordinates, leaveMargin, nightOf, earlier);
      lookupFailed ||= secondPass.lookupFailed;
      options = await annotateDisruptions([...options, ...secondPass.options]);
    }
  }

  if (options.length === 0) {
    // That night is over and only Apple Maps covers this route: plan the coming night.
    const comingNight = lookupFailed ? null : nextNightOf(nightOf, nowMs);
    if (comingNight !== null)
      return planNight(coordinates, home, leaveMargin, nowMs, { pinned, nightOf: comingNight, homeAddress, previous });
    if (lookupFailed) throw new LocationError('unavailable');
    // At (or a walk from) the home station there is no train to take: say so instead of an error.
    const nearHome = destinations.some(
      ({ station }) =>
        candidates.some((candidate) => sameStation(candidate.station, station)) ||
        distanceBetween(coordinates, station) <= NEAR_HOME_METERS,
    );
    throw new LocationError(nearHome ? 'near-home' : 'no-route');
  }
  return withTrainsBefore(assemble(options, pinned, coordinates, nowMs), nowMs);
}

/**
 * The plan with the trains before its last train filled in (1本前, 2本前). The
 * server sends them with every station's last train; Apple's are looked up
 * here, for the chosen station only. Never fails: no earlier trains is fine.
 */
export async function withTrainsBefore(plan: NightPlan, nowMs: number): Promise<NightPlan> {
  if (plan.lastTrain.before) return plan;
  const before = await trainsBefore(plan.station, plan.destination, plan.lastTrain, nowMs).catch(() => []);
  return { ...plan, lastTrain: { ...plan.lastTrain, before } };
}

/** A leave reminder (`minutesBefore` leave-by, 0 = "leave now") or the "missed it?" check-in. */
export type ReminderPlan = {
  minutesBefore: number;
  fireAt: number;
  missedCheckIn?: true;
  /**
   * Heading for an earlier train (1本前 / 2本前): at its departure, "did you make
   * it?" with 〔乗った〕 / 〔乗れなかった〕 (lib/boarding.ts). No leave time for the
   * next train in it: that is only known once re-planned from where the user is.
   */
  boardedCheck?: true;
  /** Delivered as an alarm (AlarmKit) rather than a notification. */
  alarm?: true;
};

/**
 * One reminder per chosen time (`intervals` as notifications, `alarmIntervals`
 * as alarms; 0 = at the leave time) and a "missed it?" check-in just after the
 * last train leaves; past ones are dropped. Nothing is added unless chosen.
 */
export function buildReminderPlans(
  choice: Pick<StationChoice, 'leaveByMs' | 'recommendedLeaveByMs' | 'safetyMarginMinutes' | 'walkingMinutes' | 'lastTrain' | 'nightLastTrain' | 'nightLastLeaveAt'>,
  intervals: number[],
  nowMs: number,
  {
    missedCheckIn = true,
    alarmIntervals = [],
    includePast = false,
  }: {
    missedCheckIn?: boolean;
    alarmIntervals?: number[];
    /** Keep reminders whose time has passed (lib/reminderLedger decides on catch-up). */
    includePast?: boolean;
  } = {},
): ReminderPlan[] {
  const leaveAt = recommendedLeaveTime(choice);
  const reminders: ReminderPlan[] = [...new Set([...intervals, ...alarmIntervals])]
    .sort((first, second) => second - first)
    .map((minutesBefore) => ({
      minutesBefore,
      fireAt: leaveAt - minutesBefore * MINUTE_MS,
      ...(alarmIntervals.includes(minutesBefore) ? { alarm: true as const } : {}),
    }));
  // Heading for an earlier train: when it departs, ask whether it was caught.
  if (choice.nightLastTrain) reminders.push({ minutesBefore: 0, fireAt: choice.lastTrain.departsAt, boardedCheck: true });
  if (missedCheckIn)
    reminders.push({
      minutesBefore: 0,
      fireAt: missedCheckInAt(choice),
      missedCheckIn: true,
    });
  return includePast ? reminders : reminders.filter((reminder) => reminder.fireAt > nowMs + 5000);
}
