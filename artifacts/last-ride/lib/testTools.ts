/**
 * The testing tools (demo clock, test notifications, the Live Activity log, the
 * Premium switch) on TestFlight installs: hidden until unlocked by tapping the
 * version line at the bottom of Settings 7 times, so App Review (whose installs
 * also have a sandbox receipt, like TestFlight's) never sees them. App Store
 * installs can't unlock them at all. Development builds always have them.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { isTestFlightBuild } from '@/modules/last-ride-alarm/src';

const UNLOCK_KEY = 'lastride-test-tools-unlocked';
export const UNLOCK_TAPS = 7;
/** Taps further apart than this start the count again. */
const TAP_WINDOW_MS = 1500;

/** Whether this install may have the tools at all: never on an App Store download. */
export const testToolsPossible = (typeof __DEV__ !== 'undefined' && __DEV__) || isTestFlightBuild;

let unlocked = typeof __DEV__ !== 'undefined' && __DEV__;
let loaded: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function set(value: boolean) {
  unlocked = value;
  listeners.forEach((listener) => listener());
}

/** Reads the unlock from disk once; resolves to whether the tools are on. */
export function loadTestToolsUnlock(): Promise<boolean> {
  if (!testToolsPossible) return Promise.resolve(false);
  if (unlocked) return Promise.resolve(true);
  loaded ??= AsyncStorage.getItem(UNLOCK_KEY)
    .then((value) => {
      if (value === 'true') set(true);
      return unlocked;
    })
    .catch(() => unlocked);
  return loaded;
}

export function testToolsUnlocked(): boolean {
  return testToolsPossible && unlocked;
}

let taps = 0;
let lastTapAt = -Infinity;

/** One tap on the version line. Returns true on the tap that unlocks (or locks again). */
export function tapVersion(now = Date.now()): boolean {
  if (!testToolsPossible || (typeof __DEV__ !== 'undefined' && __DEV__)) return false;
  taps = now - lastTapAt < TAP_WINDOW_MS ? taps + 1 : 1;
  lastTapAt = now;
  if (taps < UNLOCK_TAPS) return false;
  taps = 0;
  const next = !unlocked;
  set(next);
  void (next ? AsyncStorage.setItem(UNLOCK_KEY, 'true') : AsyncStorage.removeItem(UNLOCK_KEY)).catch(() => undefined);
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void loadTestToolsUnlock();
  return () => listeners.delete(listener);
}

/** React: are the testing tools showing on this install? */
export function useTestTools(): boolean {
  return useSyncExternalStore(subscribe, testToolsUnlocked, testToolsUnlocked);
}
