/**
 * Persisted user settings. Shared by the React app and the headless
 * background-location task, which runs in a separate JS runtime.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Coordinates, StationOption, WalkingSpeed } from '@/lib/stations';
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
  walkingSpeed: 'lastride-walking-speed',
  reminders: 'lastride-reminder-intervals',
  pinnedStation: 'lastride-pinned-station',
  missedCheckIn: 'lastride-missed-check-in',
  homeAddress: 'lastride-home-address',
  destinations: 'lastride-destinations',
  activeDestinationId: 'lastride-active-destination-id',
  nightHistory: 'lastride-night-history',
} as const;

export const REMINDER_CHOICES = [30, 15, 10, 5];
export const DEFAULT_REMINDERS = [15];

export type Settings = {
  language: Language | null;
  homeStation: StationOption | null;
  walkingSpeed: WalkingSpeed;
  reminderIntervals: number[];
  /** Station the user chose over the automatic pick; valid for one night only. */
  pinnedStation: StationOption | null;
  /** Send the "missed the last train?" check-in after the last train has gone. */
  missedCheckIn: boolean;
  /** Optional active destination address; plans account for the walk from its arrival station. */
  homeAddress: HomeAddress | null;
  /** All saved destinations stay on-device. */
  destinations: SavedDestination[];
  activeDestinationId: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  language: null,
  homeStation: null,
  walkingSpeed: 'normal',
  reminderIntervals: DEFAULT_REMINDERS,
  pinnedStation: null,
  missedCheckIn: true,
  homeAddress: null,
  destinations: [],
  activeDestinationId: null,
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

export async function writePinnedStation(station: StationOption | null): Promise<void> {
  if (station) await AsyncStorage.setItem(STORAGE_KEYS.pinnedStation, JSON.stringify({ station, serviceDate: serviceDate(Date.now()) }));
  else await AsyncStorage.removeItem(STORAGE_KEYS.pinnedStation);
}

export async function readSettings(): Promise<Settings> {
  const [language, homeStation, walkingSpeed, reminders, pinnedStation, missedCheckIn, homeAddress, destinationsRaw, activeDestinationIdRaw] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.language),
    AsyncStorage.getItem(STORAGE_KEYS.homeStation),
    AsyncStorage.getItem(STORAGE_KEYS.walkingSpeed),
    AsyncStorage.getItem(STORAGE_KEYS.reminders),
    AsyncStorage.getItem(STORAGE_KEYS.pinnedStation),
    AsyncStorage.getItem(STORAGE_KEYS.missedCheckIn),
    AsyncStorage.getItem(STORAGE_KEYS.homeAddress),
    AsyncStorage.getItem(STORAGE_KEYS.destinations),
    AsyncStorage.getItem(STORAGE_KEYS.activeDestinationId),
  ]);

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
    homeStation: activeDestination?.station ?? legacyStation,
    walkingSpeed: walkingSpeed === 'relaxed' || walkingSpeed === 'fast' ? walkingSpeed : 'normal',
    reminderIntervals: parseReminders(reminders),
    pinnedStation: parsePinnedStation(pinnedStation),
    // Absent means never changed, and the check-in is on by default.
    missedCheckIn: missedCheckIn !== 'false',
    homeAddress: activeDestination?.address ?? legacyAddress,
    destinations,
    activeDestinationId,
  };
}

/** True when the station has real coordinates (legacy typed-in names do not). */
export function hasCoordinates(station: StationOption | null): station is StationOption {
  return !!station && (station.latitude !== 0 || station.longitude !== 0);
}
