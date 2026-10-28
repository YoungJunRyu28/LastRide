/**
 * Did the user make the earlier train (1本前 / 2本前) they were heading for?
 *
 * The app can't tell from location (far from the station could mean on the
 * train, or that they missed it and walked off), so it asks once, when that
 * train departs: a notification with 〔乗った〕 / 〔乗れなかった〕, and the same
 * question on the home screen.
 * - 乗った: the night is over: reminders and the "missed it?" check-in are
 *   cancelled, tracking stops, the app and widgets show the train taken.
 * - 乗れなかった, or no answer: the plan has already moved on to the next train;
 *   it is re-planned from where the user is, with that train's own reminders.
 *
 * Both buttons open the app: iOS doesn't reliably hand a button tap to the
 * app's code while it is closed unless the button opens it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NightPlan } from '@/lib/planner';
import { formatJstTime, serviceDate } from '@/lib/time';
import { trainChoiceLabel } from '@/lib/trainChoice';

const BOARDED_KEY = 'lastride-boarded';
const ANSWERED_KEY = 'lastride-boarding-answered';

/** The category of the 乗れましたか？ notification, with its two buttons. */
export const BOARDED_CATEGORY = 'lastride-boarded-check';
export const BOARDED_ACTION = 'boarded';
export const NOT_BOARDED_ACTION = 'not-boarded';

export type BoardedRecord = {
  /** Service date of the night (YYYYMMDD). */
  night: string;
  /** 1 = 1本前, 2 = 2本前. */
  choice: number;
  trainDepartsAt: number;
  /** At the door (or the station when unknown), epoch ms. */
  arrivesAt?: number;
};

/** Tonight's "on the train" record, or null (another night's is ignored). */
export async function readBoarded(nowMs = Date.now()): Promise<BoardedRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(BOARDED_KEY);
    const record = raw ? (JSON.parse(raw) as BoardedRecord) : null;
    return record && record.night === serviceDate(nowMs) ? record : null;
  } catch {
    return null;
  }
}

export async function writeBoarded(record: BoardedRecord | null): Promise<void> {
  if (record) await AsyncStorage.setItem(BOARDED_KEY, JSON.stringify(record)).catch(() => undefined);
  else await AsyncStorage.removeItem(BOARDED_KEY).catch(() => undefined);
}

/** The departure the user answered 乗れなかった for (so the question isn't shown again). */
export async function readAnswered(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(ANSWERED_KEY).catch(() => null);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function writeAnswered(departsAt: number | null): Promise<void> {
  if (departsAt === null) await AsyncStorage.removeItem(ANSWERED_KEY).catch(() => undefined);
  else await AsyncStorage.setItem(ANSWERED_KEY, String(departsAt)).catch(() => undefined);
}

/** For the reminder texts: the earlier train headed for, and the one after it. */
export type HeldTrain = { label: string; next: string; nextDeparts: string };

export function heldTrain(
  plan: Pick<NightPlan, 'trainChoice' | 'nightLastTrain' | 'nightLaterTrains'>,
  ja: boolean,
): HeldTrain | undefined {
  if (!plan.trainChoice || !plan.nightLastTrain) return undefined;
  const later = plan.nightLaterTrains?.[0];
  return {
    label: trainChoiceLabel(plan.trainChoice, ja),
    next: later
      ? ja
        ? trainChoiceLabel(plan.trainChoice - 1, true)
        : `the ${trainChoiceLabel(plan.trainChoice - 1, false).toLowerCase()} train`
      : ja
        ? '終電'
        : 'the last train',
    nextDeparts: formatJstTime((later ?? plan.nightLastTrain).departsAt),
  };
}

/** The question's text. Only facts that don't depend on where the user is: no leave time. */
export function boardedQuestion(held: HeldTrain, language: 'ja' | 'en') {
  return language === 'ja'
    ? {
        title: `LastRide — ${held.label}に乗れましたか？`,
        body: `乗り遅れた場合：${held.next}は${held.nextDeparts}発。アプリを開くと、現在地からの出発時刻を再計算します。`,
      }
    : {
        title: `LastRide — did you make the ${held.label.toLowerCase()} train?`,
        body: `If not: ${held.next} leaves at ${held.nextDeparts}. Open the app for your leave time from where you are.`,
      };
}

/** The two buttons, as on the home-screen card. */
export function boardedButtons(language: 'ja' | 'en') {
  return language === 'ja' ? { boarded: '乗った', notBoarded: '乗れなかった' } : { boarded: 'I’m on it', notBoarded: 'I missed it' };
}

/** One identifier per departed train: the follow-up replaces the question in Notification Center. */
export function boardedNotificationId(departsAt: number): string {
  return `lastride-boarded-${departsAt}`;
}

/**
 * No answer yet, and re-planned from where the user is: the follow-up, with
 * the real times now (the next train, its station, when to leave).
 */
export function boardedFollowUp(
  info: { goneLabel: string; nextLabel: string; nextDeparts: string; station: string; leaveBy: string; leavePassed: boolean },
  language: 'ja' | 'en',
) {
  if (language === 'ja') {
    return {
      title: `LastRide — ${info.goneLabel}に乗れなかったなら`,
      body: info.leavePassed
        ? `${info.station}から${info.nextLabel} ${info.nextDeparts}発。今すぐ駅へ向かってください。`
        : `${info.station}から${info.nextLabel} ${info.nextDeparts}発。${info.leaveBy}に出てください。`,
    };
  }
  const next = info.nextLabel;
  return {
    title: `LastRide — if you missed the ${info.goneLabel.toLowerCase()} train`,
    body: info.leavePassed
      ? `${next} from ${info.station} leaves at ${info.nextDeparts}. Head to the station now.`
      : `${next} from ${info.station} leaves at ${info.nextDeparts}. Leave at ${info.leaveBy}.`,
  };
}
