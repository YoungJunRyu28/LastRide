import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { searchStations as searchStationsApi } from '@workspace/api-client-react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { apiBaseUrl } from '@/lib/api';
import { leaveCurrentEnterpriseEvent, syncEnterpriseLeaveBy } from '@/lib/enterpriseParticipation';
import { cancelAllReminders, ensureNotificationPermission, scheduleReminders, sendTestNotification } from '@/lib/notifications';
import { recordNightPlan } from '@/lib/nightHistory';
import { buildReminderPlans, nightEndsAt, planNight, repick, rideStatus, shouldReplan, trackingEndsAt, trackingHardStopAt, type NightPlan, type RideStatus } from '@/lib/planner';
import { DEFAULT_SETTINGS, readSettings, STORAGE_KEYS, writeDestinationState, writeHomeAddress, writePinnedStation, type HomeAddress, type Language, type SavedDestination } from '@/lib/settings';
import { clearSavedPlan, readSavedPlan, writeSavedPlan } from '@/lib/savedPlan';
import { searchAddresses as searchAddressesApi } from '@workspace/api-client-react';
import { LocationError, type Coordinates, type StationOption, type WalkingSpeed } from '@/lib/stations';
import { formatJstTime, MINUTE_MS, minutesUntil, serviceDate } from '@/lib/time';
import { getFirstTrain, type TrainTime } from '@/lib/timetable';
import { clearTrackingSnapshot, isTrackingFlagOn, markTrackingStarted, readTrackingSnapshot, readTrackingStartedAt, startBackgroundTracking, stopBackgroundTracking } from '@/lib/tracking';

export type { HomeAddress, Language, SavedDestination } from '@/lib/settings';
export type { StationOption } from '@/lib/stations';
export { REMINDER_CHOICES } from '@/lib/settings';
export type LocationErrorCode = LocationError['code'];

type RideContextValue = {
  language: Language | null;
  isHydrated: boolean;
  homeStation: string;
  homeStationOption: StationOption | null;
  /** Optional active destination address, so plans can end at its door. */
  homeAddress: HomeAddress | null;
  setHomeAddress: (address: HomeAddress | null) => void;
  destinations: SavedDestination[];
  activeDestinationId: string | null;
  saveDestination: (destination: { id?: string; label: string; station: StationOption; address: HomeAddress | null }) => void;
  selectDestination: (id: string) => void;
  deleteDestination: (id: string) => void;
  walkingSpeed: WalkingSpeed;
  plan: NightPlan | null;
  stationName: string;
  stationNameJa: string;
  destination: string;
  /** "HH:MM" (Japan time), or "--:--" before a plan exists. */
  leaveBy: string;
  lastTrain: string;
  lastTrainSource: TrainTime['source'] | null;
  firstTrain: string;
  /** Full first-train route (legs, fare, arrival) for the "if missed" screen. */
  firstTrainRoute: TrainTime | null;
  /** Minutes until leave-by (negative once passed), null before a plan exists. */
  minutesUntilLeave: number | null;
  minutesUntilFirstTrain: number | null;
  status: RideStatus | null;
  walkingMinutes: number | null;
  walkingDistanceMeters: number | null;
  userCoordinates: Coordinates | null;
  isLocationReady: boolean;
  isLocating: boolean;
  locationError: LocationErrorCode | null;
  reminderIntervals: number[];
  /** Send the "missed the last train?" check-in after the last train has gone. */
  missedCheckIn: boolean;
  setMissedCheckIn: (enabled: boolean) => void;
  notificationsAllowed: boolean | null;
  /** "HH:MM" (Japan time) of the app clock — the demo clock while one is set. */
  currentTime: string;
  nowMs: number;
  demoActive: boolean;
  setLanguage: (language: Language) => void;
  saveHomeStation: (station: StationOption) => void;
  setWalkingSpeed: (speed: WalkingSpeed) => void;
  requestLocation: () => Promise<void>;
  resetLanguage: () => void;
  toggleReminderInterval: (minutes: number) => void;
  /** Use `station` instead of the automatic pick for tonight, or null to go back to automatic. */
  setPinnedStation: (station: StationOption | null) => void;
  /** Development only: run a fast clock from `virtualMs`, or null to return to real time. */
  setDemoNow: (virtualMs: number | null) => void;
  triggerTestNotification: () => Promise<void>;
  resetAll: () => Promise<void>;
  /** null = not tracking, 'background' = OS updates while app closed, 'foreground' = only while app open. */
  trackingMode: 'background' | 'foreground' | null;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
};

