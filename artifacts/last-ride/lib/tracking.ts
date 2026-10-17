/**
 * "Night out" background tracking.
 *
 * While tracking is on, the OS wakes this task as the user moves. The task
 * re-plans the night (station, walking time, leave-by), reschedules
 * the reminder notifications, and stores a snapshot the UI reads when the app
 * comes back to the foreground.
 *
 * Background location requires a development/production build; in Expo Go and
 * on web we fall back to foreground-only tracking (updates while the app is open).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { syncEnterpriseLeaveBy } from '@/lib/enterpriseParticipation';
import { holdOnTheWay, keepOnTheWay } from '@/lib/onTheWay';
import { heldTrain, readAnswered, readBoarded } from '@/lib/boarding';
import { recommendedLeaveTime } from '@/lib/reliability';
import { endLiveActivity, syncLiveActivity } from '@/lib/liveActivity';
import { syncWidgets } from '@/lib/widgets';
import { notifyLockFallback, scheduleReminders, cancelAllReminders } from '@/lib/notifications';
import { buildReminderPlans, planNight, sameStation, shouldReplan, trackingEndsAt, trackingHardStopAt, type NightPlan } from '@/lib/planner';
import { hasCoordinates, readSettings, readTrainChoiceOverride, trainChoiceUntil, writePinnedStation, writeTrainChoiceOverride, readReminderTimes } from '@/lib/settings';
import { applyTrainChoice, choiceAt, closestChoice, effectiveTrainChoice, trainChoiceLabel, trainOptions } from '@/lib/trainChoice';
import type { Coordinates } from '@/lib/stations';
import { formatJstTime, serviceDate } from '@/lib/time';
import { syncSharedLeaveBy } from '@/lib/groupSharing';

export const LOCATION_TASK = 'lastride-night-tracking';
const SNAPSHOT_KEY = 'lastride-tracking-snapshot';
const SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1000;
// Durable on/off flag — the headless task checks it before committing anything,
// so a location callback still in flight after "stop" cannot resurrect reminders.
const TRACKING_ACTIVE_KEY = 'lastride-tracking-active';
/** When the user switched tracking on, for the 04:00 backup that ends it. */
const TRACKING_STARTED_KEY = 'lastride-tracking-started-at';

export async function markTrackingStarted(startedAt: number): Promise<void> {
  await AsyncStorage.setItem(TRACKING_STARTED_KEY, String(startedAt)).catch(() => undefined);
}

export async function readTrackingStartedAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(TRACKING_STARTED_KEY).catch(() => null);
  const startedAt = raw ? Number(raw) : NaN;
  return Number.isFinite(startedAt) ? startedAt : null;
}

export async function isTrackingFlagOn(): Promise<boolean> {
  return (await AsyncStorage.getItem(TRACKING_ACTIVE_KEY).catch(() => null)) === 'true';
}

