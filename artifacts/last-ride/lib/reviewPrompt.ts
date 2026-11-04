/**
 * Apple's review prompt, asked at a calm, good moment: the app has helped on a
 * couple of nights (今夜の案内 started on two different nights), and it's
 * daytime, the morning or afternoon after, never during a night out or the
 * first time the app opens. Once per 120 days from our side; iOS itself shows
 * it at most three times a year, and never in TestFlight.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { serviceDate } from '@/lib/time';

const NIGHTS_KEY = 'lastride-review-nights';
const ASKED_KEY = 'lastride-review-asked-at';
/** Distinct nights with 今夜の案内 before asking. */
const NIGHTS_BEFORE_ASKING = 2;
const ASK_AGAIN_AFTER_MS = 120 * 24 * 60 * 60 * 1000;
/** Japan clock hours when asking is fine: after the night, before the next one starts. */
const DAY_FROM_HOUR = 8;
const DAY_UNTIL_HOUR = 19;

async function readNights(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(NIGHTS_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** 今夜の案内 started: remember the night (only how many, kept short). */
export async function noteNightUsed(nowMs: number): Promise<void> {
  const night = serviceDate(nowMs);
  const nights = await readNights();
  if (nights.includes(night)) return;
  await AsyncStorage.setItem(NIGHTS_KEY, JSON.stringify([...nights, night].slice(-NIGHTS_BEFORE_ASKING))).catch(() => undefined);
}

/** Whether now is a good moment (pure, for tests). */
export function shouldAskForReview(nowMs: number, nights: string[], askedAt: number | null): boolean {
  if (nights.length < NIGHTS_BEFORE_ASKING) return false;
  // Not on the same service day as a night it helped with until it's daytime again.
  const hour = new Date(nowMs + 9 * 60 * 60 * 1000).getUTCHours();
  if (hour < DAY_FROM_HOUR || hour >= DAY_UNTIL_HOUR) return false;
  return askedAt === null || nowMs - askedAt >= ASK_AGAIN_AFTER_MS;
}

/** Called when the app comes to the front: asks if it's the moment, otherwise does nothing. */
export async function maybeAskForReview(nowMs = Date.now()): Promise<void> {
  try {
    const [nights, askedRaw] = await Promise.all([readNights(), AsyncStorage.getItem(ASKED_KEY)]);
    const askedAt = askedRaw ? Number(askedRaw) : null;
    if (!shouldAskForReview(nowMs, nights, Number.isFinite(askedAt) ? askedAt : null)) return;
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return;
    await AsyncStorage.setItem(ASKED_KEY, String(nowMs));
    await StoreReview.requestReview();
  } catch {
    // Never in the way: no prompt is fine.
  }
}
