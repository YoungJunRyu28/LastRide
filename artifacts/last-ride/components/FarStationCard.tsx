/**
 * The main screen when no station is within walking reach (5 km): the nearest
 * station large, tonight's last train home from it, the latest time to set off
 * by car, taxi to the station, and how to get a taxi here, with every way home
 * compared (bus, taxi, car, waiting: /far-ways) one tap away. lib/farStation finds it.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { MapCard, openDrivingRoute } from "@/components/MapCard";
import { TaxiContacts } from "@/components/TaxiContacts";
import { DIGITS } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import type { FarStationPlan } from "@/lib/farStation";
import type { Coordinates } from "@/lib/stations";
import { formatYen } from "@/lib/stayPricing";
import { formatJstTime } from "@/lib/time";

export function FarStationCard({
  far,
  ja,
  you,
  homeStation,
  fallbackText,
  onWays,
  onRetry,
}: {
  /** undefined while looking; null when none was found. */
  far: FarStationPlan | null | undefined;
  ja: boolean;
  you: Coordinates | null;
  /** The home station's name, for 「菊名着」. */
  homeStation: string;
  /** Said when no station was found at all. */
  fallbackText: string;
  /** The ways-home screen for this case (bus, taxi, car, waiting). */
  onWays: () => void;
  onRetry: () => void;
}) {
  const colors = useColors();
  const name = far ? (ja ? `${far.station.nameJa}駅` : far.station.name) : "";
  const km = far ? (far.straightMeters / 1000).toFixed(1) : "";
  // Its last train has left: still shown (when it was), but getting to the station is no use now.
  const trainGone = !!far?.lastTrain && far.lastTrain.departsAt <= Date.now();
  const canTrain = !!far?.lastTrain && !trainGone;

  return (
    <View testID="no-walkable-station" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}>
      <View style={styles.kickerRow}>
        <Feather name="navigation" size={14} color={colors.primary} />
        <Text style={[styles.kicker, { color: colors.primary }]}>
          {ja ? "歩いて行ける駅がありません" : "No station within walking distance"}
        </Text>
      </View>

      {far === undefined ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.mutedForeground} />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {ja ? "最寄りの駅を探しています…" : "Finding the nearest station…"}
          </Text>
        </View>
      ) : far === null ? (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{fallbackText}</Text>
      ) : (
        <>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{ja ? "最寄り駅" : "Nearest station"}</Text>
            <Text style={[styles.station, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
              {name}
            </Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? `直線で約${km}km` : `About ${km} km in a straight line`}
              {far.drive ? (ja ? ` · 車で約${far.drive.minutes}分` : ` · about ${far.drive.minutes} min by car`) : ""}
            </Text>
          </View>

          {you ? (
            <MapCard
              height={150}
              you={you}
              target={far.station}
              stationTag={ja ? far.station.nameJa : far.station.name}
              onPress={() => openDrivingRoute(far.station)}
              accessibilityLabel={ja ? `${name}への車の経路を地図アプリで開く` : `Open driving directions to ${name} in Maps`}
              openLabel={ja ? "地図アプリで開く" : "Open in Maps"}
              legalLabel={ja ? "法的情報" : "Legal"}
            />
          ) : null}

          <View style={[styles.trainBox, { borderColor: colors.border }]}>
            {far.lastTrain ? (
              <>
                <View style={styles.trainRow}>
                  <Text style={[styles.trainLabel, { color: colors.mutedForeground }]}>{ja ? "終電" : "Last train"}</Text>
                  <Text style={[styles.trainTime, { color: trainGone ? colors.mutedForeground : colors.foreground }]}>{formatJstTime(far.lastTrain.departsAt)}</Text>
                  <Text style={[styles.trainUnit, { color: trainGone ? colors.mutedForeground : colors.foreground }]}>{ja ? "発" : "dep."}</Text>
                  {far.lastTrain.arrivesAt !== undefined ? (
                    <Text style={[styles.arrive, { color: colors.mutedForeground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                      {ja ? `→ ${homeStation}着 ${formatJstTime(far.lastTrain.arrivesAt)}` : `→ ${homeStation} ${formatJstTime(far.lastTrain.arrivesAt)}`}
                    </Text>
                  ) : null}
                </View>
                {trainGone ? (
                  <Text style={[styles.leaveBy, { color: colors.destructive }]}>
                    {ja ? "今夜の終電は出発済みです" : "Tonight’s last train has left"}
                  </Text>
                ) : far.leaveByCarMs !== null ? (
                  <Text style={[styles.leaveBy, { color: far.leaveByCarMs > Date.now() ? colors.primary : colors.destructive }]}>
                    {far.leaveByCarMs > Date.now()
                      ? ja
                        ? `車・タクシーなら ${formatJstTime(far.leaveByCarMs)} までに出発`
                        : `By car or taxi, leave by ${formatJstTime(far.leaveByCarMs)}`
                      : ja
                        ? "車でも間に合わない時刻です"
                        : "Too late to make it even by car"}
                  </Text>
                ) : null}
                {far.lastTrain.approximate ? (
                  <Text style={[styles.note, { color: colors.subtle }]}>{ja ? "終電時刻は目安です" : "The last train time is approximate"}</Text>
                ) : null}
              </>
            ) : (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? "この駅から自宅へ帰る電車が見つかりませんでした。" : "No train home was found from this station."}
              </Text>
            )}
          </View>

          {canTrain ? (
          <View style={styles.actions}>
            <Pressable
              testID="far-taxi-to-station"
              onPress={() => openDrivingRoute(far.station)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name="truck" size={16} color={colors.primaryForeground} />
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {ja ? "タクシー・車で駅へ" : "Taxi or car to the station"}
                {far.taxiFareYen !== null ? (ja ? `  約${formatYen(far.taxiFareYen)}` : `  ~${formatYen(far.taxiFareYen)}`) : ""}
              </Text>
            </Pressable>
            <Pressable
              testID="far-compare-ways"
              onPress={onWays}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, { borderColor: colors.input, borderWidth: 1, opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="list" size={16} color={colors.foreground} />
              <Text style={[styles.buttonText, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {ja ? "バス・タクシーなど帰り方を比べる" : "Compare bus, taxi and more"}
              </Text>
            </Pressable>
          </View>
          ) : (
            // No train home from it (or it has left): getting to the station is no use, so the other ways home (taxi, somewhere to wait) lead.
            <Pressable
              testID="far-compare-ways-main"
              onPress={onWays}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name="compass" size={16} color={colors.primaryForeground} />
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{ja ? "帰り方を比べる" : "Compare ways home"}</Text>
            </Pressable>
          )}

          <TaxiContacts stand={far.taxiStand} companies={far.taxiCompanies} ja={ja} />
        </>
      )}

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <Pressable testID="retry-location" onPress={onRetry} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.link, { color: colors.primary }]}>{ja ? "現在地でもう一度探す" : "Search again from here"}</Text>
        </Pressable>
        {/* Or start from a station of your choosing (going there by car or bus first,
            or planning ahead from elsewhere): tonight's last train from it, no walk. */}
        <Pressable testID="far-choose-station" onPress={() => router.push("/departure-station")} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.link, { color: colors.primary }]}>{ja ? "駅を選んで調べる" : "Choose a station"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1.5, gap: 14, padding: 18 },
  kickerRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  kicker: { fontSize: 13, fontWeight: "800" },
  loading: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 8 },
  label: { fontSize: 12, fontWeight: "700" },
  station: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  note: { fontSize: 13, lineHeight: 19 },
  trainBox: { borderTopWidth: 1, gap: 6, paddingTop: 12 },
  trainRow: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: 4 },
  trainLabel: { fontSize: 13, fontWeight: "700", marginRight: 4 },
  trainTime: { fontFamily: DIGITS, fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  trainUnit: { fontSize: 15, fontWeight: "700" },
  arrive: { fontSize: 13, fontWeight: "600", marginLeft: 8 },
  leaveBy: { fontSize: 15, fontWeight: "800" },
  actions: { gap: 10 },
  button: { alignItems: "center", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  buttonText: { flexShrink: 1, fontSize: 15, fontWeight: "800" },
  footer: { alignItems: "center", borderTopWidth: 1, gap: 12, paddingTop: 12 },
  link: { fontSize: 14, fontWeight: "700" },
});