async function recomputeFromLocation(coordinates: Coordinates): Promise<void> {
  const settings = await readSettings();
  if (!settings.homeStation) return; // planNight finds its position
  const now = Date.now();
  const [previous, startedAt] = await Promise.all([readTrackingSnapshot(), readTrackingStartedAt()]);
  // The night's notifications are all sent (or it's past 04:00): switch tracking off.
  // iOS only wakes the app on movement, so this runs at the first update after the deadline.
  if ((previous && now >= trackingEndsAt(previous)) || (startedAt !== null && now >= trackingHardStopAt(startedAt))) {
    await stopBackgroundTracking();
    return;
  }
  // 〔乗った〕: on the earlier train, the night is over (lib/boarding.ts).
  if (await readBoarded(now)) {
    await stopBackgroundTracking();
    await cancelAllReminders().catch(() => undefined);
    return;
  }
  if (!shouldReplan(previous, coordinates, now)) return;
  let override = await readTrainChoiceOverride(now);
  // The plan in force before this update, with tonight's train choice.
  const before = previous ? trainOptions(previous, settings.leaveMargin, now) : [];
  const previousPlan = previous ? applyTrainChoice(previous, before, effectiveTrainChoice(before, choiceAt(settings.trainChoice, override, previous.station.nameJa))) : null;
  // On the way (past the leave time, train not gone): keep tonight's station and
  // times until the train departs, then re-plan from here (lib/onTheWay.ts).
  const kept = previous && previousPlan && holdOnTheWay(previous, previousPlan, now)
    ? keepOnTheWay(previous, coordinates, now, previousPlan.lastTrain.departsAt)
    : null;
  const basePlan = kept ?? await planNight(coordinates, settings.homeStation, settings.leaveMargin, now, { pinned: settings.pinnedStation, homeAddress: settings.homeAddress });
  if (!(await isTrackingFlagOn())) return; // stopped while we were computing
  // The station locked for tonight can't get you home any more: back to automatic, and say so.
  if (settings.pinnedStation && !basePlan.pinned) {
    await writePinnedStation(null);
    await notifyLockFallback(settings.pinnedStation, basePlan, settings.language ?? 'en').catch(() => undefined);
  }
  // The snapshot keeps the plan as found; the app applies tonight's train choice itself.
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(basePlan));
  // 終電 / 1本前 / 2本前, falling back to a later train once the chosen one can't be made.
  // After an automatic station change, the train there with the closest leave time.
  if (previous && previousPlan && settings.trainChoice > 0 && !sameStation(previous.station, basePlan.station) && override?.station !== basePlan.station.nameJa) {
    const choice = closestChoice(trainOptions(basePlan, settings.leaveMargin, now), recommendedLeaveTime(previousPlan));
    override = choice === settings.trainChoice
      ? null
      : { station: basePlan.station.nameJa, fromStation: previous.station.nameJa, choice, until: trainChoiceUntil(basePlan.lastTrain.departsAt) };
    await writeTrainChoiceOverride(override);
  }
  const options = trainOptions(basePlan, settings.leaveMargin, now);
  const preferred = choiceAt(settings.trainChoice, override, basePlan.station.nameJa);
  const effective = effectiveTrainChoice(options, preferred);
  // The earlier train headed for has departed and 乗れましたか？ isn't answered: one follow-up (lib/boarding.ts).
  const gone = preferred > effective ? options.find((option) => option.choice === effective + 1 && !option.catchable) : undefined;
  const goneAt = gone?.station.lastTrain.departsAt;
  // Only from a plan made after the departure (not one still held), so the times are real.
  const followUpFor = goneAt !== undefined && basePlan.computedAt >= goneAt && !basePlan.frozenUntil && (await readAnswered()) !== goneAt ? goneAt : undefined;
  const plan = applyTrainChoice(basePlan, options, effective);
  const language = settings.language ?? 'en';
  // Read again now: the user may have changed reminders or alarms while this ran.
  const times = await readReminderTimes();
  await scheduleReminders(buildReminderPlans(plan, times.reminderIntervals, now, { missedCheckIn: settings.missedCheckIn, alarmIntervals: times.alarmIntervals, includePast: true }), {
    leaveBy: formatJstTime(recommendedLeaveTime(plan)),
    station: language === 'ja' ? plan.station.nameJa : plan.station.name,
    language,
    held: heldTrain(plan, language === 'ja'),
  }, { sound: settings.alarmSound, vibrate: settings.reminderVibrate }, {
    night: serviceDate((plan.nightLastTrain ?? plan.lastTrain).departsAt),
    choiceKey: String(settings.trainChoice),
    stationKey: plan.station.nameJa,
    leaveAtMs: recommendedLeaveTime(plan),
    trainDepartsAtMs: plan.lastTrain.departsAt,
    trainLabel: trainChoiceLabel(effective, language === 'ja'),
    trainDeparts: formatJstTime(plan.lastTrain.departsAt),
    switchedToClosest: override?.station === plan.station.nameJa,
    followUpFor,
    followUpLabel: gone ? trainChoiceLabel(gone.choice, language === 'ja') : undefined,
  });
  await syncLiveActivity(plan, language, now).catch(() => undefined);
  const destinationLabel = settings.tonightDestination
    ? language === 'ja' ? settings.tonightDestination.nameJa : settings.tonightDestination.name
    : settings.destinations.find((destination) => destination.id === settings.activeDestinationId)?.label ?? (language === 'ja' ? plan.destination.nameJa : plan.destination.name);
  await syncWidgets(plan, destinationLabel, language, now).catch(() => undefined);
  await syncEnterpriseLeaveBy(recommendedLeaveTime(plan)).catch(() => undefined);
  // Groups you're sharing with tonight get the new time (if it moved a minute or more),
  // so friends' alerts are right even with LastRide closed.
  await syncSharedLeaveBy(recommendedLeaveTime(plan)).catch(() => undefined);
}

