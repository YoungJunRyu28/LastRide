import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ReminderPlan } from '@/lib/planner';
import type { ReminderDelivery, ReminderSound } from '@/lib/settings';
import { alarmKit, alarmKitAvailable, type AlarmAuthorization } from '../modules/last-ride-alarm/src';

let configured = false;
let channelReady = false;
const webTimers: ReturnType<typeof setTimeout>[] = [];
// Both the foreground app and the separate headless location-task JS runtime
// use these keys to replace, not accumulate, locally scheduled notifications.
const OWNED_IDS_KEY = 'lastride-owned-notification-ids';
const SIGNATURE_KEY = 'lastride-reminder-signature';
const SCHEDULER_VERSION = 4;

export { alarmKitAvailable };
export { iosMajorVersion } from '../modules/last-ride-alarm/src';
export const alarmAuthorizationStatus = (): Promise<AlarmAuthorization> => alarmKit.status();
/** Called from an explicit user action, never from a headless background task. */
export const requestAlarmAuthorization = (): Promise<AlarmAuthorization> => alarmKit.request();

async function readOwnedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(OWNED_IDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

async function writeOwnedIds(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(OWNED_IDS_KEY, JSON.stringify(ids)).catch(() => undefined);
}

// Serializes all schedule/cancel operations so an older reschedule can never
// cancel or overwrite a newer one.
let queue: Promise<void> = Promise.resolve();
function enqueue(operation: () => Promise<void>): Promise<void> {
  queue = queue.then(operation, operation);
  return queue;
}

function configure() {
  if (configured || Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  configured = true;
}

async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync('leave-reminders', {
      name: 'Leave reminders', importance: Notifications.AndroidImportance.HIGH,
      sound: 'default', enableVibrate: true, vibrationPattern: [0, 250, 250, 250],
    }),
    Notifications.setNotificationChannelAsync('leave-reminders-no-vibrate', {
      name: 'Leave reminders (no vibration)', importance: Notifications.AndroidImportance.HIGH,
      sound: 'default', enableVibrate: false, vibrationPattern: [0],
    }),
  ]);
  channelReady = true;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  }
  configure();
  await ensureChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export type NotificationTarget = '/ride' | '/alternatives' | '/business-event';

/** The bundled tone's file name, for alarms and for notifications standing in for them. */
function soundFile(sound: ReminderSound): string | null {
  return sound === 'default' ? null : `lastride_${sound}.caf`;
}

async function present(
  title: string, body: string, fireAt: number | null,
  target: NotificationTarget = '/ride', vibrate = true, sound: string | null = null,
) {
  const delayMs = fireAt === null ? 0 : Math.max(0, fireAt - Date.now());
  if (Platform.OS === 'web') {
    const timer = setTimeout(() => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(title, { body });
        notification.onclick = () => {
          window.focus();
          if (window.location.pathname !== target) window.location.assign(target);
        };
      }
    }, delayMs);
    webTimers.push(timer);
    return;
  }
  configure();
  await ensureChannel();
  const id = await Notifications.scheduleNotificationAsync({
    // timeSensitive lets the alert break through Focus modes once the app has the
    // Time Sensitive Notifications entitlement. On iOS, vibration follows the
    // phone's Sounds & Haptics settings; there's no per-notification switch.
    // A custom `sound` is a bundled tone (at most 30 s), used when an alarm falls back.
    content: { title, body, sound: (Platform.OS === 'ios' && sound) || true, interruptionLevel: 'timeSensitive', data: { target } },
    trigger: delayMs < 1000
      ? null
      : {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + delayMs),
          channelId: vibrate ? 'leave-reminders' : 'leave-reminders-no-vibrate',
        },
  });
  const ids = await readOwnedIds();
  ids.push(id);
  await writeOwnedIds(ids);
}

