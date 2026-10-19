import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ReminderPlan } from '@/lib/planner';
import { planDelivery, type DeliveryContext, type ReminderLedger } from '@/lib/reminderLedger';
import { isNativeReminderScheduleIntact, type ScheduledLocalNotification } from '@/lib/notificationScheduleHealth';
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
const SCHEDULER_VERSION = 10;

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
    // An OS query failing is not proof its schedule was lost. Avoid silently
    // duplicating alerts; a later foreground plan can reconcile again.
    return true;
  }
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
      : {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + delayMs),
          channelId: vibrate ? 'leave-reminders' : 'leave-reminders-no-vibrate',
        },
  });
  const ids = await readOwnedIds();
  ids.push(id);
  await writeOwnedIds(ids);
  // Immediate notices disappear from the pending OS schedule by design. Only
  // record future alerts when checking whether queued reminders were lost.
  if (fireAt !== null && delayMs >= 1000) {
    const entries = await readScheduledEntries();
    entries.push({ id, fireAt });
    await writeScheduledEntries(entries);
  }
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
  await Promise.all([...new Set([...ids, ...orphanIds])]
    .map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
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
  const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(plan.lastTrain.departsAt));
  const text = language === 'ja'
    ? { title: 'LastRide — 出発駅を自動に戻しました', body: `固定した${locked.nameJa}駅からは帰れなくなったため、${plan.station.nameJa}駅（${time}発）にしています。` }
    : { title: 'LastRide — back to automatic', body: `${locked.name} can’t get you home any more, so you’re now leaving from ${plan.station.name} (${time} train).` };
  return enqueue(() => present(text.title, text.body, null, '/ride', true, null, true));
}

function stationNotice(text: ReminderText, info: DeliveryInfo) {
  if (text.language === 'ja') {
    return {
      title: 'LastRide — 出発駅が変わりました',
      body:
        `${text.station}から${info.trainLabel}（${info.trainDeparts}発）。${text.leaveBy}に出る。` +
        (info.switchedToClosest ? `駅が変わったため、出る時刻がいちばん近い${info.trainLabel}にしています。` : ''),
    };
  }
  return {
    title: 'LastRide — your station changed',
    body:
      `Now from ${text.station}: ${info.trainLabel}, ${info.trainDeparts}. Leave at ${text.leaveBy}.` +
      (info.switchedToClosest ? ` Switched to the ${info.trainLabel} train, the closest leave time.` : ''),
  };
}

