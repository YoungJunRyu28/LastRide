import { BottomNav } from "@/components/BottomNav";
import { MapCard, openTransitRoute } from "@/components/MapCard";
import { PremiumCard } from "@/components/PremiumCard";
import { Notice } from "@/components/RideUI";
import { Card, CountdownRing, IconButton } from "@/components/ui";
import { DIGITS } from "@/constants/type";
import { locationErrorText, useLastRide } from "@/context/LastRideContext";
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
import { Feather } from "@expo/vector-icons";
import {
  getTrainDisruptions,
  joinGroupTonight,
  type TrainDisruption,
} from "@workspace/api-client-react";
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

/** The ring empties over the last hour before leave-by. */
const RING_WINDOW_MS = 60 * 60 * 1000;
/** The countdown ring, and the start button that stands in for it until tonight is started. */
const HERO_SIZE = 140;

/** "1:05" above an hour (h:mm), "13:42" below it (mm:ss). */
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
    trainChoice,
    effectiveTrainChoice,
    trainChoices,
    setTrainChoice,
  } = useLastRide();
  const ja = language === "ja";
  const station = ja ? stationNameJa : stationName;
  const [disruptions, setDisruptions] = useState<TrainDisruption[]>([]);
  const [showOtherStations, setShowOtherStations] = useState(false);
  const clockMs = useSecondClock(nowMs, demoActive);
  // "Stop tracking" from the Android countdown notification opens last-ride://ride?stop=1.
  const { stop } = useLocalSearchParams<{ stop?: string }>();
  useEffect(() => {
    if (stop !== "1") return;
    if (trackingMode !== null) void stopTracking();
    router.setParams({ stop: undefined });
  }, [stop, trackingMode, stopTracking]);
  const { isPremium } = usePremium();
  const { tonightGroup, tonightOpenGroup, apply: applyGroup, memberOptions } = useGroups();
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

  const freshness = plan ? planFreshness(plan.computedAt, nowMs) : null;
  const planAge = plan ? planAgeMinutes(plan.computedAt, nowMs) : null;
  const leaveAt = plan ? recommendedLeaveTime(plan) : null;
  const msLeft = leaveAt !== null ? leaveAt - clockMs : null;
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
      : `to ${destinationName}`
    : ja
      ? "帰り先を設定"
      : "Set destination";
  const viaStation =
    plan && homeStationOption && !sameStation(plan.destination, homeStationOption)
      ? ja
        ? plan.destination.nameJa
        : plan.destination.name
      : null;

  const ringTone =
    status === "hurry" ? "destructive" : departed ? "muted" : "primary";
  const ringLabel = departed
    ? ja
      ? "終電"
      : "Last train"
    : ja
      ? "出発まで"
      : "Leave in";
  const ringValue = departed
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
          <IconButton
            icon="settings"
            label={ja ? "設定" : "Settings"}
            onPress={() => router.push("/settings")}
            testID="open-settings"
          />
        </View>

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
                    {ja ? `${station}を選択中` : `You picked ${station}`}
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

        {/* 終電 / 1本前 / 2本前: kept for tonight; a train that can't be made any more is greyed out */}
        {plan && !departed && trainChoices.length > 1 && (
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
                      option.catchable
                        ? ja
                          ? `${label} ${formatJstTime(option.departsAt)}発`
                          : `${label}, ${formatJstTime(option.departsAt)}`
                        : ja
                          ? `${label}は間に合いません`
                          : `${label}: too late`
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
                        { color: selected ? colors.primaryForeground : colors.subtle },
                      ]}
                    >
                      {option.catchable ? formatJstTime(option.departsAt) : ja ? "間に合わず" : "Too late"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {trainChoice > effectiveTrainChoice && (
              <Text style={[styles.note, styles.switchNote, { color: colors.mutedForeground }]}>
                {ja
                  ? `${trainChoiceLabel(trainChoice, true)}には間に合わないため、${trainChoiceLabel(effectiveTrainChoice, true)}にしています`
                  : `Too late for ${trainChoiceLabel(trainChoice, false).toLowerCase()}, so this is the ${effectiveTrainChoice ? trainChoiceLabel(effectiveTrainChoice, false).toLowerCase() : "last train"}`}
              </Text>
            )}
          </View>
        )}

        {/* Tonight at a glance: start tonight (or the countdown once started), the time to leave, and how late is too late */}
        <View style={styles.hero}>
          {isLocationReady && !departed && trackingMode === null ? (
            <Pressable
              testID="start-tracking"
              onPress={() => void startTracking()}
              accessibilityRole="button"
              accessibilityLabel={ja ? "今夜スタート。リマインダーをオンにして、移動に合わせて更新" : "Start tonight. Turns reminders on and follows you"}
              style={({ pressed }) => [
                styles.startCircle,
                { backgroundColor: colors.primary, shadowColor: colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Feather name="moon" size={28} color={colors.primaryForeground} />
              <Text maxFontSizeMultiplier={1.2} style={[styles.startTitle, { color: colors.primaryForeground }]}>
                {ja ? "今夜スタート" : "Start tonight"}
              </Text>
              <Text maxFontSizeMultiplier={1.2} style={[styles.startNote, { color: colors.primaryForeground }]}>
                {ja ? "タップで通知オン" : "Turns reminders on"}
              </Text>
            </Pressable>
          ) : (
            <CountdownRing
              size={HERO_SIZE}
              fraction={msLeft === null ? 0 : msLeft / RING_WINDOW_MS}
              label={ringLabel}
              value={ringValue}
              tone={ringTone}
              caption={trackingMode !== null && !departed ? (ja ? "● トラッキング中" : "● Tracking") : undefined}
            />
          )}
          <View style={styles.heroCopy}>
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
              {departed
                ? ja
                  ? "終電は発車しました"
                  : "The last train has left"
                : ja
                  ? "この時刻に出発"
                  : "Leave at"}
            </Text>
            <Text
              testID="leave-time"
              maxFontSizeMultiplier={1.3}
              style={[
                styles.leaveTime,
                { color: departed ? colors.mutedForeground : colors.primary },
              ]}
            >
              {leaveAt !== null ? formatJstTime(leaveAt) : "--:--"}
            </Text>
            {plan && (
              <Text style={[styles.heroMeta, { color: colors.subtle }]}>
                {ja ? `遅くとも ${formatJstTime(plan.leaveByMs)}` : `Latest ${formatJstTime(plan.leaveByMs)}`}
                {lastTrainSource === "sample" ? (ja ? "（仮）" : "*") : ""}
                {plan.lastTrain.approximate ? (ja ? "（目安）" : " (approx.)") : ""}
              </Text>
            )}
            {plan && freshness && (
              <Pressable
                testID="plan-freshness"
                disabled={freshness === "fresh"}
                onPress={() => void requestLocation()}
                accessibilityRole={freshness === "fresh" ? undefined : "button"}
                hitSlop={8}
                style={styles.freshness}
              >
                {freshness !== "fresh" && (
                  <Feather
                    name={freshness === "stale" ? "alert-triangle" : "refresh-cw"}
                    size={12}
                    color={
                      freshness === "stale"
                        ? colors.destructive
                        : colors.mutedForeground
                    }
                  />
                )}
                <Text
                  style={[
                    styles.note,
                    {
                      color:
                        freshness === "stale"
                          ? colors.destructive
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {planAge === 0
                    ? ja
                      ? "最新"
                      : "Up to date"
                    : ja
                      ? `${planAge}分前に更新`
                      : `Updated ${planAge} min ago`}
                  {freshness === "fresh"
                    ? ""
                    : ja
                      ? " · タップで更新"
                      : " · tap to refresh"}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {departed && (
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

        {plan && (
          <MapCard
            // The plan's own position until fresh GPS arrives (e.g. right after relaunch).
            you={userCoordinates ?? plan.coordinates}
            target={plan.station}
            stationTag={station}
            walkLabel={
              walkingMinutes
                ? ja
                  ? `徒歩${walkingMinutes}分`
                  : `${walkingMinutes} min walk`
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
          />
        )}

        {plan && (
          <Card style={styles.trainCard}>
            <View style={styles.trainRow}>
              <View style={[styles.lineBadge, { backgroundColor: colors.line }]}>
                <Feather name="navigation-2" size={14} color="#FFFFFF" />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {effectiveTrainChoice > 0 ? (
                    <Text style={{ color: colors.primary }}>{`${trainChoiceLabel(effectiveTrainChoice, ja)}  `}</Text>
                  ) : null}
                  <Text style={styles.digits}>{lastTrain}</Text>
                  {firstLeg
                    ? `  ${ja ? shortLineName(firstLeg.line) : (firstLeg.lineEn ?? shortLineName(firstLeg.line))}`
                    : ""}
                  {firstLeg
                    ? ja
                      ? ` ${firstLeg.to}方面`
                      : ` to ${firstLeg.toEn ?? firstLeg.to}`
                    : // No line details (Apple Maps): at least say where it leaves from.
                      ja
                      ? `  ${station}発`
                      : `  from ${station}`}
                </Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
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
                    // Apple doesn't say how many changes a route has.
                    plan.lastTrain.source === "apple"
                      ? null
                      : plan.lastTrain.transfers
                      ? ja
                        ? `乗換${plan.lastTrain.transfers}回`
                        : `${plan.lastTrain.transfers} transfer${plan.lastTrain.transfers > 1 ? "s" : ""}`
                      : ja
                        ? "乗換なし"
                        : "Direct",
                    plan.lastTrain.fareYen
                      ? `¥${plan.lastTrain.fareYen.toLocaleString("en-US")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </View>

            {(plan.lastTrain.legs?.length ?? 0) > 1 &&
              plan.lastTrain.legs!.map((leg) => (
                <View key={`${leg.line}-${leg.departsAt}`} style={styles.leg}>
                  <Text style={[styles.legTime, { color: colors.subtle }]}>
                    {formatJstTime(leg.departsAt)}
                  </Text>
                  <Text
                    style={[styles.note, styles.flex, { color: colors.mutedForeground }]}
                  >
                    {ja
                      ? `${leg.from} → ${leg.to} · ${shortLineName(leg.line)}`
                      : `${leg.fromEn ?? leg.from} → ${leg.toEn ?? leg.to} · ${leg.lineEn ?? shortLineName(leg.line)}`}
                  </Text>
                </View>
              ))}

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
                            ? `${name} · 徒歩${first.walkingMinutes}分 · 終電 ${formatJstTime(first.lastTrain.departsAt)}`
                            : `${name} · ${first.walkingMinutes} min walk · last ${formatJstTime(first.lastTrain.departsAt)}`;
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
                              ? `徒歩${option.walkingMinutes}分 · 終電 ${formatJstTime(option.lastTrain.departsAt)}`
                              : `${option.walkingMinutes} min walk · last train ${formatJstTime(option.lastTrain.departsAt)}`}
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
            {trackingMode !== null && (
              <>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.trackingFooter}>
                  <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                  <View style={styles.flex}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                      {ja ? "夜のトラッキング中" : "Tracking tonight"}
                    </Text>
                    <Text style={[styles.note, { color: colors.mutedForeground }]}>
                      {trackingMode === "background"
                        ? ja
                          ? "閉じても更新。終電後に自動で停止。"
                          : "Updates when closed; stops after the last train."
                        : nightLocationMode === "background" && backgroundAllowed === false
                          ? ja
                            ? "位置情報が「常に」ではないため、開いている間だけ更新します。"
                            : "Location isn’t “Always”, so this updates only while open."
                          : ja
                            ? "アプリを開いている間だけ更新します。"
                            : "Updates while the app is open."}
                    </Text>
                  </View>
                  <Pressable
                    testID="stop-tracking"
                    onPress={() => void stopTracking()}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.smallButton,
                      { borderColor: colors.input, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.smallButtonText, { color: colors.foreground }]}>
                      {ja ? "停止" : "Stop"}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </Card>
        )}

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


        {trackingMode === "foreground" && nightLocationMode === "background" && backgroundAllowed === false && (
          <Pressable
            testID="open-location-settings"
            onPress={() => void Linking.openSettings()}
            accessibilityRole="link"
            hitSlop={8}
            style={styles.settingsLink}
          >
            <Text style={[styles.settingsLinkText, { color: colors.primary }]}>
              {ja ? "設定で位置情報を「常に」にする ›" : "Set location to “Always” in Settings ›"}
            </Text>
          </Pressable>
        )}

        {!isLocationReady && (
          <Pressable
            testID="enable-location"
            // After a refusal iOS won't ask again: only Settings can turn location on.
            onPress={() =>
              locationError === "permission" ? void Linking.openSettings() : void requestLocation()
            }
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
            <Feather name="crosshair" color={colors.primary} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {isLocating
                  ? ja
                    ? "最寄り駅を検索中…"
                    : "Finding your closest station…"
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
  startNote: { fontSize: 11, fontWeight: "700", opacity: 0.8 },
  trainSwitch: { borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 4, padding: 4 },
  trainSegment: { alignItems: "center", borderRadius: 10, flex: 1, justifyContent: "center", minHeight: 46, paddingVertical: 4 },
  trainSegmentLabel: { fontSize: 11, fontWeight: "800" },
  trainSegmentTime: { fontFamily: DIGITS, fontSize: 15 },
  switchNote: { marginTop: 6, paddingHorizontal: 4 },
  trackingFooter: { alignItems: "center", flexDirection: "row", gap: 10 },
  heroCopy: { flex: 1, gap: 2 },
  heroLabel: { fontSize: 12, fontWeight: "700" },
  leaveTime: { fontFamily: DIGITS, fontSize: 60, letterSpacing: -1.5, lineHeight: 64 },
  heroMeta: { fontSize: 13, fontWeight: "600" },
  freshness: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  promptRow: { alignItems: "center", borderRadius: 18, flexDirection: "row", gap: 12, padding: 15 },
  trainCard: { borderWidth: 1, gap: 12, padding: 16 },
  trainRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  lineBadge: { alignItems: "center", borderRadius: 8, height: 30, justifyContent: "center", width: 30 },
  digits: { fontFamily: DIGITS },
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
});
