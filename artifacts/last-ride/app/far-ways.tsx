import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MapCard, openDrivingRoute, openTransitRoute } from "@/components/MapCard";
import { TaxiContacts } from "@/components/TaxiContacts";
import { IconButton } from "@/components/ui";
import { DIGITS } from "@/constants/type";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import {
  firstTrainFrom,
  staysNearStation,
  taxiHomeFrom,
  transitHomeFrom,
  type StayNearStation,
  type Trip,
} from "@/lib/farStation";
import { formatPriceRange, formatYen, stayPrice, type StayKind } from "@/lib/stayPricing";
import { formatJstTime, jstDate, MINUTE_MS } from "@/lib/time";
import type { TrainTime } from "@/lib/timetable";

type TaxiHome = Awaited<ReturnType<typeof taxiHomeFrom>>;
type TransitHome = Awaited<ReturnType<typeof transitHomeFrom>>;
type Icon = React.ComponentProps<typeof Feather>["name"];

const STAY_KIND: Record<StayKind, { icon: Icon; ja: string; en: string }> = {
  "net-cafe": { icon: "monitor", ja: "ネットカフェ", en: "Internet café" },
  karaoke: { icon: "music", ja: "カラオケ", en: "Karaoke" },
  capsule: { icon: "moon", ja: "カプセルホテル", en: "Capsule hotel" },
  hotel: { icon: "briefcase", ja: "宿", en: "Hotel or inn" },
};

type WayKey = "bus" | "station" | "first" | "taxi";

/** One way home: a card in the list, and what opens under it. */
type Way = {
  key: WayKey;
  icon: Icon;
  label: string;
  detail: string;
  /** At home (or the home station) by then; null when not known. */
  homeBy: number | null;
  /** Yen, for 最安; null when there's no fare to show. */
  cost: number | null;
  /** How the cost reads on the card: 「約¥4,500」, 「¥8,000〜」, or 「—」. */
  costLabel: string;
  panel: React.ReactNode;
};

/** A way that is over for tonight, listed (muted) under the ones that work. */
type Gone = { key: string; icon: Icon; label: string; note: string };

/**
 * 帰り方: every way home from a place with no station within walking reach,
 * laid out like 乗れなかったら. One card per way that still works tonight
 * (bus and train from here, taxi or car to the nearest station's last train,
 * its first train with somewhere near it to wait, taxi all the way home),
 * sorted by when it gets you home and tagged 最速 / 最安; the chosen card opens
 * its details and buttons. Ways already over for tonight are listed, muted,
 * below. Opened from the main screen's far-station card.
 */
