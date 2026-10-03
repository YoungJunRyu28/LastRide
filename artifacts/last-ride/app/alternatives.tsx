import { BottomNav } from "@/components/BottomNav";
import { RailwayMark } from "@/components/RideUI";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import { apiBaseUrl, communityFallbacksEnabled } from "@/lib/api";
import { STATION_BUFFER_MINUTES } from "@/lib/planner";
import {
  distanceBetween,
  overpassQuery,
  walkingRoute,
  type WalkingRoute,
} from "@/lib/stations";
import {
  formatDuration,
  formatJstDateTime,
  formatJstTime,
  MINUTE_MS,
  serviceDate,
} from "@/lib/time";
import {
  formatPriceRange,
  formatYen,
  stayPrice,
  type StayKind,
} from "@/lib/stayPricing";
import { shortLineName } from "@/lib/timetable";
import { Feather } from "@expo/vector-icons";
import {
  getNearbyPlaces,
  getPartwayTrainTaxi,
  getTaxiEstimate,
  type PartwayTrainTaxi,
} from "@workspace/api-client-react";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type StayOption = {
  name: string;
  kind: StayKind;
  latitude: number;
  longitude: number;
  distance: number;
  walkMinutes: number;
  phone?: string;
  open24h?: boolean;
};

type TaxiEstimate = {
  fareYen: number;
  durationMinutes: number;
  distanceKm: number;
  lateNight: boolean;
};

/** Home is only walkable within this distance; beyond it the option is hidden. */
const WALKABLE_METERS = 6000;
const PER_KIND = 2;
const PREVIEW_STAYS = 3;
const MAX_STAYS = 8;

/** Cheapest a place could plausibly cost: the bottom of its estimated range. */
function lowestPrice(stay: StayOption) {
  return stayPrice(stay.name, stay.kind).range.from;
}

const STAY_META: Record<
  StayKind,
  { icon: React.ComponentProps<typeof Feather>["name"]; ja: string; en: string }
> = {
  "net-cafe": { icon: "monitor", ja: "ネットカフェ", en: "Internet café" },
  karaoke: { icon: "music", ja: "カラオケ", en: "Karaoke" },
  capsule: { icon: "moon", ja: "カプセルホテル", en: "Capsule hotel" },
  hotel: { icon: "briefcase", ja: "ホテル", en: "Hotel" },
};

const KIND_ORDER: StayKind[] = ["net-cafe", "karaoke", "capsule", "hotel"];

/** Japanese taxis add a 20% surcharge between 22:00 and 05:00. */
function isLateNight(nowMs: number) {
  return (
    Number(formatJstTime(nowMs).slice(0, 2)) >= 22 ||
    Number(formatJstTime(nowMs).slice(0, 2)) < 5
  );
}

/** Fallback when the API server is unavailable: Tokyo-area meter (¥500 first 1.096 km, ¥100 per 255 m). */
function estimateTaxiFare(distanceMeters: number, lateNight: boolean) {
  const metered =
    500 + Math.ceil(Math.max(0, distanceMeters - 1096) / 255) * 100;
  return lateNight ? metered * 1.2 : metered;
}

/** Streets add roughly 30% to the straight-line distance; 80 m per minute is a normal pace. */
function walkMinutesFor(straightMeters: number) {
  return Math.max(1, Math.ceil((straightMeters * 1.3) / 80));
}

async function fetchNearbyStays(
  latitude: number,
  longitude: number,
): Promise<StayOption[]> {
  if (apiBaseUrl) {
    try {
      const places = await getNearbyPlaces({ lat: latitude, lon: longitude });
      return places
        .map((place) => ({
          ...place,
          distance: place.distanceMeters,
          walkMinutes: walkMinutesFor(place.distanceMeters),
        }))
        .sort((first, second) => first.distance - second.distance);
    } catch {
      // Fall back to OpenStreetMap below.
    }
  }
  if (!communityFallbacksEnabled) return [];
  const query = `[out:json][timeout:15];(node(around:1500,${latitude},${longitude})["amenity"="internet_cafe"];node(around:1500,${latitude},${longitude})["amenity"="karaoke_box"];node(around:1500,${latitude},${longitude})["tourism"~"^(hotel|hostel|guest_house)$"];);out tags center 30;`;
  const elements = await overpassQuery(query);
  const options: StayOption[] = [];
  for (const element of elements) {
    if (element.lat === undefined || element.lon === undefined) continue;
    const tags = element.tags ?? {};
    const name = tags.name ?? tags["name:en"];
    if (!name) continue;
    const kind: StayKind =
      tags.amenity === "internet_cafe"
        ? "net-cafe"
        : tags.amenity === "karaoke_box"
          ? "karaoke"
          : "hotel";
    const distance = distanceBetween(
      { latitude, longitude },
      { latitude: element.lat, longitude: element.lon },
    );
    options.push({
      name,
      kind,
      latitude: element.lat,
      longitude: element.lon,
      distance,
      walkMinutes: walkMinutesFor(distance),
      phone: tags.phone,
    });
  }
  return options.sort((first, second) => first.distance - second.distance);
}

