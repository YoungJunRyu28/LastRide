/**
 * Persisted user settings. Shared by the React app and the headless
 * background-location task, which runs in a separate JS runtime.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_SAFETY_MARGIN_MINUTES, parseLeaveMargin, type LeaveMargin } from '@/lib/reliability';
import type { Coordinates, StationOption } from '@/lib/stations';
import { addressForDisk, hasPosition, rememberTonight, resolveAddress, resolveStation, stationForDisk } from '@/lib/storedPlaces';
import { serviceDate, serviceDayStart } from '@/lib/time';

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
  /** Notification times, minutes before leaving (0 = at leave time). */
  reminders: 'lastride-reminder-times',
  alarmsEnabled: 'lastride-alarms-enabled',
  alarmTimes: 'lastride-alarm-times',
  alarmSound: 'lastride-alarm-sound',
  reminderVibrate: 'lastride-reminder-vibrate',
  pinnedStation: 'lastride-pinned-station',
  missedCheckIn: 'lastride-missed-check-in',
  homeAddress: 'lastride-home-address',
  destinations: 'lastride-destinations',
  activeDestinationId: 'lastride-active-destination-id',
  nightLocationMode: 'lastride-night-location-mode',
  tonightDestination: 'lastride-tonight-destination',
  /** 終電 / 1本前 / 2本前 for tonight: { choice, until }; lapses at 05:00 after the night. */
  trainChoice: 'lastride-train-choice',
} as const;

/**
 * How night tracking uses location: ask each time (the disclosure dialog),
 * only while the app is open, or in the background too.
 */
export type NightLocationMode = 'ask' | 'foreground' | 'background';

/** Minutes before the leave time; 0 is the leave time itself (出発時刻). */
export const REMINDER_CHOICES = [30, 15, 10, 5, 0];
export const DEFAULT_REMINDERS = [15, 0];

/** Alarm sounds: Apple's default alarm, or one of the tones bundled in modules/last-ride-alarm. */
export type ReminderSound = 'default' | 'pulse' | 'chime' | 'urgent';
export const REMINDER_SOUNDS: ReminderSound[] = ['default', 'pulse', 'chime', 'urgent'];

/**
 * How the night's reminders are delivered. A time is either a notification or
 * an alarm, never both; alarms are opt-in and iOS only.
 */
export type ReminderDelivery = {
  /** Times delivered as alarms (empty while alarms are off). */
  alarmTimes: number[];
  sound: ReminderSound;
  /** Android only: iOS follows the phone's Sounds & Haptics settings. */
  vibrate: boolean;
};

export function reminderLabel(minutes: number, ja: boolean): string {
  if (minutes === 0) return ja ? '出発時' : 'At leave';
  return ja ? `${minutes}分前` : `${minutes} min`;
}

export type Settings = {
  language: Language | null;
  homeStation: StationOption | null;
  /** How much time to spare before the latest leave time. */
  leaveMargin: LeaveMargin;
  /** Notification times (minutes before leaving). */
  reminderIntervals: number[];
  alarmsEnabled: boolean;
  /** Alarm times; never overlaps reminderIntervals. */
  alarmIntervals: number[];
  alarmSound: ReminderSound;
  reminderVibrate: boolean;
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
  /** Tonight's train: 0 = 終電, 1 = 1本前, 2 = 2本前 (lib/trainChoice). */
  trainChoice: number;
};