export default function FarWaysScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language, nearestByCar: far, userCoordinates, homeStationOption } = useLastRide();
  const ja = language === "ja";
  const home = homeStationOption ? (ja ? homeStationOption.nameJa : homeStationOption.name) : "";
  const [transit, setTransit] = useState<TransitHome | undefined>(undefined);
  const [taxiHome, setTaxiHome] = useState<TaxiHome | undefined>(undefined);
  const [firstTrain, setFirstTrain] = useState<TrainTime | null | undefined>(undefined);
  const [stays, setStays] = useState<StayNearStation[] | null | undefined>(undefined);
  const [selected, setSelected] = useState<WayKey | null>(null);

  useEffect(() => {
    if (!userCoordinates || !homeStationOption) return;
    let current = true;
    const now = Date.now();
    void transitHomeFrom(userCoordinates, homeStationOption, now)
      .catch(() => null)
      .then((found) => current && setTransit(found));
    void taxiHomeFrom(userCoordinates, homeStationOption, now)
      .catch(() => null)
      .then((found) => current && setTaxiHome(found));
    return () => {
      current = false;
    };
  }, [userCoordinates, homeStationOption]);

  // The morning's first train from the nearest station, and somewhere to wait near it.
  useEffect(() => {
    if (!far || !homeStationOption) return;
    let current = true;
    void firstTrainFrom(far, homeStationOption, Date.now())
      .catch(() => null)
      .then((found) => current && setFirstTrain(found));
    void staysNearStation(far)
      .catch(() => null)
      .then((found) => current && setStays(found));
    return () => {
      current = false;
    };
  }, [far, homeStationOption]);

  const now = Date.now();
  /** 「22:46」, or 「明日 10:11」 on tomorrow's date (after midnight, a 05:21 train is just 「05:21」). */
  const when = (ms: number) => {
    const time = formatJstTime(ms);
    if (jstDate(ms) === jstDate(now)) return time;
    return ja ? `明日 ${time}` : `tomorrow ${time}`;
  };
  const approx = (yen: number) => (ja ? `約${formatYen(yen)}` : `~${formatYen(yen)}`);
  const stationName = far ? (ja ? `${far.station.nameJa}駅` : far.station.name) : "";
  const driveNote = far?.drive ? (ja ? `車で約${far.drive.minutes}分` : `about ${far.drive.minutes} min by car`) : null;

  // Apple's last trip can be one that has already left (it answers past trips too).
  const lastTrip = transit?.last && transit.last.departsAt > now ? transit.last : null;
  const goneTrip = transit?.last && transit.last.departsAt <= now ? transit.last : null;
  const nextTrip = transit?.next && transit.next.departsAt > now ? transit.next : null;
  const trainGone = !!far?.lastTrain && far.lastTrain.departsAt <= now;
  const tooLateByCar = far?.leaveByCarMs != null && far.leaveByCarMs <= now;
  const cheapestStay = stays && stays.length > 0 ? Math.min(...stays.map((stay) => stayPrice(stay.name, stay.kind).range.from)) : null;

  const button = (label: string, icon: Icon, onPress: () => void, primary = false, testID?: string) => (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: colors.primary } : { borderColor: colors.input, borderWidth: 1 },
        { opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Feather name={icon} size={15} color={primary ? colors.primaryForeground : colors.foreground} />
      <Text style={[styles.buttonText, { color: primary ? colors.primaryForeground : colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{label}</Text>
    </Pressable>
  );

  /** A time line in a panel: 「最終 22:46 に出る → 菊名着 23:42」. */
  const timeLine = (label: string, at: number, verb: string, arrivesAt?: number) => (
    <View style={styles.timeRow}>
      <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.time, { color: colors.foreground }]}>{when(at)}</Text>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        {verb}
        {arrivesAt !== undefined ? (ja ? ` → ${home}着 ${formatJstTime(arrivesAt)}` : ` → ${home} ${formatJstTime(arrivesAt)}`) : ""}
      </Text>
    </View>
  );

  const ways: Way[] = [];
  const gone: Gone[] = [];
  const pending: Array<{ key: string; icon: Icon; label: string }> = [];

  // Bus and train from right here.
  if (transit === undefined) pending.push({ key: "bus", icon: "map", label: ja ? "バス・電車を確認しています…" : "Checking buses and trains…" });
  else if (lastTrip && homeStationOption) {
    const soonest: Trip = nextTrip && nextTrip.departsAt < lastTrip.departsAt ? nextTrip : lastTrip;
    ways.push({
      key: "bus",
      icon: "map",
      label: ja ? "バス・電車" : "Bus and train",
      detail: soonest === lastTrip
        ? ja ? `最終 ${formatJstTime(lastTrip.departsAt)}出発` : `last one leaves ${formatJstTime(lastTrip.departsAt)}`
        : ja ? `次は${formatJstTime(soonest.departsAt)}出発 · 最終は${formatJstTime(lastTrip.departsAt)}出発` : `next ${formatJstTime(soonest.departsAt)} · last ${formatJstTime(lastTrip.departsAt)}`,
      homeBy: soonest.arrivesAt ?? null,
      cost: null,
      costLabel: "—",
      panel: (
        <>
          {soonest !== lastTrip ? timeLine(ja ? "次" : "Next", soonest.departsAt, ja ? "出発" : "leave", soonest.arrivesAt) : null}
          {timeLine(ja ? "最終" : "Last", lastTrip.departsAt, ja ? "出発" : "leave", lastTrip.arrivesAt)}
          <Text style={[styles.small, { color: colors.subtle }]}>
            {ja ? "バス停までの徒歩を含めた、Appleマップに基づく目安です。" : "Includes the walk to the stop; times are from Apple Maps."}
          </Text>
          {button(ja ? "乗り継ぎを地図アプリで見る" : "See the route in Maps", "map", () => openTransitRoute(homeStationOption), true, "far-transit-home")}
        </>
      ),
    });
  } else if (goneTrip || nextTrip) {
    gone.push({
      key: "bus",
      icon: "map",
      label: ja ? "バス・電車" : "Bus and train",
      note: [
        goneTrip ? (ja ? `今夜の最終（${formatJstTime(goneTrip.departsAt)}）は出発済み` : `tonight's last (${formatJstTime(goneTrip.departsAt)}) has gone`) : ja ? "今夜の便は終了しました" : "nothing more tonight",
        nextTrip ? (ja ? `次の便は${when(nextTrip.departsAt)}` : `next ${when(nextTrip.departsAt)}`) : null,
      ].filter(Boolean).join(ja ? "・" : " · "),
    });
  }

  if (far) {
    // Taxi or car to the nearest station, for its last train.
    if (far.lastTrain && !trainGone && !tooLateByCar) {
      const lastTrain = far.lastTrain;
      ways.push({
        key: "station",
        icon: "truck",
        label: ja ? `${stationName}まで車 → 終電` : `Drive to ${stationName}, last train`,
        detail: [
          far.leaveByCarMs !== null ? (ja ? `${formatJstTime(far.leaveByCarMs)}までに出発` : `leave by ${formatJstTime(far.leaveByCarMs)}`) : null,
          driveNote,
        ].filter(Boolean).join(" · "),
        homeBy: lastTrain.arrivesAt ?? null,
        cost: far.taxiFareYen,
        costLabel: far.taxiFareYen !== null ? approx(far.taxiFareYen) : "—",
        panel: (
          <>
            {timeLine(ja ? "終電" : "Last train", lastTrain.departsAt, ja ? "発" : "dep.", lastTrain.arrivesAt)}
            {far.leaveByCarMs !== null ? (
              <Text style={[styles.leaveBy, { color: colors.primary }]}>
                {ja ? `ここを${formatJstTime(far.leaveByCarMs)}までに出発` : `Leave here by ${formatJstTime(far.leaveByCarMs)}`}
              </Text>
            ) : null}
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {[driveNote, far.taxiFareYen !== null ? (ja ? `タクシーなら${approx(far.taxiFareYen)}` : `taxi ${approx(far.taxiFareYen)}`) : null].filter(Boolean).join(" · ")}
            </Text>
            {button(ja ? `${stationName}への道順（車）` : `Driving directions to ${stationName}`, "navigation", () => openDrivingRoute(far.station), true, "far-drive-station")}
            <TaxiContacts stand={far.taxiStand} companies={far.taxiCompanies} ja={ja} />
          </>
        ),
      });
    } else if (far.lastTrain) {
      gone.push({
        key: "station",
        icon: "truck",
        label: ja ? `${stationName}の終電` : `Last train from ${stationName}`,
        note: trainGone
          ? ja ? `${formatJstTime(far.lastTrain.departsAt)}発は出発済み` : `the ${formatJstTime(far.lastTrain.departsAt)} has left`
          : ja ? "車でも間に合わない時刻です" : "too late even by car",
      });
    }

    // The morning's first train from it, waiting somewhere near the station.
    if (firstTrain === undefined) pending.push({ key: "first", icon: "sunrise", label: ja ? "始発を確認しています…" : "Checking the first train…" });
    else if (firstTrain) {
      ways.push({
        key: "first",
        icon: "sunrise",
        label: ja ? `${stationName}で始発を待つ` : `First train from ${stationName}`,
        detail: [
          // The arrival before it already says 明日.
          ja ? `${formatJstTime(firstTrain.departsAt)}発` : `leaves ${formatJstTime(firstTrain.departsAt)}`,
          stays && stays.length > 0 ? (ja ? `駅の近くに${stays.length}軒` : `${stays.length} places near it`) : null,
        ].filter(Boolean).join(" · "),
        homeBy: firstTrain.arrivesAt ?? null,
        cost: cheapestStay,
        costLabel: cheapestStay !== null ? `${formatYen(cheapestStay)}${ja ? "〜" : "+"}` : "—",
        panel: (
          <>
            {timeLine(ja ? "始発" : "First", firstTrain.departsAt, ja ? "発" : "dep.", firstTrain.arrivesAt)}
            {driveNote ? (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? `駅までは${driveNote}。` : `The station is ${driveNote}.`}
              </Text>
            ) : null}
            <Text style={[styles.subhead, { color: colors.foreground }]}>{ja ? "駅の近くで朝まで待つ" : "Somewhere to wait near the station"}</Text>
            {stays === undefined ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.mutedForeground} />
                <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? "駅の近くを探しています…" : "Looking near the station…"}</Text>
              </View>
            ) : stays && stays.length > 0 ? (
              <View style={styles.list}>
                {stays.map((stay, index) => {
                  const kind = STAY_KIND[stay.kind];
                  const walk = Math.max(1, Math.ceil((stay.metersFromStation * 1.3) / 80));
                  return (
                    <View key={`${stay.name}-${index}`} style={[styles.listRow, { borderColor: colors.input }]}>
                      <Pressable
                        onPress={() => openDrivingRoute(stay)}
                        accessibilityRole="button"
                        accessibilityLabel={ja ? `${stay.name}への道順` : `Directions to ${stay.name}`}
                        style={({ pressed }) => [styles.listMain, { opacity: pressed ? 0.7 : 1 }]}
                      >
                        <Feather name={kind.icon} size={15} color={colors.primary} />
                        <View style={styles.flex}>
                          <Text style={[styles.listName, { color: colors.foreground }]} numberOfLines={1}>{stay.name}</Text>
                          <Text style={[styles.small, { color: colors.mutedForeground }]}>
                            {`${ja ? kind.ja : kind.en} · ${formatPriceRange(stayPrice(stay.name, stay.kind).range)} · ${ja ? `駅から徒歩${walk}分` : `${walk} min from the station`}`}
                          </Text>
                        </View>
                      </Pressable>
                      {stay.phone ? (
                        <Pressable
                          onPress={() => void Linking.openURL(`tel:${stay.phone!.replace(/^\+81\s*/, "0").replace(/\D/g, "")}`).catch(() => undefined)}
                          accessibilityRole="button"
                          accessibilityLabel={ja ? `${stay.name}に電話する` : `Call ${stay.name}`}
                          hitSlop={6}
                          style={styles.call}
                        >
                          <Feather name="phone" size={15} color={colors.primary} />
                          <Text style={[styles.callText, { color: colors.primary }]}>{ja ? "電話" : "Call"}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
                <Text style={[styles.small, { color: colors.subtle }]}>
                  {ja ? "料金は目安です。深夜は事前に電話で確認してください" : "Prices are estimates. Call ahead late at night."}
                </Text>
              </View>
            ) : (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? "駅の近く（1.5km以内）に朝まで過ごせる場所は見つかりませんでした。" : "Nowhere to wait was found within 1.5 km of the station."}
              </Text>
            )}
            {button(ja ? `${stationName}への道順（車）` : `Driving directions to ${stationName}`, "navigation", () => openDrivingRoute(far.station), false, "far-drive-first")}
          </>
        ),
      });
    }
  }

  // Taxi to home station.
  if (taxiHome === undefined) pending.push({ key: "taxi", icon: "truck", label: ja ? "タクシー料金を確認しています…" : "Checking the taxi fare…" });
  else if (taxiHome) {
    ways.push({
      key: "taxi",
      icon: "truck",
      label: ja ? `タクシーで${home}駅まで` : "Taxi to home station",
      detail: ja ? `約${taxiHome.minutes}分 · ${(taxiHome.distanceMeters / 1000).toFixed(1)}km` : `~${taxiHome.minutes} min · ${(taxiHome.distanceMeters / 1000).toFixed(1)} km`,
      homeBy: now + taxiHome.minutes * MINUTE_MS,
      cost: taxiHome.fareYen,
      costLabel: approx(taxiHome.fareYen),
      panel: (
        <>
          <View style={styles.timeRow}>
            <Text style={[styles.time, { color: colors.foreground }]}>{approx(taxiHome.fareYen)}</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? `${formatJstTime(now + taxiHome.minutes * MINUTE_MS)}ごろ着` : `home ~${formatJstTime(now + taxiHome.minutes * MINUTE_MS)}`}
            </Text>
          </View>
          <Text style={[styles.small, { color: colors.subtle }]}>
            {ja ? "東京23区の運賃で概算・深夜割増込み・迎車料金と高速代は別" : "Estimated with Tokyo 23-ward rates, late-night included; pick-up fee and tolls extra"}
          </Text>
          {button(ja ? `${home}駅までの道順（車）` : "Driving directions to home station", "navigation", () => openDrivingRoute(taxiHome.to), true, "far-drive-home")}
          {far ? <TaxiContacts stand={far.taxiStand} companies={far.taxiCompanies} ja={ja} /> : null}
        </>
      ),
    });
  }

  // Earliest home first; unknown arrival last.
  ways.sort((first, second) => (first.homeBy ?? Infinity) - (second.homeBy ?? Infinity));
  const fastest = ways.length > 1 ? ways.find((way) => way.homeBy !== null)?.key ?? null : null;
  const costs = ways.filter((way) => way.cost !== null).map((way) => way.cost!);
  const cheapest = costs.length > 1 ? ways.find((way) => way.cost === Math.min(...costs))?.key ?? null : null;
  const open = selected && ways.some((way) => way.key === selected) ? selected : ways[0]?.key ?? null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === "web" ? 24 : 12), paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <IconButton
            icon="chevron-left"
            label={ja ? "戻る" : "Back"}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/ride"))}
            testID="far-ways-back"
          />
        </View>

        <View style={styles.heading}>
          <Text style={[styles.kicker, { color: colors.primary }]}>{ja ? "歩いて行ける駅がありません" : "NO STATION WITHIN WALKING DISTANCE"}</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {ja ? `${home}への帰り方` : `Ways home to ${home}`}
          </Text>
          {far ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja
                ? `最寄り駅：${stationName}（直線で約${(far.straightMeters / 1000).toFixed(1)}km${far.drive ? `・車で約${far.drive.minutes}分` : ""}）`
                : `Nearest station: ${stationName} (about ${(far.straightMeters / 1000).toFixed(1)} km${far.drive ? `, ${far.drive.minutes} min by car` : ""})`}
            </Text>
          ) : null}
        </View>

        {far && userCoordinates ? (
          <MapCard
            height={150}
            you={userCoordinates}
            target={far.station}
            stationTag={ja ? far.station.nameJa : far.station.name}
            onPress={() => openDrivingRoute(far.station)}
            accessibilityLabel={ja ? `${stationName}への車の経路を地図アプリで開く` : `Open driving directions to ${stationName} in Maps`}
            openLabel={ja ? "地図アプリで開く" : "Open in Maps"}
            legalLabel={ja ? "法的情報" : "Legal"}
          />
        ) : null}

        <View style={styles.options}>
          {ways.map((way) => {
            const isOpen = way.key === open;
            const isFastest = way.key === fastest;
            const isCheapest = way.key === cheapest;
            return (
              <View key={way.key} style={[styles.way, { backgroundColor: colors.card, borderColor: isOpen ? colors.primary : colors.border, borderWidth: isOpen ? 2 : 1 }]}>
                <Pressable
                  testID={`far-way-${way.key}`}
                  onPress={() => setSelected(way.key)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  style={({ pressed }) => [styles.wayHead, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <Feather name={way.icon} size={19} color={isOpen ? colors.primary : colors.mutedForeground} />
                  <View style={styles.wayCopy}>
                    <Text style={[styles.wayLabel, { color: colors.foreground }]}>{way.label}</Text>
                    <Text style={[styles.wayDetail, { color: colors.mutedForeground }]}>
                      {way.homeBy !== null ? (ja ? `${when(way.homeBy)}に到着 · ` : `home ${when(way.homeBy)} · `) : ""}
                      {way.detail}
                    </Text>
                  </View>
                  <View style={styles.wayRight}>
                    <Text style={[styles.wayCost, { color: colors.foreground }]}>{way.costLabel}</Text>
                    {isFastest || isCheapest ? (
                      <View style={[styles.tag, { backgroundColor: isFastest ? colors.primary : colors.secondary }]}>
                        <Text style={[styles.tagText, { color: isFastest ? colors.primaryForeground : colors.secondaryForeground }]}>
                          {isFastest ? (ja ? "最速" : "fastest") : ja ? "最安" : "cheapest"}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
                {isOpen ? <View style={[styles.panel, { borderColor: colors.border }]}>{way.panel}</View> : null}
              </View>
            );
          })}

          {pending.map((row) => (
            <View key={row.key} style={[styles.way, styles.wayHead, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: 0.7 }]}>
              <Feather name={row.icon} size={19} color={colors.mutedForeground} />
              <Text style={[styles.wayDetail, styles.flex, { color: colors.mutedForeground }]}>{row.label}</Text>
              <ActivityIndicator color={colors.mutedForeground} />
            </View>
          ))}

          {ways.length === 0 && pending.length === 0 ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? "今夜利用できる帰り方が見つかりませんでした。" : "No way home was found from here tonight."}
            </Text>
          ) : null}
        </View>

        {gone.length > 0 ? (
          <View style={styles.goneList}>
            <Text style={[styles.goneHead, { color: colors.mutedForeground }]}>{ja ? "今夜は利用できない帰り方" : "Over for tonight"}</Text>
            {gone.map((row) => (
              <View key={row.key} style={styles.goneRow}>
                <Feather name={row.icon} size={15} color={colors.mutedForeground} />
                <Text style={[styles.small, styles.flex, { color: colors.mutedForeground }]}>
                  <Text style={styles.goneLabel}>{row.label}</Text>
                  {`  ${row.note}`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  topbar: { alignItems: "flex-start" },
  heading: { gap: 6 },
  kicker: { fontSize: 12, fontWeight: "700", letterSpacing: 1.3 },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.6 },
  options: { gap: 8 },
  way: { borderRadius: 18, overflow: "hidden" },
  wayHead: { alignItems: "center", flexDirection: "row", gap: 13, padding: 14 },
  wayCopy: { flex: 1, gap: 2 },
  wayLabel: { fontSize: 15, fontWeight: "700" },
  wayDetail: { fontSize: 12 },
  wayRight: { alignItems: "flex-end", gap: 3 },
  wayCost: { fontFamily: DIGITS, fontSize: 16 },
  tag: { borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  panel: { borderTopWidth: 1, gap: 12, padding: 16, paddingTop: 14 },
  timeRow: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  timeLabel: { fontSize: 13, fontWeight: "700", minWidth: 28 },
  time: { fontFamily: DIGITS, fontSize: 26, fontWeight: "800", letterSpacing: -0.3 },
  leaveBy: { fontSize: 15, fontWeight: "800" },
  subhead: { fontSize: 14, fontWeight: "800", marginTop: 4 },
  note: { fontSize: 13, lineHeight: 19 },
  small: { fontSize: 11, lineHeight: 16 },
  loading: { alignItems: "center", flexDirection: "row", gap: 10 },
  list: { gap: 8 },
  listRow: { alignItems: "center", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, paddingRight: 12 },
  listMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  listName: { fontSize: 14, fontWeight: "700" },
  call: { alignItems: "center", flexDirection: "row", gap: 4 },
  callText: { fontSize: 14, fontWeight: "800" },
  button: { alignItems: "center", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 46, paddingHorizontal: 14 },
  buttonText: { flexShrink: 1, fontSize: 15, fontWeight: "800" },
  goneList: { gap: 8 },
  goneHead: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  goneRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  goneLabel: { fontWeight: "700" },
  flex: { flex: 1 },
});
