import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ReminderPlan } from '@/lib/planner';
import { planDelivery, type DeliveryContext, type ReminderLedger } from '@/lib/reminderLedger';
import { isNativeReminderScheduleIntact, type ScheduledLocalNotification } from '@/lib/notificationScheduleHealth';
import { createSerialOperations } from '@/lib/serialOperations';
import { BOARDED_ACTION, BOARDED_CATEGORY, boardedButtons, boardedFollowUp, boardedNotificationId, boardedQuestion, NOT_BOARDED_ACTION, type HeldTrain } from '@/lib/boarding';
import { REMINDER_SOUNDS, STORAGE_KEYS, type ReminderDelivery, type ReminderSound } from '@/lib/settings';
import { alarmKit, alarmKitAvailable, type AlarmAuthorization } from '../modules/last-ride-alarm/src';

let configured = false;
let channelReady = false;
const webTimers: ReturnType<typeof setTimeout>[] = [];
// Both the foreground app and the separate headless location-task JS runtime
// use these keys to replace, not accumulate, locally scheduled notifications.
const OWNED_IDS_KEY = 'lastride-owned-notification-ids';
const SCHEDULED_ENTRIES_KEY = 'lastride-scheduled-local-notifications-v1';
const SCHEDULED_ALARMS_KEY = 'lastride-scheduled-alarmkit-v1';
const SIGNATURE_KEY = 'lastride-reminder-signature';
// v10 intentionally invalidates pre-AlarmKit-ledger signatures on upgrade:
// those builds had silent companions but no native alarm receipt to verify.
const SCHEDULER_VERSION = 11;
/** Legacy schedule description, retained to preserve unchanged real alarms. */
const ALARM_SET_KEY = 'lastride-alarm-set';

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

async function readScheduledEntries(): Promise<ScheduledLocalNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULED_ENTRIES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is ScheduledLocalNotification =>
      !!entry && typeof entry.id === 'string' && Number.isFinite(entry.fireAt)) : [];
  } catch { return []; }
}

async function writeScheduledEntries(entries: ScheduledLocalNotification[]): Promise<void> {
  await AsyncStorage.setItem(SCHEDULED_ENTRIES_KEY, JSON.stringify(entries)).catch(() => undefined);
}

/** Written after AlarmKit confirms a specific alarm; never trust companion
 * notifications as proof the native AlarmKit alarm still exists. */
type NativeAlarmReceipt = { id: string; fireAt: number };
async function readNativeAlarms(): Promise<NativeAlarmReceipt[]> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULED_ALARMS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is NativeAlarmReceipt =>
      !!value && typeof value.id === 'string' && value.id.length > 0 &&
      typeof value.fireAt === 'number' && Number.isFinite(value.fireAt));
  } catch { return []; }
}
async function appendNativeAlarm(alarm: NativeAlarmReceipt): Promise<void> {
  const current = await readNativeAlarms();
  // A failed persistence is NOT confirmation that the native alarm is safe;
  // next replan will rebuild after querying the OS.
  await AsyncStorage.setItem(SCHEDULED_ALARMS_KEY, JSON.stringify([...current, alarm]));
}

/** Only consult the OS if the exact plan signature already matches. Reading
 * native state on every replan would waste battery in background tracking. */
async function nativeSchedulePresent(plans: ReminderPlan[], hasHeld: boolean): Promise<boolean> {
  const now = Date.now();
  const expected = plans.filter((plan) => plan.fireAt > now + 1000 && (!plan.boardedCheck || hasHeld)).length;
  if (expected === 0) return true;
  try {
    const [persisted, scheduled] = await Promise.all([
      readScheduledEntries(), Notifications.getAllScheduledNotificationsAsync(),
    ]);
    const notificationIntact = isNativeReminderScheduleIntact(expected, persisted,
      new Set(scheduled.map((entry) => entry.identifier)), now);
    if (!notificationIntact) return false;
    // Silent, passive notifications are companions for a real AlarmKit alarm.
    // If the native receipt is missing after a crash/storage failure, never
    // mistake such a companion for a verified alarm.
    const persistedIds = new Set(persisted.map((entry) => entry.id));
    const companions = scheduled.filter((entry) =>
      persistedIds.has(entry.identifier) &&
      entry.content.data?.lastrideAlarmCompanion === true).length;
    const savedAlarms = (await readNativeAlarms()).filter((entry) => entry.fireAt > now + 1000);
    if (savedAlarms.length !== companions) return false;
    if (savedAlarms.length === 0) return true; // A notification-only fallback.
    // Native bridge failure is unknown, NOT confirmation. Reconcile on the
    // next schedule call even if the ordinary companion notification survived.
    const nativeIds = await alarmKit.scheduledIds();
    return nativeIds !== null && savedAlarms.every((entry) => nativeIds.includes(entry.id));
  } catch {
    // Failed OS queries do not establish that a reminder is still scheduled.
    // Reconciliation may retry when the native bridge is available again.
    return false;
  }
}

