import { RailwayMark } from "@/components/RideUI";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import {
  clearNightHistory,
  readNightHistory,
  type NightHistoryEntry,
} from "@/lib/nightHistory";
import { formatJstTime } from "@/lib/time";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function dateLabel(serviceDate: string): string {
  if (!/^\d{8}$/.test(serviceDate)) return serviceDate;
  return `${serviceDate.slice(0, 4)}/${serviceDate.slice(4, 6)}/${serviceDate.slice(6)}`;
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language === "ja";
  const [entries, setEntries] = useState<NightHistoryEntry[]>([]);

  useEffect(() => {
    void readNightHistory().then(setEntries);
  }, []);

  const clear = () => {
    const perform = () => {
      void clearNightHistory().then(() => setEntries([]));
    };
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm(ja ? "履歴をすべて削除しますか？" : "Clear all night history?")
      ) {
        perform();
      }
      return;
    }
    Alert.alert(
      ja ? "履歴を削除" : "Clear history",
      ja
        ? "この端末に保存された夜の履歴をすべて削除します。"
        : "This deletes all night history stored on this device.",
      [
        { text: ja ? "キャンセル" : "Cancel", style: "cancel" },
        {
          text: ja ? "削除" : "Clear",
          style: "destructive",
          onPress: perform,
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 14),
            paddingBottom: insets.bottom + 30,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            hitSlop={12}
          >
            <Feather name="arrow-left" size={21} color={colors.foreground} />
          </Pressable>
          <View style={styles.brand}>
            <RailwayMark size={22} />
            <Text style={[styles.brandText, { color: colors.foreground }]}>
              LastRide
            </Text>
          </View>
          <View style={styles.spacer} />
        </View>

        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            {ja ? "この端末のみ" : "ON THIS DEVICE"}
          </Text>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {ja ? "夜の履歴" : "Night history"}
            </Text>
            {entries.length > 0 && (
              <Pressable
                testID="clear-night-history"
                onPress={clear}
                accessibilityRole="button"
              >
                <Text style={[styles.clearText, { color: colors.destructive }]}>
                  {ja ? "すべて削除" : "Clear"}
                </Text>
              </Pressable>
            )}
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {ja
              ? "移動履歴ではありません。出発駅・帰り先・時刻だけを端末内に保存します。"
              : "This is not a location trail. Only the departure station, destination and plan times are kept locally."}
          </Text>
        </View>

        {entries.length === 0 ? (
          <View
            style={[
              styles.empty,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="moon" size={24} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {ja ? "まだ履歴はありません" : "No nights yet"}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              {ja
                ? "LastRideで今夜のプランを計算すると、ここに自動で残ります。"
                : "A night appears here automatically after LastRide calculates a plan."}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => (
              <View
                key={entry.id}
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardHeading}>
                    <Text
                      style={[styles.destination, { color: colors.foreground }]}
                    >
                      {entry.destinationLabel}
                    </Text>
                    <Text
                      style={[styles.station, { color: colors.mutedForeground }]}
                    >
                      {(ja
                        ? entry.departureStationJa
                        : entry.departureStation) || "—"}
                    </Text>
                  </View>
                  <Text style={[styles.date, { color: colors.mutedForeground }]}>
                    {dateLabel(entry.serviceDate)}
                  </Text>
                </View>

                <View style={styles.times}>
                  <View style={styles.metric}>
                    <Text
                      style={[styles.metricLabel, { color: colors.mutedForeground }]}
                    >
                      {ja ? "出発目安" : "LEAVE BY"}
                    </Text>
                    <Text style={[styles.metricValue, { color: colors.foreground }]}>
                      {formatJstTime(entry.leaveByMs)}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text
                      style={[styles.metricLabel, { color: colors.mutedForeground }]}
                    >
                      {ja ? "終電" : "LAST TRAIN"}
                    </Text>
                    <Text style={[styles.metricValue, { color: colors.foreground }]}>
                      {formatJstTime(entry.lastTrainDepartsAt)}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text
                      style={[styles.metricLabel, { color: colors.mutedForeground }]}
                    >
                      {ja ? "到着" : "ARRIVAL"}
                    </Text>
                    <Text style={[styles.metricValue, { color: colors.foreground }]}>
                      {entry.arrivalMs ? formatJstTime(entry.arrivalMs) : "—"}
                    </Text>
                  </View>
                </View>

                {entry.fareYen !== null && (
                  <Text style={[styles.fare, { color: colors.mutedForeground }]}>
                    {ja ? "運賃" : "Fare"} · ¥
                    {entry.fareYen.toLocaleString("en-US")}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 20, paddingHorizontal: 20 },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brand: { alignItems: "center", flexDirection: "row", gap: 7 },
  brandText: { fontFamily: "Inter_700Bold", fontSize: 17 },
  spacer: { width: 21 },
  heading: { gap: 7, marginTop: 5 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1.1 },
  titleRow: {
    alignItems: "baseline",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 32, letterSpacing: -1.1 },
  clearText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  empty: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 28,
  },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  emptyBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  list: { gap: 11 },
  card: { borderRadius: 20, borderWidth: 1, gap: 15, padding: 17 },
  cardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardHeading: { flex: 1, gap: 2 },
  destination: { fontFamily: "Inter_700Bold", fontSize: 17 },
  station: { fontFamily: "Inter_400Regular", fontSize: 12 },
  date: { fontFamily: "Inter_500Medium", fontSize: 12 },
  times: { flexDirection: "row", justifyContent: "space-between" },
  metric: { gap: 2 },
  metricLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.7 },
  metricValue: { fontFamily: "Inter_700Bold", fontSize: 17 },
  fare: { fontFamily: "Inter_400Regular", fontSize: 12 },
});
