import { BottomNav } from "@/components/BottomNav";
import { MapCard, openTransitRoute, openWalkingRoute } from "@/components/MapCard";
import { PremiumCard } from "@/components/PremiumCard";
import { Notice } from "@/components/RideUI";
import { Card, CountdownRing, IconButton } from "@/components/ui";
import { DIGITS } from "@/constants/type";
import { locationErrorText, useLastRide } from "@/context/LastRideContext";
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
import { phaseAt, phaseLabel } from "@/lib/nightPhase";
import { TimelineRail } from "@/components/TimelineRail";
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
  Alert,
  AppState,
  Linking,
  Platform,
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
const HERO_SIZE = 140;

/** "1:05" above an hour (h:mm), "13:42" below it (mm:ss). */
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
    locationError,
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
  const [showOtherStations, setShowOtherStations] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const clockMs = useSecondClock(nowMs, demoActive);
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
  // 今夜スタート starts tracking, not just notifications: say how, per the 夜の位置情報 setting.
  const startNote =
    nightLocationMode === "background" && backgroundAllowed !== false
      ? { ja: "追跡と通知\n閉じても更新", en: "Tracking + reminders\nalso when closed" }
      : nightLocationMode === "ask"
        ? { ja: "追跡と通知を\n開始", en: "Starts tracking\n+ reminders" }
        : { ja: "追跡と通知\n開いている間", en: "Tracking + reminders\nwhile open" };
  const confirmStop = () => {
    if (sharingTonight.length === 0) {
      void stopTracking();
      return;
    }
    const names = sharingTonight.map((group) => group.name).join(ja ? "、" : ", ");
    Alert.alert(
      ja ? "グループへの共有も止めますか？" : "Stop sharing with your group too?",
      ja
        ? `${names}に今夜の出発時刻を共有しています。トラッキングを止めると、時刻は更新されなくなります。`
        : `You’re sharing tonight’s leave time with ${names}. Once tracking stops, it won’t be updated.`,
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
  const canRefresh = !!plan && !isLocating && nowMs - plan.computedAt >= REFRESH_COOLDOWN_MS;
  const leaveAt = plan ? recommendedLeaveTime(plan) : null;
  // What the ring counts, the same as the widgets and the Live Activity: the
  // leave time, then (on the way) the train's departure.
  const phase = plan ? phaseAt(plan, clockMs) : null;
  const msLeft = phase ? phase.countdownTo - clockMs : null;
  const departed = status === "departed";

  useEffect(() => {
    const legs = plan?.lastTrain.legs ?? [];
    if (!apiBaseUrl || lastTrainSource !== "live" || legs.length === 0) {
      setDisruptions([]);
      return;
    }
    const lines = [...new Set(legs.map((leg) => leg.line).filter(Boolean))];
    let active = true;
    void getTrainDisruptions({ lines: lines.join(":") })
      .then((items) => {
        if (active) setDisruptions(items);
      })
      .catch(() => {
        if (active) setDisruptions([]);
      });
    return () => {
      active = false;
    };
  }, [plan?.computedAt, lastTrainSource]);

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
      ? "帰り先を設定"
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

  const firstLeg = plan?.lastTrain.legs?.[0];
  const arrivalMs = plan?.arriveHomeMs ?? plan?.lastTrain.arrivesAt;
  const otherStations = plan?.alternatives ?? [];
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
            paddingTop: insets.top + (Platform.OS === "web" ? 24 : 8),
            paddingBottom: 28,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <View style={styles.flex}>
            <Pressable
              testID="edit-destination"
              onPress={() => router.push("/destinations")}
              accessibilityRole="button"
              accessibilityLabel={
                ja ? `帰り先：${destinationLabel}。変更` : `${destinationLabel}. Change`
              }
              hitSlop={8}
              style={({ pressed }) => [
                styles.destination,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text
                numberOfLines={1}
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
                ? `固定した${lockFallback.nameJa}駅からは帰れないため、自動で選んでいます`
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
            const gain = Math.round(
              (recommendedLeaveTime(plan.autoPick) -
                recommendedLeaveTime(plan)) /
                60000,
            );
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
                        ? `自動なら${autoName}で${gain}分遅く出られます。`
                        : `${autoName} would give you ${gain} more minutes.`
                      : ja
                        ? "自動での駅の切り替えは止まっています。"
                        : "Automatic station switching is paused."}
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
                {ja ? "通知がオフになっています" : "Notifications are off"}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja
                  ? "出発時刻のお知らせが届きません。タップして設定で許可してください。"
                  : "You won’t be told when to leave. Tap to allow them in Settings."}
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
                {ja ? "今夜のリマインダーとトラッキングは止めました。" : "Tonight’s reminders and tracking are off."}
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

        {plan && !departed && !onBoard && trainChoices.length > 1 && (
          <View>
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
                    onPress={() => setTrainChoice(option.choice)}
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
            {trainChoiceOverride && leaveAt !== null ? (
              <Text style={[styles.note, styles.switchNote, { color: colors.mutedForeground }]}>
                {ja
                  ? `駅が${station}駅に変わり、${trainChoiceLabel(trainChoice, true)}の出る時刻を過ぎていたため、${trainChoiceLabel(effectiveTrainChoice, true)}（${formatJstTime(leaveAt)}に出る）にしています`
                  : `Your station changed to ${station} and it was too late for the ${trainChoiceLabel(trainChoice, false).toLowerCase()} train there, so this is the ${trainChoiceLabel(effectiveTrainChoice, false).toLowerCase()} (leave at ${formatJstTime(leaveAt)})`}
              </Text>
            ) : trainChoice > effectiveTrainChoice && !boardingQuestion && (
              <Text style={[styles.note, styles.switchNote, { color: colors.mutedForeground }]}>
                {ja
                  ? `${trainChoiceLabel(trainChoice, true)}は発車したため、${trainChoiceLabel(effectiveTrainChoice, true)}にしています`
                  : `${trainChoiceLabel(trainChoice, false)} has left, so this is the ${effectiveTrainChoice ? trainChoiceLabel(effectiveTrainChoice, false).toLowerCase() : "last train"}`}
              </Text>
            )}
          </View>
        )}

        {/* Tonight at a glance: start tonight (or the countdown once started), the time to leave, and how late is too late */}
        <View style={styles.hero}>
          {isLocationReady && !departed && !onBoard && trackingMode === null ? (
            <Pressable
              testID="start-tracking"
              onPress={() => void startTracking()}
              accessibilityRole="button"
              accessibilityLabel={ja ? `今夜スタート。${startNote.ja.replace("\n", "、")}` : `Start tonight. ${startNote.en.replace("\n", ", ")}`}
              style={({ pressed }) => [
                styles.startCircle,
                { backgroundColor: colors.primary, shadowColor: colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Feather name="moon" size={28} color={colors.primaryForeground} />
              <Text maxFontSizeMultiplier={1.2} style={[styles.startTitle, { color: colors.primaryForeground }]}>
                {ja ? "今夜スタート" : "Start tonight"}
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
          <View style={styles.heroCopy}>
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
              {onBoard
                ? ja
                  ? "着く時刻（目安）"
                  : "Arriving ~"
                : departed
                ? ja
                  ? "終電は発車しました"
                  : "The last train has left"
                : ja
                  ? "ここを出る時刻"
                  : "Leave at"}
            </Text>
            <Text
              testID="leave-time"
              maxFontSizeMultiplier={1.3}
              // One line: at 66pt it fits beside the circle even on an iPhone SE (375pt wide).
              numberOfLines={1}
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
            {plan && !onBoard && (
              <Text style={[styles.heroMeta, { color: colors.subtle }]}>
                {ja ? `遅くとも ${formatJstTime(plan.leaveByMs)}` : `Latest ${formatJstTime(plan.leaveByMs)}`}
                {lastTrainSource === "sample" ? (ja ? "（仮）" : "*") : ""}
                {plan.lastTrain.approximate ? (ja ? "（目安）" : " (approx.)") : ""}
              </Text>
            )}
          </View>
        </View>

        {/* Tonight on one line, then what the app is doing: tracking (with 停止) or when it last checked (with 更新) */}
        {plan && !departed && !onBoard && <TimelineRail plan={plan} nowMs={clockMs} ja={ja} />}
        {/* Also after the last train: moving may reach a station with a later one, so 更新 stays. */}
        {plan && freshness && !onBoard && (
          <View style={styles.statusLine}>
            <Pressable
              testID="plan-freshness"
              // Refresh any time, except straight after a lookup (no hammering Apple Maps).
              disabled={!canRefresh}
              onPress={() => void requestLocation()}
              accessibilityRole={canRefresh ? "button" : undefined}
              accessibilityHint={canRefresh ? (ja ? "タップで更新" : "Tap to refresh") : undefined}
              hitSlop={8}
              style={[styles.flex, styles.freshness]}
            >
              {trackingMode !== null && <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />}
              <Text
                numberOfLines={1}
                style={[styles.note, { color: freshness === "stale" ? colors.destructive : colors.mutedForeground }]}
              >
                {trackingMode !== null ? (
                  <>
                    <Text style={[styles.statusStrong, { color: colors.foreground }]}>{ja ? "トラッキング中" : "Tracking"}</Text>
                    {planAge === 0
                      ? ja
                        ? " · たった今確認"
                        : " · checked just now"
                      : ja
                        ? ` · ${planAge}分前に確認`
                        : ` · checked ${planAge} min ago`}
                  </>
                ) : ja ? (
                  `${formatJstTime(plan.computedAt)}に確認`
                ) : (
                  `Checked ${formatJstTime(plan.computedAt)}`
                )}
              </Text>
              {trackingMode !== null && canRefresh && (
                <Feather
                  name={freshness === "stale" ? "alert-triangle" : "refresh-cw"}
                  size={12}
                  color={freshness === "stale" ? colors.destructive : colors.mutedForeground}
                />
              )}
            </Pressable>
            {trackingMode !== null ? (
              <Pressable
                testID="stop-tracking"
                onPress={confirmStop}
                accessibilityRole="button"
                style={({ pressed }) => [styles.smallButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.smallButtonText, { color: colors.foreground }]}>{ja ? "停止" : "Stop"}</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="refresh-plan"
                disabled={!canRefresh}
                onPress={() => void requestLocation()}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.smallButton,
                  styles.lockButton,
                  { borderColor: colors.input, opacity: !canRefresh ? 0.4 : pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="refresh-cw" size={13} color={colors.foreground} />
                <Text style={[styles.smallButtonText, { color: colors.foreground }]}>{ja ? "更新" : "Refresh"}</Text>
              </Pressable>
            )}
          </View>
        )}
        {/* Tracking only while open: a compact suggestion to update when closed
            (iOS "Always"), closable for tonight; after that just the note. */}
        {trackingMode === "foreground" && alwaysCard.show && (
          <View style={[styles.alwaysStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="moon" color={colors.primary} size={16} />
            <View style={styles.flex}>
              <Text numberOfLines={1} style={[styles.alwaysTitle, { color: colors.foreground }]}>
                {ja ? "開いている間だけ更新中" : "Updating only while open"}
              </Text>
              <Text numberOfLines={2} style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? "閉じている間は駅や時刻が更新されません" : "Your station and times won’t update while closed"}
              </Text>
            </View>
            <Pressable
              testID="always-card-enable"
              onPress={() =>
                void switchTrackingToBackground().then((ok) => {
                  if (!ok) void Linking.openSettings();
                })
              }
              accessibilityRole="button"
              style={({ pressed }) => [styles.smallButton, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.smallButtonText, { color: colors.primaryForeground }]}>{ja ? "閉じても更新" : "Keep updating"}</Text>
            </Pressable>
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
        )}
        {trackingMode === "foreground" && !alwaysCard.show && (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {nightLocationMode === "background" && backgroundAllowed === false
              ? ja
                ? "位置情報が「常に」ではないため、開いている間だけ更新します。"
                : "Location isn’t “Always”, so this updates only while open."
              : ja
                ? "アプリを開いている間だけ更新します。"
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
                {ja ? "終電に間に合いませんでしたか？" : "Missed the last train?"}
              </Text>
              <Text style={[styles.note, { color: colors.primaryForeground }]}>
                {ja
                  ? "始発・タクシー・朝まで過ごせる場所を見る"
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
                  <Text numberOfLines={1} style={[styles.note, { color: joined ? colors.primary : colors.mutedForeground }]}>
                    {joined
                      ? ja
                        ? `● 出発時刻を共有中 · 今夜${count}人${nextInGroup?.leaveBy ? ` · 次は${nextInGroup.displayName}さん ${formatJstTime(Date.parse(nextInGroup.leaveBy))}` : ""}`
                        : `● Sharing your leave time · ${count} tonight${nextInGroup?.leaveBy ? ` · next: ${nextInGroup.displayName} ${formatJstTime(Date.parse(nextInGroup.leaveBy))}` : ""}`
                      : ja
                        ? `今夜の会がはじまりました · ${count}人参加中`
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

        {/* Still finding tonight's route: hold the places of the map and the train card */}
        {!plan && isLocating && (
          <>
            <PlaceholderBlock height={140} />
            <PlaceholderBlock height={120} />
          </>
        )}

        {plan && (
          <MapCard
            height={140}
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
                ? '徒歩時間は直線距離からの概算です。迂回路・駅の出入口を地図で確認してください。安全のため出発時刻を早めています。 徒歩経路を開く ↗'
                : 'Walking time is an estimate, not a verified path. Allow for detours and station entrances. Departure is moved earlier as a precaution. Open walking directions ↗'}
            </Text>
          </Pressable>
        )}

        {plan && (
          <Card style={styles.trainCard}>
            <View style={styles.trainRow}>
              <View style={[styles.lineBadge, { backgroundColor: colors.line }]}>
                <Feather name="navigation-2" size={14} color="#FFFFFF" />
              </View>
              <View style={styles.flex}>
                {/* The train's time is the one to make in the end: shown large. */}
                <View style={styles.trainTimeRow}>
                  <Text style={[styles.trainTime, { color: colors.foreground }]}>{lastTrain}</Text>
                  <Text style={[styles.trainTimeUnit, { color: colors.foreground }]}>{ja ? "発" : "dep."}</Text>
                  <Text style={[styles.trainStation, { color: colors.foreground }]} numberOfLines={1}>
                    {ja ? `${station}駅` : station}
                  </Text>
                  {effectiveTrainChoice > 0 ? (
                    <Text style={[styles.trainChoiceTag, { color: colors.primary, borderColor: colors.primary }]}>
                      {trainChoiceLabel(effectiveTrainChoice, ja)}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.heroMeta, { color: colors.mutedForeground }]}>
                  {[
                    arrivalMs
                      ? // Apple's arrival can be at the station's map point (a walk out
                        // past the gates) when the station place wasn't found: say so.
                        plan.lastTrain.source === "apple" && !plan.lastTrain.arrivesAtStation && !plan.walkHomeMinutes
                        ? ja
                          ? `${formatJstTime(arrivalMs)}ごろ ${destination}（駅を出る時刻）`
                          : `${destination} ~${formatJstTime(arrivalMs)} (out of the station)`
                        : ja
                          ? `${formatJstTime(arrivalMs)} ${destination}着`
                          : `${destination} ${formatJstTime(arrivalMs)}`
                      : null,
                    // Heading for an earlier train: the last train is the fallback.
                    plan.nightLastTrain
                      ? ja
                        ? `乗れなければ終電 ${formatJstTime(plan.nightLastTrain.departsAt)}`
                        : `else last train ${formatJstTime(plan.nightLastTrain.departsAt)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </View>

            {/* The route, folded: changes, lines and fare; tap for each leg */}
            {(() => {
              const legs = plan.lastTrain.legs ?? [];
              const lines = legs.length > 1
                ? legs.map((leg) => (ja ? shortLineName(leg.line) : leg.lineEn ?? shortLineName(leg.line))).join(" → ")
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
              if (!summary) return null;
              const foldable = legs.length > 1;
              return (
                <>
                  <Pressable
                    testID="toggle-route"
                    disabled={!foldable}
                    onPress={() => setShowRoute((value) => !value)}
                    accessibilityRole={foldable ? "button" : undefined}
                    accessibilityState={foldable ? { expanded: showRoute } : undefined}
                    style={({ pressed }) => [styles.routeToggle, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text numberOfLines={showRoute ? undefined : 1} style={[styles.note, styles.flex, { color: colors.subtle }]}>
                      {summary}
                    </Text>
                    {foldable && (
                      <Feather name={showRoute ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
                    )}
                  </Pressable>
                  {showRoute &&
                    legs.map((leg) => (
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
                </>
              );
            })()}

            {plan.lastTrain.source === "live" && (
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

            {otherStations.length > 0 && (
              <>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Pressable
                  testID="toggle-other-stations"
                  onPress={() => setShowOtherStations((value) => !value)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showOtherStations }}
                  style={({ pressed }) => [
                    styles.otherHead,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View style={styles.flex}>
                    <Text style={[styles.otherLabel, { color: colors.mutedForeground }]}>
                      {ja ? "ほかの駅から" : "Other stations"}
                    </Text>
                    {!showOtherStations && (
                      <Text
                        numberOfLines={1}
                        style={[styles.note, { color: colors.subtle }]}
                      >
                        {(() => {
                          const first = otherStations[0];
                          const name = ja ? first.station.nameJa : first.station.name;
                          return ja
                            ? `${name} · 徒歩${first.walkingMinutes}分${first.walkingSource === 'routed' ? '' : '（推定）'} · 終電 ${formatJstTime(first.lastTrain.departsAt)}`
                            : `${name} · ${first.walkingMinutes} min walk${first.walkingSource === 'routed' ? '' : ' (estimate)'} · last ${formatJstTime(first.lastTrain.departsAt)}`;
                        })()}
                      </Text>
                    )}
                  </View>
                  <Feather
                    name={showOtherStations ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
                {showOtherStations &&
                  otherStations.map((option) => {
                    const isAutoPick =
                      plan.pinned &&
                      option.station.nameJa === plan.autoPick.station.nameJa;
                    const name = ja ? option.station.nameJa : option.station.name;
                    return (
                      <Pressable
                        key={option.station.nameJa}
                        testID={`use-station-${option.station.nameJa}`}
                        onPress={() =>
                          setPinnedStation(isAutoPick ? null : option.station)
                        }
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
                                {ja ? "  自動のおすすめ" : "  Automatic pick"}
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
                {showOtherStations && (
                  <Text style={[styles.note, { color: colors.mutedForeground }]}>
                    {ja
                      ? "タップでその駅に切り替えます。自動では、10分以上遅く出られる場合のみ遠い駅を選びます。"
                      : "Tap to switch. On automatic, a farther station is only chosen if it gives you 10+ more minutes."}
                  </Text>
                )}
              </>
            )}
            {/* Lock tonight's station: this one, or any station by search */}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.lockRow}>
              {!plan.pinned && (
                <Pressable
                  testID="lock-station"
                  onPress={() => void chooseDepartureStation(plan.station)}
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
                onPress={() => router.push("/departure-station")}
                accessibilityRole="button"
                style={({ pressed }) => [styles.smallButton, styles.lockButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="search" size={13} color={colors.foreground} />
                <Text style={[styles.smallButtonText, { color: colors.foreground }]}>
                  {ja ? "駅を選ぶ" : "Choose station"}
                </Text>
              </Pressable>
            </View>

          </Card>
        )}




        {locationError !== "permission" && !isLocationReady && (
          <Pressable
            testID="enable-location"
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
            <Feather name={locationError === "near-home" && !isLocating ? "home" : "crosshair"} color={colors.primary} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {isLocating
                  ? ja
                    ? "最寄り駅を検索中…"
                    : "Finding your closest station…"
                  : locationError === "near-home"
                    ? ja
                      ? "帰り先の近くにいます"
                      : "You're near home"
                    : ja
                      ? "位置情報を使う"
                      : "Use my location"}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {locationError
                  ? locationErrorText(locationError, ja)
                  : ja
                    ? "最寄り駅と徒歩時間を正確にします"
                    : "Find your closest station and walking time."}
              </Text>
            </View>
          </Pressable>
        )}

        {plan?.lastTrain.approximate && (
          <Notice
            icon="info"
            title={ja ? "終電の時刻は目安です" : "The last train time is approximate"}
            body={
              ja
                ? "この区間はApple Mapsの推定で、電車か徒歩かを確認できませんでした。乗換案内アプリでも確認してください。"
                : "This route uses an Apple Maps estimate that couldn’t be confirmed as a train. Please double-check in a route app."
            }
          />
        )}

        {approximateLocation && (
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
                {ja ? "正確な位置情報がオフです" : "Precise Location is off"}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja
                  ? "おおよその位置しか分からないため、最寄り駅や徒歩時間がずれることがあります。設定で「正確な位置情報」をオンにしてください。"
                  : "LastRide only knows your rough area, so the nearest station and walking time may be off. Turn on Precise Location in Settings."}
              </Text>
            </View>
            <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
          </Pressable>
        )}

        {lastTrainSource === "sample" && (
          <Notice
            icon="info"
            title={ja ? "サンプルの時刻です" : "Sample train times"}
            body={
              ja
                ? "時刻表データはまだ接続されていません。表示中の終電時刻は仮の値で、実際のダイヤではありません。"
                : "Live timetables aren’t connected yet. The last train shown is a placeholder, not a real schedule."
            }
          />
        )}

        {/* Premium last: below everything for tonight (only shown without Premium) */}
        {premiumCard && leaveAt !== null && (
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

        {liveActivitiesOff && !departed && (
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
                  ? "タップして設定で「ライブアクティビティ」をオンにしてください。戻ると自動で表示されます。"
                  : "Tap and turn on Live Activities in Settings. It appears by itself when you come back."}
              </Text>
            </View>
            <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
          </Pressable>
        )}
      </ScrollView>
      <BottomNav language={language} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, paddingHorizontal: 20 },
  flex: { flex: 1, gap: 2 },
  topbar: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  destination: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, marginTop: 2 },
  destinationText: { flexShrink: 1, fontSize: 22, fontWeight: "800" },
  banner: { alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  hero: { alignItems: "center", flexDirection: "row", gap: 16, marginVertical: 4 },
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
  switchNote: { marginTop: 6, paddingHorizontal: 4 },
  heroCopy: { flex: 1, gap: 2 },
  heroLabel: { fontSize: 12, fontWeight: "700" },
  leaveTime: { fontFamily: DIGITS, fontSize: 66, letterSpacing: -1.5, lineHeight: 70 },
  heroMeta: { fontSize: 13, fontWeight: "600" },
  freshness: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  promptRow: { alignItems: "center", borderRadius: 18, flexDirection: "row", gap: 12, padding: 15 },
  trainCard: { borderWidth: 1, gap: 12, padding: 16 },
  trainRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  lineBadge: { alignItems: "center", borderRadius: 8, height: 30, justifyContent: "center", width: 30 },
  digits: { fontFamily: DIGITS },
  trainTimeRow: { alignItems: "baseline", flexDirection: "row", gap: 4 },
  trainTime: { fontFamily: DIGITS, fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  trainTimeUnit: { fontSize: 15, fontWeight: "700" },
  trainChoiceTag: { borderRadius: 6, borderWidth: 1, fontSize: 11, fontWeight: "800", marginLeft: 6, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1 },
  trainStation: { flexShrink: 1, fontSize: 15, fontWeight: "700", marginLeft: 8 },
  leg: { alignItems: "center", flexDirection: "row", gap: 12 },
  legTime: { flexShrink: 0, fontFamily: DIGITS, fontSize: 15, width: 48 },
  divider: { height: 1 },
  otherHead: { alignItems: "center", flexDirection: "row", gap: 10 },
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
  lockRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  alwaysCard: { gap: 12, paddingHorizontal: 18, paddingVertical: 18 },
  alwaysStrip: { alignItems: "center", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  alwaysTitle: { fontSize: 13, fontWeight: "800" },
  promptButtons: { flexDirection: "row", gap: 10, marginTop: 2 },
  promptButton: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 12 },
  promptButtonText: { textAlign: "center" },
  routeToggle: { alignItems: "center", flexDirection: "row", gap: 6 },
  statusLine: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: -4 },
  statusStrong: { fontWeight: "700" },
  lockButton: { alignItems: "center", flexDirection: "row", gap: 6 },
});
