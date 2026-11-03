import { BottomNav } from "@/components/BottomNav";
import { MapCard, openTransitRoute, openWalkingRoute } from "@/components/MapCard";
import { PremiumCard } from "@/components/PremiumCard";
import { Notice } from "@/components/RideUI";
import { Card, CountdownRing, IconButton } from "@/components/ui";
import { DIGITS } from "@/constants/type";
import { locationErrorText, useLastRide } from "@/context/LastRideContext";
import { FarStationCard } from "@/components/FarStationCard";
import { LocationOffCard } from "@/components/LocationOffCard";
import { usePremium } from "@/context/PremiumContext";
import { useGroups } from "@/context/GroupsContext";
import { useColors } from "@/hooks/useColors";
import { apiBaseUrl } from "@/lib/api";
import { sameStation } from "@/lib/planner";
import {
  planAgeMinutes,
  planFreshness,
  recommendedLeaveTime,
} from "@/lib/reliability";
import { leaveCardFor, useLeaveCardOpening } from "@/lib/premiumPrompts";
import { formatJstTime, serviceDate } from "@/lib/time";
import { formatCountdown } from "@/lib/countdown";
import { useSecondClock } from "@/hooks/useSecondClock";
import { shortLineName } from "@/lib/timetable";
import { trainChoiceLabel } from "@/lib/trainChoice";
import {
  markDismissed,
  markSeen,
  readSuggestionLog,
  stationSuggestion,
  suggestionNight,
  suggestionText,
  type SuggestionLog,
} from "@/lib/stationSuggestion";
import { phaseAt, phaseLabel } from "@/lib/nightPhase";
import { boardedButtons } from "@/lib/boarding";
import { PlaceholderBlock } from "@/components/Placeholder";
import { Feather } from "@expo/vector-icons";
import {
  getTrainDisruptions,
  joinGroupTonight,
  type TrainDisruption,
} from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isLocationApproximate } from "@/lib/tracking";
import { liveActivityEnabled } from "@/lib/liveActivity";
import { liveActivitiesAllowed } from "@/modules/last-ride-alarm/src";

/** The ring empties over the last hour before leave-by. */
const RING_WINDOW_MS = 60 * 60 * 1000;
const ALWAYS_CARD_KEY = "lastride-always-card";

/**
 * The "update when closed?" strip: shown while tracking only while open, until
 * closed for tonight (stored as tonight's service date). It comes back the next night.
 */
function useAlwaysCard(active: boolean) {
  const [state, setState] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    AsyncStorage.getItem(ALWAYS_CARD_KEY)
      .then((value) => setState(value))
      .catch(() => setState(null));
  }, [active]);
  const tonight = serviceDate(Date.now());
  const save = (value: string) => {
    setState(value);
    void AsyncStorage.setItem(ALWAYS_CARD_KEY, value).catch(() => undefined);
  };
  return {
    show: state !== undefined && state !== tonight,
    dismissTonight: () => save(tonight),
  };
}

/** The countdown ring, and the start button that stands in for it until tonight is started. */
const HERO_SIZE = 144;
const MAP_HEIGHT = 150;
/** On a tall, quiet screen the map grows into the free space, up to this. */
const MAP_MAX_HEIGHT = 340;

/** A plan can be refreshed by hand this soon after it was made. */
const REFRESH_COOLDOWN_MS = 30_000;

