/**
 * Persisted user settings. Shared by the React app and the headless
 * background-location task, which runs in a separate JS runtime.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LeaveMargin } from '@/lib/reliability';
import type { Coordinates, StationOption } from '@/lib/stations';
import { serviceDate } from '@/lib/time';

export type Language = 'ja' | 'en';

/** Optional street-level endpoint, so plans can include the walk from the arrival station. */
export type HomeAddress = Coordinates & { label: string };

export type SavedDestination = {
  id: string;
  label: string;
  station: StationOption;
  address: HomeAddress | null;
};

export const STORAGE_KEYS = {
  language: 'lastride-language',
  homeStation: 'lastride-home-station',
  leaveMargin: 'lastride-leave-margin',
  reminders: 'lastride-reminder-intervals',
  reminderDelivery: 'lastride-reminder-delivery',
  pinnedStation: 'lastride-pinned-station',
  missedCheckIn: 'lastride-missed-check-in',
  homeAddress: 'lastride-home-address',
  destinations: 'lastride-destinations',
  activeDestinationId: 'lastride-active-destination-id',
  nightLocationMode: 'lastride-night-location-mode',
  tonightDestination: 'lastride-tonight-destination',
} as const;

/**
 * How night tracking uses location: ask each time (the disclosure dialog),
 * only while the app is open, or in the background too.
 */
export type NightLocationMode = 'ask' | 'foreground' | 'background';

export const REMINDER_CHOICES = [30, 15, 10, 5];
export const DEFAULT_REMINDERS = [15];

/** A preference for each selected lead time and for the always-on leave-now alert (0). */
export type ReminderMode = 'notification' | 'alarm';
export type ReminderSound = 'default' | 'pulse' | 'chime' | 'urgent';
export type ReminderDelivery = { mode: ReminderMode; vibrate: boolean; sound: ReminderSound };
export type ReminderPreferences = Record<number, ReminderDelivery>;
export const DEFAULT_REMINDER_DELIVERY: ReminderDelivery = { mode: 'notification', vibrate: true, sound: 'default' };
export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = Object.fromEntries(
  [...REMINDER_CHOICES, 0].map((minute) => [minute, { ...DEFAULT_REMINDER_DELIVERY }])
) as ReminderPreferences;

/** Reject invalid/corrupted persisted data; unknown fields and intervals are discarded. */
export function parseReminderPreferences(raw: string | null): ReminderPreferences {
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  const saved = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const result: ReminderPreferences = {};
  for (const minute of [...REMINDER_CHOICES, 0]) {
    const item = saved[String(minute)];
    const value = item && typeof item === 'object' ? item as Partial<ReminderDelivery> : {};
    result[minute] = {
      mode: value.mode === 'alarm' ? 'alarm' : 'notification',
      vibrate: typeof value.vibrate === 'boolean' ? value.vibrate : true,
      sound: value.sound === 'pulse' || value.sound === 'chime' || value.sound === 'urgent'
        ? value.sound : 'default',
    };
  }
  return result;
}

export function deliveryFor(preferences: ReminderPreferences, minute: number): ReminderDelivery {
  return preferences[minute] ?? DEFAULT_REMINDER_DELIVERY;
}

export type Settings = {
  language: Language | null;
  homeStation: StationOption | null;
  /** How much time to spare before the latest leave time. */
  leaveMargin: LeaveMargin;
  reminderIntervals: number[];
  reminderPreferences: ReminderPreferences;
  /** Station the user chose over the automatic pick; valid for one night only. */
  pinnedStation: StationOption | null;
  /** Send the "missed the last train?" check-in after the last train has gone. */
  missedCheckIn: boolean;
  /** Optional active destination address; plans account for the walk from its arrival station. */
  homeAddress: HomeAddress | null;
  /** All saved destinations stay on-device. */
  destinations: SavedDestination[];
  activeDestinationId: string | null;
  nightLocationMode: NightLocationMode;
  /** A station used for tonight only (not saved); it lapses at the next service day. */
  tonightDestination: StationOption | null;
};

export const DEFAULT_SETTINGS: Settings = {
  language: null,
  homeStation: null,
  leaveMargin: 'normal',
  reminderIntervals: DEFAULT_REMINDERS,
  reminderPreferences: DEFAULT_REMINDER_PREFERENCES,
  pinnedStation: null,
  missedCheckIn: true,
  homeAddress: null,
  destinations: [],
  activeDestinationId: null,
  nightLocationMode: 'ask',
  tonightDestination: null,
};

function parseHomeStation(raw: string | null): StationOption | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StationOption;
    return parsed && typeof parsed === 'object' && parsed.name ? parsed : null;
  } catch {
    // Legacy value was a plain station name typed by the user (no coordinates).
    return { name: raw, nameJa: raw, latitude: 0, longitude: 0 };
  }
}

function parseHomeAddress(raw: string | null): HomeAddress | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HomeAddress;
    return parsed && typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number' && parsed.label ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeHomeAddress(address: HomeAddress | null): Promise<void> {
  if (address) await AsyncStorage.setItem(STORAGE_KEYS.homeAddress, JSON.stringify(address));
  else await AsyncStorage.removeItem(STORAGE_KEYS.homeAddress);
}

function parseDestinations(raw: string | null): SavedDestination[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedDestination => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Partial<SavedDestination>;
      return typeof value.id === 'string' && typeof value.label === 'string' && !!value.station && typeof value.station.name === 'string';
    });
  } catch {
    return [];
  }
}

