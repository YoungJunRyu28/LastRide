import { BottomNav } from "@/components/BottomNav";
import { MapCard, openInMaps } from "@/components/MapCard";
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
import {
  dismissLeaveCard,
  leaveCardFor,
  readPromptState,
  type PromptState,
} from "@/lib/premiumPrompts";
import { formatJstTime, serviceDate } from "@/lib/time";
import { shortLineName } from "@/lib/timetable";
import { Feather } from "@expo/vector-icons";
import {
  getTrainDisruptions,
  type TrainDisruption,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The ring empties over the last hour before leave-by. */
const RING_WINDOW_MS = 60 * 60 * 1000;

/** "1:05" above an hour (h:mm), "13:42" below it (mm:ss). */
function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Ticks every second so the countdown moves; the app clock only ticks every 10s. */
function useSecondClock(appNowMs: number, demoActive: boolean) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (demoActive) return;
    const base = Date.now();
    setOffset(0);
    const timer = setInterval(() => setOffset(Date.now() - base), 1000);
    return () => clearInterval(timer);
  }, [appNowMs, demoActive]);
  return demoActive ? appNowMs : appNowMs + offset;
}

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
  const { tonightGroup } = useGroups();
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  useEffect(() => {
    void readPromptState().then(setPromptState);
  }, []);

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
  const premiumCard = tonightGroup
    ? null
    : leaveCardFor({ isPremium, status, state: promptState, nowMs });
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
            <Text style={[styles.brand, { color: colors.mutedForeground }]}>
              LASTRIDE <Text style={styles.brandJa}>帰り時</Text>
            </Text>
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

        {/* Tonight at a glance: the countdown, the time to leave, and how late is too late */}
        <View style={styles.hero}>
          <CountdownRing
            fraction={msLeft === null ? 0 : msLeft / RING_WINDOW_MS}
            label={ringLabel}
            value={ringValue}
            tone={ringTone}
          />
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
                {ja
                  ? `遅くとも ${formatJstTime(plan.leaveByMs)} · 終電 ${lastTrain}`
                  : `Latest ${formatJstTime(plan.leaveByMs)} · last train ${lastTrain}`}
                {lastTrainSource === "sample" ? (ja ? "（仮）" : "*") : ""}
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
            you={userCoordinates}
            target={plan.station}
            stationTag={station}
            walkLabel={
              walkingMinutes
                ? ja
                  ? `徒歩${walkingMinutes}分`
                  : `${walkingMinutes} min walk`
                : undefined
            }
            onPress={() =>
              openInMaps({
                latitude: plan.station.latitude,
                longitude: plan.station.longitude,
                name: ja ? plan.station.nameJa : plan.station.name,
              })
            }
            accessibilityLabel={
              ja
                ? `${station}駅まで徒歩${walkingMinutes ?? "—"}分。地図アプリで開く`
                : `${walkingMinutes ?? "—"} min walk to ${station}. Open in Maps`
            }
            openLabel={ja ? "地図アプリで開く" : "Open in Maps"}
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
                  <Text style={styles.digits}>{lastTrain}</Text>
                  {firstLeg
                    ? `  ${ja ? shortLineName(firstLeg.line) : (firstLeg.lineEn ?? shortLineName(firstLeg.line))}`
                    : ""}
                  {firstLeg
                    ? ja
                      ? ` ${firstLeg.to}方面`
                      : ` to ${firstLeg.toEn ?? firstLeg.to}`
                    : ""}
                </Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {[
                    arrivalMs
                      ? ja
                        ? `${formatJstTime(arrivalMs)} ${destination}着`
                        : `${destination} ${formatJstTime(arrivalMs)}`
                      : null,
                    plan.lastTrain.transfers
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
          </Card>
        )}

        {tonightGroup && (
          <Pressable
            testID="group-strip"
            onPress={() =>
              router.push({ pathname: "/group/[id]", params: { id: tonightGroup.id } })
            }
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.trackRow,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="users" color={colors.primary} size={18} />
            <Text numberOfLines={1} style={[styles.rowTitle, styles.flex, { color: colors.foreground }]}>
              {tonightGroup.name}
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja
                  ? ` · 今夜${tonightGroup.tonight.participants.length}人${nextInGroup?.leaveBy ? ` · 次は${nextInGroup.displayName}さん ${formatJstTime(Date.parse(nextInGroup.leaveBy))}` : ""}`
                  : ` · ${tonightGroup.tonight.participants.length} tonight${nextInGroup?.leaveBy ? ` · next: ${nextInGroup.displayName} ${formatJstTime(Date.parse(nextInGroup.leaveBy))}` : ""}`}
              </Text>
            </Text>
            <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
          </Pressable>
        )}

        {premiumCard && leaveAt !== null && (
          <PremiumCard
            variant={premiumCard}
            ja={ja}
            leaveAt={formatJstTime(leaveAt)}
            countdown={ringValue}
            station={station}
            destination={destination}
            onDismiss={() => {
              void dismissLeaveCard(nowMs);
              setPromptState((state) =>
                state ? { ...state, cardDismissedNight: serviceDate(nowMs) } : state,
              );
            }}
          />
        )}

        {isLocationReady &&
          (!departed || trackingMode !== null) &&
          (trackingMode === null ? (
            <Pressable
              testID="start-tracking"
              onPress={() => void startTracking()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.trackRow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Feather name="moon" color={colors.mutedForeground} size={18} />
              <View style={styles.flex}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {ja ? "夜のトラッキング" : "Night-out tracking"}
                </Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {ja
                    ? "リマインダーをオンにし、移動に合わせて更新"
                    : "Reminders on, and your plan follows you"}
                </Text>
              </View>
              <View style={[styles.smallButton, styles.startButton, { backgroundColor: colors.primary }]}>
                <Text style={[styles.smallButtonText, { color: colors.primaryForeground }]}>
                  {ja ? "開始" : "Start"}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              testID="stop-tracking"
              onPress={() => void stopTracking()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.trackRow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
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
                    : ja
                      ? "アプリを開いている間だけ更新します。"
                      : "Updates while the app is open."}
                </Text>
              </View>
              <View style={[styles.smallButton, { borderColor: colors.input }]}>
                <Text style={[styles.smallButtonText, { color: colors.foreground }]}>
                  {ja ? "停止" : "Stop"}
                </Text>
              </View>
            </Pressable>
          ))}

        {!isLocationReady && (
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
  brand: { fontSize: 11, fontWeight: "800", letterSpacing: 1.6 },
  brandJa: { letterSpacing: 0 },
  destination: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, marginTop: 2 },
  destinationText: { flexShrink: 1, fontSize: 22, fontWeight: "800" },
  banner: { alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  hero: { alignItems: "center", flexDirection: "row", gap: 18, marginVertical: 4 },
  heroCopy: { flex: 1, gap: 2 },
  heroLabel: { fontSize: 12, fontWeight: "700" },
  leaveTime: { fontFamily: DIGITS, fontSize: 48, letterSpacing: -1, lineHeight: 54 },
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
  trackRow: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  liveDot: { borderRadius: 5, height: 10, marginHorizontal: 4, width: 10 },
  smallButton: { borderRadius: 12, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 14, paddingVertical: 9 },
  startButton: { borderWidth: 0 },
  smallButtonText: { fontSize: 13, fontWeight: "800" },
});