async function fetchTaxiEstimate(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  nowMs: number,
): Promise<TaxiEstimate | null> {
  const lateNight = isLateNight(nowMs);
  if (apiBaseUrl) {
    try {
      // NAVITIME applies regional meter rates and the late-night surcharge itself.
      const route = await getTaxiEstimate({
        fromLat: from.latitude,
        fromLon: from.longitude,
        toLat: to.latitude,
        toLon: to.longitude,
        startTime: formatJstDateTime(nowMs),
      });
      return {
        fareYen:
          route.fareYen ?? estimateTaxiFare(route.distanceMeters, lateNight),
        durationMinutes: Math.max(1, route.minutes),
        distanceKm: route.distanceMeters / 1000,
        lateNight,
      };
    } catch {
      // Fall back to OpenStreetMap routing below.
    }
  }
  if (!communityFallbacksEnabled) return null;
  const response = await fetch(
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false&alternatives=false&steps=false`,
    { signal: AbortSignal.timeout(8_000) },
  ).catch(() => null);
  if (!response?.ok) return null;
  const payload = (await response.json()) as {
    routes?: Array<{ distance: number; duration: number }>;
  };
  const route = payload.routes?.[0];
  if (!route) return null;
  return {
    fareYen: estimateTaxiFare(route.distance, lateNight),
    durationMinutes: Math.max(1, Math.round(route.duration / 60)),
    distanceKm: route.distance / 1000,
    lateNight,
  };
}

function openMaps(
  latitude: number,
  longitude: number,
  label: string,
  driving = false,
) {
  const query = encodeURIComponent(label);
  const url =
    Platform.OS === "ios"
      ? `https://maps.apple.com/?${driving ? "daddr" : "q"}=${driving ? `${latitude},${longitude}` : query}&ll=${latitude},${longitude}${driving ? "&dirflg=d" : ""}`
      : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}${driving ? "&travelmode=driving" : ""}`;
  void Linking.openURL(url);
}

/** Up to PER_KIND of each kind, so a hotel district still shows the nearest net café and karaoke. */
function balancedStays(options: StayOption[]): StayOption[] {
  const perKind = new Map<StayKind, number>();
  const seen = new Set<string>();
  return options
    .filter((option) => {
      const count = perKind.get(option.kind) ?? 0;
      if (seen.has(option.name) || count >= PER_KIND) return false;
      seen.add(option.name);
      perKind.set(option.kind, count + 1);
      return true;
    })
    .slice(0, MAX_STAYS);
}

type OptionKey = "train" | "partway" | "stay" | "taxi" | "walk";

export default function AlternativesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    language,
    status,
    destination,
    currentTime,
    nowMs,
    walkingSpeed,
    plan,
    firstTrain,
    firstTrainRoute,
    minutesUntilFirstTrain,
    stationName,
    stationNameJa,
    userCoordinates,
    homeStationOption,
    homeAddress,
    isLocating,
    locationError,
    requestLocation,
  } = useLastRide();
  const ja = language === "ja";
  const [stays, setStays] = useState<StayOption[] | null>(null);
  const [staysError, setStaysError] = useState(false);
  const [isLoadingStays, setIsLoadingStays] = useState(false);
  const [taxi, setTaxi] = useState<TaxiEstimate | null>(null);
  const [isLoadingTaxi, setIsLoadingTaxi] = useState(false);
  const [partway, setPartway] = useState<PartwayTrainTaxi | null>(null);
  const [isLoadingPartway, setIsLoadingPartway] = useState(false);
  const [walkHome, setWalkHome] = useState<WalkingRoute | null>(null);
  const [selected, setSelected] = useState<OptionKey>("train");
  const [kindFilter, setKindFilter] = useState<StayKind | null>(null);
  const [sortBy, setSortBy] = useState<"distance" | "price">("distance");
  const [showAllStays, setShowAllStays] = useState(false);
  const requestToken = useRef(0);
  const partwayToken = useRef(0);
  const [retryCount, setRetryCount] = useState(0);

  const homeHasCoordinates =
    !!homeStationOption &&
    (homeStationOption.latitude !== 0 || homeStationOption.longitude !== 0);
  // A taxi should take you to your door when the app knows it, not just to the station.
  const taxiTarget =
    homeAddress ?? (homeHasCoordinates ? homeStationOption : null);
  const taxiTargetName = homeAddress
    ? homeAddress.label
    : (homeStationOption?.nameJa ?? "");

  // Opened straight from the "missed the last train?" notification, this screen may be
  // the first thing shown, so it asks for a location like the leave screen does.
  useEffect(() => {
    if (!userCoordinates && !isLocating && !locationError)
      void requestLocation();
  }, [userCoordinates, isLocating, locationError, requestLocation]);

  useEffect(() => {
    const token = ++requestToken.current;
    // Clear previous results so a new location never shows stale options while loading.
    setStays(null);
    setStaysError(false);
    setTaxi(null);
    setWalkHome(null);
    if (!userCoordinates) {
      setIsLoadingStays(false);
      setIsLoadingTaxi(false);
      return;
    }
    setIsLoadingStays(true);
    fetchNearbyStays(userCoordinates.latitude, userCoordinates.longitude)
      .then((result) => {
        if (token === requestToken.current) setStays(result);
      })
      .catch(() => {
        if (token === requestToken.current) setStaysError(true);
      })
      .finally(() => {
        if (token === requestToken.current) setIsLoadingStays(false);
      });
    if (homeStationOption && homeHasCoordinates) {
      setIsLoadingTaxi(true);
      fetchTaxiEstimate(userCoordinates, taxiTarget ?? homeStationOption, nowMs)
        .then((result) => {
          if (token === requestToken.current) setTaxi(result);
        })
        .catch(() => {
          if (token === requestToken.current) setTaxi(null);
        })
        .finally(() => {
          if (token === requestToken.current) setIsLoadingTaxi(false);
        });
      // Walking is only worth offering when the actual destination is close enough.
      const walkTarget = taxiTarget ?? homeStationOption;
      if (distanceBetween(userCoordinates, walkTarget) <= WALKABLE_METERS) {
        walkingRoute(userCoordinates, walkTarget, walkingSpeed)
          .then((route) => {
            if (
              token === requestToken.current &&
              route.distanceMeters <= WALKABLE_METERS
            )
              setWalkHome(route);
          })
          .catch(() => undefined);
      }
    }
    // nowMs is deliberately not a dependency: it ticks constantly and would refetch.
  }, [
    userCoordinates,
    homeStationOption,
    homeHasCoordinates,
    taxiTarget?.latitude,
    taxiTarget?.longitude,
    walkingSpeed,
    retryCount,
  ]);

  useEffect(() => {
    const token = ++partwayToken.current;
    setPartway(null);
    if (
      status !== "departed" ||
      !apiBaseUrl ||
      !userCoordinates ||
      !plan ||
      plan.lastTrain.source !== "live" ||
      !taxiTarget
    ) {
      setIsLoadingPartway(false);
      return;
    }

    setIsLoadingPartway(true);
    const earliestBoardAtMs =
      nowMs + (plan.walkingMinutes + STATION_BUFFER_MINUTES) * MINUTE_MS;
    void getPartwayTrainTaxi({
      fromLat: plan.station.latitude,
      fromLon: plan.station.longitude,
      fromName: plan.station.nameJa,
      toLat: plan.destination.latitude,
      toLon: plan.destination.longitude,
      toName: plan.destination.nameJa,
      taxiToLat: taxiTarget.latitude,
      taxiToLon: taxiTarget.longitude,
      date: serviceDate(plan.lastTrain.departsAt),
      earliestBoardAtMs,
    })
      .then((result) => {
        if (token === partwayToken.current) setPartway(result);
      })
      .catch(() => {
        if (token === partwayToken.current) setPartway(null);
      })
      .finally(() => {
        if (token === partwayToken.current) setIsLoadingPartway(false);
      });
    // nowMs deliberately isn't a dependency: status or a fresh plan triggers this once.
  }, [
    status,
    userCoordinates,
    plan?.computedAt,
    taxiTarget?.latitude,
    taxiTarget?.longitude,
    retryCount,
  ]);

  useEffect(() => {
    if (selected === "partway" && !partway && !isLoadingPartway)
      setSelected("train");
  }, [selected, partway, isLoadingPartway]);

  const station = ja ? stationNameJa : stationName;
  const homeLabel = destination || (ja ? "帰り先" : "your destination");
  const trainFare = firstTrainRoute?.fareYen ?? null;
  const homeByTrain = firstTrainRoute?.arrivesAt ?? null;
  const homeByTaxi = taxi ? nowMs + taxi.durationMinutes * MINUTE_MS : null;
  const partwayTrainArrival = partway
    ? Date.parse(partway.train.arrivesAt)
    : null;
  const homeByPartway =
    partway &&
    partwayTrainArrival !== null &&
    Number.isFinite(partwayTrainArrival)
      ? partwayTrainArrival + partway.taxi.minutes * MINUTE_MS
      : null;
  const homeByWalk = walkHome
    ? nowMs + walkHome.walkingMinutes * MINUTE_MS
    : null;
  const cheapestStay =
    stays && stays.length > 0 ? Math.min(...stays.map(lowestPrice)) : null;
  const partwaySavings =
    taxi &&
    partway?.totalFareYen !== null &&
    partway?.totalFareYen !== undefined
      ? taxi.fareYen - partway.totalFareYen
      : null;

  type Option = {
    key: OptionKey;
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    detail: string;
    homeBy: number | null;
    cost: number | null;
  };
  const options: Option[] = [
    {
      key: "train",
      icon: "sunrise",
      label: ja ? "始発を待つ" : "Wait for the first train",
      detail:
        minutesUntilFirstTrain === null
          ? ja
            ? "始発を確認中"
            : "checking"
          : ja
            ? `待ち${formatDuration(minutesUntilFirstTrain, true)}`
            : `${formatDuration(minutesUntilFirstTrain, false)} wait`,
      homeBy: homeByTrain,
      cost: trainFare,
    },
    ...(partway
      ? [
          {
            key: "partway" as const,
            icon: "shuffle" as const,
            label: ja ? "途中まで電車＋タクシー" : "Train partway + taxi",
            detail: ja
              ? `${partway.taxiFrom.nameJa}まで電車 · タクシー約${partway.taxi.minutes}分`
              : `train to ${partway.taxiFrom.name} · ~${partway.taxi.minutes} min taxi`,
            homeBy: homeByPartway,
            cost: partway.totalFareYen,
          },
        ]
      : []),
    ...(cheapestStay !== null
      ? [
          {
            key: "stay" as const,
            icon: "moon" as const,
            label: ja ? "近くで待つ＋始発" : "Wait somewhere + first train",
            detail: ja
              ? `${stays?.length ?? 0}軒が徒歩圏内`
              : `${stays?.length ?? 0} places nearby`,
            homeBy: homeByTrain,
            cost: trainFare === null ? cheapestStay : cheapestStay + trainFare,
          },
        ]
      : []),
    ...(taxi
      ? [
          {
            key: "taxi" as const,
            icon: "truck" as const,
            label: ja ? "タクシー" : "Taxi",
            detail: ja
              ? `約${taxi.durationMinutes}分 · ${taxi.distanceKm.toFixed(1)} km`
              : `~${taxi.durationMinutes} min · ${taxi.distanceKm.toFixed(1)} km`,
            homeBy: homeByTaxi,
            cost: taxi.fareYen,
          },
        ]
      : []),
    ...(walkHome
      ? [
          {
            key: "walk" as const,
            icon: "navigation" as const,
            label: ja ? "歩いて向かう" : "Walk there",
            detail: ja
              ? `徒歩${walkHome.walkingMinutes}分 · ${(walkHome.distanceMeters / 1000).toFixed(1)} km`
              : `${walkHome.walkingMinutes} min · ${(walkHome.distanceMeters / 1000).toFixed(1)} km`,
            homeBy: homeByWalk,
            cost: 0,
          },
        ]
      : []),
  ];
  const costs = options
    .map((option) => option.cost)
    .filter((cost): cost is number => cost !== null);
  const times = options
    .map((option) => option.homeBy)
    .filter((time): time is number => time !== null);
  const cheapest = costs.length > 1 ? Math.min(...costs) : null;
  const fastest = times.length > 1 ? Math.min(...times) : null;

  const visibleStays = stays
    ? kindFilter
      ? stays.filter((stay) => stay.kind === kindFilter)
      : balancedStays(stays)
    : null;
  const sortedStays = visibleStays
    ? [...visibleStays]
        .sort((first, second) =>
          sortBy === "price"
            ? lowestPrice(first) - lowestPrice(second) ||
              first.distance - second.distance
            : first.distance - second.distance,
        )
        .slice(0, showAllStays ? MAX_STAYS : PREVIEW_STAYS)
    : null;
  const filteredCount = visibleStays?.length ?? 0;
  const availableKinds = KIND_ORDER.filter((kind) =>
    stays?.some((stay) => stay.kind === kind),
  );

  const waitNote =
    minutesUntilFirstTrain === null
      ? null
      : ja
        ? `始発まで${formatDuration(minutesUntilFirstTrain, true)}`
        : `${formatDuration(minutesUntilFirstTrain, false)} until ${firstTrain}`;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12),
            paddingBottom: 26,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.top}>
          <View style={styles.brand}>
            <RailwayMark size={22} />
            <Text style={[styles.brandText, { color: colors.foreground }]}>
              LastRide
            </Text>
          </View>
          <Text style={[styles.clock, { color: colors.mutedForeground }]}>
            {currentTime}
          </Text>
        </View>
        <View style={styles.heading}>
          <Text
            style={[
              styles.kicker,
              {
                color:
                  status === "departed" ? colors.destructive : colors.primary,
              },
            ]}
          >
            {status === "departed"
              ? ja
                ? "終電が発車しました"
                : "THE LAST TRAIN HAS LEFT"
              : ja
                ? "乗れなかったときは"
                : "IF YOU MISS IT"}
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {ja ? `${homeLabel}へ行く方法` : `Ways to ${homeLabel}`}
          </Text>
        </View>

        {/* Pick an option; only its details are shown below */}
        <View style={styles.options}>
          {options.map((option) => {
            const isSelected = option.key === selected;
            const isCheapest = cheapest !== null && option.cost === cheapest;
            const isFastest = fastest !== null && option.homeBy === fastest;
            return (
              <Pressable
                key={option.key}
                testID={`option-${option.key}`}
                onPress={() => setSelected(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: isSelected
                      ? colors.foreground
                      : colors.card,
                    borderColor: isSelected ? colors.foreground : colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Feather
                  name={option.icon}
                  size={19}
                  color={
                    isSelected ? colors.primary : colors.secondaryForeground
                  }
                />
                <View style={styles.optionCopy}>
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: isSelected ? colors.card : colors.foreground },
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[
                      styles.optionDetail,
                      {
                        color: isSelected
                          ? colors.muted
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {option.homeBy
                      ? ja
                        ? `${formatJstTime(option.homeBy)}に到着 · `
                        : `arrives ~${formatJstTime(option.homeBy)} · `
                      : ""}
                    {option.detail}
                  </Text>
                </View>
                <View style={styles.optionRight}>
                  <Text
                    style={[
                      styles.optionCost,
                      { color: isSelected ? colors.card : colors.foreground },
                    ]}
                  >
                    {option.cost === null
                      ? "—"
                      : option.cost === 0
                        ? ja
                          ? "無料"
                          : "Free"
                        : `${formatYen(option.cost)}${option.key === "stay" ? (ja ? "〜" : "+") : ""}`}
                  </Text>
                  {(isCheapest || isFastest) && (
                    <View
                      style={[
                        styles.tag,
                        {
                          backgroundColor: isFastest
                            ? colors.primary
                            : colors.secondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagText,
                          {
                            color: isFastest
                              ? colors.primaryForeground
                              : colors.secondaryForeground,
                          },
                        ]}
                      >
                        {isFastest
                          ? ja
                            ? "最速"
                            : "fastest"
                          : ja
                            ? "最安"
                            : "cheapest"}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {isLoadingPartway && status === "departed" && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja
                ? "まだ乗れる電車＋タクシーを確認中…"
                : "Checking whether a train can shorten the taxi…"}
            </Text>
          </View>
        )}

        {/* Train partway, taxi the rest */}
        {selected === "partway" && partway && (
          <View
            style={[
              styles.panel,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.panelHead}>
              <Text style={[styles.panelTime, { color: colors.foreground }]}>
                {formatJstTime(Date.parse(partway.train.departsAt))}
              </Text>
              <View style={styles.panelHeadCopy}>
                <Text style={[styles.panelTitle, { color: colors.foreground }]}>
                  {ja
                    ? `${partway.taxiFrom.nameJa}まで電車、その先はタクシー`
                    : `Train to ${partway.taxiFrom.name}, then taxi`}
                </Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {[
                    partway.totalFareYen === null
                      ? null
                      : formatYen(partway.totalFareYen),
                    homeByPartway
                      ? ja
                        ? `${formatJstTime(homeByPartway)}着`
                        : `arrives ~${formatJstTime(homeByPartway)}`
                      : null,
                    partwaySavings !== null && partwaySavings > 0
                      ? ja
                        ? `全区間タクシーより約${formatYen(partwaySavings)}安い`
                        : `~${formatYen(partwaySavings)} less than a full taxi`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </View>

            <View style={styles.legs}>
              {partway.train.legs.map((leg) => (
                <View key={`${leg.line}-${leg.departsAt}`} style={styles.leg}>
                  <Text style={[styles.legTime, { color: colors.foreground }]}>
                    {formatJstTime(Date.parse(leg.departsAt))}
                  </Text>
                  <View style={styles.cardCopy}>
                    <Text
                      style={[styles.cardTitle, { color: colors.foreground }]}
                    >
                      {ja
                        ? `${leg.from} → ${leg.to}`
                        : `${leg.fromEn} → ${leg.toEn}`}
                    </Text>
                    <Text
                      style={[styles.note, { color: colors.mutedForeground }]}
                    >
                      {ja ? shortLineName(leg.line) : leg.lineEn}
                    </Text>
                  </View>
                </View>
              ))}
              <View style={styles.leg}>
                <Feather
                  name="truck"
                  size={18}
                  color={colors.primary}
                  style={styles.legIcon}
                />
                <View style={styles.cardCopy}>
                  <Text
                    style={[styles.cardTitle, { color: colors.foreground }]}
                  >
                    {ja
                      ? `${partway.taxiFrom.nameJa} → ${homeLabel}`
                      : `${partway.taxiFrom.name} → ${homeLabel}`}
                  </Text>
                  <Text
                    style={[styles.note, { color: colors.mutedForeground }]}
                  >
                    {[
                      ja
                        ? `タクシー約${partway.taxi.minutes}分`
                        : `~${partway.taxi.minutes} min taxi`,
                      `${(partway.taxi.distanceMeters / 1000).toFixed(1)} km`,
                      partway.taxi.fareYen === null
                        ? null
                        : formatYen(partway.taxi.fareYen),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja
                ? "終電ルート上で今から到達できる最も先の候補を使います。時刻は現在地から駅まで歩く時間も考慮しています。"
                : "Uses the farthest useful stop from the original last-train path that you can still reach, including your walk to the boarding station."}
            </Text>
          </View>
        )}

        {/* First train */}
        {selected === "train" && (
          <View
            style={[
              styles.panel,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.panelHead}>
              <Text style={[styles.panelTime, { color: colors.foreground }]}>
                {firstTrain}
              </Text>
              <View style={styles.panelHeadCopy}>
                <Text style={[styles.panelTitle, { color: colors.foreground }]}>
                  {ja ? `${station}発` : `from ${station}`}
                </Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {[
                    waitNote,
                    trainFare === null ? null : `${formatYen(trainFare)}`,
                    homeByTrain
                      ? ja
                        ? `${formatJstTime(homeByTrain)}着`
                        : `arrives ${formatJstTime(homeByTrain)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </View>
            {firstTrainRoute?.legs && firstTrainRoute.legs.length > 0 && (
              <View style={styles.legs}>
                {firstTrainRoute.legs.map((leg) => (
                  <View key={`${leg.line}-${leg.departsAt}`} style={styles.leg}>
                    <Text
                      style={[styles.legTime, { color: colors.foreground }]}
                    >
                      {formatJstTime(leg.departsAt)}
                    </Text>
                    <View style={styles.cardCopy}>
                      <Text
                        style={[styles.cardTitle, { color: colors.foreground }]}
                      >
                        {ja
                          ? `${leg.from} → ${leg.to}`
                          : `${leg.fromEn ?? leg.from} → ${leg.toEn ?? leg.to}`}
                      </Text>
                      <Text
                        style={[styles.note, { color: colors.mutedForeground }]}
                      >
                        {ja
                          ? shortLineName(leg.line)
                          : (leg.lineEn ?? shortLineName(leg.line))}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja
                ? "運賃のほかに、始発まで待つ場所の料金がかかります。"
                : "The fare above is the train only — you’ll also need somewhere to wait."}
            </Text>
          </View>
        )}

        {/* Somewhere to wait */}
        {selected === "stay" && (
          <View
            style={[
              styles.panel,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.chipRow}>
              <Pressable
                testID="filter-all"
                onPress={() => setKindFilter(null)}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      kindFilter === null ? colors.primary : colors.secondary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color:
                        kindFilter === null
                          ? colors.primaryForeground
                          : colors.secondaryForeground,
                    },
                  ]}
                >
                  {ja ? "すべて" : "All"}
                </Text>
              </Pressable>
              {availableKinds.map((kind) => (
                <Pressable
                  key={kind}
                  testID={`filter-${kind}`}
                  onPress={() =>
                    setKindFilter(kind === kindFilter ? null : kind)
                  }
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        kind === kindFilter ? colors.primary : colors.secondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color:
                          kind === kindFilter
                            ? colors.primaryForeground
                            : colors.secondaryForeground,
                      },
                    ]}
                  >
                    {ja ? STAY_META[kind].ja : STAY_META[kind].en}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                testID="sort-toggle"
                onPress={() =>
                  setSortBy(sortBy === "distance" ? "price" : "distance")
                }
                style={[styles.chip, { backgroundColor: colors.background }]}
              >
                <Feather
                  name={sortBy === "distance" ? "map-pin" : "tag"}
                  size={12}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.chipText, { color: colors.mutedForeground }]}
                >
                  {sortBy === "distance"
                    ? ja
                      ? "近い順"
                      : "Nearest"
                    : ja
                      ? "安い順"
                      : "Cheapest"}
                </Text>
              </Pressable>
            </View>

            {isLoadingStays ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {ja ? "周辺を検索中…" : "Searching around you…"}
                </Text>
              </View>
            ) : staysError ? (
              <Pressable
                testID="retry-stays"
                onPress={() => setRetryCount((count) => count + 1)}
                style={styles.loadingRow}
              >
                <Feather
                  name="refresh-cw"
                  color={colors.secondaryForeground}
                  size={17}
                />
                <Text
                  style={[styles.note, { color: colors.secondaryForeground }]}
                >
                  {ja
                    ? "周辺検索が混み合っています。タップして再試行"
                    : "Nearby search was busy. Tap to retry"}
                </Text>
              </Pressable>
            ) : sortedStays && sortedStays.length > 0 ? (
              <>
                {sortedStays.map((stay) => {
                  const meta = STAY_META[stay.kind];
                  const { range, chain } = stayPrice(stay.name, stay.kind);
                  return (
                    <View key={stay.name} style={styles.stayRow}>
                      <View
                        style={[
                          styles.cardIcon,
                          { backgroundColor: colors.secondary },
                        ]}
                      >
                        <Feather
                          name={meta.icon}
                          color={colors.secondaryForeground}
                          size={18}
                        />
                      </View>
                      <Pressable
                        style={styles.cardCopy}
                        onPress={() =>
                          openMaps(stay.latitude, stay.longitude, stay.name)
                        }
                        accessibilityRole="link"
                        accessibilityLabel={
                          ja
                            ? `${stay.name}を地図で開く`
                            : `Open ${stay.name} in Maps`
                        }
                      >
                        <Text
                          style={[
                            styles.cardTitle,
                            { color: colors.foreground },
                          ]}
                          numberOfLines={1}
                        >
                          {stay.name}
                        </Text>
                        <Text
                          style={[
                            styles.note,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {ja
                            ? `${meta.ja} · 徒歩${stay.walkMinutes}分`
                            : `${meta.en} · ${stay.walkMinutes} min walk`}
                          {stay.open24h ? (ja ? " · 24時間" : " · 24h") : ""}
                        </Text>
                        <Text
                          style={[
                            styles.stayPrice,
                            { color: colors.foreground },
                          ]}
                        >
                          {formatPriceRange(range)}
                          <Text
                            style={[
                              styles.priceNote,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            {chain
                              ? ja
                                ? "  店舗目安"
                                : "  chain rate"
                              : ja
                                ? "  目安"
                                : "  typical"}
                          </Text>
                        </Text>
                      </Pressable>
                      <View style={styles.stayActions}>
                        {stay.phone && (
                          <Pressable
                            onPress={() =>
                              void Linking.openURL(`tel:${stay.phone}`)
                            }
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={
                              ja ? `${stay.name}に電話` : `Call ${stay.name}`
                            }
                            style={[
                              styles.iconButton,
                              { backgroundColor: colors.secondary },
                            ]}
                          >
                            <Feather
                              name="phone"
                              color={colors.secondaryForeground}
                              size={15}
                            />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
                {filteredCount > PREVIEW_STAYS && (
                  <Pressable
                    testID="show-more-stays"
                    onPress={() => setShowAllStays(!showAllStays)}
                    style={styles.moreButton}
                  >
                    <Text style={[styles.chipText, { color: colors.primary }]}>
                      {showAllStays
                        ? ja
                          ? "少なく表示"
                          : "Show fewer"
                        : ja
                          ? `ほか${Math.min(filteredCount, MAX_STAYS) - PREVIEW_STAYS}件を表示`
                          : `Show ${Math.min(filteredCount, MAX_STAYS) - PREVIEW_STAYS} more`}
                    </Text>
                    <Feather
                      name={showAllStays ? "chevron-up" : "chevron-down"}
                      color={colors.primary}
                      size={15}
                    />
                  </Pressable>
                )}
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {ja
                    ? "料金はチェーン店の一般的な深夜料金の目安です。実際の料金は店舗にご確認ください。タップで地図を開きます。"
                    : "Prices are typical late-night rates for that chain — check with the venue. Tap a name for Maps."}
                </Text>
              </>
            ) : (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja
                  ? "徒歩圏内に見つかりませんでした。タクシーか始発待ちをご検討ください。"
                  : "Nothing within walking distance. A taxi or waiting for the first train may be your options."}
              </Text>
            )}
          </View>
        )}

        {/* Taxi */}
        {selected === "taxi" && (
          <View
            style={[
              styles.panel,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.panelHead}>
              <Text style={[styles.panelTime, { color: colors.foreground }]}>
                {taxi ? formatYen(taxi.fareYen) : "—"}
              </Text>
              <View style={styles.panelHeadCopy}>
                <Text style={[styles.panelTitle, { color: colors.foreground }]}>
                  {ja ? `${homeLabel} まで` : `To ${homeLabel}`}
                </Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {isLoadingTaxi
                    ? ja
                      ? "概算を計算中…"
                      : "Calculating estimate…"
                    : taxi
                      ? [
                          ja
                            ? `約${taxi.durationMinutes}分 · ${taxi.distanceKm.toFixed(1)} km`
                            : `~${taxi.durationMinutes} min · ${taxi.distanceKm.toFixed(1)} km`,
                          taxi.lateNight
                            ? ja
                              ? "深夜料金込み"
                              : "incl. late-night rate"
                            : null,
                          homeByTaxi
                            ? ja
                              ? `${formatJstTime(homeByTaxi)}着`
                              : `arrives ~${formatJstTime(homeByTaxi)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : ja
                        ? "現在地と帰り先が必要です。"
                        : "Needs your location and destination."}
                </Text>
              </View>
            </View>
            {taxiTarget && (
              <>
                <Pressable
                  testID="taxi-route"
                  onPress={() =>
                    openMaps(
                      taxiTarget.latitude,
                      taxiTarget.longitude,
                      taxiTargetName,
                      true,
                    )
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.actionButton,
                    {
                      backgroundColor: colors.foreground,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Feather name="map" color={colors.card} size={16} />
                  <Text style={[styles.actionText, { color: colors.card }]}>
                    {ja ? "地図でルート" : "Driving route"}
                  </Text>
                </Pressable>
                {/* Japanese speakers can just tell the driver; this is for everyone else. */}
                {!ja && (
                  <View
                    style={[
                      styles.phraseBox,
                      { backgroundColor: colors.secondary },
                    ]}
                  >
                    <Text
                      style={[
                        styles.priceNote,
                        { color: colors.secondaryForeground },
                      ]}
                    >
                      Show the driver
                    </Text>
                    <Text
                      selectable
                      style={[
                        styles.phrase,
                        { color: colors.secondaryForeground },
                      ]}
                    >
                      {homeAddress
                        ? `${homeAddress.label}までお願いします`
                        : `${homeStationOption?.nameJa ?? ""}駅までお願いします`}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Walk home */}
        {selected === "walk" && walkHome && (
          <View
            style={[
              styles.panel,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.panelHead}>
              <Text style={[styles.panelTime, { color: colors.foreground }]}>
                {ja
                  ? `${walkHome.walkingMinutes}分`
                  : `${walkHome.walkingMinutes} min`}
              </Text>
              <View style={styles.panelHeadCopy}>
                <Text style={[styles.panelTitle, { color: colors.foreground }]}>
                  {ja ? `${homeLabel} まで歩く` : `Walk to ${homeLabel}`}
                </Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {`${(walkHome.distanceMeters / 1000).toFixed(1)} km`}
                  {homeByWalk
                    ? ja
                      ? ` · ${formatJstTime(homeByWalk)}着`
                      : ` · arrives ~${formatJstTime(homeByWalk)}`
                    : ""}
                </Text>
              </View>
            </View>
            <Pressable
              testID="walk-home"
              onPress={() =>
                taxiTarget &&
                openMaps(
                  taxiTarget.latitude,
                  taxiTarget.longitude,
                  taxiTargetName || homeLabel,
                )
              }
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: colors.foreground,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Feather name="map" color={colors.card} size={16} />
              <Text style={[styles.actionText, { color: colors.card }]}>
                {ja ? "地図で見る" : "Open in Maps"}
              </Text>
            </Pressable>
          </View>
        )}

        {!userCoordinates && (
          <Pressable
            testID="alternatives-use-location"
            onPress={() => void requestLocation()}
            style={({ pressed }) => [
              styles.locationPrompt,
              { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather
              name="crosshair"
              color={colors.secondaryForeground}
              size={18}
            />
            <Text
              style={[
                styles.locationPromptText,
                { color: colors.secondaryForeground },
              ]}
            >
              {isLocating
                ? ja
                  ? "現在地を取得中…"
                  : "Getting your location…"
                : ja
                  ? "現在地から周辺の選択肢を表示"
                  : "Use my location to show nearby options"}
            </Text>
          </Pressable>
        )}
      </ScrollView>
      <BottomNav language={language} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  top: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brand: { alignItems: "center", flexDirection: "row", gap: 7 },
  brandText: { fontFamily: "Inter_700Bold", fontSize: 17 },
  clock: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  heading: { gap: 6, marginTop: 2 },
  kicker: { fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 1.3 },
  title: { fontFamily: "Inter_700Bold", fontSize: 27, letterSpacing: -1 },
  options: { gap: 8 },
  option: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    padding: 14,
  },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { fontFamily: "Inter_700Bold", fontSize: 15 },
  optionDetail: { fontFamily: "Inter_400Regular", fontSize: 12 },
  optionRight: { alignItems: "flex-end", gap: 3 },
  optionCost: { fontFamily: "Inter_700Bold", fontSize: 16 },
  priceNote: { fontFamily: "Inter_400Regular", fontSize: 10 },
  tag: { borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  panel: { borderRadius: 22, borderWidth: 1, gap: 16, padding: 18 },
  panelHead: { alignItems: "center", flexDirection: "row", gap: 16 },
  panelHeadCopy: { flex: 1, gap: 3 },
  panelTime: { fontFamily: "Inter_700Bold", fontSize: 34, letterSpacing: -1.5 },
  panelTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  note: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  legs: { gap: 12 },
  leg: { alignItems: "flex-start", flexDirection: "row", gap: 14 },
  legTime: { fontFamily: "Inter_700Bold", fontSize: 15, width: 46 },
  legIcon: { marginLeft: 14, marginRight: 14 },
  stayRow: { alignItems: "center", flexDirection: "row", gap: 11 },
  stayActions: { flexDirection: "row", gap: 6 },
  cardIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  cardCopy: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  stayPrice: { fontFamily: "Inter_700Bold", fontSize: 14 },
  iconButton: {
    alignItems: "center",
    borderRadius: 11,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  moreButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    paddingVertical: 4,
  },
  actionButton: {
    alignItems: "center",
    borderRadius: 15,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
  },
  actionText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  phraseBox: { borderRadius: 15, gap: 3, padding: 12 },
  phrase: { fontFamily: "Inter_700Bold", fontSize: 15 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    alignItems: "center",
    borderRadius: 13,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  locationPrompt: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 11,
    padding: 15,
  },
  locationPromptText: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});
