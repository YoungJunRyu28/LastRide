import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import {
  clearEnterpriseParticipation,
  leaveCurrentEnterpriseEvent,
  syncEnterpriseLeaveBy,
} from "@/lib/enterpriseParticipation";
import {
  cancelAllReminders,
  ensureNotificationPermission,
  scheduleReminders,
  sendTestNotification,
} from "@/lib/notifications";
import { recommendedLeaveTime, type LeaveMargin } from "@/lib/reliability";
import {
  buildReminderPlans,
  nightEndsAt,
  freshPlanNightOf,
  planNight,
  repick,
  rideStatus,
  shouldReplan,
  trackingEndsAt,
  trackingHardStopAt,
  type NightPlan,
  type RideStatus,
} from "@/lib/planner";
import {
  DEFAULT_SETTINGS,
  readSettings,
  STORAGE_KEYS,
  writeDestinationState,
  writeHomeAddress,
  writePinnedStation,
  writeTonightDestination,
  type HomeAddress,
  type Language,
  type NightLocationMode,
  type ReminderSound,
  type SavedDestination,
} from "@/lib/settings";
import { clearSavedPlan, readSavedPlan, writeSavedPlan } from "@/lib/savedPlan";
import {
  resolveNightLocationMode,
  trackingDisclosure,
} from "@/lib/trackingDisclosure";
import {
  LocationError,
  type Coordinates,
  type StationOption,
} from "@/lib/stations";
import {
  formatJstTime,
  MINUTE_MS,
  minutesUntil,
  serviceDate,
} from "@/lib/time";
import { getFirstTrain, type TrainTime } from "@/lib/timetable";
import { endLiveActivity, syncLiveActivity } from "@/lib/liveActivity";
import { usePremium } from "@/context/PremiumContext";
import { syncAppleLanguage } from "@/lib/applePlaces";
import { stationForStorage } from "@/lib/savedStation";
import {
  clearPlaceCache,
  hasPosition,
  rememberTonight,
  resolveAddress,
  resolveStation,
  stationForDisk,
} from "@/lib/storedPlaces";
import { syncWidgets } from "@/lib/widgets";
import {
  clearTrackingSnapshot,
  backgroundLocationState,
  requestNightLocationPermission,
  isTrackingFlagOn,
  markTrackingStarted,
  readTrackingSnapshot,
  readTrackingStartedAt,
  startBackgroundTracking,
  stopBackgroundTracking,
} from "@/lib/tracking";

export type { HomeAddress, Language, SavedDestination } from "@/lib/settings";
export type { StationOption } from "@/lib/stations";
export { REMINDER_CHOICES } from "@/lib/settings";
export { searchAddresses, searchStations } from "@/lib/placeSearch";
export type LocationErrorCode = LocationError["code"];

/**
 * An explicit choice before either OS location-permission prompt. The saved
 * choice is reused without asking (see resolveNightLocationMode); `asked`
 * says whether the dialog was shown, so the caller can remember the answer.
 * Null means the user cancelled and tracking must not start.
 */