export default function RideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    language,
    plan,
    setPinnedStation,
    homeStationOption,
    stationName,
    stationNameJa,
    destination,
    tonightDestination,
    lastTrain,
    lastTrainSource,
    status,
    walkingMinutes,
    isLocationReady,
    isLocating,
    isSearching,
    locationError,
    nearestByCar,
    requestLocation,
    nowMs,
    demoActive,
    userCoordinates,
    trackingMode,
    startTracking,
    stopTracking,
    nightLocationMode,
    backgroundAllowed,
    switchTrackingToBackground,
    notificationsAllowed,
    trainChoice,
    effectiveTrainChoice,
    trainChoices,
    pinnedGainMinutes,
    setTrainChoice,
    trainChoiceOverride,
    chooseDepartureStation,
    lockFallback,
    dismissLockFallback,
    boarded,
    boardingQuestion,
    answerBoarding,
    undoBoarded,
  } = useLastRide();
  const ja = language === "ja";
  const station = ja ? stationNameJa : stationName;
  const [disruptions, setDisruptions] = useState<TrainDisruption[]>([]);
  const [disruptionFeedUnavailable, setDisruptionFeedUnavailable] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  // The control row's dropdowns: 終電 ▾ (which train) and the station ▾.
  const [panel, setPanel] = useState<"train" | "station" | null>(null);
  const [mapHeight, setMapHeight] = useState(MAP_HEIGHT);
  // A dropdown or the route open for a moment: the map keeps its size and just
  // moves down (the screen scrolls), instead of shrinking and fetching a new
  // map image, then growing back and fetching the old one again.
  const holdMapHeight = panel !== null || showRoute;
  const onMapSlotLayout = (event: LayoutChangeEvent) => {
    if (holdMapHeight) return;
    // In steps of 10, so tiny layout changes don't fetch a new map image.
    const height = Math.min(MAP_MAX_HEIGHT, Math.floor(event.nativeEvent.layout.height / 10) * 10);
    if (height >= MAP_HEIGHT && height !== mapHeight) setMapHeight(height);
  };
  const clockMs = useSecondClock(nowMs, demoActive);
  // A farther station that gets you home later: suggested, never switched to (lib/stationSuggestion.ts).
  const suggestion = plan && !demoActive ? stationSuggestion(plan, nowMs) : null;
  const suggestionNightKey = plan ? suggestionNight(plan) : null;
  const [suggestionLog, setSuggestionLog] = useState<SuggestionLog | null>(null);
  useEffect(() => {
    if (!suggestionNightKey) return;
    let live = true;
    void readSuggestionLog(suggestionNightKey).then((log) => live && setSuggestionLog(log));
    return () => {
      live = false;
    };
  }, [suggestionNightKey]);
  const suggested =
    suggestion &&
    suggestionLog?.night === suggestionNightKey &&
    !suggestionLog.dismissed.includes(suggestion.option.station.nameJa)
      ? suggestion
      : null;
  const suggestedName = suggested?.option.station.nameJa;
  // Seen on screen: the background task won't also send it as a notification.
  useEffect(() => {
    if (!suggestedName || !suggestionNightKey || AppState.currentState !== "active") return;
    if (suggestionLog?.seen.includes(suggestedName)) return;
    void markSeen(suggestionNightKey, suggestedName).then(setSuggestionLog);
  }, [suggestedName, suggestionNightKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Stop tracking" from the Android countdown notification opens last-ride://ride?stop=1.
  const { stop } = useLocalSearchParams<{ stop?: string }>();
  useEffect(() => {
    if (stop !== "1") return;
    if (trackingMode !== null) void stopTracking();
    router.setParams({ stop: undefined });
  }, [stop, trackingMode, stopTracking]);
  const { isPremium } = usePremium();
  const { tonightGroup, tonightOpenGroup, apply: applyGroup, memberOptions, sharingTonight, stopSharingTonight } = useGroups();
  const [joiningGroup, setJoiningGroup] = useState(false);
  /** 参加 on the home screen: shares your current leave time with tonight's group. */
  const joinOpenGroup = async () => {
    if (!tonightOpenGroup) return;
    setJoiningGroup(true);
    try {
      applyGroup(
        await joinGroupTonight(
          tonightOpenGroup.id,
          { leaveBy: plan ? new Date(recommendedLeaveTime(plan)).toISOString() : null },
          memberOptions(tonightOpenGroup.id),
        ),
      );
    } catch {
      Alert.alert(ja ? '参加できませんでした' : 'Couldn’t join', ja ? 'しばらくしてからもう一度お試しください。' : 'Please try again in a moment.');
    } finally {
      setJoiningGroup(false);
    }
  };
  const leaveCard = useLeaveCardOpening();
  // Precise Location off (iOS): positions are only approximate. Rechecked on return from Settings.
  const [approximateLocation, setApproximateLocation] = useState(false);
  useEffect(() => {
    const check = () => void isLocationApproximate().then(setApproximateLocation);
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => subscription.remove();
  }, [isLocationReady]);

  // Premium's lock-screen countdown needs Live Activities allowed for the app.
  // Only looked at while tracking, the one time the countdown would be shown.
  const [liveActivitiesOff, setLiveActivitiesOff] = useState(false);
  const [showAllNotices, setShowAllNotices] = useState(false);
  useEffect(() => {
    if (!liveActivityEnabled || !isPremium || trackingMode === null) {
      setLiveActivitiesOff(false);
      return;
    }
    const check = () => void liveActivitiesAllowed().then((allowed) => setLiveActivitiesOff(allowed === false));
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => subscription.remove();
  }, [isPremium, trackingMode]);

  // 停止 while sharing with a group: ask whether to stop sharing too (the time
  // would otherwise stay as last sent, no longer following you).
  const alwaysCard = useAlwaysCard(trackingMode === "foreground");
  // 案内を開始 starts tracking, not just notifications: say how, per the 夜の位置情報 setting.
  const startNote =
    nightLocationMode === "background" && backgroundAllowed !== false
      ? { ja: "位置情報と通知\n閉じていても更新", en: "Tracking + reminders\nalso when closed" }
      : nightLocationMode === "ask"
        ? { ja: "位置情報の更新と\n通知を開始", en: "Starts tracking\n+ reminders" }
        : { ja: "位置情報と通知\nアプリ使用中のみ", en: "Tracking + reminders\nwhile open" };
  const confirmStop = () => {
    if (sharingTonight.length === 0) {
      void stopTracking();
      return;
    }
    const names = sharingTonight.map((group) => group.name).join(ja ? "、" : ", ");
    Alert.alert(
      ja ? "グループへの共有も止めますか？" : "Stop sharing with your group too?",
      ja
        ? `${names}に共有中の時刻も更新されなくなります`
        : `The time shared with ${names} stops updating too`,
      [
        { text: ja ? "共有は続ける" : "Keep sharing", onPress: () => void stopTracking() },
        {
          text: ja ? "共有も止める" : "Stop sharing too",
          style: "destructive",
          onPress: () => {
            void stopTracking();
            void stopSharingTonight();
          },
        },
      ],
    );
  };

  const freshness = plan ? planFreshness(plan.computedAt, nowMs) : null;
  const planAge = plan ? planAgeMinutes(plan.computedAt, nowMs) : null;
  // Apple didn't find both earlier trains (1本前 / 2本前): a refresh may, so no waiting for it.
  const missingEarlier =
    !!plan && plan.lastTrain.source === "apple" && trainChoices.length < 3 && status !== "departed";
  const canRefresh = !!plan && !isLocating && (missingEarlier || nowMs - plan.computedAt >= REFRESH_COOLDOWN_MS);
  const leaveAt = plan ? recommendedLeaveTime(plan) : null;
  // What the ring counts, the same as the widgets and the Live Activity: the
  // leave time, then (on the way) the train's departure.
  const phase = plan ? phaseAt(plan, clockMs) : null;
  const msLeft = phase ? phase.countdownTo - clockMs : null;
  const departed = status === "departed";

  const disruptionLineNames = [...new Set(
    (plan?.lastTrain.legs ?? []).map((leg) => leg.line).filter(Boolean),
  )].join(":");
  useEffect(() => {
    if (!apiBaseUrl || lastTrainSource !== "live" || !disruptionLineNames) {
      setDisruptions([]);
      setDisruptionFeedUnavailable(false);
      return;
    }
    let active = true;
    let lastCheckAt = 0;
    const check = (force = false) => {
      if (AppState.currentState !== "active") return;
      const now = Date.now();
      // Avoid a burst of provider requests when the user repeatedly switches
      // away and back from Settings or another app.
      if (!force && now - lastCheckAt < 60_000) return;
      lastCheckAt = now;
      void getTrainDisruptions({ lines: disruptionLineNames })
        .then((items) => {
          if (active) {
            setDisruptions(items);
            setDisruptionFeedUnavailable(false);
          }
        })
        .catch(() => {
          if (active) {
            setDisruptions([]);
            setDisruptionFeedUnavailable(true);
          }
        });
    };
    // Clear stale alerts from a different route. A same-route refresh leaves
    // the previous status visible until the response settles.
    setDisruptions([]);
    setDisruptionFeedUnavailable(false);
    check(true);
    const timer = setInterval(() => check(), 5 * 60_000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      active = false;
      clearInterval(timer);
      listener.remove();
    };
  }, [plan?.computedAt, lastTrainSource, disruptionLineNames]);

  useEffect(() => {
    if (homeStationOption && !isLocationReady && !isLocating && !locationError)
      void requestLocation();
  }, [
    homeStationOption,
    isLocationReady,
    isLocating,
    locationError,
    requestLocation,
  ]);

  // "自宅（押上）へ": the saved name plus its station, unless they're the same.
  // The first lookup (or one about to start on its own): the location card shows it's loading.
  const firstLoad = !isLocationReady && (isLocating || (!locationError && !!homeStationOption));
  // No station within walking reach and no plan: the far-station card takes the hero's place.
  const farMode = locationError === "no-station" && !isLocationReady && !isLocating;
  const homeStationName = homeStationOption
    ? ja
      ? homeStationOption.nameJa
      : homeStationOption.name
    : null;
  const destinationName =
    destination && homeStationName && destination !== homeStationName
      ? ja
        ? `${destination}（${homeStationName}）`
        : `${destination} (${homeStationName})`
      : destination;
  const destinationLabel = destinationName
    ? ja
      ? `${destinationName}へ`
      : `To ${destinationName}`
    : ja
      ? "帰る場所を設定"
      : "Set destination";
  const viaStation =
    plan && homeStationOption && !sameStation(plan.destination, homeStationOption)
      ? ja
        ? plan.destination.nameJa
        : plan.destination.name
      : null;

  // 〔乗った〕: on the earlier train; the night is over (lib/boarding.ts).
  const onBoard = boarded !== null;
  const ringTone = departed || onBoard ? "muted" : phase?.kind === "train" ? "train" : "primary";
  const ringLabel = onBoard
    ? trainChoiceLabel(boarded.choice, ja)
    : departed || !phase
    ? ja
      ? "終電"
      : "Last train"
    : phase.kind === "leave"
      ? ja
        ? "出るまで"
        : "Leave in"
      : phase.last
        ? ja
          ? "終電まで"
          : "Last train in"
        : phaseLabel(phase, ja).label;
  const ringValue = onBoard
    ? ja
      ? "乗車済み"
      : "On board"
    : departed
    ? ja
      ? "発車済み"
      : "Gone"
    : msLeft === null
      ? "--:--"
      : msLeft <= 0
        ? ja
          ? "今すぐ"
          : "Now"
        : formatCountdown(msLeft);

  const arrivalMs = plan?.arriveHomeMs ?? plan?.lastTrain.arrivesAt;
  const otherStations = plan?.alternatives ?? [];
  const showTrainChip = !!plan && !departed && !onBoard && trainChoices.length > 1;

  // 「元町・中華街 00:19発 → 菊名 00:39」: the trip under the leave time.
  const tripLine = (() => {
    if (!plan) return null;
    const from = ja ? `${station} ${lastTrain}発` : `${station} ${lastTrain}`;
    // Apple's arrival can be at the station's map point (a walk out past the
    // gates) when the station place wasn't found: only "around" then.
    const roughArrival = plan.lastTrain.source === "apple" && !plan.lastTrain.arrivesAtStation && !plan.walkHomeMinutes;
    const to = arrivalMs
      ? roughArrival
        ? ja
          ? `${destination} ${formatJstTime(arrivalMs)}ごろ`
          : `${destination} ~${formatJstTime(arrivalMs)}`
        : `${destination} ${formatJstTime(arrivalMs)}`
      : destination;
    const marks =
      (lastTrainSource === "sample" ? (ja ? "（仮）" : " (sample)") : "") +
      (plan.lastTrain.approximate ? (ja ? "（目安）" : " (approx.)") : "");
    return `${from} → ${to}${marks}`;
  })();

  // The route behind the trip line: changes, lines and fare (tap it for each leg).
  const routeLegs = plan?.lastTrain.legs ?? [];
  const routeSummary = (() => {
    if (!plan) return null;
    const firstLeg = routeLegs[0];
    const lines = routeLegs.length > 1
      ? routeLegs.map((leg) => (ja ? shortLineName(leg.line) : leg.lineEn ?? shortLineName(leg.line))).join(" → ")
      : firstLeg
        ? ja
          ? `${shortLineName(firstLeg.line)} ${firstLeg.to}方面`
          : `${firstLeg.lineEn ?? shortLineName(firstLeg.line)} to ${firstLeg.toEn ?? firstLeg.to}`
        : null;
    const summary = [
      // Apple doesn't say how many changes a route has, or the line.
      plan.lastTrain.source === "apple"
        ? null
        : plan.lastTrain.transfers
          ? ja
            ? `乗換${plan.lastTrain.transfers}回`
            : `${plan.lastTrain.transfers} transfer${plan.lastTrain.transfers > 1 ? "s" : ""}`
          : ja
            ? "乗換なし"
            : "Direct",
      lines,
      plan.lastTrain.fareYen ? `¥${plan.lastTrain.fareYen.toLocaleString("en-US")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return summary || null;
  })();
  // Tonight's group takes the card slot; the premium card only shows without one.
  const premiumCard = tonightGroup || tonightOpenGroup
    ? null
    : leaveCardFor({ isPremium, opens: leaveCard.opens, dismissed: leaveCard.dismissed });
  const nextInGroup = tonightGroup?.tonight.participants.find(
    (participant) =>
      participant.memberId !== tonightGroup.me.memberId &&
      participant.leaveBy &&
      Date.parse(participant.leaveBy) > nowMs,
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            flexGrow: 1,
            paddingTop: insets.top + (Platform.OS === "web" ? 24 : 8),
            paddingBottom: 28,
          },
        ]}
        showsVerticalScrollIndicator={false}
        // Fits on one screen most nights: only scrolls (and bounces) when something overflows.
        alwaysBounceVertical={false}
      >
        <View style={styles.topbar}>
          <View style={styles.flex}>
            <Pressable
              testID="edit-destination"
              onPress={() => router.push("/destinations")}
              accessibilityRole="button"
              accessibilityLabel={
                ja ? `帰る場所：${destinationLabel}。変更` : `${destinationLabel}. Change`
              }
              hitSlop={8}
              style={({ pressed }) => [
                styles.destination,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                maxFontSizeMultiplier={1.4}
                style={[styles.destinationText, { color: colors.foreground }]}
              >
                {destinationLabel}
              </Text>
              <Feather
                name="chevron-down"
                size={20}
                color={colors.mutedForeground}
              />
            </Pressable>
            {(tonightDestination || viaStation) && (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {[
                  tonightDestination ? (ja ? "今夜だけ" : "Tonight only") : null,
                  viaStation
                    ? ja
                      ? `${viaStation}経由`
                      : `via ${viaStation}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </View>
          {/* Free users: the way into Premium, always in the same place */}
          {!isPremium && (
            <IconButton
              icon="star"
              tone="accent"
              label={ja ? "プレミアム" : "Premium"}
              onPress={() => router.push("/paywall")}
              testID="open-premium"
            />
          )}
          <IconButton
            icon="settings"
            label={ja ? "設定" : "Settings"}
            onPress={() => router.push("/settings")}
            testID="open-settings"
          />
        </View>

        {lockFallback && (
          <Card style={styles.banner}>
            <Feather name="unlock" color={colors.primary} size={18} />
            <Text style={[styles.note, styles.flex, { color: colors.foreground }]}>
              {ja
                ? `${lockFallback.nameJa}駅からの帰宅ルートが見つからないため、出発駅を自動選択に戻しました`
                : `${lockFallback.name} can’t get you home any more, so the station is chosen automatically`}
            </Text>
            <Pressable
              testID="dismiss-lock-fallback"
              onPress={dismissLockFallback}
              accessibilityRole="button"
              accessibilityLabel={ja ? "閉じる" : "Dismiss"}
              hitSlop={10}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </Card>
        )}

        {plan?.pinned &&
          (() => {
            // Station against station (both last trains), never 1本前 here against 終電 there.
            const gain = pinnedGainMinutes;
            const autoName = ja
              ? plan.autoPick.station.nameJa
              : plan.autoPick.station.name;
            return (
              <Card style={styles.banner}>
                <Feather name="map-pin" color={colors.primary} size={18} />
                <View style={styles.flex}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    {ja ? `${station}駅に固定中` : `Locked to ${station}`}
                  </Text>
                  <Text
                    style={[
                      styles.note,
                      {
                        color:
                          gain >= 5 ? colors.destructive : colors.mutedForeground,
                      },
                    ]}
                  >
                    {gain >= 5
                      ? ja
                        ? `自動で選ぶと、${autoName}駅から${gain}分遅く出発できます。`
                        : `${autoName} would give you ${gain} more minutes.`
                      : ja
                        ? "一番近い駅への自動の切り替えは止まっています。"
                        : "Following the closest station is paused."}
                  </Text>
                </View>
                <Pressable
                  testID="back-to-auto"
                  onPress={() => setPinnedStation(null)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.smallButton,
                    { borderColor: colors.input, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text
                    style={[styles.smallButtonText, { color: colors.foreground }]}
                  >
                    {ja ? "自動に戻す" : "Back to auto"}
                  </Text>
                </Pressable>
              </Card>
            );
          })()}

        {suggested &&
          suggestionNightKey &&
          (() => {
            const text = suggestionText(suggested, ja);
            const name = suggested.option.station.nameJa;
            return (
              <Card style={styles.banner}>
                <Pressable
                  testID="use-suggested-station"
                  onPress={() => setPinnedStation(suggested.option.station)}
                  accessibilityRole="button"
                  accessibilityLabel={`${text.title}。${text.body}。${ja ? "タップでこの駅にする" : "Tap to use this station"}`}
                  style={({ pressed }) => [styles.suggestion, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather
                    name={suggested.reason === "clean" ? "alert-triangle" : "clock"}
                    color={colors.primary}
                    size={18}
                  />
                  <View style={styles.flex}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{text.title}</Text>
                    <Text style={[styles.note, { color: colors.mutedForeground }]}>
                      {text.body}
                      {ja ? " · タップでこの駅にする" : " · tap to use it"}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  testID="dismiss-suggested-station"
                  onPress={() => void markDismissed(suggestionNightKey, name).then(setSuggestionLog)}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? "閉じる" : "Dismiss"}
                  hitSlop={10}
                >
                  <Feather name="x" size={18} color={colors.mutedForeground} />
                </Pressable>
              </Card>
            );
          })()}

        {/* Notifications are the core of the app: say so as soon as they're off */}
        {notificationsAllowed === false && (
          <Pressable
            testID="notifications-off"
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.trackRow,
              { backgroundColor: colors.card, borderColor: colors.destructive, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="bell-off" color={colors.destructive} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {ja ? "通知がオフです" : "Notifications are off"}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja
                  ? "出る時刻のお知らせが届きません　設定 ↗"
                  : "You won’t be told when to leave · Settings ↗"}
              </Text>
            </View>
            <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
          </Pressable>
        )}

        {/* Location turned off: shown up top, even while a saved plan is still on screen */}
        {locationError === "permission" && <LocationOffCard ja={ja} />}

        {/* 終電 / 1本前 / 2本前: kept for tonight; a train is greyed out once it has departed */}
        {/* 乗れましたか？: the earlier train headed for has just departed */}
        {boardingQuestion && (
          <Card style={styles.alwaysCard}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              {ja
                ? `${trainChoiceLabel(boardingQuestion.choice, true)}（${formatJstTime(boardingQuestion.departsAt)}発）に乗れましたか？`
                : `Did you make the ${formatJstTime(boardingQuestion.departsAt)} train (${trainChoiceLabel(boardingQuestion.choice, false).toLowerCase()})?`}
            </Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja
                ? `乗れなかった場合は、今いる場所から${trainChoiceLabel(effectiveTrainChoice, true)}に間に合う時刻を計算します。`
                : `If not, LastRide works out your leave time for the ${effectiveTrainChoice ? `${trainChoiceLabel(effectiveTrainChoice, false).toLowerCase()} train` : "last train"} from where you are.`}
            </Text>
            <View style={styles.promptButtons}>
              <Pressable
                testID="boarded-yes"
                onPress={() => void answerBoarding(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.smallButton, styles.promptButton, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[styles.smallButtonText, styles.promptButtonText, { color: colors.primaryForeground }]}>{boardedButtons(ja ? "ja" : "en").boarded}</Text>
              </Pressable>
              <Pressable
                testID="boarded-no"
                onPress={() => void answerBoarding(false)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.smallButton, styles.promptButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.smallButtonText, styles.promptButtonText, { color: colors.foreground }]}>{boardedButtons(ja ? "ja" : "en").notBoarded}</Text>
              </Pressable>
            </View>
          </Card>
        )}

        {/* 〔乗った〕: the train taken; reminders and tracking are off for tonight */}
        {onBoard && (
          <Card style={styles.banner}>
            <Feather name="check-circle" color={colors.primary} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {ja
                  ? `${trainChoiceLabel(boarded.choice, true)}（${formatJstTime(boarded.trainDepartsAt)}発）に乗車しました`
                  : `On the ${formatJstTime(boarded.trainDepartsAt)} train (${trainChoiceLabel(boarded.choice, false).toLowerCase()})`}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? "今夜の通知と位置情報の更新を停止しました。" : "Tonight’s reminders and tracking are off."}
              </Text>
            </View>
            <Pressable
              testID="undo-boarded"
              onPress={undoBoarded}
              accessibilityRole="button"
              style={({ pressed }) => [styles.smallButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.smallButtonText, { color: colors.foreground }]}>{ja ? "取り消す" : "Undo"}</Text>
            </Pressable>
          </Card>
        )}

        {/* No station within walking reach: the nearest one, its last train and how to get there, in the hero's place. */}
        {farMode ? (
          <FarStationCard
            far={nearestByCar}
            ja={ja}
            you={userCoordinates}
            homeStation={ja ? (homeStationOption?.nameJa ?? "") : (homeStationOption?.name ?? "")}
            fallbackText={locationErrorText("no-station", ja)}
            onWays={() => router.push("/far-ways")}
            onRetry={() => void requestLocation()}
          />
        ) : plan ? (
        // Tonight in one sentence, centred: 「今夜は 23:56 に出る」, the trip under it, then the button (or the ring).
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
              {onBoard
                ? ja
                  ? "着く時刻（目安）"
                  : "Arriving around"
                : departed
                ? ja
                  ? "終電は発車しました"
                  : "The last train has left"
                : ja
                  ? "今夜は"
                  : "Leave at"}
            </Text>
            <View style={styles.leaveRow}>
              <Text
                testID="leave-time"
                maxFontSizeMultiplier={1.1}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
                  styles.leaveTime,
                  { color: departed || onBoard ? colors.mutedForeground : colors.primary },
                ]}
              >
                {onBoard
                  ? boarded.arrivesAt
                    ? formatJstTime(boarded.arrivesAt)
                    : "--:--"
                  : leaveAt !== null
                    ? formatJstTime(leaveAt)
                    : "--:--"}
              </Text>
              {ja && !departed && !onBoard && (
                <Text maxFontSizeMultiplier={1.2} style={[styles.leaveSuffix, { color: colors.foreground }]}>に出る</Text>
              )}
            </View>
            {!onBoard && tripLine && (
              <Pressable
                testID="toggle-route"
                disabled={!routeSummary}
                onPress={() => setShowRoute((value) => !value)}
                accessibilityRole={routeSummary ? "button" : undefined}
                accessibilityState={routeSummary ? { expanded: showRoute } : undefined}
                accessibilityHint={routeSummary ? (ja ? "タップで経路を表示" : "Tap for the route") : undefined}
                hitSlop={6}
                style={({ pressed }) => [styles.tripRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.tripLine, { color: colors.foreground }]}>{tripLine}</Text>
                {routeSummary ? (
                  <Feather name={showRoute ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
                ) : null}
              </Pressable>
            )}
            {/* Heading for an earlier train: the last train is the fallback. */}
            {!onBoard && !departed && plan.nightLastTrain && (
              <Text style={[styles.note, styles.centred, { color: colors.mutedForeground }]}>
                {ja
                  ? `乗れなければ終電 ${formatJstTime(plan.nightLastTrain.departsAt)}`
                  : `If you miss it, last train ${formatJstTime(plan.nightLastTrain.departsAt)}`}
              </Text>
            )}
            {!onBoard && !departed && trainChoiceOverride && leaveAt !== null ? (
              <Text style={[styles.note, styles.centred, { color: colors.mutedForeground }]}>
                {trainChoiceOverride.fromStation === trainChoiceOverride.station
                  ? ja
                    ? `${trainChoiceLabel(trainChoice, true)}は出る時刻を過ぎていたため、${trainChoiceLabel(effectiveTrainChoice, true)}にしています`
                    : `It was too late to leave for the ${trainChoiceLabel(trainChoice, false).toLowerCase()} train, so this is the ${trainChoiceLabel(effectiveTrainChoice, false).toLowerCase()}`
                  : ja
                    ? `駅が${station}駅に変わり、${trainChoiceLabel(trainChoice, true)}の出る時刻を過ぎていたため、${trainChoiceLabel(effectiveTrainChoice, true)}にしています`
                    : `Your station changed to ${station} and it was too late for the ${trainChoiceLabel(trainChoice, false).toLowerCase()} train there, so this is the ${trainChoiceLabel(effectiveTrainChoice, false).toLowerCase()}`}
              </Text>
            ) : !onBoard && !departed && trainChoice > effectiveTrainChoice && !boardingQuestion &&
              // Only when that train was found and has left (not when it was never found).
              trainChoices.some((option) => option.choice === trainChoice && !option.catchable) ? (
              <Text style={[styles.note, styles.centred, { color: colors.mutedForeground }]}>
                {ja
                  ? `${trainChoiceLabel(trainChoice, true)}は発車したため、${trainChoiceLabel(effectiveTrainChoice, true)}にしています`
                  : `${trainChoiceLabel(trainChoice, false)} has left, so this is the ${effectiveTrainChoice ? trainChoiceLabel(effectiveTrainChoice, false).toLowerCase() : "last train"}`}
              </Text>
            ) : null}
          </View>

          {/* The route, unfolded from the trip line: changes, lines and fare, then each leg */}
          {!onBoard && showRoute && routeSummary && (
            <Card style={styles.routeCard}>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>{routeSummary}</Text>
              {routeLegs.length > 1 &&
                routeLegs.map((leg) => (
                  <View key={`${leg.line}-${leg.departsAt}`} style={styles.leg}>
                    <Text style={[styles.legTime, { color: colors.subtle }]}>
                      {formatJstTime(leg.departsAt)}
                    </Text>
                    <Text style={[styles.note, styles.flex, { color: colors.mutedForeground }]}>
                      {ja
                        ? `${leg.from} → ${leg.to} · ${shortLineName(leg.line)}`
                        : `${leg.fromEn ?? leg.from} → ${leg.toEn ?? leg.to} · ${leg.lineEn ?? shortLineName(leg.line)}`}
                    </Text>
                  </View>
                ))}
            </Card>
          )}

          {isLocationReady && !departed && !onBoard && trackingMode === null ? (
            <Pressable
              testID="start-tracking"
              onPress={() => void startTracking()}
              accessibilityRole="button"
              accessibilityLabel={ja ? `案内を開始。${startNote.ja.replace("\n", "、")}` : `Start tonight. ${startNote.en.replace("\n", ", ")}`}
              style={({ pressed }) => [
                styles.startCircle,
                { backgroundColor: colors.primary, shadowColor: colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Feather name="moon" size={28} color={colors.primaryForeground} />
              <Text maxFontSizeMultiplier={1.2} style={[styles.startTitle, { color: colors.primaryForeground }]}>
                {ja ? "案内を開始" : "Start tonight"}
              </Text>
              <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={1.2} style={[styles.startNote, { color: colors.primaryForeground }]}>
                {ja ? startNote.ja : startNote.en}
              </Text>
            </Pressable>
          ) : (
            <CountdownRing
              size={HERO_SIZE}
              fraction={msLeft === null ? 0 : msLeft / RING_WINDOW_MS}
              label={ringLabel}
              value={ringValue}
              tone={ringTone}
            />
          )}
        </View>
        ) : firstLoad ? (
        // The first lookup: the same layout as tonight's plan, with a spinner where the button goes.
        <View
          testID="first-load"
          style={styles.hero}
          accessible
          accessibilityLabel={ja ? "近くの駅と終電を検索しています" : "Finding your closest station and last train"}
        >
          <View style={styles.heroCopy}>
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>{ja ? "今夜は" : "Leave at"}</Text>
            <View style={[styles.leaveRow, styles.loadingFaint]}>
              <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={[styles.leaveTime, { color: colors.mutedForeground }]}>--:--</Text>
              {ja && <Text maxFontSizeMultiplier={1.2} style={[styles.leaveSuffix, { color: colors.mutedForeground }]}>に出る</Text>}
            </View>
            <Text style={[styles.tripLine, { color: colors.mutedForeground }]}>
              {ja ? "近くの駅を検索中…" : "Finding your closest station…"}
            </Text>
          </View>
          <View style={[styles.loadingCircle, { borderColor: colors.secondary }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text maxFontSizeMultiplier={1.2} style={[styles.loadingNote, { color: colors.mutedForeground }]}>
              {ja ? "終電を確認中" : "Checking trains"}
            </Text>
          </View>
        </View>
        ) : null}

        {/* (During the first lookup without a plan, the loading hero above says it instead.) */}
        {locationError !== "permission" && locationError !== "no-station" && !isLocationReady && !(firstLoad && !plan) && (
          <Pressable
            testID="enable-location"
            disabled={firstLoad}
            onPress={() => void requestLocation()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.trackRow,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {firstLoad ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Feather name={locationError === "near-home" ? "home" : "crosshair"} color={colors.primary} size={18} />
            )}
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {firstLoad
                  ? ja
                    ? "近くの駅を検索しています…"
                    : "Finding your closest station…"
                  : locationError === "near-home"
                    ? ja
                      ? "帰る場所の近くにいます"
                      : "You're near home"
                    : ja
                      ? "位置情報を使う"
                      : "Use my location"}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {firstLoad
                  ? ja
                    ? "現在地から終電を調べています"
                    : "Checking tonight's last train from here"
                  : locationError
                  ? locationErrorText(locationError, ja)
                  : ja
                    ? "近くの駅と徒歩時間を確認します"
                    : "Find your closest station and walking time."}
              </Text>
            </View>
          </Pressable>
        )}
        {/* No plan because the search failed or found no route: the way on is to pick a
            station (it works from anywhere, e.g. planning ahead, or outside Japan). */}
        {!plan && !farMode && !firstLoad && locationError !== null && locationError !== "permission" && locationError !== "near-home" && (
          <Pressable
            testID="error-choose-station"
            onPress={() => router.push("/departure-station")}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.errorChoose, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="search" size={14} color={colors.primary} />
            <Text style={[styles.smallButtonText, { color: colors.primary }]}>{ja ? "駅を選んで調べる" : "Choose a station"}</Text>
          </Pressable>
        )}

        {/* What the app is doing (案内中, last check), then the controls: train ▾, station ▾, and 更新 or 停止 */}
        {plan && !onBoard && (
          <View style={styles.controlsBlock}>
            {trackingMode !== null && (
              <Pressable
                testID="plan-freshness"
                // Refresh any time, except straight after a lookup (no hammering Apple Maps).
                disabled={!canRefresh}
                onPress={() => void requestLocation()}
                accessibilityRole={canRefresh ? "button" : undefined}
                accessibilityHint={canRefresh ? (ja ? "タップで更新" : "Tap to refresh") : undefined}
                hitSlop={8}
                style={styles.freshness}
              >
                <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                <Text
                  numberOfLines={1}
                  style={[styles.note, { color: freshness === "stale" ? colors.destructive : colors.mutedForeground }]}
                >
                  <Text style={[styles.statusStrong, { color: colors.foreground }]}>{ja ? "案内中" : "Tracking"}</Text>
                  {isSearching
                    ? ja
                      ? " · 確認中…"
                      : " · checking…"
                    : planAge === 0
                      ? ja
                        ? " · たった今確認"
                        : " · checked just now"
                      : ja
                        ? ` · ${planAge}分前に確認`
                        : ` · checked ${planAge} min ago`}
                </Text>
                {/* Looking for stations and trains: a small spinner, so it's clear something is happening. */}
                {isSearching && <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.searching} />}
                {canRefresh && !isSearching && (
                  <Feather
                    name={freshness === "stale" ? "alert-triangle" : "refresh-cw"}
                    size={12}
                    color={freshness === "stale" ? colors.destructive : colors.mutedForeground}
                  />
                )}
              </Pressable>
            )}
            <View style={styles.controls}>
              {showTrainChip && (
                <ControlChip
                  testID="train-chip"
                  label={trainChoiceLabel(effectiveTrainChoice, ja)}
                  open={panel === "train"}
                  onPress={() => setPanel((open) => (open === "train" ? null : "train"))}
                  accessibilityLabel={
                    ja
                      ? `乗る電車：${trainChoiceLabel(effectiveTrainChoice, true)}。変更`
                      : `Train: ${trainChoiceLabel(effectiveTrainChoice, false)}. Change`
                  }
                />
              )}
              <ControlChip
                testID="station-chip"
                icon={plan.pinned ? "lock" : undefined}
                label={station}
                open={panel === "station"}
                onPress={() => setPanel((open) => (open === "station" ? null : "station"))}
                accessibilityLabel={
                  ja
                    ? `出発駅：${station}駅${plan.pinned ? "（固定中）" : ""}。変更`
                    : `Station: ${station}${plan.pinned ? " (locked)" : ""}. Change`
                }
              />
              {trackingMode !== null ? (
                <Pressable
                  testID="stop-tracking"
                  onPress={confirmStop}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.smallButton, styles.chip, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={[styles.smallButtonText, { color: colors.foreground }]}>{ja ? "停止" : "Stop"}</Text>
                </Pressable>
              ) : (
                // Also after the last train: moving may reach a station with a later one, so 更新 stays.
                <Pressable
                  testID="refresh-plan"
                  disabled={!canRefresh}
                  onPress={() => void requestLocation()}
                  accessibilityRole="button"
                  accessibilityLabel={
                    ja
                      ? `${formatJstTime(plan.computedAt)}に確認。更新`
                      : `Checked ${formatJstTime(plan.computedAt)}. Refresh`
                  }
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.refreshChip,
                    { opacity: isSearching ? 1 : !canRefresh ? 0.5 : pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.smallButtonText, { color: freshness === "stale" ? colors.destructive : colors.mutedForeground }]}>
                    {isSearching ? (ja ? "確認中" : "Checking") : formatJstTime(plan.computedAt)}
                  </Text>
                  {isSearching ? (
                    <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.searching} />
                  ) : (
                    <Feather
                      name={freshness === "stale" ? "alert-triangle" : "refresh-cw"}
                      size={13}
                      color={freshness === "stale" ? colors.destructive : colors.mutedForeground}
                    />
                  )}
                </Pressable>
              )}
            </View>

            {/* 終電 ▾: 終電 / 1本前 / 2本前, kept for tonight; a train is greyed out once it has departed */}
            {panel === "train" && showTrainChip && (
              <View
                accessibilityRole="radiogroup"
                style={[styles.trainSwitch, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {trainChoices.map((option) => {
                  const selected = option.choice === effectiveTrainChoice;
                  const label = trainChoiceLabel(option.choice, ja);
                  return (
                    <Pressable
                      key={option.choice}
                      testID={`train-choice-${option.choice}`}
                      disabled={!option.catchable}
                      onPress={() => {
                        setTrainChoice(option.choice);
                        setPanel(null);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: !option.catchable }}
                      accessibilityLabel={
                        !option.catchable
                          ? ja
                            ? `${label}は発車しました`
                            : `${label}: gone`
                          : option.late && !selected
                            ? ja
                              ? `${label} ${formatJstTime(option.departsAt)}発、急げば間に合います`
                              : `${label}, ${formatJstTime(option.departsAt)}, only if you hurry`
                            : ja
                              ? `${label} ${formatJstTime(option.departsAt)}発`
                              : `${label}, ${formatJstTime(option.departsAt)}`
                      }
                      style={({ pressed }) => [
                        styles.trainSegment,
                        selected && { backgroundColor: colors.primary },
                        { opacity: !option.catchable ? 0.4 : pressed ? 0.75 : 1 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.trainSegmentLabel,
                          { color: selected ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {label}
                      </Text>
                      <Text
                        style={[
                          styles.trainSegmentTime,
                          { color: selected ? colors.primaryForeground : option.late && option.catchable ? colors.destructive : colors.subtle },
                        ]}
                      >
                        {option.catchable ? formatJstTime(option.departsAt) : ja ? "発車済" : "Gone"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Station ▾: lock this one (or back to auto), search any station, or switch to a nearby one */}
            {panel === "station" && (
              <Card style={styles.stationPanel}>
                <View style={styles.panelButtons}>
                  {plan.pinned ? (
                    <Pressable
                      testID="panel-back-to-auto"
                      onPress={() => {
                        setPinnedStation(null);
                        setPanel(null);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.smallButton, styles.lockButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Feather name="unlock" size={13} color={colors.foreground} />
                      <Text style={[styles.smallButtonText, { color: colors.foreground }]}>
                        {ja ? "自動に戻す" : "Back to auto"}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      testID="lock-station"
                      onPress={() => {
                        void chooseDepartureStation(plan.station);
                        setPanel(null);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.smallButton, styles.lockButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Feather name="lock" size={13} color={colors.foreground} />
                      <Text style={[styles.smallButtonText, { color: colors.foreground }]}>
                        {ja ? "この駅に固定" : "Lock this station"}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    testID="choose-station"
                    onPress={() => {
                      setPanel(null);
                      router.push("/departure-station");
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.smallButton, styles.lockButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Feather name="search" size={13} color={colors.foreground} />
                    <Text style={[styles.smallButtonText, { color: colors.foreground }]}>
                      {ja ? "駅を検索" : "Search stations"}
                    </Text>
                  </Pressable>
                </View>
                {otherStations.length > 0 && (
                  <>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <Text style={[styles.otherLabel, { color: colors.mutedForeground }]}>
                      {ja ? "別の駅から帰る" : "Other stations"}
                    </Text>
                    {otherStations.map((option) => {
                      const isAutoPick =
                        plan.pinned &&
                        option.station.nameJa === plan.autoPick.station.nameJa;
                      const name = ja ? option.station.nameJa : option.station.name;
                      return (
                        <Pressable
                          key={option.station.nameJa}
                          testID={`use-station-${option.station.nameJa}`}
                          onPress={() => {
                            setPinnedStation(isAutoPick ? null : option.station);
                            setPanel(null);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={
                            ja ? `${name}から帰る` : `Leave from ${name} instead`
                          }
                          style={({ pressed }) => [
                            styles.leg,
                            { opacity: pressed ? 0.6 : 1 },
                          ]}
                        >
                          <Text style={[styles.legTime, { color: colors.foreground }]}>
                            {formatJstTime(recommendedLeaveTime(option))}
                          </Text>
                          <View style={styles.flex}>
                            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                              {name}
                              {isAutoPick ? (
                                <Text style={[styles.note, { color: colors.primary }]}>
                                  {ja ? "  おすすめの駅" : "  Automatic pick"}
                                </Text>
                              ) : null}
                            </Text>
                            <Text style={[styles.note, { color: colors.mutedForeground }]}>
                              {ja
                                ? `徒歩${option.walkingMinutes}分${option.walkingSource === 'routed' ? '' : '（推定）'} · 終電 ${formatJstTime(option.lastTrain.departsAt)}`
                                : `${option.walkingMinutes} min walk${option.walkingSource === 'routed' ? '' : ' (estimate)'} · last train ${formatJstTime(option.lastTrain.departsAt)}`}
                              {(option.disruptionLines?.length ?? 0) > 0
                                ? ja
                                  ? " · 運行情報あり"
                                  : " · service issue"
                                : ""}
                            </Text>
                          </View>
                          <Feather name="repeat" color={colors.mutedForeground} size={16} />
                        </Pressable>
                      );
                    })}
                  </>
                )}
              </Card>
            )}
          </View>
        )}

        {/* Tracking only while open: a compact suggestion to update when closed
            (iOS "Always"), closable for tonight; after that just the note. */}
        {trackingMode === "foreground" && alwaysCard.show && (
          // Stacked, never cut off: title and ✕, the sentence in full, then the button.
          <View style={[styles.alwaysStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.alwaysHead}>
              <Feather name="moon" color={colors.primary} size={16} />
              <Text style={[styles.alwaysTitle, styles.flex, { color: colors.foreground }]}>
                {ja ? "アプリの使用中のみ更新" : "Updating only while open"}
              </Text>
              <Pressable
                testID="always-card-close"
                onPress={alwaysCard.dismissTonight}
                accessibilityRole="button"
                accessibilityLabel={ja ? "今夜は閉じる" : "Close for tonight"}
                hitSlop={10}
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? "アプリを閉じると、駅や出発時刻は更新されません。" : "Your station and times won’t update while the app is closed."}
            </Text>
            <Pressable
              testID="always-card-enable"
              onPress={() =>
                void switchTrackingToBackground().then((ok) => {
                  if (!ok) void Linking.openSettings();
                })
              }
              accessibilityRole="button"
              style={({ pressed }) => [styles.smallButton, styles.alwaysButton, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.smallButtonText, { color: colors.primaryForeground }]}>{ja ? "アプリを閉じても更新" : "Keep updating when closed"}</Text>
            </Pressable>
          </View>
        )}
        {trackingMode === "foreground" && !alwaysCard.show && (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {nightLocationMode === "background" && backgroundAllowed === false
              ? ja
                ? "位置情報の許可が「常に」ではないため、アプリの使用中のみ更新します。"
                : "Location isn’t “Always”, so this updates only while open."
              : ja
                ? "アプリの使用中のみ位置情報を更新します。"
                : "Updates while the app is open."}
          </Text>
        )}

        {departed && !onBoard && (
          <Pressable
            testID="missed-prompt"
            onPress={() => router.replace("/alternatives")}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.promptRow,
              { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="compass" color={colors.primaryForeground} size={18} />
            <View style={styles.flex}>
              <Text
                style={[styles.rowTitle, { color: colors.primaryForeground }]}
              >
                {ja ? "終電を逃しましたか？" : "Missed the last train?"}
              </Text>
              <Text style={[styles.note, { color: colors.primaryForeground }]}>
                {ja
                  ? "始発・タクシー・近くの施設を探す"
                  : "See the first train, a taxi, and places to stay"}
              </Text>
            </View>
            <Feather
              name="chevron-right"
              color={colors.primaryForeground}
              size={18}
            />
          </Pressable>
        )}

        {disruptions.map((incident) => (
          <Notice
            key={`${incident.lineCode ?? incident.line}-${incident.title}`}
            icon="alert-triangle"
            title={
              ja
                ? `${incident.line}：${incident.status}`
                : `Service disruption · ${incident.line}`
            }
            body={incident.comment ?? incident.title}
          />
        ))}

        {(tonightGroup ?? tonightOpenGroup) &&
          (() => {
            const group = (tonightGroup ?? tonightOpenGroup)!;
            const joined = tonightGroup !== null;
            const count = group.tonight.participants.length;
            return (
              <Pressable
                testID="group-strip"
                onPress={() => router.push({ pathname: "/group/[id]", params: { id: group.id } })}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.trackRow,
                  { backgroundColor: colors.card, borderColor: joined ? colors.border : colors.primary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Feather name="users" color={colors.primary} size={18} />
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }]}>
                    {group.name}
                  </Text>
                  <Text numberOfLines={2} style={[styles.note, { color: joined ? colors.primary : colors.mutedForeground }]}>
                    {joined
                      ? ja
                        ? `● 出発時刻を共有中 · 今夜${count}人${nextInGroup?.leaveBy ? ` · 次は${nextInGroup.displayName}さん ${formatJstTime(Date.parse(nextInGroup.leaveBy))}` : ""}`
                        : `● Sharing your leave time · ${count} tonight${nextInGroup?.leaveBy ? ` · next: ${nextInGroup.displayName} ${formatJstTime(Date.parse(nextInGroup.leaveBy))}` : ""}`
                      : ja
                        ? `今夜の共有が始まりました · ${count}人参加中`
                        : `Tonight has started · ${count} joined`}
                  </Text>
                </View>
                {joined ? (
                  <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
                ) : (
                  <Pressable
                    testID="group-strip-join"
                    onPress={() => void joinOpenGroup()}
                    disabled={joiningGroup}
                    accessibilityRole="button"
                    accessibilityLabel={ja ? `${group.name}に今夜参加する` : `Join ${group.name} tonight`}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.smallButton,
                      styles.joinButton,
                      { backgroundColor: colors.primary, opacity: joiningGroup ? 0.6 : pressed ? 0.85 : 1 },
                    ]}
                  >
                    <Text style={[styles.smallButtonText, { color: colors.primaryForeground }]}>
                      {ja ? "今夜参加" : "Join"}
                    </Text>
                  </Pressable>
                )}
              </Pressable>
            );
          })()}

        {/* Still finding tonight's route: hold the places of the controls and the map */}
        {!plan && !farMode && (isLocating || firstLoad) && (
          <>
            <View style={styles.controls}>
              <PlaceholderBlock height={38} width={86} radius={12} />
              <PlaceholderBlock height={38} width={110} radius={12} />
            </View>
            <View style={styles.mapSlot} onLayout={onMapSlotLayout}>
              <PlaceholderBlock height={mapHeight} />
            </View>
          </>
        )}

        {/* The map takes the room left over (150 at least, so it never gets cramped):
            no empty band at the bottom when nothing else is showing. Its own
            height doesn't count toward the slot, so the slot can shrink again. */}
        {plan && (
          <View
            style={holdMapHeight ? [styles.mapSlot, { flexGrow: 0, height: mapHeight }] : styles.mapSlot}
            onLayout={onMapSlotLayout}
          >
          <View style={StyleSheet.absoluteFill}>
          <MapCard
            height={mapHeight}
            // The plan's own position until fresh GPS arrives (e.g. right after relaunch).
            you={userCoordinates ?? plan.coordinates}
            target={plan.station}
            // Apple's street route, when known: the card never draws a straight line instead.
            path={plan.walkPath}
            stationTag={station}
            walkLabel={
              walkingMinutes
                ? ja
                  ? `徒歩${walkingMinutes}分${plan.walkingSource === 'routed' ? '' : '（推定）'}`
                  : `${walkingMinutes} min walk${plan.walkingSource === 'routed' ? '' : ' (estimate)'}`
                : undefined
            }
            // The whole trip home (transfers and walks included), not just the walk to the station.
            onPress={() => openTransitRoute(plan.destination)}
            accessibilityLabel={
              ja
                ? `${station}駅まで徒歩${walkingMinutes ?? "—"}分。帰りの経路を地図アプリで開く`
                : `${walkingMinutes ?? "—"} min walk to ${station}. Open the route home in Maps`
            }
            openLabel={ja ? "経路を地図アプリで開く" : "Open route in Maps"}
            legalLabel={ja ? "法的情報" : "Legal"}
          />
          </View>
          </View>
        )}

        {plan && plan.walkingSource !== 'routed' && (
          <Pressable
            testID="estimated-walk-warning"
            accessibilityRole="button"
            accessibilityLabel={ja ? '徒歩時間は概算です。徒歩経路を地図で確認' : 'Walking time is estimated. Verify walking directions in Maps'}
            onPress={() => openWalkingRoute(plan.station)}
            style={({ pressed }) => ({ marginHorizontal: 20, marginTop: 5, marginBottom: 8, opacity: pressed ? 0.65 : 1 })}
          >
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja
                ? '徒歩時間は推定です（余裕を多めに）　経路を見る ↗'
                : 'Walking time is estimated (extra margin added) · View route ↗'}
            </Text>
          </Pressable>
        )}









        {/* Secondary notices: the most important one shows; the rest fold away. */}
        {(() => {
          const notices: Array<{ key: string; node: React.ReactNode }> = [];
          if (disruptionFeedUnavailable) notices.push({ key: "feed", node: (
          <Notice
            icon="alert-triangle"
            title={ja ? "運行情報を取得できません" : "Service alerts unavailable"}
            body={ja
              ? "遅れや運転見合わせは鉄道会社の情報で確認を"
              : "Check delays and suspensions with the railway"}
          />
          ) });
          if (plan?.lastTrain.approximate) notices.push({ key: "approx", node: (
          <Notice
            icon="info"
            title={ja ? "推定の時刻です" : "Estimated train time"}
            body={
              ja
                ? "乗換案内でも確認を"
                : "Double-check in a route app"
            }
          />
          ) });
          if (approximateLocation) notices.push({ key: "precise", node: (
          <Pressable
            testID="precise-location"
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.trackRow,
              { backgroundColor: colors.card, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="crosshair" color={colors.primary} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {ja ? "「正確な位置情報」がオフです" : "Precise Location is off"}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja
                  ? "駅や徒歩時間がずれることがあります　設定 ↗"
                  : "Your station and walk may be off · Settings ↗"}
              </Text>
            </View>
            <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
          </Pressable>
          ) });
          if (lastTrainSource === "sample") notices.push({ key: "sample", node: (
          <Notice
            icon="info"
            title={ja ? "時刻表を取得できません" : "Timetables unavailable"}
            body={
              ja
                ? "表示は仮の時刻です"
                : "The times shown are placeholders"
            }
          />
          ) });
          if (liveActivitiesOff && !departed) notices.push({ key: "lao", node: (
          <Pressable
            testID="live-activities-off"
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.trackRow,
              { backgroundColor: colors.card, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="lock" color={colors.primary} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {ja ? "ロック画面のカウントダウンがオフです" : "Lock-screen countdown is off"}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja
                  ? "ライブアクティビティをオンに　設定 ↗"
                  : "Turn on Live Activities · Settings ↗"}
              </Text>
            </View>
            <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
          </Pressable>
          ) });
          if (notices.length === 0) return null;
          return (
            <View style={styles.noticeGroup}>
              {notices.slice(0, showAllNotices ? undefined : 1).map((notice) => (
                <React.Fragment key={notice.key}>{notice.node}</React.Fragment>
              ))}
              {notices.length > 1 ? (
                <Pressable
                  testID="more-notices"
                  onPress={() => setShowAllNotices((open) => !open)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAllNotices }}
                  hitSlop={6}
                  style={styles.moreNotices}
                >
                  <Text style={[styles.note, { color: colors.mutedForeground }]}>
                    {showAllNotices
                      ? ja ? "閉じる" : "Show fewer"
                      : ja ? `ほかのお知らせ ${notices.length - 1}件` : `${notices.length - 1} more notice${notices.length > 2 ? "s" : ""}`}
                  </Text>
                  <Feather name={showAllNotices ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          );
        })()}

        {/* Premium last: below everything for tonight (only shown without Premium, and not while 案内 runs) */}
        {premiumCard && leaveAt !== null && trackingMode === null && (
          <PremiumCard
            variant={premiumCard}
            ja={ja}
            leaveAt={formatJstTime(leaveAt)}
            countdown={ringValue}
            station={station}
            destination={destination}
            onDismiss={leaveCard.dismiss}
          />
        )}

        {plan?.lastTrain.source === "live" && (
          <Pressable
            testID="odpt-credit"
            onPress={() => router.push("/data-sources")}
            accessibilityRole="link"
            hitSlop={6}
          >
            <Text style={[styles.credit, { color: colors.mutedForeground }]}>
              {ja
                ? "時刻データ：公共交通オープンデータセンター（正確性は保証されません）"
                : "Timetable: Public Transportation Open Data Center (accuracy not guaranteed)"}
            </Text>
          </Pressable>
        )}

      </ScrollView>
      <BottomNav language={language} />
    </View>
  );
}

/** A control-row dropdown button: 「終電 ▾」, 「元町・中華街 ▾」. */
function ControlChip({
  testID,
  icon,
  label,
  open,
  onPress,
  accessibilityLabel,
}: {
  testID: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  label: string;
  open: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [
        styles.smallButton,
        styles.chip,
        { borderColor: open ? colors.primary : colors.input, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {icon ? <Feather name={icon} size={13} color={colors.foreground} /> : null}
      <Text numberOfLines={1} style={[styles.smallButtonText, styles.chipText, { color: colors.foreground }]}>
        {label}
      </Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searching: { transform: [{ scale: 0.75 }] },
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  flex: { flex: 1, gap: 2 },
  topbar: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  destination: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, marginTop: 2 },
  destinationText: { flexShrink: 1, fontSize: 22, fontWeight: "800" },
  banner: { alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  suggestion: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12 },
  hero: { alignItems: "center", gap: 20, marginTop: 8 },
  startCircle: {
    alignItems: "center",
    borderRadius: HERO_SIZE / 2,
    gap: 2,
    height: HERO_SIZE,
    justifyContent: "center",
    paddingHorizontal: 10,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    width: HERO_SIZE,
  },
  startTitle: { fontSize: 18, fontWeight: "900", marginTop: 4 },
  startNote: { fontSize: 11, fontWeight: "700", lineHeight: 14, opacity: 0.8, paddingHorizontal: 10, textAlign: "center" },
  trainSwitch: { borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 4, padding: 4 },
  trainSegment: { alignItems: "center", borderRadius: 10, flex: 1, justifyContent: "center", minHeight: 46, paddingVertical: 4 },
  trainSegmentLabel: { fontSize: 11, fontWeight: "800" },
  trainSegmentTime: { fontFamily: DIGITS, fontSize: 15 },
  heroCopy: { alignItems: "center", alignSelf: "stretch", gap: 4 },
  heroLabel: { fontSize: 14, fontWeight: "700" },
  leaveRow: { alignItems: "baseline", flexDirection: "row", gap: 8, justifyContent: "center", maxWidth: "100%" },
  leaveTime: { flexShrink: 1, fontFamily: DIGITS, fontSize: 80, letterSpacing: -2, lineHeight: 86 },
  leaveSuffix: { fontSize: 20, fontWeight: "800" },
  tripRow: { alignItems: "center", flexDirection: "row", gap: 4, justifyContent: "center", maxWidth: "100%" },
  tripLine: { flexShrink: 1, fontSize: 15, fontWeight: "600", lineHeight: 21, textAlign: "center" },
  centred: { textAlign: "center" },
  routeCard: { alignSelf: "stretch", borderWidth: 1, gap: 10, padding: 14 },
  freshness: { alignItems: "center", alignSelf: "center", flexDirection: "row", gap: 5 },
  promptRow: { alignItems: "center", borderRadius: 18, flexDirection: "row", gap: 12, padding: 15 },
  digits: { fontFamily: DIGITS },
  leg: { alignItems: "center", flexDirection: "row", gap: 12 },
  legTime: { flexShrink: 0, fontFamily: DIGITS, fontSize: 15, width: 48 },
  divider: { height: 1 },
  otherLabel: { fontSize: 12, fontWeight: "700" },
  rowTitle: { fontSize: 15, fontWeight: "700" },
  note: { fontSize: 12, lineHeight: 17 },
  credit: { fontSize: 10, lineHeight: 14, textDecorationLine: "underline" },
  settingsLink: { alignSelf: "flex-start", marginTop: -6, paddingHorizontal: 4 },
  settingsLinkText: { fontSize: 13, fontWeight: "700" },
  trackRow: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  liveDot: { borderRadius: 5, height: 10, marginHorizontal: 4, width: 10 },
  smallButton: { borderRadius: 12, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 14, paddingVertical: 9 },
  joinButton: { borderWidth: 0 },
  smallButtonText: { fontSize: 13, fontWeight: "800" },
  controlsBlock: { gap: 12 },
  controls: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  chip: { alignItems: "center", flexDirection: "row", gap: 6, maxWidth: 220 },
  chipText: { flexShrink: 1 },
  refreshChip: { alignItems: "center", flexDirection: "row", gap: 5, paddingHorizontal: 6, paddingVertical: 9 },
  stationPanel: { borderWidth: 1, gap: 12, padding: 14 },
  panelButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  noticeGroup: { gap: 8 },
  errorChoose: { alignItems: "center", alignSelf: "center", flexDirection: "row", gap: 6, paddingVertical: 4 },
  loadingFaint: { opacity: 0.35 },
  loadingCircle: { alignItems: "center", borderRadius: HERO_SIZE / 2, borderWidth: 9, gap: 8, height: HERO_SIZE, justifyContent: "center", width: HERO_SIZE },
  loadingNote: { fontSize: 11, fontWeight: "700" },
  mapSlot: { flexGrow: 1, maxHeight: MAP_MAX_HEIGHT, minHeight: MAP_HEIGHT },
  moreNotices: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, paddingVertical: 2 },
  alwaysCard: { gap: 12, paddingHorizontal: 18, paddingVertical: 18 },
  alwaysStrip: { borderRadius: 16, borderWidth: 1, gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  alwaysHead: { alignItems: "center", flexDirection: "row", gap: 8 },
  alwaysButton: { alignSelf: "flex-start" },
  alwaysTitle: { fontSize: 13, fontWeight: "800" },
  promptButtons: { flexDirection: "row", gap: 10, marginTop: 2 },
  promptButton: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 12 },
  promptButtonText: { textAlign: "center" },
  statusStrong: { fontWeight: "700" },
  lockButton: { alignItems: "center", flexDirection: "row", gap: 6 },
});