// Must be registered at module scope so the OS can invoke it headlessly.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const { locations } = data as { locations?: Array<{ coords: { latitude: number; longitude: number } }> };
    const latest = locations?.[locations.length - 1];
    if (!latest) return;
    if (!(await isTrackingFlagOn())) return;
    try {
      await recomputeFromLocation({ latitude: latest.coords.latitude, longitude: latest.coords.longitude });
    } catch {
      // Transient network failures are fine — the next location update retries.
    }
  });
}

/** Whether background location is already allowed, so no OS prompt (or disclosure) is needed. */
export async function hasBackgroundLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Background ("Always") location state. iOS shows its prompt for it only once:
 * after a refusal `canAskAgain` is false and only the Settings app can change it.
 */
export async function backgroundLocationState(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (Platform.OS === 'web') return { granted: false, canAskAgain: false };
  try {
    const permission = await Location.getBackgroundPermissionsAsync();
    return { granted: permission.granted, canAskAgain: permission.canAskAgain };
  } catch {
    return { granted: false, canAskAgain: true };
  }
}

/** Whether the user turned off Precise Location for the app (iOS), so positions are only approximate. */
export async function isLocationApproximate(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    return permission.granted && permission.ios?.accuracy === 'reduced';
  } catch {
    return false;
  }
}

/**
 * Asks for location up front (onboarding step 3). "background" asks for
 * foreground first, then "when closed"; returns whether that level was granted.
 */
export async function requestNightLocationPermission(level: 'foreground' | 'background'): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return false;
    if (level === 'foreground') return true;
    return (await Location.requestBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Starts OS-level background updates. Returns true if background mode is active. */
export async function startBackgroundTracking(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    if (!background.granted) return false;
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 200, // meters moved before an update
      timeInterval: 180000, // at most every 3 minutes (Android)
      // iOS would otherwise pause updates after a while in one place (a bar) and may
      // not resume until a big move: you'd leave without the plan following you.
      // Updates still only come on movement, so standing still costs little.
      pausesUpdatesAutomatically: false,
      // No blue location pill: on Dynamic Island iPhones it takes the island's
      // place and hides the Live Activity while the app is closed. Allowed with
      // "Always" location (which background tracking needs); the Live Activity
      // and iOS's status-bar arrow still show that location is in use.
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'LastRide is watching the clock',
        notificationBody: 'Tracking your nearest station for tonight.',
      },
    });
    // Only publish the durable active flag after the native task is confirmed.
    // Otherwise a failed start can leave the app believing background tracking is active.
    await AsyncStorage.setItem(TRACKING_ACTIVE_KEY, 'true');
    return true;
  } catch {
    await AsyncStorage.setItem(TRACKING_ACTIVE_KEY, 'false').catch(() => undefined);
    // Expo Go and unsupported environments land here — caller falls back to foreground tracking.
    return false;
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  await AsyncStorage.setItem(TRACKING_ACTIVE_KEY, 'false').catch(() => undefined);
  await endLiveActivity().catch(() => undefined);
  if (Platform.OS === 'web') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // Nothing to stop.
  }
}

export async function readTrackingSnapshot(): Promise<NightPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as NightPlan;
    if (typeof plan?.leaveByMs !== 'number') return null; // ignore snapshots from older app versions
    // Snapshots hold positions from Apple Maps: drop one left over from a past night.
    if (Date.now() - plan.computedAt > SNAPSHOT_MAX_AGE_MS) {
      await AsyncStorage.removeItem(SNAPSHOT_KEY).catch(() => undefined);
      return null;
    }
    return plan;
  } catch {
    return null;
  }
}

export async function clearTrackingSnapshot(): Promise<void> {
  await AsyncStorage.removeItem(SNAPSHOT_KEY).catch(() => undefined);
}