export async function writeDestinationState(destinations: SavedDestination[], activeDestinationId: string | null): Promise<void> {
  const active = destinations.find((destination) => destination.id === activeDestinationId) ?? destinations[0] ?? null;
  if (destinations.length > 0) await AsyncStorage.setItem(STORAGE_KEYS.destinations, JSON.stringify(destinations));
  else await AsyncStorage.removeItem(STORAGE_KEYS.destinations);
  if (active) {
    await AsyncStorage.setItem(STORAGE_KEYS.activeDestinationId, active.id);
    // Keep the legacy active keys synchronized so older background tasks/builds degrade safely.
    await AsyncStorage.setItem(STORAGE_KEYS.homeStation, JSON.stringify(active.station));
    await writeHomeAddress(active.address);
  } else {
    await AsyncStorage.multiRemove([STORAGE_KEYS.activeDestinationId, STORAGE_KEYS.homeStation, STORAGE_KEYS.homeAddress]);
  }
}

function parseReminders(raw: string | null): number[] {
  if (!raw) return DEFAULT_REMINDERS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is number => REMINDER_CHOICES.includes(entry as number)) : DEFAULT_REMINDERS;
  } catch {
    return DEFAULT_REMINDERS;
  }
}

/** A pin only applies to the service day it was made on, so it never leaks into tomorrow night. */
function parsePinnedStation(raw: string | null): StationOption | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { station?: StationOption; serviceDate?: string };
    return parsed.station && parsed.serviceDate === serviceDate(Date.now()) ? parsed.station : null;
  } catch {
    return null;
  }
}

/** Tonight-only destinations share the pinned station's one-night lifetime. */
export async function writeTonightDestination(station: StationOption | null): Promise<void> {
  if (station) await AsyncStorage.setItem(STORAGE_KEYS.tonightDestination, JSON.stringify({ station, serviceDate: serviceDate(Date.now()) }));
  else await AsyncStorage.removeItem(STORAGE_KEYS.tonightDestination);
}

export async function writePinnedStation(station: StationOption | null): Promise<void> {
  if (station) await AsyncStorage.setItem(STORAGE_KEYS.pinnedStation, JSON.stringify({ station, serviceDate: serviceDate(Date.now()) }));
  else await AsyncStorage.removeItem(STORAGE_KEYS.pinnedStation);
}

export async function readSettings(): Promise<Settings> {
  const [language, homeStation, leaveMargin, reminders, reminderDelivery, pinnedStation, missedCheckIn, homeAddress, destinationsRaw, activeDestinationIdRaw, nightLocationMode, tonightRaw] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.language),
    AsyncStorage.getItem(STORAGE_KEYS.homeStation),
    AsyncStorage.getItem(STORAGE_KEYS.leaveMargin),
    AsyncStorage.getItem(STORAGE_KEYS.reminders),
    AsyncStorage.getItem(STORAGE_KEYS.reminderDelivery),
    AsyncStorage.getItem(STORAGE_KEYS.pinnedStation),
    AsyncStorage.getItem(STORAGE_KEYS.missedCheckIn),
    AsyncStorage.getItem(STORAGE_KEYS.homeAddress),
    AsyncStorage.getItem(STORAGE_KEYS.destinations),
    AsyncStorage.getItem(STORAGE_KEYS.activeDestinationId),
    AsyncStorage.getItem(STORAGE_KEYS.nightLocationMode),
    AsyncStorage.getItem(STORAGE_KEYS.tonightDestination),
  ]);
  // Night history was removed: plan times derived from map data aren't kept long-term.
  void AsyncStorage.removeItem('lastride-night-history').catch(() => undefined);
  // The walking-pace setting was replaced by 余裕 (leaveMargin).
  void AsyncStorage.removeItem('lastride-walking-speed').catch(() => undefined);
  const tonightDestination = parsePinnedStation(tonightRaw);

  const legacyStation = parseHomeStation(homeStation);
  const legacyAddress = parseHomeAddress(homeAddress);
  let destinations = parseDestinations(destinationsRaw);
  let activeDestinationId = activeDestinationIdRaw;

  // One-time migration: the old single "home" becomes the first local destination.
  if (destinations.length === 0 && legacyStation) {
    const home: SavedDestination = {
      id: 'home',
      label: language === 'ja' ? '自宅' : 'Home',
      station: legacyStation,
      address: legacyAddress,
    };
    destinations = [home];
    activeDestinationId = home.id;
    await writeDestinationState(destinations, activeDestinationId);
  }

  const activeDestination = destinations.find((destination) => destination.id === activeDestinationId) ?? destinations[0] ?? null;
  if (activeDestination && activeDestination.id !== activeDestinationId) {
    activeDestinationId = activeDestination.id;
    await AsyncStorage.setItem(STORAGE_KEYS.activeDestinationId, activeDestinationId);
  }

  return {
    language: language === 'ja' || language === 'en' ? language : null,
    // Tonight's one-off station, when set, is where every plan heads (foreground and background).
    homeStation: tonightDestination ?? activeDestination?.station ?? legacyStation,
    leaveMargin: leaveMargin === 'tight' || leaveMargin === 'relaxed' ? leaveMargin : 'normal',
    reminderIntervals: parseReminders(reminders),
    reminderPreferences: parseReminderPreferences(reminderDelivery),
    pinnedStation: parsePinnedStation(pinnedStation),
    // Absent means never changed, and the check-in is on by default.
    missedCheckIn: missedCheckIn !== 'false',
    homeAddress: tonightDestination ? null : activeDestination?.address ?? legacyAddress,
    destinations,
    activeDestinationId,
    nightLocationMode: nightLocationMode === 'foreground' || nightLocationMode === 'background' ? nightLocationMode : 'ask',
    tonightDestination,
  };
}

/** True when the station has real coordinates (legacy typed-in names do not). */
export function hasCoordinates(station: StationOption | null): station is StationOption {
  return !!station && (station.latitude !== 0 || station.longitude !== 0);
}