export const DEFAULT_SETTINGS: Settings = {
  language: null,
  homeStation: null,
  leaveMargin: BASE_SAFETY_MARGIN_MINUTES,
  reminderIntervals: DEFAULT_REMINDERS,
  alarmsEnabled: false,
  alarmIntervals: [],
  alarmSound: 'default',
  reminderVibrate: true,
  pinnedStation: null,
  missedCheckIn: true,
  homeAddress: null,
  destinations: [],
  activeDestinationId: null,
  nightLocationMode: 'ask',
  tonightDestination: null,
  trainChoice: 0,
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
  if (address) {
    await rememberTonight([], [address]);
    await AsyncStorage.setItem(STORAGE_KEYS.homeAddress, JSON.stringify(addressForDisk(address)));
  }
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

/**
 * Saves the destinations by name only (lib/storedPlaces): positions found
 * through Apple Maps go to tonight's cache, not long-term storage.
 */
export async function writeDestinationState(destinations: SavedDestination[], activeDestinationId: string | null): Promise<void> {
  const active = destinations.find((destination) => destination.id === activeDestinationId) ?? destinations[0] ?? null;
  await rememberTonight(
    destinations.map((destination) => destination.station),
    destinations.flatMap((destination) => (destination.address ? [destination.address] : [])),
  );
  const stored = destinations.map((destination) => ({
    ...destination,
    station: stationForDisk(destination.station),
    address: addressForDisk(destination.address),
  }));
  if (stored.length > 0) await AsyncStorage.setItem(STORAGE_KEYS.destinations, JSON.stringify(stored));
  else await AsyncStorage.removeItem(STORAGE_KEYS.destinations);
  if (active) {
    await AsyncStorage.setItem(STORAGE_KEYS.activeDestinationId, active.id);
    // Keep the legacy active keys synchronized so older background tasks/builds degrade safely.
    await AsyncStorage.setItem(STORAGE_KEYS.homeStation, JSON.stringify(stationForDisk(active.station)));
    await writeHomeAddress(active.address);
  } else {
    await AsyncStorage.multiRemove([STORAGE_KEYS.activeDestinationId, STORAGE_KEYS.homeStation, STORAGE_KEYS.homeAddress]);
  }
}

function parseReminders(raw: string | null, fallback: number[]): number[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((entry): entry is number => REMINDER_CHOICES.includes(entry as number)))].sort((a, b) => b - a)
      : fallback;
  } catch {
    return fallback;
  }
}