async function cancelOwned() {
  webTimers.splice(0).forEach(clearTimeout);
  await AsyncStorage.removeItem(SIGNATURE_KEY).catch(() => undefined);
  if (Platform.OS === 'web') return;
  configure();
  const ids = await readOwnedIds();
  await writeOwnedIds([]);
  // Cancel native alarms even when the JS runtime died before persisting the
  // schedule. AlarmKit only exposes alarms belonging to our app.
  await alarmKit.cancelAll().catch((error) => console.warn('[LastRide] Could not cancel alarms', error));
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

export function cancelAllReminders(): Promise<void> {
  return enqueue(cancelOwned);
}

export type ReminderText = { leaveBy: string; station: string; language: 'ja' | 'en' };
function reminderText({ leaveBy, station, language }: ReminderText, { minutesBefore, missedCheckIn }: ReminderPlan) {
  if (missedCheckIn) {
    return language === 'ja'
      ? { title: 'LastRide — 終電に間に合いませんでしたか？', body: 'タップして始発・タクシー・近くで朝まで過ごせる場所を確認。' }
      : { title: 'LastRide — missed the last train?', body: 'Tap to see the first train, a taxi estimate, and places to wait nearby.' };
  }
  if (minutesBefore === 0) {
    return language === 'ja'
      ? { title: 'LastRide — 今すぐ出発', body: `${station}へ歩き始めましょう。終電に間に合う最後のタイミングです。` }
      : { title: 'LastRide — leave now', body: `Start walking to ${station} now to make the last train.` };
  }
  return language === 'ja'
    ? { title: `LastRide — あと${minutesBefore}分`, body: `${leaveBy}に${station}へ出発。そろそろ支度を。` }
    : { title: `LastRide — ${minutesBefore} min to go`, body: `Leave for ${station} by ${leaveBy}. Time to wrap up.` };
}

function newAlarmId(): string {
  // AlarmKit identifiers are UUIDs. These aren't authorization/security tokens.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const r = Math.floor(Math.random() * 16);
    return (char === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

/**
 * Replaces all reminders for a tracking plan (fire times are real epoch ms).
 * Plans marked `alarm` become AlarmKit alarms on iOS 26+ when allowed; otherwise
 * a time-sensitive notification with the chosen tone stands in for them.
 * Skips the work when the same set is already scheduled, so frequent location
 * updates from the app and the background task don't churn the OS schedule.
 * Never requests alarm permission: this also runs in the headless location task.
 */
export function scheduleReminders(
  plans: ReminderPlan[],
  text: ReminderText,
  { sound, vibrate }: Pick<ReminderDelivery, 'sound' | 'vibrate'> = { sound: 'default', vibrate: true },
): Promise<void> {
  return enqueue(async () => {
    const wantsAlarm = plans.some((plan) => plan.alarm);
    const alarmAuthorization = wantsAlarm && alarmKitAvailable ? await alarmKit.status().catch(() => 'denied') : 'unsupported';
    // Permission can change in iOS Settings without the plans changing; a schedule
    // made of stand-in notifications must be replaced once alarms are allowed.
    const signature = JSON.stringify([SCHEDULER_VERSION, plans, text, sound, vibrate, alarmAuthorization]);
    if (Platform.OS !== 'web' && (await AsyncStorage.getItem(SIGNATURE_KEY).catch(() => null)) === signature) return;
    await cancelOwned();
    const language = text.language;
    for (const plan of plans) {
      // A delayed background task must never turn an expired alarm into an instant notification.
      if (plan.fireAt < Date.now() - 1000) continue;
      const { title, body } = reminderText(text, plan);
      const target = plan.missedCheckIn ? '/alternatives' : '/ride';
      if (plan.alarm && alarmAuthorization === 'authorized' && plan.fireAt > Date.now() + 1000) {
        try {
          await alarmKit.schedule(newAlarmId(), plan.fireAt, title, sound, stopLabel(language));
          continue;
        } catch (error) {
          console.warn('[LastRide] AlarmKit failed; falling back to a notification', error);
        }
      }
      await present(title, body, plan.fireAt, target, vibrate, plan.alarm ? soundFile(sound) : null);
    }
    await AsyncStorage.setItem(SIGNATURE_KEY, signature).catch(() => undefined);
  });
}

function stopLabel(language: 'ja' | 'en'): string {
  return language === 'ja' ? '停止' : 'Stop';
}

export function sendTestNotification(language: 'ja' | 'en'): Promise<void> {
  return enqueue(async () => {
    const text = language === 'ja'
      ? { title: 'LastRide — テスト通知', body: '通知はこのように届きます。' }
      : { title: 'LastRide — test notification', body: 'This is how your reminders will look.' };
    await present(text.title, text.body, Date.now() + 2000);
  });
}

/** How long the "check with a real alarm" test waits: time to lock the phone and see the full alarm. */
export const TEST_ALARM_DELAY_MS = 5000;

/** Schedules a real system alarm a few seconds ahead with `sound`; false when alarms aren't allowed. */
export async function sendTestAlarm(language: 'ja' | 'en', sound: ReminderSound): Promise<boolean> {
  if (!alarmKitAvailable || (await alarmKit.status()) !== 'authorized') return false;
  await alarmKit.schedule(newAlarmId(), Date.now() + TEST_ALARM_DELAY_MS,
    language === 'ja' ? 'LastRide — アラームのテスト' : 'LastRide — alarm test', sound, stopLabel(language));
  return true;
}

/** Plays a bundled tone right away (even in silent mode, at media volume). Not for 'default': apps can't play Apple's alarm sound. */
export function previewSound(sound: ReminderSound): Promise<void> {
  const file = soundFile(sound);
  return file ? alarmKit.preview(file) : Promise.resolve();
}
