/**
 * When to suggest premium. The rules (see the design notes):
 * - at most one prompt per night (service day);
 * - the one-time trial offer after onboarding counts as that night's prompt;
 * - the Leave card alternates nightly between the lock-screen and the
 *   home-widget preview, and a dismissal hides it for the rest of the night;
 * - never close to leave-by or after the last train (status must be "relaxed");
 * - never in notifications or on the lock screen (App Review 4.5.4).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RideStatus } from '@/lib/planner';
import { serviceDate } from '@/lib/time';

const TRIAL_OFFER_KEY = 'lastride-trial-offer-shown';
/** Service date of the last night a prompt was shown or dismissed. */
const PROMPT_NIGHT_KEY = 'lastride-premium-prompt-night';
const CARD_DISMISSED_KEY = 'lastride-premium-card-dismissed';

export type LeaveCardVariant = 'lock' | 'widget';

export type PromptState = {
  trialOfferShown: boolean;
  /** Service date a non-card prompt (the trial offer) was shown on. */
  promptNight: string | null;
  /** Service date the Leave card was dismissed on. */
  cardDismissedNight: string | null;
};

export async function readPromptState(): Promise<PromptState> {
  try {
    const [trial, night, dismissed] = await Promise.all([
      AsyncStorage.getItem(TRIAL_OFFER_KEY),
      AsyncStorage.getItem(PROMPT_NIGHT_KEY),
      AsyncStorage.getItem(CARD_DISMISSED_KEY),
    ]);
    return { trialOfferShown: trial === 'true', promptNight: night, cardDismissedNight: dismissed };
  } catch {
    // If storage fails, behave as if tonight's prompt was already used.
    return { trialOfferShown: true, promptNight: serviceDate(Date.now()), cardDismissedNight: null };
  }
}

/** Records the one-time trial offer; it is tonight's prompt. */
export async function markTrialOfferShown(nowMs: number): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(TRIAL_OFFER_KEY, 'true'),
    AsyncStorage.setItem(PROMPT_NIGHT_KEY, serviceDate(nowMs)),
  ]).catch(() => undefined);
}

export async function dismissLeaveCard(nowMs: number): Promise<void> {
  await AsyncStorage.setItem(CARD_DISMISSED_KEY, serviceDate(nowMs)).catch(() => undefined);
}

/** Lock-screen preview on even service days, widget preview on odd ones. */
export function leaveCardVariant(nowMs: number): LeaveCardVariant {
  const date = serviceDate(nowMs);
  const day = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))) / 86_400_000;
  return day % 2 === 0 ? 'lock' : 'widget';
}

/** Which Leave card to show tonight, or null for none. */
export function leaveCardFor({
  isPremium,
  status,
  state,
  nowMs,
}: {
  isPremium: boolean;
  status: RideStatus | null;
  state: PromptState | null;
  nowMs: number;
}): LeaveCardVariant | null {
  if (isPremium || !state || status !== 'relaxed') return null;
  const tonight = serviceDate(nowMs);
  if (state.promptNight === tonight || state.cardDismissedNight === tonight) return null;
  return leaveCardVariant(nowMs);
}