function timeNotice(text: ReminderText, info: DeliveryInfo) {
  return text.language === 'ja'
    ? { title: 'LastRide — 出る時刻が変わりました', body: `${text.leaveBy}に出て${text.station}へ（${info.trainDeparts}発）。` }
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
      ? { title: 'LastRide — 終電に間に合いませんでしたか？', body: 'タップして始発・タクシー・近くで朝まで過ごせる場所を確認。' }
      : { title: 'LastRide — missed the last train?', body: 'Tap to see the first train, a taxi estimate, and places to wait nearby.' };
  }
  if (minutesBefore === 0) {
    // Only the next train's departure: its leave time depends on where the user will be.
    if (held) {
      return language === 'ja'
        ? { title: 'LastRide — 出る時間です', body: `${station}へ歩き始めましょう。乗り遅れても、${held.next}は${held.nextDeparts}発です。` }
        : { title: 'LastRide — leave now', body: `Start walking to ${station}. If you miss this train, ${held.next} leaves at ${held.nextDeparts}.` };
    }
    return language === 'ja'
      ? { title: 'LastRide — 出る時間です', body: `${station}へ歩き始めましょう。終電に間に合う最後のタイミングです。` }
      : { title: 'LastRide — leave now', body: `Start walking to ${station} now to make the last train.` };
  }
  return language === 'ja'
    ? { title: `LastRide — あと${minutesBefore}分`, body: `${leaveBy}に出て${station}へ。そろそろ支度を。` }
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
/** What a station-change notice says about the train (with the reminder record). */
export type DeliveryInfo = DeliveryContext & {
  /** 「1本前」 / 「終電」 / "1 before"… */
  trainLabel: string;
  /** Its departure, e.g. "23:33". */
  trainDeparts: string;
  /** The station changed and the app picked the train with the closest leave time. */
  switchedToClosest?: boolean;
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
  { sound, vibrate }: Pick<ReminderDelivery, 'sound' | 'vibrate'> = { sound: 'default', vibrate: true },
  delivery?: DeliveryInfo,
): Promise<void> {
  return enqueue(async () => {
    const now = Date.now();
    const decided = delivery ? planDelivery(await readLedger(), delivery, plans, now) : null;
    const upcoming = decided ? decided.schedule : plans;
    const wantsAlarm = upcoming.some((plan) => plan.alarm);
    const alarmAuthorization = wantsAlarm && alarmKitAvailable ? await alarmKit.status().catch(() => 'denied') : 'unsupported';
    // Permission can change in iOS Settings without the plans changing; a schedule
    // made of stand-in notifications must be replaced once alarms are allowed.
    const signature = JSON.stringify([
      SCHEDULER_VERSION, upcoming, text, sound, vibrate, alarmAuthorization,
      decided && [decided.catchUp, decided.stationChanged, decided.timeShifted, decided.followUp, decided.ledger.sent, decided.ledger.stationKey],
    ]);
    if (Platform.OS !== 'web' && (await AsyncStorage.getItem(SIGNATURE_KEY).catch(() => null)) === signature &&
        await nativeSchedulePresent(upcoming, !!text.held)) return;
    await cancelOwned();
    // An alarm receipt may fail to persist despite a successful native
    // schedule. Never claim an intact signature for that uncertain state.
    let alarmReceiptsIntact = true;
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
        await present(notice.title, notice.body, null, '/ride', vibrate, null, true, false, {
          category: BOARDED_CATEGORY,
          data: { boardedCheck: delivery.followUpFor },
          identifier: boardedNotificationId(delivery.followUpFor),
        });
      }
      if (decided.stationChanged) {
        const notice = stationNotice(text, delivery);
        await present(notice.title, notice.body, null, '/ride', vibrate, null, true);
      } else if (decided.timeShifted) {
        const notice = timeNotice(text, delivery);
        await present(notice.title, notice.body, null, '/ride', vibrate, null, true);
      }
      if (decided.catchUp) {
        const minutesLeft = Math.round((delivery.leaveAtMs - now) / 60_000);
        const late = { ...decided.catchUp, minutesBefore: decided.catchUp.minutesBefore > 0 && minutesLeft > 0 ? minutesLeft : 0 };
        const { title, body } = reminderText(text, late);
        const tone = late.alarm ? soundFile(sound === 'default' ? 'urgent' : sound) : null;
        await present(title, body, null, '/ride', vibrate, tone, true);
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
        await present(title, body, plan.fireAt, '/ride', vibrate, null, false, false, {
          category: BOARDED_CATEGORY,
          data: { boardedCheck: plan.fireAt },
          identifier: boardedNotificationId(plan.fireAt),
        });
        continue;
      }
      const { title, body } = reminderText(text, plan);
      const target = plan.missedCheckIn ? '/alternatives' : '/ride';
      if (plan.alarm && alarmAuthorization === 'authorized' && plan.fireAt > Date.now() + 1000) {
        try {
          const alarmId = newAlarmId();
          await alarmKit.schedule(alarmId, plan.fireAt, title, sound, stopLabel(language));
          // A failed AsyncStorage receipt doesn't mean AlarmKit failed. Keep
          // the already-scheduled native alarm and its quiet companion; avoid
          // scheduling an extra audible notification for the same event.
          try {
            await appendNativeAlarm({ id: alarmId, fireAt: plan.fireAt });
          } catch {
            alarmReceiptsIntact = false;
          }
          // The alarm rings; a silent notification keeps the details (station, times)
          // in Notification Center once it's stopped, and opens the app when tapped.
          await present(title, body, plan.fireAt, target, false, null, false, true);
          continue;
        } catch (error) {
          console.warn('[LastRide] AlarmKit failed; falling back to a notification', error);
        }
      }
      // An alarm's stand-in never uses the plain notification sound (or it'd be just another reminder).
      const tone = plan.alarm ? soundFile(sound === 'default' ? 'urgent' : sound) : null;
      // Time Sensitive (breaks through Focus) only where being late means missing the train.
      const urgent = plan.alarm === true || (plan.minutesBefore === 0 && !plan.missedCheckIn);
      await present(title, body, plan.fireAt, target, vibrate, tone, urgent);
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