/** Notification and alarm times; a time in both lists stays an alarm. */
function parseReminderTimes(
  notifyRaw: string | null,
  enabledRaw: string | null,
  alarmRaw: string | null,
): Pick<Settings, 'reminderIntervals' | 'alarmsEnabled' | 'alarmIntervals'> {
  const alarmsEnabled = enabledRaw === 'true';
  const alarmIntervals = alarmsEnabled ? parseReminders(alarmRaw, []) : [];
  const reminderIntervals = parseReminders(notifyRaw, DEFAULT_REMINDERS).filter((minutes) => !alarmIntervals.includes(minutes));
  return { reminderIntervals, alarmsEnabled, alarmIntervals };
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
  const [language, homeStation, leaveMargin, reminders, alarmsEnabled, alarmTimes, alarmSound, reminderVibrate, pinnedStation, missedCheckIn, homeAddress, destinationsRaw, activeDestinationIdRaw, nightLocationMode, tonightRaw] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.language),
    AsyncStorage.getItem(STORAGE_KEYS.homeStation),
    AsyncStorage.getItem(STORAGE_KEYS.leaveMargin),
    AsyncStorage.getItem(STORAGE_KEYS.reminders),
    AsyncStorage.getItem(STORAGE_KEYS.alarmsEnabled),
    AsyncStorage.getItem(STORAGE_KEYS.alarmTimes),
    AsyncStorage.getItem(STORAGE_KEYS.alarmSound),
    AsyncStorage.getItem(STORAGE_KEYS.reminderVibrate),
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
  // Replaced by lastride-reminder-times (which includes the leave time) and the alarm keys.
  void AsyncStorage.multiRemove(['lastride-reminder-intervals', 'lastride-reminder-delivery']).catch(() => undefined);
  const tonightDestination = parsePinnedStation(tonightRaw);
  // One-night stations are dropped once their night is over.
  if (tonightRaw && !tonightDestination) void AsyncStorage.removeItem(STORAGE_KEYS.tonightDestination).catch(() => undefined);
  const pinned = parsePinnedStation(pinnedStation);
  if (pinnedStation && !pinned) void AsyncStorage.removeItem(STORAGE_KEYS.pinnedStation).catch(() => undefined);

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
  } else if (
    destinations.some(
      (destination) => (destination.station.source !== 'odpt' && hasPosition(destination.station)) || hasPosition(destination.address),
    ) ||
    (legacyStation?.source !== 'odpt' && hasPosition(legacyStation)) ||
    hasPosition(legacyAddress)
  ) {
    // Saved by an older build with Apple positions: keep them for tonight only and store names.
    await writeDestinationState(destinations, activeDestinationId);
  }

  const activeDestination = destinations.find((destination) => destination.id === activeDestinationId) ?? destinations[0] ?? null;
  if (activeDestination && activeDestination.id !== activeDestinationId) {
    activeDestinationId = activeDestination.id;
    await AsyncStorage.setItem(STORAGE_KEYS.activeDestinationId, activeDestinationId);
  }

  // Saved places are stored by name; find tonight's positions (cached after the first lookup).
  const savedStation = activeDestination?.station ?? legacyStation;
  const savedAddress = activeDestination?.address ?? legacyAddress;
  const [homeStationResolved, homeAddressResolved] = await Promise.all([
    !tonightDestination && savedStation ? resolveStation(savedStation) : Promise.resolve(savedStation),
    !tonightDestination && savedAddress ? resolveAddress(savedAddress) : Promise.resolve(savedAddress),
  ]);

  return {
    language: language === 'ja' || language === 'en' ? language : null,
    // Tonight's one-off station, when set, is where every plan heads (foreground and background).
    // A saved station may still lack a position (offline); planning looks it up again.
    homeStation: tonightDestination ?? homeStationResolved,
    leaveMargin: parseLeaveMargin(leaveMargin),
    ...parseReminderTimes(reminders, alarmsEnabled, alarmTimes),
    alarmSound: REMINDER_SOUNDS.includes(alarmSound as ReminderSound) ? (alarmSound as ReminderSound) : 'default',
    reminderVibrate: reminderVibrate !== 'false',
    pinnedStation: pinned,
    // Absent means never changed, and the check-in is on by default.
    missedCheckIn: missedCheckIn !== 'false',
    homeAddress: tonightDestination ? null : homeAddressResolved,
    destinations,
    activeDestinationId,
    nightLocationMode: nightLocationMode === 'foreground' || nightLocationMode === 'background' ? nightLocationMode : 'ask',
    tonightDestination,
    trainChoice: await readTrainChoice(),
  };
}

/** True when the station has real coordinates (legacy typed-in names do not). */
export function hasCoordinates(station: StationOption | null): station is StationOption {
  return !!station && (station.latitude !== 0 || station.longitude !== 0);
}

/** The end of the night a train choice was made for: 05:00 the next morning. */
export function trainChoiceUntil(nightMs: number): number {
  return serviceDayStart(nightMs) + 25 * 60 * 60 * 1000;
}

/** Tonight's 終電 / 1本前 / 2本前 (0 once the night it was chosen for is over). */
export async function readTrainChoice(nowMs = Date.now()): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.trainChoice);
    if (!raw) return 0;
    const { choice, until } = JSON.parse(raw) as { choice?: unknown; until?: unknown };
    if (typeof until !== 'number' || nowMs >= until) return 0;
    return choice === 1 || choice === 2 ? choice : 0;
  } catch {
    return 0;
  }
}

export async function writeTrainChoice(choice: number, until: number): Promise<void> {
  if (choice === 0) await AsyncStorage.removeItem(STORAGE_KEYS.trainChoice).catch(() => undefined);
  else await AsyncStorage.setItem(STORAGE_KEYS.trainChoice, JSON.stringify({ choice, until })).catch(() => undefined);
}