const LastRideContext = createContext<RideContextValue | null>(null);

/** Demo clock speed: one demo minute per real second. */
const DEMO_SPEED = 60;

function newDestinationId(): string {
  return `destination-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getCurrentCoordinates(): Promise<Coordinates> {
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new LocationError('unsupported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
        () => reject(new LocationError('permission')),
        { enableHighAccuracy: true, timeout: 12000 },
      );
    });
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new LocationError('permission');
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

function errorCode(error: unknown): LocationErrorCode {
  return error instanceof LocationError ? error.code : 'unavailable';
}

type PhotonFeature = {
  properties?: { osm_id?: number; name?: string; state?: string; city?: string; district?: string };
  geometry?: { coordinates?: [number, number] };
};

/**
 * Searches Japanese railway stations by name. Japanese/kana queries go to the
 * API server (NAVITIME); romaji queries — and any server failure — use the
 * Photon geocoder (OSM data), which also understands English names.
 */
export async function searchStations(query: string): Promise<StationOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const isJapanese = /[\u3040-\u30ff\u4e00-\u9fff]/.test(trimmed);
  if (apiBaseUrl && isJapanese) {
    try {
      const stations = await searchStationsApi({ q: trimmed });
      if (stations.length > 0) {
        return stations.map(({ id: _id, walkingMeters: _meters, walkingMinutes: _minutes, region, ...station }) => ({ ...station, regionJa: region }));
      }
    } catch {
      // Fall back to Photon below.
    }
  }
  return searchStationsPhoton(trimmed);
}

async function searchStationsPhoton(trimmed: string): Promise<StationOption[]> {
  // Japan bounding box keeps results domestic; two requests give local + English names.
  const base = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&osm_tag=railway:station&limit=12&bbox=122,24,154,46`;
  const [defaultResponse, englishResponse] = await Promise.all([fetch(`${base}&lang=default`), fetch(`${base}&lang=en`)]);
  if (!defaultResponse.ok) throw new Error('Station search is temporarily unavailable.');
  const defaultPayload = (await defaultResponse.json()) as { features?: PhotonFeature[] };
  const englishFeatures = new Map<number, PhotonFeature['properties']>();
  if (englishResponse.ok) {
    const englishPayload = (await englishResponse.json()) as { features?: PhotonFeature[] };
    for (const feature of englishPayload.features ?? []) {
      if (feature.properties?.osm_id !== undefined && feature.properties.name) {
        englishFeatures.set(feature.properties.osm_id, feature.properties);
      }
    }
  }
  const seen = new Set<string>();
  const options: StationOption[] = [];
  for (const feature of defaultPayload.features ?? []) {
    const coordinates = feature.geometry?.coordinates;
    const props = feature.properties;
    const localName = props?.name;
    if (!coordinates || !localName) continue;
    const [longitude, latitude] = coordinates;
    const english = (props?.osm_id !== undefined && englishFeatures.get(props.osm_id)) || undefined;
    const englishName = english?.name || localName;
    const regionJa = [props?.state, props?.city, props?.district].filter(Boolean).join('') || undefined;
    const region = [english?.city || props?.city, english?.state || props?.state].filter(Boolean).join(', ') || undefined;
    // Collapse duplicate entries for the same station complex (multiple operators / entrances):
    // same name within the same city+district is one station to the user.
    const key = props?.city ? `${localName}|${props.city}|${props.district ?? ''}` : `${localName}|${latitude.toFixed(2)}|${longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ name: englishName, nameJa: localName, latitude, longitude, region, regionJa });
  }
  return options.slice(0, 8);
}

/** Searches Japanese addresses through the API server; empty when no server is configured. */
export async function searchAddresses(query: string): Promise<HomeAddress[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || !apiBaseUrl) return [];
  const results = await searchAddressesApi({ q: trimmed });
  return results.map((address) => ({ label: address.name, latitude: address.latitude, longitude: address.longitude }));
}

export function LastRideProvider({ children }: React.PropsWithChildren) {
  const [language, setLanguageState] = useState<Language | null>(DEFAULT_SETTINGS.language);
  const [homeStationOption, setHomeStationOption] = useState<StationOption | null>(DEFAULT_SETTINGS.homeStation);
  const [homeAddress, setHomeAddressState] = useState<HomeAddress | null>(DEFAULT_SETTINGS.homeAddress);
  const [destinations, setDestinations] = useState<SavedDestination[]>(DEFAULT_SETTINGS.destinations);
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(DEFAULT_SETTINGS.activeDestinationId);
  const [walkingSpeed, setWalkingSpeedState] = useState<WalkingSpeed>(DEFAULT_SETTINGS.walkingSpeed);
  const [reminderIntervals, setReminderIntervals] = useState<number[]>(DEFAULT_SETTINGS.reminderIntervals);
  const [missedCheckIn, setMissedCheckInState] = useState(DEFAULT_SETTINGS.missedCheckIn);
  const [pinnedStation, setPinnedStationState] = useState<StationOption | null>(DEFAULT_SETTINGS.pinnedStation);
  const [plan, setPlan] = useState<NightPlan | null>(null);
  const [firstTrain, setFirstTrain] = useState<TrainTime | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<Coordinates | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<LocationErrorCode | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null);
  const [demo, setDemo] = useState<{ virtualAt: number; realAt: number } | null>(null);
  const [realNow, setRealNow] = useState(Date.now);
  const [trackingMode, setTrackingMode] = useState<'background' | 'foreground' | null>(null);
  const [trackingStartedAt, setTrackingStartedAt] = useState<number | null>(null);
  const scheduleToken = useRef(0);
  const foregroundWatch = useRef<Location.LocationSubscription | null>(null);
  const webWatchId = useRef<number | null>(null);
  // Serializes start/stop tracking: any await inside startTracking re-checks this
  // and compensates (tears down what it created) if a stop/reset happened meanwhile.
  const trackingOp = useRef(0);
  // Incremented on resetAll so in-flight async work from a previous session cannot commit state.
  const sessionRef = useRef(0);
  // Latest settings for long-lived location callbacks, so a pace or home change applies mid-tracking.
  const settingsRef = useRef({ walkingSpeed, homeStationOption, pinnedStation, homeAddress });
  settingsRef.current = { walkingSpeed, homeStationOption, pinnedStation, homeAddress };
  const replanInFlight = useRef(false);
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => {
    readSettings()
      .then((saved) => {
        setLanguageState(saved.language);
        setHomeStationOption(saved.homeStation);
        setWalkingSpeedState(saved.walkingSpeed);
        setReminderIntervals(saved.reminderIntervals);
        setPinnedStationState(saved.pinnedStation);
        setMissedCheckInState(saved.missedCheckIn);
        setHomeAddressState(saved.homeAddress);
        setDestinations(saved.destinations);
        setActiveDestinationId(saved.activeDestinationId);
      })
      .catch(() => undefined) // unreadable storage: start fresh rather than hang on a blank screen
      .finally(() => setIsHydrated(true));
    // A plan saved earlier tonight beats showing nothing when the network is down.
    void readSavedPlan().then((saved) => {
      if (saved) setPlan((current) => current ?? saved);
    });
  }, []);

  const demoActive = demo !== null;
  useEffect(() => {
    const timer = setInterval(() => setRealNow(Date.now()), demoActive ? 1000 : 10000);
    return () => clearInterval(timer);
  }, [demoActive]);
  const nowMs = demo ? demo.virtualAt + (realNow - demo.realAt) * DEMO_SPEED : realNow;
  const demoRef = useRef(demo);
  demoRef.current = demo;
  /** The app clock at this instant — the demo clock while one is set — for use in callbacks. */
  const getNow = useCallback(() => {
    const current = demoRef.current;
    return current ? current.virtualAt + (Date.now() - current.realAt) * DEMO_SPEED : Date.now();
  }, []);

  const stationLabel = plan ? (language === 'ja' ? plan.station.nameJa : plan.station.name) : '';

  // Keep OS reminders in sync with the plan. Leave reminders belong to a night
  // out, so they are only scheduled while night-out tracking is on. Runs only when
  // these inputs change; unchanged schedules are skipped inside scheduleReminders.
  useEffect(() => {
    const token = ++scheduleToken.current;
    if (demoActive) return;
    if (!trackingMode || !plan || reminderIntervals.length === 0) {
      void cancelAllReminders();
      return;
    }
    void (async () => {
      const allowed = await ensureNotificationPermission();
      if (token !== scheduleToken.current) return;
      setNotificationsAllowed(allowed);
      if (!allowed) return;
      const plans = buildReminderPlans(plan, reminderIntervals, Date.now(), { missedCheckIn });
      await scheduleReminders(plans, { leaveBy: formatJstTime(plan.leaveByMs), station: stationLabel, language: language ?? 'en' });
    })();
  }, [trackingMode, plan, stationLabel, reminderIntervals, missedCheckIn, language, demoActive]);

  // First train from the chosen station, for the "if missed" screen. Keyed on the
  // station and night rather than the plan, so re-plans that keep them don't refetch.
  const firstTrainKey = plan ? `${plan.station.nameJa}|${serviceDate(plan.lastTrain.departsAt)}` : null;
  useEffect(() => {
    const station = planRef.current?.station;
    if (!station || !homeStationOption) {
      setFirstTrain(null);
      return;
    }
    let cancelled = false;
    getFirstTrain(station, homeStationOption, getNow())
      .then((train) => {
        if (!cancelled) setFirstTrain(train);
      })
      .catch(() => {
        if (!cancelled) setFirstTrain(null);
      });
    return () => {
      cancelled = true;
    };
  }, [firstTrainKey, homeStationOption, getNow]);

  // The night is over once the first train has left (not before 04:00).
  const nightEnd = plan ? nightEndsAt(plan, firstTrain) : null;
  const nightEndRef = useRef(nightEnd);
  nightEndRef.current = nightEnd;

  // Persisted so the app can open offline later in the night and still know tonight's plan.
  useEffect(() => {
    void writeSavedPlan(plan);
  }, [plan]);

  useEffect(() => {
    if (!plan) return;
    const active =
      destinations.find((destination) => destination.id === activeDestinationId) ??
      destinations[0];
    if (!active) return;
    void recordNightPlan(plan, { id: active.id, label: active.label }).catch(
      () => undefined,
    );
  }, [plan?.computedAt, destinations, activeDestinationId]);

  // Enterprise participation is deliberately privacy-minimal: only the computed
  // leave-by timestamp is synced. Location, station, destination and route stay local.
  useEffect(() => {
    if (!plan) return;
    void syncEnterpriseLeaveBy(plan.leaveByMs).catch(() => undefined);
  }, [plan?.leaveByMs]);

  const clearPlan = useCallback(() => {
    setPlan(null);
    setLocationError(null);
  }, []);

  const setWalkingSpeed = useCallback((speed: WalkingSpeed) => {
    setWalkingSpeedState(speed);
    void AsyncStorage.setItem(STORAGE_KEYS.walkingSpeed, speed);
    clearPlan(); // the leave screen re-plans with the new pace
    void Haptics.selectionAsync();
  }, [clearPlan]);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    void AsyncStorage.setItem(STORAGE_KEYS.language, nextLanguage);
    void Haptics.selectionAsync();
  }, []);

  const setPinnedStation = useCallback((station: StationOption | null) => {
    setPinnedStationState(station);
    void writePinnedStation(station);
    // Every candidate's route is already in the plan, so the swap is instant.
    setPlan((current) => (current ? repick(current, station) : current));
    void Haptics.selectionAsync();
  }, []);

  // A pin that can no longer get the user home (e.g. they walked far away) quietly returns to automatic.
  useEffect(() => {
    if (pinnedStation && plan && !plan.pinned) {
      setPinnedStationState(null);
      void writePinnedStation(null);
    }
  }, [pinnedStation, plan]);

  const applyDestinationState = useCallback((next: SavedDestination[], requestedActiveId: string | null) => {
    const active = next.find((destination) => destination.id === requestedActiveId) ?? next[0] ?? null;
    setDestinations(next);
    setActiveDestinationId(active?.id ?? null);
    setHomeStationOption(active?.station ?? null);
    setHomeAddressState(active?.address ?? null);
    setPinnedStationState(null); // station pins belong to the previous destination
    void writePinnedStation(null);
    void writeDestinationState(next, active?.id ?? null);
    clearPlan();
  }, [clearPlan]);

  const saveDestination = useCallback((input: { id?: string; label: string; station: StationOption; address: HomeAddress | null }) => {
    const id = input.id ?? newDestinationId();
    const item: SavedDestination = {
      id,
      label: input.label.trim() || input.station.name,
      station: input.station,
      address: input.address,
    };
    const exists = destinations.some((destination) => destination.id === id);
    const next = exists
      ? destinations.map((destination) => (destination.id === id ? item : destination))
      : [...destinations, item];
    applyDestinationState(next, id);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [destinations, applyDestinationState]);

  const selectDestination = useCallback((id: string) => {
    if (id === activeDestinationId || !destinations.some((destination) => destination.id === id)) return;
    applyDestinationState(destinations, id);
    void Haptics.selectionAsync();
  }, [activeDestinationId, destinations, applyDestinationState]);

  const deleteDestination = useCallback((id: string) => {
    const next = destinations.filter((destination) => destination.id !== id);
    if (next.length === destinations.length) return;
    if (id === activeDestinationId) {
      applyDestinationState(next, next[0]?.id ?? null);
    } else {
      setDestinations(next);
      void writeDestinationState(next, activeDestinationId);
    }
    void Haptics.selectionAsync();
  }, [activeDestinationId, destinations, applyDestinationState]);

  const saveHomeStation = useCallback((station: StationOption) => {
    const current = destinations.find((destination) => destination.id === activeDestinationId);
    if (current) {
      saveDestination({ ...current, station });
      return;
    }
    setHomeStationOption(station);
    void AsyncStorage.setItem(STORAGE_KEYS.homeStation, JSON.stringify(station));
    setPinnedStationState(null);
    void writePinnedStation(null);
    clearPlan();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [activeDestinationId, destinations, saveDestination, clearPlan]);

  const toggleReminderInterval = useCallback((minutes: number) => {
    setReminderIntervals((current) => {
      const next = current.includes(minutes) ? current.filter((entry) => entry !== minutes) : [...current, minutes].sort((a, b) => b - a);
      void AsyncStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(next));
      return next;
    });
    void Haptics.selectionAsync();
  }, []);

  const setHomeAddress = useCallback((address: HomeAddress | null) => {
    const current = destinations.find((destination) => destination.id === activeDestinationId);
    if (current) {
      saveDestination({ ...current, address });
      return;
    }
    setHomeAddressState(address);
    void writeHomeAddress(address);
    clearPlan(); // arrival stations are chosen around the address, so re-plan
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [activeDestinationId, destinations, saveDestination, clearPlan]);

  const setMissedCheckIn = useCallback((enabled: boolean) => {
    setMissedCheckInState(enabled);
    void AsyncStorage.setItem(STORAGE_KEYS.missedCheckIn, String(enabled));
    void Haptics.selectionAsync();
  }, []);

  const setDemoNow = useCallback(
    (virtualMs: number | null) => {
      const realAt = Date.now();
      setRealNow(realAt);
      setDemo(virtualMs === null ? null : { virtualAt: virtualMs, realAt });
      void Haptics.selectionAsync();
      // Returning to real time: the sync effect reschedules real reminders.
      if (virtualMs === null) return;
      // Schedule demo reminders with the OS (compressed to demo speed) so they
      // arrive even when the app is backgrounded or the phone is locked.
      scheduleToken.current += 1; // invalidate any in-flight real-mode scheduling
      if (!trackingMode || !plan || reminderIntervals.length === 0) return;
      void (async () => {
        const allowed = await ensureNotificationPermission();
        setNotificationsAllowed(allowed);
        if (!allowed) return;
        const plans = buildReminderPlans(plan, reminderIntervals, virtualMs, { missedCheckIn }).map((reminder) => ({
          ...reminder,
          fireAt: realAt + (reminder.fireAt - virtualMs) / DEMO_SPEED,
        }));
        await scheduleReminders(plans, { leaveBy: formatJstTime(plan.leaveByMs), station: stationLabel, language: language ?? 'en' });
      })();
    },
    [trackingMode, plan, language, reminderIntervals, missedCheckIn, stationLabel],
  );

  const triggerTestNotification = useCallback(async () => {
    const allowed = await ensureNotificationPermission();
    setNotificationsAllowed(allowed);
    if (!allowed) return;
    await sendTestNotification(language ?? 'en');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [language]);

  /** Plans from a position; returns null when there is no home station to plan toward. */
  const planFrom = useCallback(async (coordinates: Coordinates, { dropPin = false } = {}) => {
    const { homeStationOption: home, walkingSpeed: speed, pinnedStation } = settingsRef.current;
    if (!home) return null;
    const now = getNow();
    // Until tonight is over, keep planning for it: someone waiting for the first
    // train at 04:30 should still see tonight, not tomorrow night.
    const current = planRef.current;
    const nightOf = current && nightEndRef.current !== null && now < nightEndRef.current ? current.lastTrain.departsAt : now;
    return planNight(coordinates, home, speed, now, { pinned: dropPin ? null : pinnedStation, nightOf, homeAddress: settingsRef.current.homeAddress });
  }, [getNow]);

  const requestLocation = useCallback(async () => {
    if (isLocating) return;
    const session = sessionRef.current;
    setIsLocating(true);
    setLocationError(null);
    try {
      const coordinates = await getCurrentCoordinates();
      if (session !== sessionRef.current) return;
      setUserCoordinates(coordinates);
      const next = await planFrom(coordinates);
      if (session !== sessionRef.current || !next) return;
      setPlan(next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if (session !== sessionRef.current) return;
      setLocationError(errorCode(error));
      setPlan(null);
    } finally {
      if (session === sessionRef.current) setIsLocating(false);
    }
  }, [isLocating, planFrom]);

  const applyPlan = useCallback((next: NightPlan) => {
    setUserCoordinates(next.coordinates);
    setPlan(next);
  }, []);

  const removeWatches = useCallback(() => {
    foregroundWatch.current?.remove();
    foregroundWatch.current = null;
    if (webWatchId.current !== null && Platform.OS === 'web' && navigator.geolocation) {
      navigator.geolocation.clearWatch(webWatchId.current);
      webWatchId.current = null;
    }
  }, []);

  const stopTracking = useCallback(async () => {
    trackingOp.current += 1; // invalidate any in-flight startTracking
    removeWatches();
    setTrackingMode(null);
    setTrackingStartedAt(null);
    await stopBackgroundTracking();
    await clearTrackingSnapshot();
  }, [removeWatches]);

  // Stop the watch callbacks if the provider ever unmounts.
  useEffect(() => removeWatches, [removeWatches]);

  /** `resume` picks tracking back up after an app restart, keeping its original start time. */
  const startTracking = useCallback(async ({ resume = false }: { resume?: boolean } = {}) => {
    const op = ++trackingOp.current;
    const startedAt = (resume ? await readTrackingStartedAt() : null) ?? getNow();
    if (op !== trackingOp.current) return;
    if (!resume) void markTrackingStarted(startedAt);
    setTrackingStartedAt(startedAt);
    const handleCoordinates = (coordinates: Coordinates) => {
      if (op !== trackingOp.current || replanInFlight.current) return;
      if (!shouldReplan(planRef.current, coordinates, getNow())) return;
      replanInFlight.current = true;
      void planFrom(coordinates)
        .then((next) => {
          if (next && op === trackingOp.current) applyPlan(next);
        })
        .catch(() => undefined) // transient failure: keep the last plan, the next update retries
        .finally(() => {
          replanInFlight.current = false;
        });
    };
    removeWatches();
    if (Platform.OS === 'web') {
      if (!navigator.geolocation) {
        setLocationError('unsupported');
        return;
      }
      webWatchId.current = navigator.geolocation.watchPosition(
        ({ coords }) => handleCoordinates({ latitude: coords.latitude, longitude: coords.longitude }),
        () => setLocationError('permission'),
        { enableHighAccuracy: true },
      );
      setTrackingMode('foreground');
      return;
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (op !== trackingOp.current) return;
    if (!permission.granted) {
      setLocationError('permission');
      return;
    }
    const watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 150, timeInterval: 120000 },
      (position) => handleCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
    );
    if (op !== trackingOp.current) {
      watch.remove(); // a stop/reset happened while we were awaiting — tear down
      return;
    }
    foregroundWatch.current = watch;
    // Background updates keep it fresh while the app is closed (dev/production builds).
    const backgroundActive = await startBackgroundTracking();
    if (op !== trackingOp.current) {
      if (backgroundActive) await stopBackgroundTracking(); // compensate a stale start
      return;
    }
    setTrackingMode(backgroundActive ? 'background' : 'foreground');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [planFrom, applyPlan, removeWatches, getNow]);

  // Once the night is over (the first train has left), move on to the next night
  // from the last known position. Tonight's pinned station no longer applies.
  const nightOver = nightEnd !== null && nowMs >= nightEnd;
  useEffect(() => {
    if (!nightOver) return;
    const coordinates = planRef.current?.coordinates;
    if (!coordinates) return;
    const session = sessionRef.current;
    setPinnedStationState(null);
    void writePinnedStation(null);
    planFrom(coordinates, { dropPin: true })
      .then((next) => {
        if (next && session === sessionRef.current) setPlan(next);
      })
      .catch(() => {
        if (session === sessionRef.current) clearPlan(); // the Leave screen asks for a fresh location
      });
  }, [nightOver, planFrom, clearPlan]);

  // Night-out tracking ends by itself once the "missed it?" check-in has gone out
  // (or at 04:00): every notification for the night is done, so GPS can stop.
  const trackingOver =
    trackingMode !== null &&
    ((plan !== null && nowMs >= trackingEndsAt(plan)) || (trackingStartedAt !== null && nowMs >= trackingHardStopAt(trackingStartedAt)));
  useEffect(() => {
    if (trackingOver) void stopTracking();
  }, [trackingOver, stopTracking]);

  // Latest requestLocation, for the effects below that refresh a stale plan.
  const requestLocationRef = useRef(requestLocation);
  requestLocationRef.current = requestLocation;

  // A plan restored from storage can be hours old, so refresh it once on launch.
  useEffect(() => {
    if (!isHydrated || trackingMode !== null) return;
    const current = planRef.current;
    if (current && getNow() - current.computedAt >= 10 * MINUTE_MS) void requestLocationRef.current();
  }, [isHydrated, trackingMode, getNow]);

  // Without tracking, the position is only as fresh as the last plan. When the app
  // comes back after a while, get a new fix so the options page shows what's nearby now.
  useEffect(() => {
    if (trackingMode !== null) return;
    const subscription = AppState.addEventListener('change', (state) => {
      const current = planRef.current;
      if (state === 'active' && current && getNow() - current.computedAt >= 10 * MINUTE_MS) void requestLocationRef.current();
    });
    return () => subscription.remove();
  }, [trackingMode, getNow]);

  // Background tracking outlives the app: if it was on when the app was closed,
  // pick it back up on launch so reminders and live updates carry on.
  useEffect(() => {
    if (!isHydrated) return;
    void isTrackingFlagOn().then((on) => {
      if (on) void startTracking({ resume: true });
    });
    // Only on launch: later starts and stops come from the user.
  }, [isHydrated]);

  // When the app returns to the foreground, adopt the background task's plan if it is newer.
  useEffect(() => {
    if (trackingMode !== 'background') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const session = sessionRef.current;
      void readTrackingSnapshot().then((snapshot) => {
        if (!snapshot || session !== sessionRef.current) return;
        setPlan((current) => {
          if (current && current.computedAt >= snapshot.computedAt) return current;
          // The background task moves on at 04:00; keep tonight while the user still waits for the first train.
          const waitingForFirstTrain = current && nightEndRef.current !== null && getNow() < nightEndRef.current;
          if (waitingForFirstTrain && serviceDate(snapshot.lastTrain.departsAt) !== serviceDate(current.lastTrain.departsAt)) return current;
          return snapshot;
        });
        setUserCoordinates(snapshot.coordinates);
      });
    });
    return () => subscription.remove();
  }, [trackingMode, getNow]);

  const resetLanguage = useCallback(() => {
    setLanguageState(null);
    void AsyncStorage.removeItem(STORAGE_KEYS.language);
  }, []);

  /** Clears every saved preference and returns the app to first-launch state. */
  const resetAll = useCallback(async () => {
    sessionRef.current += 1;
    await stopTracking();
    await cancelAllReminders();
    await leaveCurrentEnterpriseEvent().catch(() => undefined);
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
    await clearSavedPlan();
    setLanguageState(DEFAULT_SETTINGS.language);
    setHomeStationOption(DEFAULT_SETTINGS.homeStation);
    setWalkingSpeedState(DEFAULT_SETTINGS.walkingSpeed);
    setReminderIntervals(DEFAULT_SETTINGS.reminderIntervals);
    setPinnedStationState(null);
    setHomeAddressState(null);
    setDestinations(DEFAULT_SETTINGS.destinations);
    setActiveDestinationId(DEFAULT_SETTINGS.activeDestinationId);
    setPlan(null);
    setUserCoordinates(null);
    setIsLocating(false);
    setLocationError(null);
    setDemo(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [stopTracking]);

  const homeStation = homeStationOption ? (language === 'ja' ? homeStationOption.nameJa : homeStationOption.name) : '';
  const activeDestination = destinations.find((destination) => destination.id === activeDestinationId) ?? destinations[0] ?? null;

  const value = useMemo<RideContextValue>(
    () => ({
      language,
      isHydrated,
      homeStation,
      homeStationOption,
      homeAddress,
      setHomeAddress,
      destinations,
      activeDestinationId,
      saveDestination,
      selectDestination,
      deleteDestination,
      walkingSpeed,
      plan,
      stationName: plan?.station.name ?? (language === 'ja' ? '最寄り駅を検索中' : 'Finding nearby station'),
      stationNameJa: plan?.station.nameJa ?? '最寄り駅を検索中',
      destination: activeDestination?.label ?? homeStation,
      leaveBy: plan ? formatJstTime(plan.leaveByMs) : '--:--',
      lastTrain: plan ? formatJstTime(plan.lastTrain.departsAt) : '--:--',
      lastTrainSource: plan?.lastTrain.source ?? null,
      firstTrain: firstTrain ? formatJstTime(firstTrain.departsAt) : '--:--',
      firstTrainRoute: firstTrain,
      minutesUntilLeave: plan ? minutesUntil(plan.leaveByMs, nowMs) : null,
      minutesUntilFirstTrain: firstTrain ? Math.max(0, Math.ceil((firstTrain.departsAt - nowMs) / MINUTE_MS)) : null,
      status: plan ? rideStatus(plan, nowMs) : null,
      walkingMinutes: plan?.walkingMinutes ?? null,
      walkingDistanceMeters: plan?.distanceMeters ?? null,
      userCoordinates,
      isLocationReady: plan !== null,
      isLocating,
      locationError,
      reminderIntervals,
      missedCheckIn,
      setMissedCheckIn,
      notificationsAllowed,
      currentTime: formatJstTime(nowMs),
      nowMs,
      demoActive,
      setLanguage,
      saveHomeStation,
      setWalkingSpeed,
      requestLocation,
      resetLanguage,
      toggleReminderInterval,
      setPinnedStation,
      setDemoNow,
      triggerTestNotification,
      resetAll,
      trackingMode,
      startTracking,
      stopTracking,
    }),
    [activeDestinationId, deleteDestination, demoActive, destinations, firstTrain, homeAddress, setHomeAddress, homeStation, missedCheckIn, setMissedCheckIn, homeStationOption, isHydrated, isLocating, language, locationError, notificationsAllowed, nowMs, plan, reminderIntervals, requestLocation, resetAll, resetLanguage, saveDestination, saveHomeStation, selectDestination, setDemoNow, setPinnedStation, setLanguage, setWalkingSpeed, startTracking, stopTracking, toggleReminderInterval, trackingMode, triggerTestNotification, userCoordinates, walkingSpeed],
  );

  return <LastRideContext.Provider value={value}>{children}</LastRideContext.Provider>;
}

export function useLastRide() {
  const context = useContext(LastRideContext);
  if (!context) throw new Error('useLastRide must be used within LastRideProvider');
  return context;
}

/** Localized text for a location/planning error. */
export function locationErrorText(code: LocationErrorCode, ja: boolean): string {
  switch (code) {
    case 'permission':
      return ja ? '位置情報が許可されていません。端末の設定から許可してください。' : 'Location permission was not granted. Please allow it in your device settings.';
    case 'unsupported':
      return ja ? 'この端末では位置情報を利用できません。' : 'Location is not available on this device.';
    case 'no-station':
      return ja ? '近くに駅が見つかりませんでした。' : 'No station was found nearby.';
    case 'no-route':
      return ja ? '近くの駅から自宅の最寄り駅へ行ける電車が見つかりませんでした。' : 'No train from the stations near you reaches your home station.';
    case 'unavailable':
      return ja ? '駅の検索に失敗しました。通信状況を確認して再試行してください。' : 'Couldn’t reach the station search. Check your connection and try again.';
  }
}