// Native Expo Notifications and AlarmKit calls are not abortable. Releasing
// the queue after an arbitrary timeout allows stale work to continue and
// cancel a newer reminder schedule. Watchdog warnings do not unlock the queue.
const OPERATION_WARNING_MS = 20_000;
const enqueue = createSerialOperations(OPERATION_WARNING_MS, () => {
  console.warn('[LastRide] reminder scheduling is still running');
});

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

/**
 * Whether notifications are allowed, without asking: 'denied' means the user
 * turned them off (iOS won't ask again; only Settings can turn them back on).
 */
export async function notificationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'undetermined';
  }
  const { status, granted } = await Notifications.getPermissionsAsync();
  if (granted) return 'granted';
  return status === 'denied' ? 'denied' : 'undetermined';
}

export type NotificationTarget = '/ride' | '/alternatives' | '/business-event';

/** The bundled tone's file name, for alarms and for notifications standing in for them. */
function soundFile(sound: ReminderSound): string | null {
  return sound === 'default' ? null : `lastride_${sound}.caf`;
}

/**
 * Alarm tones on offer. "iOS default" is Apple's alarm sound only with AlarmKit
 * (iOS 26+); before that an alarm arrives as a notification, where it would
 * sound exactly like an ordinary reminder, so it isn't offered.
 */
export const ALARM_SOUND_CHOICES: ReminderSound[] = alarmKitAvailable
  ? REMINDER_SOUNDS
  : REMINDER_SOUNDS.filter((sound) => sound !== 'default');

/** The tone an alarm actually uses: without AlarmKit, "iOS default" becomes Urgent. */
export function effectiveAlarmSound(sound: ReminderSound): ReminderSound {
  return !alarmKitAvailable && sound === 'default' ? 'urgent' : sound;
}

