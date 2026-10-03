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
import { recordNightPlan } from '@/lib/nightHistory';
import { scheduleReminders } from '@/lib/notifications';
import { buildReminderPlans, planNight, shouldReplan, trackingEndsAt, trackingHardStopAt, type NightPlan } from '@/lib/planner';
import { hasCoordinates, readSettings } from '@/lib/settings';
import type { Coordinates } from '@/lib/stations';
import { formatJstTime } from '@/lib/time';

export const LOCATION_TASK = 'lastride-night-tracking';
const SNAPSHOT_KEY = 'lastride-tracking-snapshot';
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
  if (!hasCoordinates(settings.homeStation)) return;
  const now = Date.now();
  const [previous, startedAt] = await Promise.all([readTrackingSnapshot(), readTrackingStartedAt()]);
  // The night's notifications are all sent (or it's past 04:00): switch tracking off.
  // iOS only wakes the app on movement, so this runs at the first update after the deadline.
  if ((previous && now >= trackingEndsAt(previous)) || (startedAt !== null && now >= trackingHardStopAt(startedAt))) {
    await stopBackgroundTracking();
    return;
  }
  if (!shouldReplan(previous, coordinates, now)) return;
  const plan = await planNight(coordinates, settings.homeStation, settings.walkingSpeed, now, { pinned: settings.pinnedStation, homeAddress: settings.homeAddress });
  if (!(await isTrackingFlagOn())) return; // stopped while we were computing
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(plan));
  const activeDestination =
    settings.destinations.find(
      (destination) => destination.id === settings.activeDestinationId,
    ) ?? settings.destinations[0];
  if (activeDestination) {
    await recordNightPlan(plan, {
      id: activeDestination.id,
      label: activeDestination.label,
    }).catch(() => undefined);
  }
  const language = settings.language ?? 'en';
  await scheduleReminders(buildReminderPlans(plan, settings.reminderIntervals, now, { missedCheckIn: settings.missedCheckIn }), {
    leaveBy: formatJstTime(plan.leaveByMs),
    station: language === 'ja' ? plan.station.nameJa : plan.station.name,
    language,
  });
  await syncEnterpriseLeaveBy(plan.leaveByMs).catch(() => undefined);
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
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: true,
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
    return typeof plan?.leaveByMs === 'number' ? plan : null; // ignore snapshots from older app versions
  } catch {
    return null;
  }
}

export async function clearTrackingSnapshot(): Promise<void> {
  await AsyncStorage.removeItem(SNAPSHOT_KEY).catch(() => undefined);
}
