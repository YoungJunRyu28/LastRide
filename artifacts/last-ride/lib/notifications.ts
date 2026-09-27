import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ReminderPlan } from '@/lib/planner';

let configured = false;
let channelReady = false;
const webTimers: ReturnType<typeof setTimeout>[] = [];
// Owned notification IDs are persisted so the headless background-location task
// and the foreground app (separate JS runtimes) replace each other's reminders
// instead of stacking duplicates.
const OWNED_IDS_KEY = 'lastride-owned-notification-ids';
// What is currently scheduled, so an identical reschedule can be skipped.
const SIGNATURE_KEY = 'lastride-reminder-signature';

async function readOwnedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(OWNED_IDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
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
  await Notifications.setNotificationChannelAsync('leave-reminders', {
    name: 'Leave reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
  channelReady = true;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }
  configure();
  await ensureChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** Screen to open when a notification is tapped; read by NotificationRouter. */
export type NotificationTarget = '/ride' | '/alternatives' | '/business-event';

async function present(title: string, body: string, fireAt: number | null, target: NotificationTarget = '/ride') {
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
    // Time Sensitive Notifications entitlement (paid developer account); ignored otherwise.
    content: { title, body, sound: true, interruptionLevel: 'timeSensitive', data: { target } },
    trigger:
      delayMs < 1000
        ? null
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + delayMs), channelId: 'leave-reminders' },
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
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

export function cancelAllReminders(): Promise<void> {
  return enqueue(cancelOwned);
}

export type ReminderText = { leaveBy: string; station: string; language: 'ja' | 'en' };

function reminderText({ leaveBy, station, language }: ReminderText, { minutesBefore, missedCheckIn }: ReminderPlan) {
  if (missedCheckIn) {
    // The app can't tell whether the user boarded, so this asks rather than asserts.
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
    ? { title: `LastRide — あと${minutesBefore}分`, body: `${leaveBy} に${station}へ出発。そろそろ支度を。` }
    : { title: `LastRide — ${minutesBefore} min to go`, body: `Leave for ${station} by ${leaveBy}. Time to wrap up.` };
}

/**
 * Replaces all app-owned reminders with `plans` (fire times are real epoch ms).
 * Skips the work when the same set is already scheduled, so frequent location
 * updates from the app and the background task don't churn the OS schedule.
 */
export function scheduleReminders(plans: ReminderPlan[], text: ReminderText): Promise<void> {
  return enqueue(async () => {
    const signature = JSON.stringify([plans, text]);
    if ((await AsyncStorage.getItem(SIGNATURE_KEY).catch(() => null)) === signature && Platform.OS !== 'web') return;
    await cancelOwned();
    for (const plan of plans) {
      const { title, body } = reminderText(text, plan);
      await present(title, body, plan.fireAt, plan.missedCheckIn ? '/alternatives' : '/ride');
    }
    await AsyncStorage.setItem(SIGNATURE_KEY, signature).catch(() => undefined);
  });
}

export function sendTestNotification(language: 'ja' | 'en'): Promise<void> {
  return enqueue(async () => {
    const text =
      language === 'ja'
        ? { title: 'LastRide — テスト通知', body: '通知はこのように届きます。' }
        : { title: 'LastRide — test notification', body: 'This is how your reminders will look.' };
    await present(text.title, text.body, Date.now() + 2000);
  });
}
