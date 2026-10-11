/**
 * When to suggest premium. The rules:
 * - the Leave card shows to free users every time the app is opened;
 * - closing it hides it until the app is next opened (coming back from the
 *   background counts as opening);
 * - each opening switches between the lock-screen and the home-widget preview;
 * - never in notifications or on the lock screen (App Review 4.5.4).
 * The trial offer is shown once, at the end of setup.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

const TRIAL_OFFER_KEY = 'lastride-trial-offer-shown';
/** How many times the app has been opened; its parity picks the card. */
const OPENS_KEY = 'lastride-app-opens';

export type LeaveCardVariant = 'lock' | 'widget';

/** Records the one-time trial offer at the end of setup. */
export async function markTrialOfferShown(): Promise<void> {
  await AsyncStorage.setItem(TRIAL_OFFER_KEY, 'true').catch(() => undefined);
}

/** Lock-screen preview on even openings, widget preview on odd ones. */
export function leaveCardVariant(opens: number): LeaveCardVariant {
  return opens % 2 === 0 ? 'lock' : 'widget';
}

/** Which Leave card to show now, or null for none. */
export function leaveCardFor({
  isPremium,
  opens,
  dismissed,
}: {
  isPremium: boolean;
  /** Null until the opening count has loaded. */
  opens: number | null;
  dismissed: boolean;
}): LeaveCardVariant | null {
  if (isPremium || dismissed || opens === null) return null;
  return leaveCardVariant(opens);
}

async function recordOpening(): Promise<number> {
  try {
    const opens = Number((await AsyncStorage.getItem(OPENS_KEY)) ?? '0') + 1;
    await AsyncStorage.setItem(OPENS_KEY, String(opens));
    return opens;
  } catch {
    return 0;
  }
}

/*
 * App-wide, not per screen: the Leave screen remounts on every tab switch,
 * which must not count as opening the app. Held outside React and read with
 * useSyncExternalStore (immutable snapshots, so the React Compiler sees changes).
 */
type CardState = { opens: number | null; dismissed: boolean };
let cardState: CardState = { opens: null, dismissed: false };
let started = false;
const listeners = new Set<() => void>();

function setCardState(next: Partial<CardState>) {
  cardState = { ...cardState, ...next };
  listeners.forEach((listener) => listener());
}

function startTracking() {
  if (started) return;
  started = true;
  const open = () => {
    void recordOpening().then((opens) => setCardState({ opens, dismissed: false }));
  };
  open();
  let wasBackground = false;
  AppState.addEventListener('change', (state) => {
    if (state === 'background') wasBackground = true;
    if (state === 'active' && wasBackground) {
      wasBackground = false;
      open();
    }
  });
}

function subscribe(listener: () => void) {
  startTracking();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => cardState;
const dismiss = () => setCardState({ dismissed: true });

/**
 * The card's state for this opening of the app: which variant, whether it has
 * been closed, and a way to close it. A new opening (launch, or returning from
 * the background) counts up and brings a closed card back.
 */
export function useLeaveCardOpening() {
  const { opens, dismissed } = useSyncExternalStore(subscribe, getSnapshot);
  return { opens, dismissed, dismiss };
}