async function present(
  title: string, body: string, fireAt: number | null,
  target: NotificationTarget = '/ride', vibrate = true, sound: string | null = null, urgent = false,
  /** Silent and passive: kept in Notification Center without sound or lighting the screen. */
  silent = false,
  /** Buttons (a registered category), extra data for the tap, and a fixed id (same id = replaces). */
  extra: { category?: string; data?: Record<string, unknown>; identifier?: string } = {},
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
  // Prefix identifiers even before their AsyncStorage receipts are persisted.
  // If a background task is killed between OS scheduling and storage, the next
  // run can still enumerate and cancel orphaned alerts belonging to LastRide.
  const identifier = extra.identifier ?? `lastride-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const id = await Notifications.scheduleNotificationAsync({
    identifier,
    // timeSensitive lets the alert break through Focus modes once the app has the
    // Time Sensitive Notifications entitlement. On iOS, vibration follows the
    // phone's Sounds & Haptics settings; there's no per-notification switch.
    // A custom `sound` is a bundled tone (at most 30 s), used when an alarm falls back.
    content: {
      title, body,
      sound: silent ? false : (Platform.OS === 'ios' && sound) || true,
      interruptionLevel: silent ? 'passive' : urgent ? 'timeSensitive' : 'active',
      data: { target, ...extra.data, ...(silent ? { lastrideAlarmCompanion: true } : {}) },
      ...(extra.category ? { categoryIdentifier: extra.category } : {}),
    },
    trigger: delayMs < 1000
      ? null
      : Platform.OS === 'ios'
        ? clockTrigger(Date.now() + delayMs)
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(Date.now() + delayMs),
            channelId: vibrate ? 'leave-reminders' : 'leave-reminders-no-vibrate',
          },
  });
  const ids = await readOwnedIds();
  if (!ids.includes(id)) ids.push(id);
  await writeOwnedIds(ids);
  // Immediate notices disappear from the pending OS schedule by design. Only
  // record future alerts when checking whether queued reminders were lost.
  if (fireAt !== null && delayMs >= 1000) {
    const entries = await readScheduledEntries();
    entries.splice(0, entries.length, ...entries.filter((entry) => entry.id !== id));
    entries.push({ id, fireAt });
    await writeScheduledEntries(entries);
  }
}

/**
 * iOS: fire at a clock time (a calendar trigger), like AlarmKit's alarms. Expo's
 * DATE trigger becomes "in N seconds" (a time-interval trigger), which iOS
 * delivers on power-saving timers: about 20 s late with the phone asleep.
 */
function clockTrigger(atMs: number): Notifications.CalendarTriggerInput {
  const japan = new Date(atMs + 9 * 60 * 60 * 1000);
  return {
    type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
    timezone: 'Asia/Tokyo',
    year: japan.getUTCFullYear(),
    month: japan.getUTCMonth() + 1,
    day: japan.getUTCDate(),
    hour: japan.getUTCHours(),
    minute: japan.getUTCMinutes(),
    second: japan.getUTCSeconds(),
    repeats: false,
  };
}

async function cancelOwned() {
  webTimers.splice(0).forEach(clearTimeout);
  await AsyncStorage.removeItem(SIGNATURE_KEY).catch(() => undefined);
  if (Platform.OS === 'web') return;
  configure();
  const ids = await readOwnedIds();
  // Recover native schedules lost between scheduleNotificationAsync() and
  // writing OWNED_IDS_KEY, but leave unrelated app notifications untouched.
  const orphanIds = await Notifications.getAllScheduledNotificationsAsync()
    .then((requests) => requests.map((request) => request.identifier).filter((id) =>
      id.startsWith('lastride-local-') || id.startsWith('lastride-boarded-')))
    .catch(() => [] as string[]);
  await writeOwnedIds([]);
  await writeScheduledEntries([]);
  await AsyncStorage.removeItem(SCHEDULED_ALARMS_KEY).catch(() => undefined);
  // Cancel native alarms even when the JS runtime died before persisting the
  // schedule. AlarmKit only exposes alarms belonging to our app.
  await alarmKit.cancelAll().catch((error) => console.warn('[LastRide] Could not cancel alarms', error));
  await AsyncStorage.removeItem(ALARM_SET_KEY).catch(() => undefined);
  await Promise.all([...new Set([...ids, ...orphanIds])].filter((id) => isOwnedReminderId(id)).map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  // And everything else still scheduled: the app and its background task keep
  // the owned list separately, so it can miss one (an alarm's silent companion
  // that then still arrives). Every local notification is a reminder from here,
  // except a TestFlight test notification; ones already delivered aren't affected.
  const queued = await queuedIds();
  await Promise.all([...queued].filter((id) => isOwnedReminderId(id)).map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

/**
 * iOS delivers scheduled notifications late while the screen is off (measured:
 * ~9 s, ~17 s with an Apple Watch paired; on time with the screen on, app open or
 * closed; AlarmKit alarms always on time). Leave reminders that are notifications
 * go this much early: about on time in a pocket without a watch, ~7 s late with
 * one, at most this early with the screen on. The words say the clock time to
 * leave, so early never misleads.
 */
export const SCREEN_OFF_DELAY_MS = 10_000;

/** TestFlight test notifications (sendTestNotifications): never cancelled with the reminders. */
const TEST_ID_PREFIX = 'lastride-test-';
function isTestNotification(id: string): boolean {
  return id.startsWith(TEST_ID_PREFIX);
}
function isOwnedReminderId(id: string): boolean {
  return !isTestNotification(id) && (id.startsWith('lastride-local-') || id.startsWith('lastride-reminder-') || id.startsWith('lastride-boarded-'));
}

/**
 * A fixed identifier for a timed reminder: the same time and words give the same
 * id, so a re-plan leaves an unchanged reminder queued as it is (never removed
 * and re-added just before it fires).
 */
function reminderId(...parts: unknown[]): string {
  const text = JSON.stringify(parts);
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return `lastride-reminder-${hash.toString(36)}-${text.length}`;
}

/** Identifiers of the local notifications iOS has queued (not yet delivered). */
async function queuedIds(): Promise<Set<string>> {
  if (Platform.OS === 'web') return new Set();
  const requests = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  return new Set(requests.map((request) => request.identifier));
}

export function cancelAllReminders(): Promise<void> {
  return enqueue(cancelOwned);
}

/** The station locked for tonight can't get you home any more: the app went back to automatic. */
export function notifyLockFallback(
  locked: { name: string; nameJa: string },
  plan: { station: { name: string; nameJa: string }; lastTrain: { departsAt: number } },
  language: 'ja' | 'en',
): Promise<void> {
  markReminderChange('stationTold');
  const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(plan.lastTrain.departsAt));
  const text = language === 'ja'
    ? { title: 'LastRide — 出発駅を自動に戻しました', body: `${locked.nameJa}駅からの帰宅ルートが見つからなかったため、${plan.station.nameJa}駅（${time}発）に切り替えました。` }
    : { title: 'LastRide — back to automatic', body: `${locked.name} can’t get you home any more, so you’re now leaving from ${plan.station.name} (${time} train).` };
  return enqueue(async () => present(text.title, text.body, null, '/ride', true, null, (await AsyncStorage.getItem(STORAGE_KEYS.throughFocus).catch(() => null)) !== 'false'));
}

function stationNotice(text: ReminderText, info: DeliveryInfo) {
  if (text.language === 'ja') {
    return {
      title: 'LastRide — 出発駅が変わりました',
      body:
        `${text.station}から${info.trainLabel}（${info.trainDeparts}発）。${text.leaveBy}に出る。` +
        (info.movedFrom ? `${info.movedFrom}は出発時刻を過ぎていたため、${info.trainLabel}にしています。` : ''),
    };
  }
  return {
    title: 'LastRide — your station changed',
    body:
      `Now from ${text.station}: ${info.trainLabel}, ${info.trainDeparts}. Leave at ${text.leaveBy}.` +
      (info.movedFrom ? ` Too late for the ${info.movedFrom.toLowerCase()} train from there, so it’s the ${info.trainLabel.toLowerCase()}.` : ''),
  };
}

function timeNotice(text: ReminderText, info: DeliveryInfo) {
  return text.language === 'ja'
    ? { title: 'LastRide — 出発時刻が変更されました', body: `${text.leaveBy}に出て${text.station}へ（${info.trainDeparts}発）。` }
    : { title: 'LastRide — new leave time', body: `Leave for ${text.station} at ${text.leaveBy} (${info.trainDeparts} train).` };
}

export type ReminderText = {
  leaveBy: string;
  station: string;
  language: 'ja' | 'en';
  /** Heading for an earlier train (1本前 / 2本前): it and the one after it (lib/boarding.ts). */
  held?: HeldTrain;
};
function reminderText({ leaveBy, station, language, held }: ReminderText, { minutesBefore, missedCheckIn, boardedCheck }: ReminderPlan) {
  if (boardedCheck && held) {
    const { title, body } = boardedQuestion(held, language);
    return { title, body };
  }
  if (missedCheckIn) {
    return language === 'ja'
      ? { title: 'LastRide — 終電を逃しましたか？', body: 'タップして始発・タクシー・周辺の施設を確認できます。' }
      : { title: 'LastRide — missed the last train?', body: 'Tap to see the first train, a taxi estimate, and places to wait nearby.' };
  }
  if (minutesBefore === 0) {
    // Only the next train's departure: its leave time depends on where the user will be.
    if (held) {
      return language === 'ja'
        ? { title: 'LastRide — 出発の時間です', body: `${station}へ歩き始めましょう。乗り遅れても、${held.next}は${held.nextDeparts}発です。` }
        : { title: 'LastRide — leave now', body: `Start walking to ${station}. If you miss this train, ${held.next} leaves at ${held.nextDeparts}.` };
    }
    return language === 'ja'
      ? { title: 'LastRide — 出発の時間です', body: `${station}へ歩き始めましょう。終電に向かう出発時刻です。徒歩時間は目安のため、余裕をもって移動してください。` }
      : { title: 'LastRide — leave now', body: `Start walking to ${station} now to make the last train.` };
  }
  return language === 'ja'
    ? { title: `LastRide — 出発まであと${minutesBefore}分`, body: `${leaveBy}に出て${station}へ。出発の準備をしましょう。` }
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
 * Plans marked `alarm` become AlarmKit alarms (iOS alarm sound) on iOS 26+ when allowed; otherwise
 * a time-sensitive notification with the chosen tone stands in for them.
 * Skips the work when the same set is already scheduled, so frequent location
 * updates from the app and the background task don't churn the OS schedule.
 * Never requests alarm permission: this also runs in the headless location task.
 */
/** What a station-change notice says about the train (with the reminder record). */
export type DeliveryInfo = DeliveryContext & {
  /** 「1本前」 / 「終電」 / "1 before"… */
  trainLabel: string;
  /** Its departure, e.g. "23:33". */
  trainDeparts: string;
  /** The station changed and the chosen slot's leave time there had passed: that slot's label ("2本前"). */
  movedFrom?: string;
  /** With `followUpFor`: the departed train's label (「1本前」), for 「…に乗れなかったなら」. */
  followUpLabel?: string;
};

/** 〔乗った〕 / 〔乗れなかった〕 on the 乗れましたか？ notification. Both open the app (lib/boarding.ts). */
async function registerBoardedCategory(language: 'ja' | 'en') {
  if (Platform.OS === 'web') return;
  const text = boardedButtons(language);
  await Notifications.setNotificationCategoryAsync(BOARDED_CATEGORY, [
    { identifier: BOARDED_ACTION, buttonTitle: text.boarded, options: { opensAppToForeground: true } },
    { identifier: NOT_BOARDED_ACTION, buttonTitle: text.notBoarded, options: { opensAppToForeground: true } },
  ]).catch(() => undefined);
}

/**
 * A change the user made (userChange), or a station change already told by
 * 「出発駅を自動に戻しました」 (stationTold). Stored so the background task sees
 * it too: the phone may sleep before the app's own re-plan has finished.
 */
type ChangeMark = { kind: 'user' | 'stationTold'; at: number };
const CHANGE_MARK_KEY = 'lastride-reminder-change-mark';
/** Long enough for the re-plan a change starts (new lookups) to arrive. */
const CHANGE_MARK_MS = 90_000;
let lastMark: ChangeMark | null = null;

export function markReminderChange(kind: ChangeMark['kind'], nowMs = Date.now()): void {
  lastMark = { kind, at: nowMs };
  void AsyncStorage.setItem(CHANGE_MARK_KEY, JSON.stringify(lastMark)).catch(() => undefined);
}

async function recentMark(nowMs: number): Promise<ChangeMark['kind'] | null> {
  let mark = lastMark;
  try {
    const raw = await AsyncStorage.getItem(CHANGE_MARK_KEY);
    const stored = raw ? (JSON.parse(raw) as ChangeMark) : null;
    if (stored && typeof stored.at === 'number' && (!mark || stored.at > mark.at)) mark = stored;
  } catch {
    // No mark.
  }
  return mark && nowMs - mark.at >= 0 && nowMs - mark.at < CHANGE_MARK_MS ? mark.kind : null;
}

async function readLedger(): Promise<ReminderLedger | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.reminderLedger);
    return raw ? (JSON.parse(raw) as ReminderLedger) : null;
  } catch {
    return null;
  }
}

/**
 * Schedules tonight's reminders. With `delivery` (night tracking), the reminder
 * record (lib/reminderLedger) makes re-plans safe: nothing already sent is sent
 * again, reminders pushed into the past are caught up (latest only), and a
 * station change or a big leave-time move gets one notice. Without it (demo
 * mode), the plans are simply scheduled.
 */
export function scheduleReminders(
  plans: ReminderPlan[],
  text: ReminderText,
  { sound, vibrate, throughFocus = true }: Pick<ReminderDelivery, 'sound' | 'vibrate'> & { throughFocus?: boolean } = { sound: 'default', vibrate: true },
  delivery?: DeliveryInfo,
): Promise<void> {
  // Leave-reminder notifications go SCREEN_OFF_DELAY_MS early on iOS. Shifted here,
  // before the record decides, so "sent" means sent: a re-plan in those seconds
  // mustn't think 出発の時間です is still to come and send it again. Alarms (exact
  // with AlarmKit), the 乗れましたか？ question and the missed-train check-in keep their time.
  if (Platform.OS === 'ios')
    plans = plans.map((plan) => (plan.alarm || plan.missedCheckIn || plan.boardedCheck ? plan : { ...plan, fireAt: plan.fireAt - SCREEN_OFF_DELAY_MS }));
  return enqueue(async () => {
    const now = Date.now();
    const mark = delivery ? await recentMark(now) : null;
    const decided = delivery
      ? planDelivery(await readLedger(), { ...delivery, userChange: delivery.userChange || mark === 'user', stationTold: mark === 'stationTold' }, plans, now)
      : null;
    const upcoming = decided ? decided.schedule : plans;
    const wantsAlarm = upcoming.some((plan) => plan.alarm);
    const alarmAuthorization = wantsAlarm && alarmKitAvailable ? await alarmKit.status().catch(() => 'denied') : 'unsupported';
    // Permission can change in iOS Settings without the plans changing; a schedule
    // made of stand-in notifications must be replaced once alarms are allowed.
    const signature = JSON.stringify([
      SCHEDULER_VERSION, upcoming, text, sound, vibrate, throughFocus, alarmAuthorization,
      decided && [decided.catchUp, decided.stationChanged, decided.timeShifted, decided.followUp, decided.ledger.sent, decided.ledger.stationKey],
    ]);
    if (Platform.OS !== 'web' && (await AsyncStorage.getItem(SIGNATURE_KEY).catch(() => null)) === signature &&
        await nativeSchedulePresent(upcoming, !!text.held)) return;
    let alarmReceiptsIntact = true;
    // Only what changed is replaced: reminders still the same stay queued untouched
    // (see reminderId); the rest are removed once the new set is in. AlarmKit can
    // only cancel all alarms at once, so they're left alone while the alarms still
    // ahead are the same: otherwise a re-plan as one rings (the user picking up the
    // phone and starting to walk) would stop it.
    const alarmsAhead = alarmAuthorization === 'authorized'
      ? upcoming.filter((plan) => plan.alarm && plan.fireAt > now + 1000).map((plan) => [plan.fireAt, reminderText(text, plan).title] as const)
      : [];
    const alarmSet = JSON.stringify(alarmsAhead);
    let alarmsUnchanged = false;
    if (Platform.OS === 'web') await cancelOwned();
    else {
      await AsyncStorage.removeItem(SIGNATURE_KEY).catch(() => undefined);
      configure();
      try {
        const before = JSON.parse((await AsyncStorage.getItem(ALARM_SET_KEY)) ?? 'null') as Array<[number, string]> | null;
        const signatureMatches = !!before && JSON.stringify(before.filter(([at]) => at > now + 1000)) === alarmSet;
        if (signatureMatches && alarmsAhead.length) {
          // A matching description and a silent notification do NOT prove
          // that iOS still owns a live AlarmKit alarm.
          const receipts = (await readNativeAlarms()).filter((entry) => entry.fireAt > now + 1000);
          const nativeIds = await alarmKit.scheduledIds().catch(() => null);
          alarmsUnchanged = nativeIds !== null && receipts.length === alarmsAhead.length &&
            receipts.every((entry) => nativeIds.includes(entry.id)) &&
            alarmsAhead.every(([at]) => receipts.some((entry) => entry.fireAt === at));
          if (nativeIds === null) alarmReceiptsIntact = false;
        } else alarmsUnchanged = signatureMatches;
      } catch {
        alarmsUnchanged = false;
      }
      if (!alarmsUnchanged) {
        await alarmKit.cancelAll().catch((error) => console.warn('[LastRide] Could not cancel alarms', error));
        await AsyncStorage.removeItem(ALARM_SET_KEY).catch(() => undefined);
        await AsyncStorage.removeItem(SCHEDULED_ALARMS_KEY).catch(() => undefined);
      }
    }
    const queued = await queuedIds();
    const kept = new Set<string>();
    /** Queues a timed reminder unless the identical one is already queued. */
    const queue = async (id: string, show: () => Promise<void>) => {
      kept.add(id);
      if (!queued.has(id)) await show();
    };
    const language = text.language;
    if (decided && delivery) {
      // Told once: where you leave from now, or that the leave time moved after a reminder.
      if (decided.followUp && delivery.followUpFor !== undefined) {
        // 乗れましたか？ unanswered: the times from here, with the same buttons, in place of the question.
        const notice = boardedFollowUp(
          {
            goneLabel: delivery.followUpLabel ?? delivery.trainLabel,
            nextLabel: delivery.trainLabel,
            nextDeparts: delivery.trainDeparts,
            station: text.station,
            leaveBy: text.leaveBy,
            leavePassed: delivery.leaveAtMs <= now,
          },
          language,
        );
        await registerBoardedCategory(language);
        await present(notice.title, notice.body, null, '/ride', vibrate, null, throughFocus, false, {
          category: BOARDED_CATEGORY,
          data: { boardedCheck: delivery.followUpFor },
          identifier: boardedNotificationId(delivery.followUpFor),
        });
      }
      if (decided.stationChanged) {
        const notice = stationNotice(text, delivery);
        await present(notice.title, notice.body, null, '/ride', vibrate, null, throughFocus);
      } else if (decided.timeShifted) {
        const notice = timeNotice(text, delivery);
        await present(notice.title, notice.body, null, '/ride', vibrate, null, throughFocus);
      }
      if (decided.catchUp) {
        const minutesLeft = Math.round((delivery.leaveAtMs - now) / 60_000);
        const late = { ...decided.catchUp, minutesBefore: decided.catchUp.minutesBefore > 0 && minutesLeft > 0 ? minutesLeft : 0 };
        const { title, body } = reminderText(text, late);
        const tone = late.alarm ? soundFile(sound === 'default' ? 'urgent' : sound) : null;
        await present(title, body, null, '/ride', vibrate, tone, late.alarm === true || throughFocus);
      }
      await AsyncStorage.setItem(STORAGE_KEYS.reminderLedger, JSON.stringify(decided.ledger)).catch(() => undefined);
    }
    if (upcoming.some((plan) => plan.boardedCheck) && text.held) await registerBoardedCategory(language);
    for (const plan of upcoming) {
      // A delayed background task must never turn an expired alarm into an instant notification.
      if (plan.fireAt < Date.now() - 1000) continue;
      if (plan.boardedCheck) {
        if (!text.held) continue;
        const { title, body } = reminderText(text, plan);
        // A fixed id per train (the follow-up replaces it): queued again only when its words change.
        const id = boardedNotificationId(plan.fireAt);
        const words = reminderId(title, body, vibrate);
        kept.add(id);
        if (!queued.has(id) || (await AsyncStorage.getItem(`${id}-words`).catch(() => null)) !== words) {
          await present(title, body, plan.fireAt, '/ride', vibrate, null, false, false, {
            category: BOARDED_CATEGORY,
            data: { boardedCheck: plan.fireAt },
            identifier: id,
          });
          await AsyncStorage.setItem(`${id}-words`, words).catch(() => undefined);
        }
        continue;
      }
      const { title, body } = reminderText(text, plan);
      const target = plan.missedCheckIn ? '/alternatives' : '/ride';
      if (plan.alarm && alarmAuthorization === 'authorized' && plan.fireAt > Date.now() + 1000) {
        try {
          // Apple's native alarm sound is the only reliable sound in silent
          // mode; custom bundled notification tones are not native AlarmKit.
          if (!alarmsUnchanged) {
            const alarmId = newAlarmId();
            await alarmKit.schedule(alarmId, plan.fireAt, title, 'default', stopLabel(language));
            try {
              await appendNativeAlarm({ id: alarmId, fireAt: plan.fireAt });
            } catch {
              alarmReceiptsIntact = false;
            }
          }
          // The alarm rings; a silent notification keeps the details (station, times)
          // in Notification Center once it's stopped, and opens the app when tapped.
          const id = reminderId('companion', plan.fireAt, title, body, target);
          await queue(id, () => present(title, body, plan.fireAt, target, false, null, false, true, { identifier: id }));
          continue;
        } catch (error) {
          console.warn('[LastRide] AlarmKit failed; falling back to a notification', error);
        }
      }
      // An alarm's stand-in never uses the plain notification sound (or it'd be just another reminder).
      const tone = plan.alarm ? soundFile(sound === 'default' ? 'urgent' : sound) : null;
      // 集中モード中も通知 (on by default): every leave reminder is Time Sensitive (即時通知),
      // through Focus and the summary. An alarm standing in as a notification always is.
      const urgent = plan.alarm === true || (!plan.missedCheckIn && throughFocus);
      const id = reminderId(plan.fireAt, title, body, target, vibrate, tone, urgent);
      await queue(id, () => present(title, body, plan.fireAt, target, vibrate, tone, urgent, false, { identifier: id }));
    }
    if (Platform.OS !== 'web') {
      if (!alarmsUnchanged) await AsyncStorage.setItem(ALARM_SET_KEY, alarmSet).catch(() => undefined);
      // Everything queued that isn't in the new set: changed or no longer wanted.
      await Promise.all([...queued].filter((id) => !kept.has(id) && isOwnedReminderId(id)).map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
      await writeOwnedIds([...kept]);
      await writeScheduledEntries((await readScheduledEntries()).filter((entry) => kept.has(entry.id) && entry.fireAt > now));
    }
    if (alarmReceiptsIntact) {
      await AsyncStorage.setItem(SIGNATURE_KEY, signature).catch(() => undefined);
    }
  });
}

function stopLabel(language: 'ja' | 'en'): string {
  return language === 'ja' ? '停止' : 'Stop';
}

/** How long the "check with a real alarm" test waits: time to lock the phone and see the full alarm. */
export const TEST_ALARM_DELAY_MS = 5000;

/** Schedules a real system alarm a few seconds ahead with `sound`; false when alarms aren't allowed. */
export async function sendTestAlarm(language: 'ja' | 'en'): Promise<boolean> {
  if (!alarmKitAvailable || (await alarmKit.status()) !== 'authorized') return false;
  await alarmKit.schedule(newAlarmId(), Date.now() + TEST_ALARM_DELAY_MS,
    language === 'ja' ? 'LastRide — アラームのテスト' : 'LastRide — alarm test', 'default', stopLabel(language));
  return true;
}

/**
 * TestFlight check: a normal and a Time Sensitive (即時通知) notification for the
 * same clock second, at least a minute ahead (a whole minute). Lock the phone and
 * compare when each arrives. Re-plans and reminder changes leave them queued.
 * Returns the time they're set for.
 */
export async function sendTestNotifications(language: 'ja' | 'en'): Promise<number> {
  const at = Math.ceil((Date.now() + 70_000) / 60_000) * 60_000;
  const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(at));
  const ja = language === 'ja';
  await present(ja ? `テスト（通常） ${time}` : `Test (normal) ${time}`, ja ? `${time}に届く予定` : `Due at ${time}`, at, '/ride', true, null, false, false, { identifier: `${TEST_ID_PREFIX}normal-${at}` });
  await present(ja ? `テスト（即時通知） ${time}` : `Test (Time Sensitive) ${time}`, ja ? `${time}に届く予定` : `Due at ${time}`, at, '/ride', true, null, true, false, { identifier: `${TEST_ID_PREFIX}urgent-${at}` });
  return at;
}

/** TestFlight check: what iOS has queued, one line each: time to the second, trigger kind, level, title. */
export async function scheduledNotificationLines(): Promise<string[]> {
  const requests = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  return requests.map((request) => {
    const trigger = request.trigger as unknown as Record<string, unknown> | null;
    const kind = String(trigger?.type ?? 'now');
    const parts = (trigger?.dateComponents ?? trigger) as Record<string, unknown> | undefined;
    const pad = (value: unknown) => String(value ?? '--').padStart(2, '0');
    const when = parts && parts.hour !== undefined ? `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` : trigger?.seconds !== undefined ? `+${trigger.seconds}s` : '—';
    const level = (request.content as unknown as { interruptionLevel?: string }).interruptionLevel ?? '';
    return `${when} · ${kind}${level ? ` · ${level}` : ''} · ${request.content.title ?? ''}`;
  });
}

/** Plays a bundled tone right away (even in silent mode, at media volume). Not for 'default': apps can't play Apple's alarm sound. */
export function previewSound(sound: ReminderSound): Promise<void> {
  const file = soundFile(sound);
  return file ? alarmKit.preview(file) : Promise.resolve();
}
