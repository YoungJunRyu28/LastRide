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
  alarmKitAvailable,
  cancelAllReminders,
  ensureNotificationPermission,
  notificationPermissionStatus,
  markReminderChange,
  notifyLockFallback,
  scheduleReminders,
} from "@/lib/notifications";
import { clampLeaveMargin, recommendedLeaveTime, type LeaveMargin } from "@/lib/reliability";
import { applyTrainChoice, choiceAt, effectiveTrainChoice, slotAtNewStation, trainChoiceLabel, trainOptions, type TrainChoice } from "@/lib/trainChoice";
import {
  buildReminderPlans,
  nightEndsAt,
  firstTrainSearchFrom,
  freshPlanNightOf,
  locationProfile,
  planNight,
  replanMargin,
  repick,
  rideStatus,
  sameStation,
  shouldReplan,
  trackingEndsAt,
  trackingHardStopAt,
  type NightPlan,
  type RideStatus,
  withTrainsBefore,
} from "@/lib/planner";
import {
  DEFAULT_SETTINGS,
  readSettings,
  STORAGE_KEYS,
  writeDestinationState,
  writeHomeAddress,
  writePinnedStation,
  trainChoiceUntil,
  writeTonightDestination,
  writeTrainChoice,
  writeWidgetTheme,
  readOneNightSettings,
  REMINDER_CHOICES,
  readTrainChoiceOverride,
  writeTrainChoiceOverride,
  type TrainChoiceOverride,
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
  jstDate,
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
import { holdOnTheWay, keepOnTheWay } from "@/lib/onTheWay";
import { heldTrain, readAnswered, readBoarded, writeAnswered, writeBoarded, type BoardedRecord } from "@/lib/boarding";
import type { WidgetThemeId } from "@/lib/widgetThemes";
import {
  clearTrackingSnapshot,
  backgroundLocationState,
  requestNightLocationPermission,
  isTrackingFlagOn,
  markTrackingStarted,
  readTrackingSnapshot,
  readTrackingStartedAt,
  applyLocationProfile,
  startBackgroundTracking,
  stopBackgroundTracking,
} from "@/lib/tracking";

export type { HomeAddress, Language, SavedDestination } from "@/lib/settings";
export type { StationOption } from "@/lib/stations";
export { REMINDER_CHOICES } from "@/lib/settings";
export { searchAddresses, searchStations } from "@/lib/placeSearch";
export type LocationErrorCode = LocationError["code"];

/** A station change this soon after the user chose a station counts as theirs (no notice, no catch-up). */

/** Without night tracking, opening (or returning to) the app re-plans a plan this old. */
/** A station change this soon after the user chose one is theirs, not automatic. */
const USER_STATION_WINDOW_MS = 60_000;
const AUTO_REPLAN_AFTER_MS = 5 * MINUTE_MS;

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
  /** A station search is running (any re-plan): the 更新 / tracking line shows a spinner. */
  isSearching: boolean;
  locationError: LocationErrorCode | null;
  /** Notification times, minutes before leaving (0 = at leave time). */
  reminderIntervals: number[];
  /** Alarm times (iOS); a time is a notification or an alarm, never both. */
  alarmsEnabled: boolean;
  alarmIntervals: number[];
  alarmSound: ReminderSound;
  /** Android: vibrate with reminders. */
  reminderVibrate: boolean;
  /** 集中モード中も通知: leave reminders as Time Sensitive (on by default). */
  throughFocus: boolean;
  setThroughFocus: (on: boolean) => void;
  /** On starts with the leave time; off moves alarm times back to notifications. */
  setAlarmsEnabled: (enabled: boolean) => void;
  toggleAlarmInterval: (minutes: number) => void;
  setAlarmSound: (sound: ReminderSound) => void;
  setReminderVibrate: (vibrate: boolean) => void;
  /** Colour theme of the widgets and the Live Activity. */
  widgetTheme: WidgetThemeId;
  setWidgetTheme: (theme: WidgetThemeId) => void;
  /** Send the "missed the last train?" check-in after the last train has gone. */
  missedCheckIn: boolean;
  setMissedCheckIn: (enabled: boolean) => void;
  /** Night tracking's location choice; "ask" shows the disclosure next time. */
  nightLocationMode: NightLocationMode;
  /** pendingAlways: chosen 閉じても更新 but iOS hasn't confirmed "Always" yet; switches by itself once it does. */
  setNightLocationMode: (mode: NightLocationMode, options?: { pendingAlways?: boolean }) => void;
  /** Whether iOS allows location while the app is closed ("Always"); null until known. */
  backgroundAllowed: boolean | null;
  /** Asks iOS for "Always" if it still can; resolves to whether it's allowed now. */
  requestBackgroundLocation: () => Promise<boolean>;
  /**
   * Tracking only while open → also while closed: sets 閉じても更新, asks iOS for
   * "Always" and starts background updates. False when iOS didn't allow it.
   */
  switchTrackingToBackground: () => Promise<boolean>;
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
  /** Tonight's preferred train: 0 = 終電, 1 = 1本前, 2 = 2本前 (kept until 05:00). */
  trainChoice: number;
  /** The train the plan actually heads for: the preference, or a later one once it can't be made. */
  effectiveTrainChoice: TrainChoice;
  /** The last train and up to two before it from tonight's station. */
  /** `catchable`: not departed yet; `late`: its leave time has passed (only made by hurrying). */
  trainChoices: Array<{ choice: TrainChoice; departsAt: number; leaveAt: number; catchable: boolean; late: boolean }>;
  /** Set when the station changed and the chosen slot's leave time there had passed, so a later train is used. */
  trainChoiceOverride: TrainChoiceOverride | null;
  /** Lock tonight's plan to a station (any station; works without a location too). */
  chooseDepartureStation: (station: StationOption) => Promise<void>;
  /** The locked station that could no longer get the user home (now automatic), until dismissed. */
  lockFallback: StationOption | null;
  /** 〔乗った〕 tonight: the earlier train taken (lib/boarding.ts); tracking and reminders are off. */
  boarded: BoardedRecord | null;
  /** The earlier train headed for has just departed and 乗れましたか？ isn't answered yet. */
  boardingQuestion: { choice: number; departsAt: number } | null;
  /** 〔乗った〕 (true) / 〔乗れなかった〕 (false), for the train departing at `departsAt` (default: the open question). */
  answerBoarding: (onBoard: boolean, departsAt?: number) => Promise<void>;
  /** Undo 〔乗った〕 (tracking stays off until started again). */
  undoBoarded: () => void;
  dismissLockFallback: () => void;
  setTrainChoice: (choice: number) => void;
  requestLocation: () => Promise<void>;
  resetLanguage: () => void;
  toggleReminderInterval: (minutes: number) => void;
  /** Use `station` instead of the automatic pick for tonight, or null to go back to automatic. */
  setPinnedStation: (station: StationOption | null) => void;
  /** Development only: run a fast clock from `virtualMs`, or null to return to real time. */
  setDemoNow: (virtualMs: number | null) => void;
  /** The demo clock's speed (60 = 1 minute a second, 1 = real time); keeps the current demo time. */
  demoSpeed: number;
  setDemoSpeed: (speed: number) => void;
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
  const [throughFocus, setThroughFocusState] = useState(DEFAULT_SETTINGS.throughFocus);
  const [widgetTheme, setWidgetThemeState] = useState<WidgetThemeId>(DEFAULT_SETTINGS.widgetTheme);
  const [missedCheckIn, setMissedCheckInState] = useState(
    DEFAULT_SETTINGS.missedCheckIn,
  );
  const [nightLocationMode, setNightLocationModeState] =
    useState<NightLocationMode>(DEFAULT_SETTINGS.nightLocationMode);
  const [pinnedStation, setPinnedStationState] = useState<StationOption | null>(
    DEFAULT_SETTINGS.pinnedStation,
  );
  /** Tonight's plan as found (last train). `plan` below is it with tonight's train choice applied. */
  const [basePlan, setPlan] = useState<NightPlan | null>(null);
  const [trainChoice, setTrainChoiceState] = useState<number>(DEFAULT_SETTINGS.trainChoice);
  /** After an automatic station change: the train used there instead of the chosen slot. */
  const [choiceOverride, setChoiceOverride] = useState<TrainChoiceOverride | null>(null);
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
    /** Demo minutes per real minute: 60 to run through a night, 1 to hold still (screenshots). */
    speed: number;
  } | null>(null);
  const [realNow, setRealNow] = useState(Date.now);
  // False until launch has checked whether tracking was on (and resumed it). Until
  // then "not tracking" isn't known, so nothing may end the Live Activity: iOS
  // also starts the app invisibly for background location updates.
  const [trackingRestored, setTrackingRestored] = useState(false);
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
  const planRef = useRef(basePlan);
  planRef.current = basePlan;

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
        setThroughFocusState(saved.throughFocus);
        setWidgetThemeState(saved.widgetTheme);
        setPinnedStationState(saved.pinnedStation);
        setMissedCheckInState(saved.missedCheckIn);
        setNightLocationModeState(saved.nightLocationMode);
        setTonightDestinationState(saved.tonightDestination);
        setHomeAddressState(saved.homeAddress);
        setDestinations(saved.destinations);
        setActiveDestinationId(saved.activeDestinationId);
        setTrainChoiceState(saved.trainChoice);
      })
      .then(() => readTrainChoiceOverride())
      .then((override) => setChoiceOverride(override ?? null))
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
    ? demo.virtualAt + (realNow - demo.realAt) * demo.speed
    : realNow;
  // 終電 / 1本前 / 2本前 (lib/trainChoice): the plan heads for the chosen train
  // while it can still be made, then falls back to a later one. Recomputed only
  // when the train actually used changes, so effects keyed on the plan stay quiet.
  // The station changed automatically while 1本前 / 2本前 is chosen: the same slot
  // there, unless its leave time has passed (then the next later one). Decided in
  // the same render as the new plan, so nothing (reminders, the station notice)
  // ever sees the new station with the old choice. undefined = no new decision.
  const lastPlanRef = useRef<NightPlan | null>(null);
  /**
   * When the user last chose the station themselves (駅を選ぶ, この駅に固定, 自動に戻す).
   * That's not an automatic change: their own 1本前 / 2本前 applies there as it is.
   * Also holds back the lock fallback until the plan for a newly pinned station arrives.
   */
  const userStationAt = useRef<number>(-Infinity);
  const newOverride = useMemo((): TrainChoiceOverride | null | undefined => {
    const previous = lastPlanRef.current;
    if (!basePlan || !previous || trainChoice === 0) return undefined;
    if (sameStation(previous.station, basePlan.station)) return undefined;
    if (choiceOverride?.station === basePlan.station.nameJa) return undefined;
    if (nowMs - userStationAt.current < USER_STATION_WINDOW_MS) return undefined;
    const slot = choiceAt(trainChoice, choiceOverride, previous.station.nameJa);
    // nowMs, not getNow(): getNow is declared further down, and this runs during render.
    const options = trainOptions(basePlan, leaveMargin, nowMs);
    // Its earlier trains not known yet (or not found): no decision on an incomplete list.
    if (options.length <= slot) return undefined;
    const choice = slotAtNewStation(options, slot);
    return choice === trainChoice
      ? null
      : { station: basePlan.station.nameJa, fromStation: previous.station.nameJa, choice, until: trainChoiceUntil(basePlan.lastTrain.departsAt) };
  }, [basePlan]); // eslint-disable-line react-hooks/exhaustive-deps
  // Once saved, the stored override takes over again (so picking a train yourself clears it).
  const [savedFor, setSavedFor] = useState<NightPlan | null>(null);
  const activeOverride = newOverride !== undefined && savedFor !== basePlan ? newOverride : choiceOverride;
  const preferredChoice = basePlan ? choiceAt(trainChoice, activeOverride, basePlan.station.nameJa) : trainChoice;
  const effectiveChoice: TrainChoice = basePlan
    ? effectiveTrainChoice(trainOptions(basePlan, leaveMargin, nowMs), preferredChoice)
    : 0;
  const plan = useMemo(
    () =>
      basePlan
        ? applyTrainChoice(basePlan, trainOptions(basePlan, leaveMargin, 0), effectiveChoice)
        : null,
    [basePlan, leaveMargin, effectiveChoice],
  );
  // For planFrom: the plan in force and whether tracking is on (the on-the-way rule).
  const effectivePlanRef = useRef(plan);
  effectivePlanRef.current = plan;
  const trackingModeRef = useRef(trackingMode);
  trackingModeRef.current = trackingMode;

  // Saves a decision made below (newOverride) once the render that used it is committed.
  useEffect(() => {
    if (newOverride === undefined) return;
    setChoiceOverride(newOverride);
    setSavedFor(basePlan);
    void writeTrainChoiceOverride(newOverride);
  }, [newOverride]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    lastPlanRef.current = plan;
  }, [plan]);
  // Background tracking may have switched the train after a station change.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void readTrainChoiceOverride().then((override) => setChoiceOverride(override ?? null));
    });
    return () => subscription.remove();
  }, []);
  /** Tonight's trains from the plan's station, for the 終電 / 1本前 / 2本前 switch. */
  const trainChoices = useMemo(
    () =>
      basePlan
        ? trainOptions(basePlan, leaveMargin, nowMs).map((option) => ({
            choice: option.choice,
            departsAt: option.station.lastTrain.departsAt,
            leaveAt: recommendedLeaveTime(option.station),
            catchable: option.catchable,
            late: option.late,
          }))
        : [],
    [basePlan, leaveMargin, nowMs],
  );

  // 乗れましたか？ (lib/boarding.ts): tonight's 〔乗った〕 record, and the departure answered 乗れなかった.
  const [boarded, setBoarded] = useState<BoardedRecord | null>(null);
  const [answeredDeparture, setAnsweredDeparture] = useState<number | null>(null);
  useEffect(() => {
    const load = () => {
      void readBoarded().then(setBoarded);
      void readAnswered().then(setAnsweredDeparture);
    };
    load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") load();
    });
    return () => subscription.remove();
  }, []);
  const boardingQuestion = useMemo(() => {
    if (!trackingMode || boarded || trainChoice <= effectiveChoice) return null;
    // The train just before the one in force: it departed while being headed for.
    const gone = trainChoices.find((option) => option.choice === effectiveChoice + 1 && !option.catchable);
    if (!gone || gone.departsAt === answeredDeparture) return null;
    return { choice: gone.choice, departsAt: gone.departsAt };
  }, [trackingMode, boarded, trainChoice, effectiveChoice, trainChoices, answeredDeparture]);
  const boardingQuestionRef = useRef(boardingQuestion);
  boardingQuestionRef.current = boardingQuestion;

  const demoRef = useRef(demo);
  demoRef.current = demo;
  /** The app clock at this instant — the demo clock while one is set — for use in callbacks. */
  const getNow = useCallback(() => {
    const current = demoRef.current;
    return current
      ? current.virtualAt + (Date.now() - current.realAt) * current.speed
      : Date.now();
  }, []);

  const stationLabel = plan
    ? language === "ja"
      ? plan.station.nameJa
      : plan.station.name
    : "";

  const { isPremium, known: premiumKnown } = usePremium();
  // Notifications and alarms are free: what is chosen is what is delivered.
  const delivered = useMemo(
    () => ({ notifications: reminderIntervals, alarms: alarmIntervals, sound: alarmSound }),
    [reminderIntervals, alarmIntervals, alarmSound],
  );

  // Keep OS reminders in sync with the plan. Leave reminders belong to a night
  // out, so they are only scheduled while night-out tracking is on. Runs only when
  // these inputs change; unchanged schedules are skipped inside scheduleReminders.
  useEffect(() => {
    const token = ++scheduleToken.current;
    if (demoActive) return;
    // Not before saved tracking has been resumed: on launch (often invisible, for a
    // background location update) trackingMode starts null, and cancelling then
    // would drop every reminder and alarm until the resume finishes.
    if (!trackingRestored) return;
    if (!trackingMode || !plan) {
      void cancelAllReminders();
      return;
    }
    void (async () => {
      const allowed = await ensureNotificationPermission();
      if (token !== scheduleToken.current) return;
      setNotificationsAllowed(allowed);
      const plans = buildReminderPlans(plan, delivered.notifications, Date.now(), {
        missedCheckIn,
        alarmIntervals: delivered.alarms,
        includePast: true,
      });
      await scheduleReminders(plans, {
        leaveBy: formatJstTime(recommendedLeaveTime(plan)),
        station: stationLabel,
        held: heldTrain(plan, language === "ja"),
        language: language ?? "en",
      }, { sound: delivered.sound, vibrate: reminderVibrate, throughFocus }, {
        night: serviceDate((plan.nightLastTrain ?? plan.lastTrain).departsAt),
        choiceKey: String(trainChoice),
        stationKey: plan.station.nameJa,
        leaveAtMs: recommendedLeaveTime(plan),
        trainDepartsAtMs: plan.lastTrain.departsAt,
        trainLabel: trainChoiceLabel(effectiveChoice, language === "ja"),
        trainDeparts: formatJstTime(plan.lastTrain.departsAt),
        movedFrom: activeOverride?.station === plan.station.nameJa ? trainChoiceLabel(trainChoice, language === "ja") : undefined,
        // Only once re-planned from here after the departure, so the times are real.
        ...(boardingQuestion && plan.computedAt >= boardingQuestion.departsAt
          ? { followUpFor: boardingQuestion.departsAt, followUpLabel: trainChoiceLabel(boardingQuestion.choice, language === "ja") }
          : {}),
      });
    })();
  }, [
    trackingRestored,
    trackingMode,
    plan,
    boardingQuestion,
    stationLabel,
    delivered,
    reminderVibrate,
    throughFocus,
    missedCheckIn,
    language,
    demoActive,
    alarmPermissionRevision,
    trainChoice,
    effectiveChoice,
    activeOverride,
  ]);

  // The lock-screen countdown follows night-out tracking. Re-synced when the plan
  // changes and when the night moves on (leave-by passes, the last train goes).
  const liveStatus = plan && !demoActive ? rideStatus(plan, nowMs) : null;
  useEffect(() => {
    if (!trackingRestored) return;
    if (!trackingMode || !plan || demoActive || (premiumKnown && !isPremium)) {
      void endLiveActivity();
      return;
    }
    // Premium not known yet (just opened, or RevenueCat unreachable): the saved
    // flag decides, and a running activity is never ended for it.
    const sync = () =>
      void syncLiveActivity(plan, language ?? "en", Date.now(), premiumKnown ? true : undefined, widgetTheme, trackingMode === "foreground").catch(
        () => undefined,
      );
    sync();
    // Also on return, so Live Activities just allowed in Settings show at once.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => subscription.remove();
  }, [trackingRestored, trackingMode, plan, language, liveStatus, demoActive, isPremium, premiumKnown, widgetTheme]);

  // First train from the chosen station, for the "if missed" screen. Keyed on the
  // station and night rather than the plan, so re-plans that keep them don't refetch.
  // Before 05:00 it is this morning's 始発; once that has left (the morning is
  // over, as when last night's plan ends) it is the one after tonight's last train.
  const [morningOverOn, setMorningOverOn] = useState<string | null>(null);
  const morningOver = morningOverOn === jstDate(nowMs);
  const morningOverRef = useRef(morningOver);
  morningOverRef.current = morningOver;
  const firstTrainKey = plan
    ? `${plan.station.nameJa}|${serviceDate(plan.lastTrain.departsAt)}|${morningOver}`
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
      morningOverRef.current
        ? Math.max(getNow(), current!.lastTrain.departsAt)
        : firstTrainSearchFrom(current!.lastTrain.departsAt, getNow()),
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

  // This morning's 始発 has left while the plan is already for the coming night:
  // the morning is over, so show tomorrow's (last night's plan moves on by itself).
  useEffect(() => {
    if (morningOver || !firstTrain || firstTrainFor !== firstTrainKey) return;
    if (firstTrain.departsAt > nowMs) return;
    if (!planRef.current || planRef.current.lastTrain.departsAt <= nowMs) return;
    setMorningOverOn(jstDate(nowMs));
  }, [firstTrain, firstTrainFor, firstTrainKey, morningOver, nowMs]);

  // The night is over once the first train has left (not before 04:00).
  const nightEnd = basePlan
    ? nightEndsAt(basePlan, firstTrain, {
        firstTrainPending: firstTrainFor !== firstTrainKey,
      })
    : null;
  const nightEndRef = useRef(nightEnd);
  nightEndRef.current = nightEnd;

  // Persisted so the app can open offline later in the night and still know tonight's plan.
  useEffect(() => {
    void writeSavedPlan(basePlan);
  }, [basePlan]);

  // Apple's trains before the last one are looked up for the chosen station only:
  // fill them in when the station changes (a pin) or a saved plan comes back without them.
  useEffect(() => {
    if (!basePlan || basePlan.lastTrain.before) return;
    let cancelled = false;
    void withTrainsBefore(basePlan, getNow()).then((filled) => {
      if (!cancelled) setPlan((current) => (current === basePlan ? filled : current));
    });
    return () => {
      cancelled = true;
    };
  }, [basePlan, getNow]);

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

  const setLeaveMargin = useCallback((minutes: LeaveMargin) => {
    const margin = clampLeaveMargin(minutes);
    markReminderChange("user");
    setLeaveMarginState(margin);
    void AsyncStorage.setItem(STORAGE_KEYS.leaveMargin, String(margin));
    // Only the recommended leave times move: no new lookups.
    setPlan((current) => (current ? replanMargin(current, margin) : current));
    void Haptics.selectionAsync();
  }, []);

  const setTrainChoice = useCallback((choice: number) => {
    const next = choice === 1 || choice === 2 ? choice : 0;
    markReminderChange("user");
    setTrainChoiceState(next);
    // Picking a train yourself replaces any automatic pick after a station change.
    setChoiceOverride(null);
    void writeTrainChoiceOverride(null);
    // Kept for tonight: every re-plan (and the background task) applies it until 05:00.
    void writeTrainChoice(next, trainChoiceUntil(planRef.current?.lastTrain.departsAt ?? Date.now()));
    void Haptics.selectionAsync();
  }, []);

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
    markReminderChange("user");
    userStationAt.current = getNow();
    setLockFallback(null);
    setPinnedStationState(station);
    void writePinnedStation(station);
    // Every candidate's route is already in the plan, so the swap is instant.
    setPlan((current) => (current ? repick(current, station) : current));
    void Haptics.selectionAsync();
  }, []);

  // A locked station that can no longer get the user home (e.g. they walked far
  // away, or its last train went) returns to automatic, and says so.
  const [lockFallback, setLockFallback] = useState<StationOption | null>(null);
  useEffect(() => {
    // A station just chosen from search: its plan is still being looked up, and the
    // plan on screen (made before the choice) isn't pinned yet. Not a fallback.
    if (basePlan && basePlan.computedAt < userStationAt.current) return;
    if (pinnedStation && basePlan && !basePlan.pinned) {
      setPinnedStationState(null);
      void writePinnedStation(null);
      setLockFallback(pinnedStation);
      // Told here (on screen or as a notification): no 「出発駅が変わりました」 as well.
      markReminderChange("stationTold");
      // Seen on screen when the app is open; otherwise as a notification.
      if (trackingMode !== null && AppState.currentState !== "active") {
        void notifyLockFallback(pinnedStation, basePlan, language ?? "en");
      }
    }
  }, [pinnedStation, basePlan, trackingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyDestinationState = useCallback(
    (next: SavedDestination[], requestedActiveId: string | null) => {
      const active =
        next.find((destination) => destination.id === requestedActiveId) ??
        next[0] ??
        null;
      markReminderChange("user");
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
      // Editing a saved destination that isn't tonight's (renaming 職場 while heading
      // home): just save it; tonight's plan, 今夜だけ and a locked station stay.
      if (exists && id !== activeDestinationId) {
        setDestinations(next);
        void writeDestinationState(next, activeDestinationId);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      applyDestinationState(next, id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [destinations, activeDestinationId, applyDestinationState],
  );

  const selectDestination = useCallback(
    (id: string) => {
      if (!destinations.some((destination) => destination.id === id)) return;
      // The usual destination again while a 今夜だけ one is set: back to it (the list
      // shows none selected then, so tapping it means "my usual place").
      if (id === activeDestinationId && !tonightDestination) return;
      markReminderChange("user");
      applyDestinationState(destinations, id);
      void Haptics.selectionAsync();
    },
    [activeDestinationId, destinations, applyDestinationState, tonightDestination],
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
      markReminderChange("user");
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
      markReminderChange("user");
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

  // One-night settings (1本前 / 2本前, a locked station, 今夜だけ destination) expire
  // at the end of their night, but only reading them drops them. iOS can keep the
  // app in memory into the next evening, so read them again whenever it comes back.
  const oneNightRef = useRef({ trainChoice, pinnedStation, tonightDestination });
  oneNightRef.current = { trainChoice, pinnedStation, tonightDestination };
  useEffect(() => {
    if (!isHydrated) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void readOneNightSettings(getNow()).then((stored) => {
        const current = oneNightRef.current;
        if (stored.trainChoice !== current.trainChoice) setTrainChoiceState(stored.trainChoice);
        if (current.pinnedStation && !stored.pinnedStation) setPinnedStationState(null);
        if (current.tonightDestination && !stored.tonightDestination) setTonightDestination(null);
      });
    });
    return () => subscription.remove();
  }, [isHydrated, getNow, setTonightDestination]);

  // A time is a notification or an alarm, never both: choosing it in one list
  // removes it from the other.
  const toggleReminderInterval = useCallback((minutes: number) => {
    const adding = !reminderIntervals.includes(minutes);
    const next = adding
      ? [...reminderIntervals, minutes].sort((a, b) => b - a)
      : reminderIntervals.filter((entry) => entry !== minutes);
    markReminderChange("user");
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
    markReminderChange("user");
    setAlarmIntervals(next);
    void AsyncStorage.setItem(STORAGE_KEYS.alarmTimes, JSON.stringify(next));
    if (adding && reminderIntervals.includes(minutes)) {
      const notifications = reminderIntervals.filter((entry) => entry !== minutes);
      setReminderIntervals(notifications);
      void AsyncStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(notifications));
    }
    void Haptics.selectionAsync();
  }, [reminderIntervals, alarmIntervals]);

  // The alarm times from when alarms were last switched off, to bring back when they're switched on.
  const lastAlarmTimes = useRef<number[]>([]);
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEYS.lastAlarmTimes)
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) lastAlarmTimes.current = parsed.filter((entry): entry is number => REMINDER_CHOICES.includes(entry as number));
      })
      .catch(() => undefined);
  }, []);

  const setAlarmsEnabled = useCallback((enabled: boolean) => {
    if (enabled === alarmsEnabled) return;
    markReminderChange("user");
    let notifications: number[];
    let alarms: number[];
    if (enabled) {
      // The alarm times chosen before they were switched off, or one at the leave
      // time the first time. Those times stop being notifications. Settings asks for permission.
      alarms = lastAlarmTimes.current.length > 0 ? [...lastAlarmTimes.current] : [0];
      notifications = reminderIntervals.filter((entry) => !alarms.includes(entry));
      setAlarmPermissionRevision((revision) => revision + 1);
    } else {
      // Remembered for next time; meanwhile their times go back to notifications,
      // so switching alarms off never drops a reminder.
      if (alarmIntervals.length > 0) {
        lastAlarmTimes.current = [...alarmIntervals];
        void AsyncStorage.setItem(STORAGE_KEYS.lastAlarmTimes, JSON.stringify(alarmIntervals));
      }
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

  // Before iOS 26 there are no real alarms (no AlarmKit), so the option isn't
  // offered: alarm times someone set earlier go back to being notifications.
  useEffect(() => {
    if (isHydrated && Platform.OS === "ios" && !alarmKitAvailable && alarmsEnabled) setAlarmsEnabled(false);
  }, [isHydrated, alarmsEnabled, setAlarmsEnabled]);

  const setAlarmSound = useCallback((sound: ReminderSound) => {
    setAlarmSoundState(sound);
    void AsyncStorage.setItem(STORAGE_KEYS.alarmSound, sound);
  }, []);

  const setReminderVibrate = useCallback((vibrate: boolean) => {
    setReminderVibrateState(vibrate);
    void AsyncStorage.setItem(STORAGE_KEYS.reminderVibrate, String(vibrate));
  }, []);

  const setThroughFocus = useCallback((on: boolean) => {
    setThroughFocusState(on);
    void AsyncStorage.setItem(STORAGE_KEYS.throughFocus, String(on));
    void Haptics.selectionAsync();
  }, []);

  const setWidgetTheme = useCallback((theme: WidgetThemeId) => {
    setWidgetThemeState(theme);
    void writeWidgetTheme(theme);
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
      markReminderChange("user");
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

  const setNightLocationMode = useCallback((mode: NightLocationMode, { pendingAlways = false }: { pendingAlways?: boolean } = {}) => {
    setNightLocationModeState(mode);
    void AsyncStorage.setItem(STORAGE_KEYS.nightLocationMode, mode);
    // A choice made now replaces a 閉じても更新 still waiting for iOS (see refreshBackgroundAllowed).
    if (pendingAlways) void AsyncStorage.setItem(STORAGE_KEYS.wantsBackground, 'true');
    else void AsyncStorage.removeItem(STORAGE_KEYS.wantsBackground);
  }, []);

  // The app's 閉じても更新 only works if iOS allows "Always"; keep track so the UI
  // can say when it doesn't (rechecked when returning from the Settings app).
  const [backgroundAllowed, setBackgroundAllowed] = useState<boolean | null>(null);
  const refreshBackgroundAllowed = useCallback(async () => {
    if (Platform.OS === "web") return false;
    const { granted } = await backgroundLocationState();
    setBackgroundAllowed(granted);
    // Setup chose 閉じても更新 before iOS had confirmed "Always" (its prompt came late,
    // or the user allowed it in Settings afterwards): now it's allowed, so use it.
    if (granted && (await AsyncStorage.getItem(STORAGE_KEYS.wantsBackground).catch(() => null)) === 'true') {
      setNightLocationModeState('background');
      void AsyncStorage.setItem(STORAGE_KEYS.nightLocationMode, 'background');
      void AsyncStorage.removeItem(STORAGE_KEYS.wantsBackground);
    }
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

  const switchTrackingToBackground = useCallback(async () => {
    setNightLocationMode("background");
    if (!(await requestBackgroundLocation())) return false;
    if (trackingMode !== "foreground") return true;
    const started = await startBackgroundTracking(locationProfile(effectivePlanRef.current, getNow()));
    if (started) setTrackingMode("background");
    return started;
  }, [setNightLocationMode, requestBackgroundLocation, trackingMode, getNow]);

  const setDemoNow = useCallback(
    (virtualMs: number | null) => {
      const realAt = Date.now();
      const speed = demoRef.current?.speed ?? DEMO_SPEED;
      setRealNow(realAt);
      setDemo(virtualMs === null ? null : { virtualAt: virtualMs, realAt, speed });
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
        const plans = buildReminderPlans(plan, delivered.notifications, virtualMs, {
          missedCheckIn,
          alarmIntervals: delivered.alarms,
        }).map((reminder) => ({
          ...reminder,
          fireAt: realAt + (reminder.fireAt - virtualMs) / speed,
        }));
        await scheduleReminders(plans, {
          leaveBy: formatJstTime(recommendedLeaveTime(plan)),
          station: stationLabel,
          held: heldTrain(plan, language === "ja"),
          language: language ?? "en",
        }, { sound: delivered.sound, vibrate: reminderVibrate, throughFocus });
      })();
    },
    [
      trackingMode,
      plan,
      language,
      delivered,
      reminderVibrate,
      throughFocus,
      missedCheckIn,
      stationLabel,
    ],
  );

  const setDemoSpeed = useCallback((speed: number) => {
    const current = demoRef.current;
    if (!current) return;
    // Keep the demo time where it is; only its pace changes.
    const realAt = Date.now();
    setRealNow(realAt);
    setDemo({ virtualAt: current.virtualAt + (realAt - current.realAt) * current.speed, realAt, speed });
  }, []);

  const requestNotifications = useCallback(async () => {
    const allowed = await ensureNotificationPermission();
    setNotificationsAllowed(allowed);
    return allowed;
  }, []);

  /** Plans from a position; returns null when there is no home station to plan toward. */
  // Searches in flight (any re-plan: 更新, moving while tracking, the periodic check),
  // so the screen can show that it's looking.
  const [searches, setSearches] = useState(0);
  const planFrom = useCallback(
    async (coordinates: Coordinates, options: { dropPin?: boolean; pin?: StationOption } = {}) => {
      setSearches((count) => count + 1);
      try {
        return await planFromNow(coordinates, options);
      } finally {
        setSearches((count) => Math.max(0, count - 1));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getNow],
  );
  const planFromNow = useCallback(
    async (coordinates: Coordinates, { dropPin = false, pin }: { dropPin?: boolean; pin?: StationOption } = {}) => {
      const {
        homeStationOption: home,
        leaveMargin: margin,
      } = settingsRef.current;
      const pinnedStation = pin ?? settingsRef.current.pinnedStation;
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
      // On the way (tracking, past the leave time, train not gone): keep tonight's
      // station and times until the train departs, then re-plan from here. A station the user chooses
      // (`pin`) is a choice, not a re-plan, so it isn't held.
      const effective = effectivePlanRef.current;
      if (!pin && !dropPin && trackingModeRef.current !== null && current && effective && holdOnTheWay(current, effective, now))
        return keepOnTheWay(current, coordinates, now, effective.lastTrain.departsAt);
      return planNight(coordinates, home, margin, now, {
        pinned: dropPin ? null : pinnedStation,
        nightOf,
        homeAddress: settingsRef.current.homeAddress,
        previous: current,
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
      const code = errorCode(error);
      // A lookup that failed for now (Apple's request limit, no connection) with a
      // plan on screen: keep it; its 確認 time shows its age and the next check retries.
      // While tracking, keep it for any lookup answer too: an empty plan would cancel
      // every reminder, and nothing reschedules them until the phone moves.
      if (planRef.current && (code === "unavailable" || (trackingModeRef.current !== null && code !== "permission"))) return;
      setLocationError(code);
      setPlan(null);
    } finally {
      if (session === sessionRef.current) setIsLocating(false);
    }
  }, [isLocating, planFrom]);

  const applyPlan = useCallback((next: NightPlan) => {
    setUserCoordinates(next.coordinates);
    setPlan(next);
  }, []);

  /**
   * 「駅を選ぶ」 / 「この駅に固定」: tonight's plan leaves from `station`, whatever
   * location updates say (only the walk and leave time change). Without a
   * location (turned off), the plan starts at the station itself: its last
   * train and leave time, with no walk.
   */
  const chooseDepartureStation = useCallback(
    async (station: StationOption) => {
      markReminderChange("user");
      userStationAt.current = getNow();
      setLockFallback(null);
      setPinnedStationState(station);
      void writePinnedStation(station);
      void Haptics.selectionAsync();
      const current = planRef.current;
      if (current && [current, ...current.alternatives].some((option) => sameStation(option.station, station))) {
        setPlan(repick(current, station));
        return;
      }
      const from = current?.coordinates ?? { latitude: station.latitude, longitude: station.longitude };
      const session = sessionRef.current;
      setIsLocating(true);
      try {
        const next = await planFrom(from, { pin: station });
        if (session !== sessionRef.current) return; // reset meanwhile
        if (next) {
          setLocationError((error) => (error === "permission" ? error : null));
          applyPlan(next);
        }
      } catch (error) {
        setLocationError(errorCode(error));
      } finally {
        setIsLocating(false);
      }
    },
    [planFrom, applyPlan],
  );

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

  const answerBoarding = useCallback(
    async (onBoard: boolean, departsAt?: number) => {
      const at = departsAt ?? boardingQuestionRef.current?.departsAt;
      if (at === undefined) return;
      if (!onBoard) {
        // The plan has already moved on to the next train: re-plan it from here.
        setAnsweredDeparture(at);
        await writeAnswered(at);
        void requestLocation();
        return;
      }
      const current = planRef.current;
      const option = current ? trainOptions(current, settingsRef.current.leaveMargin, 0).find((entry) => entry.station.lastTrain.departsAt === at) : undefined;
      const record: BoardedRecord = {
        night: serviceDate(at),
        choice: option?.choice ?? boardingQuestionRef.current?.choice ?? 1,
        trainDepartsAt: at,
        arrivesAt: option?.station.arriveHomeMs ?? option?.station.lastTrain.arrivesAt,
      };
      setBoarded(record);
      await writeBoarded(record);
      // Off with tracking: reminders, the "missed it?" check-in and the Live Activity go too.
      await stopTracking();
    },
    [requestLocation, stopTracking],
  );

  const undoBoarded = useCallback(() => {
    setBoarded(null);
    void writeBoarded(null);
  }, []);

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
      // Starting tracking: the times are on screen, so no catch-up or notice for them.
      if (!resume) markReminderChange("user");
      const locationMode = choice.mode;
      if (choice.asked) setNightLocationMode(locationMode);
      const startedAt =
        (resume ? await readTrackingStartedAt() : null) ?? getNow();
      if (op !== trackingOp.current) return;
      if (!resume) {
        void markTrackingStarted(startedAt);
        // A new night of tracking starts from a clean slate, not an old night's snapshot.
        void clearTrackingSnapshot();
      }
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
        ? await startBackgroundTracking(locationProfile(effectivePlanRef.current, getNow()))
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
    ((basePlan !== null && nowMs >= trackingEndsAt(basePlan)) ||
      (trackingStartedAt !== null &&
        nowMs >= trackingHardStopAt(trackingStartedAt)));
  useEffect(() => {
    if (trackingOver) void stopTracking();
  }, [trackingOver, stopTracking]);

  // Latest requestLocation, for the effects below that refresh a stale plan.
  const requestLocationRef = useRef(requestLocation);
  requestLocationRef.current = requestLocation;

  // A plan restored from storage can be hours old, so refresh it once on launch.
  // (Without tracking, nothing else re-plans: same on returning to the app.)
  useEffect(() => {
    if (!isHydrated || trackingMode !== null) return;
    const current = planRef.current;
    if (current && getNow() - current.computedAt >= AUTO_REPLAN_AFTER_MS)
      void requestLocationRef.current();
  }, [isHydrated, trackingMode, getNow]);

  // Tracking with the app open: location updates only come on movement, so standing
  // still would leave the plan (and "checked N min ago") going stale. Check it again
  // every few minutes while the app is in front.
  useEffect(() => {
    if (trackingMode === null || Platform.OS === "web") return;
    const timer = setInterval(() => {
      const current = planRef.current;
      if (AppState.currentState !== "active" || !current) return;
      // Also right after the train a frozen plan was held for has left (lib/onTheWay.ts).
      const now = getNow();
      if (now - current.computedAt >= AUTO_REPLAN_AFTER_MS || (current.frozenUntil !== undefined && now >= current.frozenUntil))
        void requestLocationRef.current();
    }, MINUTE_MS);
    return () => clearInterval(timer);
  }, [trackingMode, getNow]);

  // Without tracking (before it starts, after the user stops it, or after the last
  // train when it has switched off), the app on screen stays up to date too: re-check
  // every 5 minutes while open, as tracking does. After the last train this can find
  // a nearby station with a later train.
  useEffect(() => {
    if (trackingMode !== null || Platform.OS === "web") return;
    const timer = setInterval(() => {
      const current = planRef.current;
      if (AppState.currentState !== "active" || !current) return;
      if (getNow() - current.computedAt >= AUTO_REPLAN_AFTER_MS) void requestLocationRef.current();
    }, MINUTE_MS);
    return () => clearInterval(timer);
  }, [trackingMode, getNow]);

  // Closed-app updates: rough while leaving is over an hour away, the usual
  // detail after that (lib/tracking.ts). Checked with each new plan, and every
  // minute while open, so a phone lying still still switches at the hour mark.
  const profileMinute = trackingMode === "background" ? Math.floor(nowMs / 60_000) : 0;
  useEffect(() => {
    if (trackingMode !== "background") return;
    void applyLocationProfile(locationProfile(plan, getNow()));
  }, [trackingMode, plan, profileMinute, getNow]);

  // Permissions change in iPhone Settings while the app is in the background.
  // Re-check them on launch and whenever the app comes back: show when
  // notifications are off, and pick location back up by itself once it's allowed.
  const locationErrorRef = useRef(locationError);
  locationErrorRef.current = locationError;
  useEffect(() => {
    if (Platform.OS === "web") return;
    const recheck = async () => {
      const notifications = await notificationPermissionStatus().catch(() => null);
      if (notifications) setNotificationsAllowed(notifications === "granted" ? true : notifications === "denied" ? false : null);
      // Look at the permission itself, not just the last lookup: a plan saved
      // earlier would otherwise hide that location has since been turned off.
      const [permission, servicesOn] = await Promise.all([
        Location.getForegroundPermissionsAsync().catch(() => null),
        Location.hasServicesEnabledAsync().catch(() => true),
      ]);
      const turnedOff = !servicesOn || permission?.status === "denied";
      const failed = locationErrorRef.current;
      if (turnedOff) {
        if (failed !== "permission") setLocationError("permission");
      } else if ((failed === "permission" || failed === "unavailable") && permission?.granted) {
        // Allowed again (e.g. back from Settings): pick up by itself.
        setLocationError(null);
        void requestLocationRef.current();
      }
    };
    void recheck();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void recheck();
    });
    return () => subscription.remove();
  }, []);

  // Coming back to the app after a while: re-plan at once from where the user is,
  // tracking or not. (With tracking, standing still sends no location updates, so
  // the plan can be old; waiting for the 5-minute timer felt broken.)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const current = planRef.current;
      if (
        state === "active" &&
        current &&
        getNow() - current.computedAt >= AUTO_REPLAN_AFTER_MS
      )
        void requestLocationRef.current();
    });
    return () => subscription.remove();
  }, [trackingMode, getNow]);

  // Background tracking outlives the app: if it was on when the app was closed,
  // pick it back up on launch so reminders and live updates carry on.
  useEffect(() => {
    if (!isHydrated) return;
    void isTrackingFlagOn()
      .then(async (on) => {
        if (on) await startTracking({ resume: true });
      })
      .catch(() => undefined)
      .finally(() => setTrackingRestored(true));
    // Only on launch: later starts and stops come from the user.
  }, [isHydrated]);

  // Adopt the background task's plan if it is newer: when the app returns to the
  // foreground, and at once when background tracking (re)starts, which on a cold
  // launch comes after the launch's own "active" event.
  useEffect(() => {
    if (trackingMode !== "background") return;
    const adopt = () => {
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
    };
    adopt();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") adopt();
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
    setTrainChoiceState(DEFAULT_SETTINGS.trainChoice);
    setChoiceOverride(null);
    setReminderIntervals(DEFAULT_SETTINGS.reminderIntervals);
    setAlarmsEnabledState(DEFAULT_SETTINGS.alarmsEnabled);
    setAlarmIntervals(DEFAULT_SETTINGS.alarmIntervals);
    setAlarmSoundState(DEFAULT_SETTINGS.alarmSound);
    setReminderVibrateState(DEFAULT_SETTINGS.reminderVibrate);
    setThroughFocusState(DEFAULT_SETTINGS.throughFocus);
    setWidgetThemeState(DEFAULT_SETTINGS.widgetTheme);
    setBoarded(null);
    setAnsweredDeparture(null);
    void writeBoarded(null);
    void writeAnswered(null);
    setPinnedStationState(null);
    setTonightDestinationState(null);
    setMissedCheckInState(DEFAULT_SETTINGS.missedCheckIn);
    setNightLocationModeState(DEFAULT_SETTINGS.nightLocationMode);
    setLockFallback(null);
    setSavedFor(null);
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
      // Until RevenueCat has answered, the saved premium state decides (as for the Live Activity).
      premiumKnown ? isPremium : undefined,
      { tracking: !!trackingMode, firstTrain, reason: locationError, theme: widgetTheme, boarded },
    ).catch((error) => {
      if (__DEV__) console.warn("[LastRide] widget sync failed", error);
    });
  }, [plan, widgetDestination, language, isPremium, premiumKnown, demoActive, isHydrated, trackingMode, firstTrain, locationError, widgetTheme, boarded]);

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
      isSearching: searches > 0 || isLocating,
      locationError,
      reminderIntervals,
      alarmsEnabled,
      alarmIntervals,
      alarmSound,
      reminderVibrate,
      throughFocus,
      setThroughFocus,
      setAlarmsEnabled,
      toggleAlarmInterval,
      setAlarmSound,
      setReminderVibrate,
      widgetTheme,
      setWidgetTheme,
      missedCheckIn,
      setMissedCheckIn,
      nightLocationMode,
      setNightLocationMode,
      backgroundAllowed,
      requestBackgroundLocation,
      switchTrackingToBackground,
      notificationsAllowed,
      requestNotifications,
      currentTime: formatJstTime(nowMs),
      nowMs,
      demoActive,
      setLanguage,
      saveHomeStation,
      setLeaveMargin,
      trainChoice,
      effectiveTrainChoice: effectiveChoice,
      trainChoices,
      trainChoiceOverride: basePlan && activeOverride?.station === basePlan.station.nameJa ? activeOverride : null,
      chooseDepartureStation,
      lockFallback,
      boarded,
      boardingQuestion,
      answerBoarding,
      undoBoarded,
      dismissLockFallback: () => setLockFallback(null),
      setTrainChoice,
      requestLocation,
      resetLanguage,
      toggleReminderInterval,
      setPinnedStation,
      setDemoNow,
      demoSpeed: demo?.speed ?? DEMO_SPEED,
      setDemoSpeed,
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
      switchTrackingToBackground,
      homeStationOption,
      isHydrated,
      isLocating,
      searches,
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
      throughFocus,
      setThroughFocus,
      setAlarmsEnabled,
      toggleAlarmInterval,
      setAlarmSound,
      setReminderVibrate,
      widgetTheme,
      setWidgetTheme,
      requestLocation,
      resetAll,
      resetLanguage,
      saveDestination,
      saveHomeStation,
      selectDestination,
      tonightDestination,
      setTonightDestination,
      setDemoNow,
      demo,
      setDemoSpeed,
      setPinnedStation,
      setLanguage,
      setLeaveMargin,
      trainChoice,
      effectiveChoice,
      trainChoices,
      activeOverride,
      basePlan,
      chooseDepartureStation,
      lockFallback,
      boarded,
      boardingQuestion,
      answerBoarding,
      undoBoarded,
      setTrainChoice,
      startTracking,
      stopTracking,
      toggleReminderInterval,
      trackingMode,
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
        ? "位置情報がオフです。タップしてiPhoneの設定で許可してください。戻ると自動で更新します。"
        : "Location is off. Tap to allow it in iPhone Settings; the app updates when you come back.";
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
    case "near-home":
      return ja
        ? "ここからは電車に乗る必要はありません。帰り先から離れると、終電と出発時刻を表示します。"
        : "No train needed from here. Once you're further from home, your last train and leave time will show.";
    case "unavailable":
      return ja
        ? "駅の検索に失敗しました。通信状況を確認して再試行してください。"
        : "Couldn’t reach the station search. Check your connection and try again.";
  }
}