async function chooseNightTrackingLocation(
  language: Language | null,
  saved: NightLocationMode,
): Promise<{ mode: 'foreground' | 'background'; asked: boolean } | null> {
  if (Platform.OS === 'web') return { mode: 'foreground', asked: false };
  const background = await backgroundLocationState();
  const resolved = resolveNightLocationMode(saved, saved === 'background' && background.granted);
  if (resolved !== 'ask') return { mode: resolved, asked: false };
  if (!background.granted && !background.canAskAgain) {
    // iOS won't ask for "Always" again; only Settings can change it. Say so,
    // instead of a choice that would silently fall back to app-open-only.
    const ja = language === 'ja';
    return new Promise((resolve) => {
      Alert.alert(
        ja ? '閉じても更新するには' : 'To update when closed',
        ja
          ? 'iPhoneの設定で、LastRideの位置情報を「常に」にしてください（夜のトラッキング中だけ使います）。今夜はアプリを開いている間だけ更新することもできます。'
          : 'In iPhone Settings, set LastRide’s location access to “Always” (used only during night tracking). Or track tonight while the app is open.',
        [
          { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: ja ? 'アプリ使用中のみで開始' : 'Track while open', onPress: () => resolve({ mode: 'foreground', asked: true }) },
          {
            text: ja ? '設定を開く' : 'Open Settings',
            onPress: () => {
              void Linking.openSettings();
              resolve(null);
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    });
  }
  const disclosure = trackingDisclosure(language);
  return new Promise((resolve) => {
    Alert.alert(
      disclosure.title,
      disclosure.message,
      [
        { text: disclosure.cancel, style: 'cancel', onPress: () => resolve(null) },
        { text: disclosure.foregroundOnly, onPress: () => resolve({ mode: 'foreground', asked: true }) },
        { text: disclosure.allowBackground, onPress: () => resolve({ mode: 'background', asked: true }) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}


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
  saveDestination: (destination: {
    id?: string;
    label: string;
    station: StationOption;
    address: HomeAddress | null;
  }) => Promise<void>;
  selectDestination: (id: string) => void;
  /** A station for tonight only (not saved; back to the saved destination tomorrow). */
  tonightDestination: StationOption | null;
  setTonightDestination: (station: StationOption | null) => void;
  deleteDestination: (id: string) => void;
  leaveMargin: LeaveMargin;
  plan: NightPlan | null;
  stationName: string;
  stationNameJa: string;
  destination: string;
  /** "HH:MM" (Japan time), or "--:--" before a plan exists. */
  leaveBy: string;
  lastTrain: string;
  lastTrainSource: TrainTime["source"] | null;
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
  /** Notification times, minutes before leaving (0 = at leave time). */
  reminderIntervals: number[];
  /** Alarm times (iOS); a time is a notification or an alarm, never both. */
  alarmsEnabled: boolean;
  alarmIntervals: number[];
  alarmSound: ReminderSound;
  /** Android: vibrate with reminders. */
  reminderVibrate: boolean;
  /** On starts with the leave time; off moves alarm times back to notifications. */
  setAlarmsEnabled: (enabled: boolean) => void;
  toggleAlarmInterval: (minutes: number) => void;
  setAlarmSound: (sound: ReminderSound) => void;
  setReminderVibrate: (vibrate: boolean) => void;
  /** Send the "missed the last train?" check-in after the last train has gone. */
  missedCheckIn: boolean;
  setMissedCheckIn: (enabled: boolean) => void;
  /** Night tracking's location choice; "ask" shows the disclosure next time. */
  nightLocationMode: NightLocationMode;
  setNightLocationMode: (mode: NightLocationMode) => void;
  /** Whether iOS allows location while the app is closed ("Always"); null until known. */
  backgroundAllowed: boolean | null;
  /** Asks iOS for "Always" if it still can; resolves to whether it's allowed now. */
  requestBackgroundLocation: () => Promise<boolean>;
  notificationsAllowed: boolean | null;
  /** Asks the OS for notification permission (onboarding step 2). */
  requestNotifications: () => Promise<boolean>;
  /** "HH:MM" (Japan time) of the app clock — the demo clock while one is set. */
  currentTime: string;
  nowMs: number;
  demoActive: boolean;
  setLanguage: (language: Language) => void;
  saveHomeStation: (station: StationOption) => Promise<void>;
  setLeaveMargin: (margin: LeaveMargin) => void;
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
  trackingMode: "background" | "foreground" | null;
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
  if (Platform.OS === "web") {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new LocationError("unsupported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          resolve({ latitude: coords.latitude, longitude: coords.longitude }),
        () => reject(new LocationError("permission")),
        { enableHighAccuracy: true, timeout: 12000 },
      );
    });
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new LocationError("permission");
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

function errorCode(error: unknown): LocationErrorCode {
  return error instanceof LocationError ? error.code : "unavailable";
}

export function LastRideProvider({ children }: React.PropsWithChildren) {
  const [language, setLanguageState] = useState<Language | null>(
    DEFAULT_SETTINGS.language,
  );
  const [homeStationOption, setHomeStationOption] =
    useState<StationOption | null>(DEFAULT_SETTINGS.homeStation);
  const [tonightDestination, setTonightDestinationState] =
    useState<StationOption | null>(null);
  const [homeAddress, setHomeAddressState] = useState<HomeAddress | null>(
    DEFAULT_SETTINGS.homeAddress,
  );
  const [destinations, setDestinations] = useState<SavedDestination[]>(
    DEFAULT_SETTINGS.destinations,
  );
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(
    DEFAULT_SETTINGS.activeDestinationId,
  );
  const [leaveMargin, setLeaveMarginState] = useState<LeaveMargin>(
    DEFAULT_SETTINGS.leaveMargin,
  );
  const [reminderIntervals, setReminderIntervals] = useState<number[]>(
    DEFAULT_SETTINGS.reminderIntervals,
  );
  const [alarmsEnabled, setAlarmsEnabledState] = useState(DEFAULT_SETTINGS.alarmsEnabled);
  const [alarmIntervals, setAlarmIntervals] = useState<number[]>(DEFAULT_SETTINGS.alarmIntervals);
  const [alarmSound, setAlarmSoundState] = useState<ReminderSound>(DEFAULT_SETTINGS.alarmSound);
  const [reminderVibrate, setReminderVibrateState] = useState(DEFAULT_SETTINGS.reminderVibrate);
  const [missedCheckIn, setMissedCheckInState] = useState(
    DEFAULT_SETTINGS.missedCheckIn,
  );
  const [nightLocationMode, setNightLocationModeState] =
    useState<NightLocationMode>(DEFAULT_SETTINGS.nightLocationMode);
  const [pinnedStation, setPinnedStationState] = useState<StationOption | null>(
    DEFAULT_SETTINGS.pinnedStation,
  );
  const [plan, setPlan] = useState<NightPlan | null>(null);
  const [firstTrain, setFirstTrain] = useState<TrainTime | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<Coordinates | null>(
    null,
  );
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<LocationErrorCode | null>(
    null,
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [notificationsAllowed, setNotificationsAllowed] = useState<
    boolean | null
  >(null);
  const [demo, setDemo] = useState<{
    virtualAt: number;
    realAt: number;
  } | null>(null);
  const [realNow, setRealNow] = useState(Date.now);
  const [trackingMode, setTrackingMode] = useState<
    "background" | "foreground" | null
  >(null);
  const [trackingStartedAt, setTrackingStartedAt] = useState<number | null>(
    null,
  );
  const scheduleToken = useRef(0);
  // Recheck alarm authorization when returning from iOS Settings, even if the
  // chosen route and preferences are unchanged.
  const [alarmPermissionRevision, setAlarmPermissionRevision] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setAlarmPermissionRevision((revision) => revision + 1);
    });
    return () => subscription.remove();
  }, []);
  const foregroundWatch = useRef<Location.LocationSubscription | null>(null);
  const webWatchId = useRef<number | null>(null);
  // Serializes start/stop tracking: any await inside startTracking re-checks this
  // and compensates (tears down what it created) if a stop/reset happened meanwhile.
  const trackingOp = useRef(0);
  // Incremented on resetAll so in-flight async work from a previous session cannot commit state.
  const sessionRef = useRef(0);
  // Latest settings for long-lived location callbacks, so a 余裕 or home change applies mid-tracking.
  const settingsRef = useRef({
    leaveMargin,
    homeStationOption,
    pinnedStation,
    homeAddress,
  });
  settingsRef.current = {
    leaveMargin,
    homeStationOption,
    pinnedStation,
    homeAddress,
  };
  const replanInFlight = useRef(false);
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => {
    readSettings()
      .then((saved) => {
        setLanguageState(saved.language);
        setHomeStationOption(saved.homeStation);
        setLeaveMarginState(saved.leaveMargin);
        setReminderIntervals(saved.reminderIntervals);
        setAlarmsEnabledState(saved.alarmsEnabled);
        setAlarmIntervals(saved.alarmIntervals);
        setAlarmSoundState(saved.alarmSound);
        setReminderVibrateState(saved.reminderVibrate);
        setPinnedStationState(saved.pinnedStation);
        setMissedCheckInState(saved.missedCheckIn);
        setNightLocationModeState(saved.nightLocationMode);
        setTonightDestinationState(saved.tonightDestination);
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
    const timer = setInterval(
      () => setRealNow(Date.now()),
      demoActive ? 1000 : 10000,
    );
    return () => clearInterval(timer);
  }, [demoActive]);
  const nowMs = demo
    ? demo.virtualAt + (realNow - demo.realAt) * DEMO_SPEED
    : realNow;
  const demoRef = useRef(demo);
  demoRef.current = demo;
  /** The app clock at this instant — the demo clock while one is set — for use in callbacks. */
  const getNow = useCallback(() => {
    const current = demoRef.current;
    return current
      ? current.virtualAt + (Date.now() - current.realAt) * DEMO_SPEED
      : Date.now();
  }, []);

  const stationLabel = plan
    ? language === "ja"
      ? plan.station.nameJa
      : plan.station.name
    : "";

  // Keep OS reminders in sync with the plan. Leave reminders belong to a night
  // out, so they are only scheduled while night-out tracking is on. Runs only when
  // these inputs change; unchanged schedules are skipped inside scheduleReminders.
  useEffect(() => {
    const token = ++scheduleToken.current;
    if (demoActive) return;
    if (!trackingMode || !plan) {
      void cancelAllReminders();
      return;
    }
    void (async () => {
      const allowed = await ensureNotificationPermission();
      if (token !== scheduleToken.current) return;
      setNotificationsAllowed(allowed);
      const plans = buildReminderPlans(plan, reminderIntervals, Date.now(), {
        missedCheckIn,
        alarmIntervals,
      });
      await scheduleReminders(plans, {
        leaveBy: formatJstTime(recommendedLeaveTime(plan)),
        station: stationLabel,
        language: language ?? "en",
      }, { sound: alarmSound, vibrate: reminderVibrate });
    })();
  }, [
    trackingMode,
    plan,
    stationLabel,
    reminderIntervals,
    alarmIntervals,
    alarmSound,
    reminderVibrate,
    missedCheckIn,
    language,
    demoActive,
    alarmPermissionRevision,
  ]);

  // The lock-screen countdown follows night-out tracking. Re-synced when the plan
  // changes and when the night moves on (leave-by passes, the last train goes).
  const liveStatus = plan && !demoActive ? rideStatus(plan, nowMs) : null;
  const { isPremium } = usePremium();
  useEffect(() => {
    if (!trackingMode || !plan || demoActive || !isPremium) {
      void endLiveActivity();
      return;
    }
    void syncLiveActivity(plan, language ?? "en", Date.now(), true).catch(
      () => undefined,
    );
  }, [trackingMode, plan, language, liveStatus, demoActive, isPremium]);

  // First train from the chosen station, for the "if missed" screen. Keyed on the
  // station and night rather than the plan, so re-plans that keep them don't refetch.
  const firstTrainKey = plan
    ? `${plan.station.nameJa}|${serviceDate(plan.lastTrain.departsAt)}`
    : null;
  /** Which firstTrainKey `firstTrain` was looked up for; differs while a lookup is in flight. */
  const [firstTrainFor, setFirstTrainFor] = useState<string | null>(null);
  useEffect(() => {
    const current = planRef.current;
    const station = current?.station;
    if (!station || !homeStationOption) {
      setFirstTrain(null);
      setFirstTrainFor(firstTrainKey);
      return;
    }
    let cancelled = false;
    // The first train after tonight's last one — tomorrow morning's 始発 — or,
    // while still waiting for this morning's, the next one from now.
    getFirstTrain(
      station,
      homeStationOption,
      Math.max(getNow(), current!.lastTrain.departsAt),
    )
      .then((train) => {
        if (cancelled) return;
        setFirstTrain(train);
        setFirstTrainFor(firstTrainKey);
      })
      .catch(() => {
        if (cancelled) return;
        setFirstTrain(null);
        setFirstTrainFor(firstTrainKey);
      });
    return () => {
      cancelled = true;
    };
  }, [firstTrainKey, homeStationOption, getNow]);

  // The night is over once the first train has left (not before 04:00).
  const nightEnd = plan
    ? nightEndsAt(plan, firstTrain, {
        firstTrainPending: firstTrainFor !== firstTrainKey,
      })
    : null;
  const nightEndRef = useRef(nightEnd);
  nightEndRef.current = nightEnd;

  // Persisted so the app can open offline later in the night and still know tonight's plan.
  useEffect(() => {
    void writeSavedPlan(plan);
  }, [plan]);

  // Enterprise participation is deliberately privacy-minimal: only the computed
  // leave-by timestamp is synced. Location, station, destination and route stay local.
  useEffect(() => {
    if (!plan) return;
    void syncEnterpriseLeaveBy(recommendedLeaveTime(plan)).catch(
      () => undefined,
    );
  }, [plan?.leaveByMs, plan?.recommendedLeaveByMs]);

  const clearPlan = useCallback(() => {
    setPlan(null);
    setLocationError(null);
  }, []);

  // Saved places are stored by name (lib/storedPlaces). When the active one has no
  // position yet (just switched to it, or offline at launch), look it up.
  useEffect(() => {
    let cancelled = false;
    if (homeStationOption && !hasPosition(homeStationOption))
      void resolveStation(homeStationOption).then((resolved) => {
        if (!cancelled && hasPosition(resolved)) setHomeStationOption(resolved);
      });
    if (homeAddress && !hasPosition(homeAddress))
      void resolveAddress(homeAddress).then((resolved) => {
        if (!cancelled && hasPosition(resolved)) setHomeAddressState(resolved);
      });
    return () => {
      cancelled = true;
    };
  }, [homeStationOption, homeAddress]);

  const setLeaveMargin = useCallback(
    (margin: LeaveMargin) => {
      setLeaveMarginState(margin);
      void AsyncStorage.setItem(STORAGE_KEYS.leaveMargin, margin);
      clearPlan(); // the leave screen re-plans with the new margin
      void Haptics.selectionAsync();
    },
    [clearPlan],
  );

  // Apple Maps place names follow the app's iOS language; keep it on LastRide's choice.
  useEffect(() => {
    if (language) syncAppleLanguage(language);
  }, [language]);

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

  const applyDestinationState = useCallback(
    (next: SavedDestination[], requestedActiveId: string | null) => {
      const active =
        next.find((destination) => destination.id === requestedActiveId) ??
        next[0] ??
        null;
      setDestinations(next);
      setActiveDestinationId(active?.id ?? null);
      setTonightDestinationState(null);
      void writeTonightDestination(null);
      setHomeStationOption(active?.station ?? null);
      setHomeAddressState(active?.address ?? null);
      setPinnedStationState(null); // station pins belong to the previous destination
      void writePinnedStation(null);
      void writeDestinationState(next, active?.id ?? null);
      clearPlan();
    },
    [clearPlan],
  );

  const saveDestination = useCallback(
    async (input: {
      id?: string;
      label: string;
      station: StationOption;
      address: HomeAddress | null;
    }) => {
      const id = input.id ?? newDestinationId();
      const item: SavedDestination = {
        id,
        label: input.label.trim() || input.station.name,
        // Kept long-term, so stored from our ODPT data where possible (see lib/savedStation).
        station: await stationForStorage(input.station),
        address: input.address,
      };
      const exists = destinations.some((destination) => destination.id === id);
      const next = exists
        ? destinations.map((destination) =>
            destination.id === id ? item : destination,
          )
        : [...destinations, item];
      applyDestinationState(next, id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [destinations, applyDestinationState],
  );

  const selectDestination = useCallback(
    (id: string) => {
      if (
        id === activeDestinationId ||
        !destinations.some((destination) => destination.id === id)
      )
        return;
      applyDestinationState(destinations, id);
      void Haptics.selectionAsync();
    },
    [activeDestinationId, destinations, applyDestinationState],
  );

  const deleteDestination = useCallback(
    (id: string) => {
      const next = destinations.filter((destination) => destination.id !== id);
      if (next.length === destinations.length) return;
      if (id === activeDestinationId) {
        applyDestinationState(next, next[0]?.id ?? null);
      } else {
        setDestinations(next);
        void writeDestinationState(next, activeDestinationId);
      }
      void Haptics.selectionAsync();
    },
    [activeDestinationId, destinations, applyDestinationState],
  );

  const saveHomeStation = useCallback(
    async (picked: StationOption) => {
      const current = destinations.find(
        (destination) => destination.id === activeDestinationId,
      );
      if (current) {
        await saveDestination({ ...current, station: picked });
        return;
      }
      const station = await stationForStorage(picked);
      setHomeStationOption(station);
      void rememberTonight([station], []);
      void AsyncStorage.setItem(
        STORAGE_KEYS.homeStation,
        JSON.stringify(stationForDisk(station)),
      );
      setPinnedStationState(null);
      void writePinnedStation(null);
      clearPlan();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [activeDestinationId, destinations, saveDestination, clearPlan],
  );

  const setTonightDestination = useCallback(
    (station: StationOption | null) => {
      const active =
        destinations.find((destination) => destination.id === activeDestinationId) ??
        destinations[0] ??
        null;
      setTonightDestinationState(station);
      void writeTonightDestination(station);
      setHomeStationOption(station ?? active?.station ?? null);
      setHomeAddressState(station ? null : (active?.address ?? null));
      setPinnedStationState(null);
      void writePinnedStation(null);
      clearPlan();
      void Haptics.selectionAsync();
    },
    [activeDestinationId, destinations, clearPlan],
  );

  // A time is a notification or an alarm, never both: choosing it in one list
  // removes it from the other.
  const toggleReminderInterval = useCallback((minutes: number) => {
    const adding = !reminderIntervals.includes(minutes);
    const next = adding
      ? [...reminderIntervals, minutes].sort((a, b) => b - a)
      : reminderIntervals.filter((entry) => entry !== minutes);
    setReminderIntervals(next);
    void AsyncStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(next));
    if (adding && alarmIntervals.includes(minutes)) {
      const alarms = alarmIntervals.filter((entry) => entry !== minutes);
      setAlarmIntervals(alarms);
      void AsyncStorage.setItem(STORAGE_KEYS.alarmTimes, JSON.stringify(alarms));
    }
    void Haptics.selectionAsync();
  }, [reminderIntervals, alarmIntervals]);

  const toggleAlarmInterval = useCallback((minutes: number) => {
    const adding = !alarmIntervals.includes(minutes);
    const next = adding
      ? [...alarmIntervals, minutes].sort((a, b) => b - a)
      : alarmIntervals.filter((entry) => entry !== minutes);
    setAlarmIntervals(next);
    void AsyncStorage.setItem(STORAGE_KEYS.alarmTimes, JSON.stringify(next));
    if (adding && reminderIntervals.includes(minutes)) {
      const notifications = reminderIntervals.filter((entry) => entry !== minutes);
      setReminderIntervals(notifications);
      void AsyncStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(notifications));
    }
    void Haptics.selectionAsync();
  }, [reminderIntervals, alarmIntervals]);

  const setAlarmsEnabled = useCallback((enabled: boolean) => {
    if (enabled === alarmsEnabled) return;
    let notifications: number[];
    let alarms: number[];
    if (enabled) {
      // Start with an alarm at the leave time. Settings asks for permission.
      alarms = [0];
      notifications = reminderIntervals.filter((entry) => entry !== 0);
      setAlarmPermissionRevision((revision) => revision + 1);
    } else {
      // Their times go back to notifications, so switching alarms off never drops a reminder.
      alarms = [];
      notifications = [...new Set([...reminderIntervals, ...alarmIntervals])].sort((a, b) => b - a);
    }
    setAlarmsEnabledState(enabled);
    setAlarmIntervals(alarms);
    setReminderIntervals(notifications);
    void AsyncStorage.multiSet([
      [STORAGE_KEYS.alarmsEnabled, String(enabled)],
      [STORAGE_KEYS.alarmTimes, JSON.stringify(alarms)],
      [STORAGE_KEYS.reminders, JSON.stringify(notifications)],
    ]);
    void Haptics.selectionAsync();
  }, [alarmsEnabled, reminderIntervals, alarmIntervals]);

  const setAlarmSound = useCallback((sound: ReminderSound) => {
    setAlarmSoundState(sound);
    void AsyncStorage.setItem(STORAGE_KEYS.alarmSound, sound);
  }, []);

  const setReminderVibrate = useCallback((vibrate: boolean) => {
    setReminderVibrateState(vibrate);
    void AsyncStorage.setItem(STORAGE_KEYS.reminderVibrate, String(vibrate));
  }, []);

  const setHomeAddress = useCallback(
    (address: HomeAddress | null) => {
      const current = destinations.find(
        (destination) => destination.id === activeDestinationId,
      );
      if (current) {
        saveDestination({ ...current, address });
        return;
      }
      setHomeAddressState(address);
      void writeHomeAddress(address);
      clearPlan(); // arrival stations are chosen around the address, so re-plan
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [activeDestinationId, destinations, saveDestination, clearPlan],
  );

  const setMissedCheckIn = useCallback((enabled: boolean) => {
    setMissedCheckInState(enabled);
    void AsyncStorage.setItem(STORAGE_KEYS.missedCheckIn, String(enabled));
    void Haptics.selectionAsync();
  }, []);

  const setNightLocationMode = useCallback((mode: NightLocationMode) => {
    setNightLocationModeState(mode);
    void AsyncStorage.setItem(STORAGE_KEYS.nightLocationMode, mode);
  }, []);

  // The app's 閉じても更新 only works if iOS allows "Always"; keep track so the UI
  // can say when it doesn't (rechecked when returning from the Settings app).
  const [backgroundAllowed, setBackgroundAllowed] = useState<boolean | null>(null);
  const refreshBackgroundAllowed = useCallback(async () => {
    if (Platform.OS === "web") return false;
    const { granted } = await backgroundLocationState();
    setBackgroundAllowed(granted);
    return granted;
  }, []);
  useEffect(() => {
    void refreshBackgroundAllowed();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshBackgroundAllowed();
    });
    return () => subscription.remove();
  }, [refreshBackgroundAllowed]);
  const requestBackgroundLocation = useCallback(async () => {
    if (Platform.OS === "web") return false;
    const state = await backgroundLocationState();
    if (!state.granted && state.canAskAgain) await requestNightLocationPermission("background");
    return refreshBackgroundAllowed();
  }, [refreshBackgroundAllowed]);

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
      if (!trackingMode || !plan) return;
      void (async () => {
        const allowed = await ensureNotificationPermission();
        setNotificationsAllowed(allowed);
        const plans = buildReminderPlans(plan, reminderIntervals, virtualMs, {
          missedCheckIn,
          alarmIntervals,
        }).map((reminder) => ({
          ...reminder,
          fireAt: realAt + (reminder.fireAt - virtualMs) / DEMO_SPEED,
        }));
        await scheduleReminders(plans, {
          leaveBy: formatJstTime(recommendedLeaveTime(plan)),
          station: stationLabel,
          language: language ?? "en",
        }, { sound: alarmSound, vibrate: reminderVibrate });
      })();
    },
    [
      trackingMode,
      plan,
      language,
      reminderIntervals,
      alarmIntervals,
      alarmSound,
      reminderVibrate,
      missedCheckIn,
      stationLabel,
    ],
  );

  const requestNotifications = useCallback(async () => {
    const allowed = await ensureNotificationPermission();
    setNotificationsAllowed(allowed);
    return allowed;
  }, []);

  const triggerTestNotification = useCallback(async () => {
    const allowed = await ensureNotificationPermission();
    setNotificationsAllowed(allowed);
    if (!allowed) return;
    await sendTestNotification(language ?? "en");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [language]);

  /** Plans from a position; returns null when there is no home station to plan toward. */
  const planFrom = useCallback(
    async (coordinates: Coordinates, { dropPin = false } = {}) => {
      const {
        homeStationOption: home,
        leaveMargin: margin,
        pinnedStation,
      } = settingsRef.current;
      if (!home) return null;
      const now = getNow();
      // Until tonight is over, keep planning for it: someone waiting for the first
      // train at 04:30 should still see tonight, not tomorrow night.
      // Without a plan yet (first open after 04:00), freshPlanNightOf decides.
      const current = planRef.current;
      const nightOf = !current
        ? freshPlanNightOf(now)
        : nightEndRef.current !== null && now < nightEndRef.current
          ? current.lastTrain.departsAt
          : now;
      return planNight(coordinates, home, margin, now, {
        pinned: dropPin ? null : pinnedStation,
        nightOf,
        homeAddress: settingsRef.current.homeAddress,
      });
    },
    [getNow],
  );

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
    if (
      webWatchId.current !== null &&
      Platform.OS === "web" &&
      navigator.geolocation
    ) {
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
  const startTracking = useCallback(
    async ({ resume = false }: { resume?: boolean } = {}) => {
      const op = ++trackingOp.current;
      // Decide before touching anything, so Cancel leaves no trace. The
      // headless background task only auto-resumes after a session that
      // already had background permission, so resume never prompts.
      const choice = resume
        ? { mode: 'background' as const, asked: false }
        : await chooseNightTrackingLocation(language, nightLocationMode);
      if (op !== trackingOp.current || !choice) return;
      const locationMode = choice.mode;
      if (choice.asked) setNightLocationMode(locationMode);
      const startedAt =
        (resume ? await readTrackingStartedAt() : null) ?? getNow();
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
      if (locationMode === 'foreground' && Platform.OS !== 'web') {
        // Never leave a previously registered native background task running
        // after the user explicitly chose open-app-only tracking.
        await stopBackgroundTracking();
        if (op !== trackingOp.current) return;
      }
      if (Platform.OS === "web") {
        if (!navigator.geolocation) {
          setLocationError("unsupported");
          return;
        }
        webWatchId.current = navigator.geolocation.watchPosition(
          ({ coords }) =>
            handleCoordinates({
              latitude: coords.latitude,
              longitude: coords.longitude,
            }),
          () => setLocationError("permission"),
          { enableHighAccuracy: true },
        );
        setTrackingMode("foreground");
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (op !== trackingOp.current) return;
      if (!permission.granted) {
        setLocationError("permission");
        return;
      }
      const watch = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 150,
          timeInterval: 120000,
        },
        (position) =>
          handleCoordinates({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
      );
      if (op !== trackingOp.current) {
        watch.remove(); // a stop/reset happened while we were awaiting — tear down
        return;
      }
      foregroundWatch.current = watch;
      // Background updates keep it fresh while the app is closed (dev/production builds).
      const backgroundActive = locationMode === 'background'
        ? await startBackgroundTracking()
        : false;
      if (op !== trackingOp.current) {
        if (backgroundActive) await stopBackgroundTracking(); // compensate a stale start
        return;
      }
      setTrackingMode(backgroundActive ? "background" : "foreground");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (locationMode === "background" && !backgroundActive) {
        // Chosen 閉じても更新, but iOS isn't set to "Always": say so rather than
        // quietly tracking only while the app is open.
        void refreshBackgroundAllowed();
        const ja = language === "ja";
        Alert.alert(
          ja ? "アプリを閉じている間は更新されません" : "Won’t update while closed",
          ja
            ? "iPhoneの設定で、LastRideの位置情報が「常に」になっていません。今夜はアプリを開いている間だけ更新します。閉じても更新するには、設定で「常に」を選んでください。"
            : "LastRide’s location access in iPhone Settings isn’t “Always”, so tonight it updates only while the app is open. Choose “Always” in Settings to update when closed.",
          [
            { text: "OK", style: "cancel" },
            { text: ja ? "設定を開く" : "Open Settings", onPress: () => void Linking.openSettings() },
          ],
        );
      }
    },
    [planFrom, applyPlan, removeWatches, getNow, language, nightLocationMode, setNightLocationMode, refreshBackgroundAllowed],
  );

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
    ((plan !== null && nowMs >= trackingEndsAt(plan)) ||
      (trackingStartedAt !== null &&
        nowMs >= trackingHardStopAt(trackingStartedAt)));
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
    if (current && getNow() - current.computedAt >= 10 * MINUTE_MS)
      void requestLocationRef.current();
  }, [isHydrated, trackingMode, getNow]);

  // Without tracking, the position is only as fresh as the last plan. When the app
  // comes back after a while, get a new fix so the options page shows what's nearby now.
  useEffect(() => {
    if (trackingMode !== null) return;
    const subscription = AppState.addEventListener("change", (state) => {
      const current = planRef.current;
      if (
        state === "active" &&
        current &&
        getNow() - current.computedAt >= 10 * MINUTE_MS
      )
        void requestLocationRef.current();
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
    if (trackingMode !== "background") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const session = sessionRef.current;
      void readTrackingSnapshot().then((snapshot) => {
        if (!snapshot || session !== sessionRef.current) return;
        setPlan((current) => {
          if (current && current.computedAt >= snapshot.computedAt)
            return current;
          // The background task moves on at 04:00; keep tonight while the user still waits for the first train.
          const waitingForFirstTrain =
            current &&
            nightEndRef.current !== null &&
            getNow() < nightEndRef.current;
          if (
            waitingForFirstTrain &&
            serviceDate(snapshot.lastTrain.departsAt) !==
              serviceDate(current.lastTrain.departsAt)
          )
            return current;
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
    await clearPlaceCache();
    await stopTracking();
    await cancelAllReminders();
    // Try to leave on the server first; if that fails (e.g. offline), still
    // erase the token locally — the server row is removed when the event expires.
    await leaveCurrentEnterpriseEvent().catch(() =>
      clearEnterpriseParticipation(),
    );
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
    await clearSavedPlan();
    setLanguageState(DEFAULT_SETTINGS.language);
    setHomeStationOption(DEFAULT_SETTINGS.homeStation);
    setLeaveMarginState(DEFAULT_SETTINGS.leaveMargin);
    setReminderIntervals(DEFAULT_SETTINGS.reminderIntervals);
    setAlarmsEnabledState(DEFAULT_SETTINGS.alarmsEnabled);
    setAlarmIntervals(DEFAULT_SETTINGS.alarmIntervals);
    setAlarmSoundState(DEFAULT_SETTINGS.alarmSound);
    setReminderVibrateState(DEFAULT_SETTINGS.reminderVibrate);
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

  const homeStation = homeStationOption
    ? language === "ja"
      ? homeStationOption.nameJa
      : homeStationOption.name
    : "";

  const activeDestination =
    destinations.find(
      (destination) => destination.id === activeDestinationId,
    ) ??
    destinations[0] ??
    null;

  // Home/lock widgets show tonight's plan whenever there is one (not only while tracking).
  const widgetDestination = tonightDestination
    ? language === "ja"
      ? tonightDestination.nameJa
      : tonightDestination.name
    : (activeDestination?.label ?? homeStation);
  useEffect(() => {
    if (demoActive || !isHydrated) return;
    void syncWidgets(
      plan,
      widgetDestination,
      language ?? "en",
      Date.now(),
      isPremium,
    ).catch((error) => {
      if (__DEV__) console.warn("[LastRide] widget sync failed", error);
    });
  }, [plan, widgetDestination, language, isPremium, demoActive, isHydrated]);

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
      leaveMargin,
      plan,
      stationName:
        plan?.station.name ??
        (language === "ja" ? "最寄り駅を検索中" : "Finding nearby station"),
      stationNameJa: plan?.station.nameJa ?? "最寄り駅を検索中",
      destination: tonightDestination
        ? language === "ja"
          ? tonightDestination.nameJa
          : tonightDestination.name
        : (activeDestination?.label ?? homeStation),
      tonightDestination,
      setTonightDestination,
      leaveBy: plan ? formatJstTime(recommendedLeaveTime(plan)) : "--:--",
      lastTrain: plan ? formatJstTime(plan.lastTrain.departsAt) : "--:--",
      lastTrainSource: plan?.lastTrain.source ?? null,
      firstTrain: firstTrain ? formatJstTime(firstTrain.departsAt) : "--:--",
      firstTrainRoute: firstTrain,
      minutesUntilLeave: plan
        ? minutesUntil(recommendedLeaveTime(plan), nowMs)
        : null,
      minutesUntilFirstTrain: firstTrain
        ? Math.max(0, Math.ceil((firstTrain.departsAt - nowMs) / MINUTE_MS))
        : null,
      status: plan ? rideStatus(plan, nowMs) : null,
      walkingMinutes: plan?.walkingMinutes ?? null,
      walkingDistanceMeters: plan?.distanceMeters ?? null,
      userCoordinates,
      isLocationReady: plan !== null,
      isLocating,
      locationError,
      reminderIntervals,
      alarmsEnabled,
      alarmIntervals,
      alarmSound,
      reminderVibrate,
      setAlarmsEnabled,
      toggleAlarmInterval,
      setAlarmSound,
      setReminderVibrate,
      missedCheckIn,
      setMissedCheckIn,
      nightLocationMode,
      setNightLocationMode,
      backgroundAllowed,
      requestBackgroundLocation,
      notificationsAllowed,
      requestNotifications,
      currentTime: formatJstTime(nowMs),
      nowMs,
      demoActive,
      setLanguage,
      saveHomeStation,
      setLeaveMargin,
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
    [
      activeDestinationId,
      deleteDestination,
      demoActive,
      destinations,
      firstTrain,
      homeAddress,
      setHomeAddress,
      homeStation,
      missedCheckIn,
      setMissedCheckIn,
      nightLocationMode,
      setNightLocationMode,
      backgroundAllowed,
      requestBackgroundLocation,
      homeStationOption,
      isHydrated,
      isLocating,
      language,
      locationError,
      notificationsAllowed,
      requestNotifications,
      nowMs,
      plan,
      reminderIntervals,
      alarmsEnabled,
      alarmIntervals,
      alarmSound,
      reminderVibrate,
      setAlarmsEnabled,
      toggleAlarmInterval,
      setAlarmSound,
      setReminderVibrate,
      requestLocation,
      resetAll,
      resetLanguage,
      saveDestination,
      saveHomeStation,
      selectDestination,
      tonightDestination,
      setTonightDestination,
      setDemoNow,
      setPinnedStation,
      setLanguage,
      setLeaveMargin,
      startTracking,
      stopTracking,
      toggleReminderInterval,
      trackingMode,
      triggerTestNotification,
      userCoordinates,
      leaveMargin,
    ],
  );

  return (
    <LastRideContext.Provider value={value}>
      {children}
    </LastRideContext.Provider>
  );
}

export function useLastRide() {
  const context = useContext(LastRideContext);
  if (!context)
    throw new Error("useLastRide must be used within LastRideProvider");
  return context;
}

/** Localized text for a location/planning error. */
export function locationErrorText(
  code: LocationErrorCode,
  ja: boolean,
): string {
  switch (code) {
    case "permission":
      return ja
        ? "位置情報が許可されていません。端末の設定から許可してください。"
        : "Location permission was not granted. Please allow it in your device settings.";
    case "unsupported":
      return ja
        ? "この端末では位置情報を利用できません。"
        : "Location is not available on this device.";
    case "no-station":
      return ja
        ? "近くに駅が見つかりませんでした。"
        : "No station was found nearby.";
    case "no-route":
      return ja
        ? "近くの駅から帰り先の最寄り駅へ行ける電車が見つかりませんでした。"
        : "No train from the stations near you reaches your destination's station.";
    case "unavailable":
      return ja
        ? "駅の検索に失敗しました。通信状況を確認して再試行してください。"
        : "Couldn’t reach the station search. Check your connection and try again.";
  }
}
