import { BottomNav } from "@/components/BottomNav";
import { Card, IconButton, PremiumTag, SecondaryButton, SectionLabel } from "@/components/ui";
import { useLastRide } from "@/context/LastRideContext";
import { FREE_DESTINATIONS, usePremium } from "@/context/PremiumContext";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
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

export default function DestinationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    language,
    destinations,
    activeDestinationId,
    selectDestination,
    deleteDestination,
    tonightDestination,
    setTonightDestination,
  } = useLastRide();
  const { isPremium } = usePremium();
  const ja = language === "ja";
  const canAdd = isPremium || destinations.length < FREE_DESTINATIONS;
  const usualLabel =
    destinations.find((destination) => destination.id === activeDestinationId)?.label ??
    destinations[0]?.label ??
    (ja ? "自宅" : "Home");

  const choose = (id: string) => {
    selectDestination(id);
    router.dismissTo("/ride");
  };

  const remove = (id: string, label: string) => {
    if (destinations.length <= 1) return;
    const perform = () => deleteDestination(id);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(ja ? `「${label}」を削除しますか？` : `Delete “${label}”?`)) perform();
      return;
    }
    Alert.alert(ja ? "帰る場所を削除" : "Delete destination", ja ? `「${label}」を削除しますか？` : `Delete “${label}”?`, [
      { text: ja ? "キャンセル" : "Cancel", style: "cancel" },
      { text: ja ? "削除" : "Delete", style: "destructive", onPress: perform },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === "web" ? 24 : 8), paddingBottom: 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <IconButton
            icon="chevron-left"
            label={ja ? "戻る" : "Back"}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/ride"))}
            testID="destinations-back"
          />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.kicker, { color: colors.primary }]}>{ja ? "帰る場所" : "DESTINATIONS"}</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {ja ? "今夜はどこに帰りますか？" : "Where are you heading?"}
          </Text>
        </View>

        <View style={styles.list}>
          {destinations.map((destination) => {
            const active = !tonightDestination && destination.id === activeDestinationId;
            const station = ja ? destination.station.nameJa : destination.station.name;
            return (
              <View
                key={destination.id}
                style={[styles.row, { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border, borderWidth: active ? 2 : 1 }]}
              >
                <Pressable
                  testID={`select-destination-${destination.id}`}
                  onPress={() => choose(destination.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.65 : 1 }]}
                >
                  <View style={[styles.icon, { backgroundColor: active ? colors.primary : colors.secondary }]}>
                    <Feather name={active ? "check" : "home"} size={16} color={active ? colors.primaryForeground : colors.foreground} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{destination.label}</Text>
                    <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {station}
                      {destination.address ? (ja ? " · 住所登録済み" : " · with address") : ""}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  <Pressable
                    testID={`edit-destination-${destination.id}`}
                    onPress={() => router.push({ pathname: "/home-station", params: { id: destination.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={ja ? `${destination.label}を編集` : `Edit ${destination.label}`}
                    hitSlop={10}
                  >
                    <Feather name="edit-3" size={17} color={colors.mutedForeground} />
                  </Pressable>
                  {destinations.length > 1 && (
                    <Pressable
                      testID={`delete-destination-${destination.id}`}
                      onPress={() => remove(destination.id, destination.label)}
                      accessibilityRole="button"
                      accessibilityLabel={ja ? `${destination.label}を削除` : `Delete ${destination.label}`}
                      hitSlop={10}
                    >
                      <Feather name="trash-2" size={17} color={colors.destructive} />
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <SectionLabel>{ja ? "今夜" : "Tonight"}</SectionLabel>
          {tonightDestination ? (
            <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2 }]}>
              <View style={styles.rowMain}>
                <View style={[styles.icon, { backgroundColor: colors.primary }]}>
                  <Feather name="moon" size={16} color={colors.primaryForeground} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    {ja ? tonightDestination.nameJa : tonightDestination.name}
                  </Text>
                  <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                    {ja ? `今夜だけ · 明日は${usualLabel}に戻ります` : `Tonight only · back to ${usualLabel} tomorrow`}
                  </Text>
                </View>
              </View>
              <Pressable
                testID="clear-tonight-destination"
                onPress={() => setTonightDestination(null)}
                accessibilityRole="button"
                accessibilityLabel={ja ? "今夜の行き先をやめる" : "Clear tonight’s destination"}
                hitSlop={10}
                style={styles.actions}
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              testID="tonight-destination"
              onPress={() => router.push({ pathname: "/home-station", params: { tonight: "1" } })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pressed ? 0.75 : 1 }]}
            >
              <View style={styles.rowMain}>
                <View style={[styles.icon, { backgroundColor: colors.secondary }]}>
                  <Feather name="moon" size={16} color={colors.primary} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>{ja ? "今夜は別の場所へ" : "Somewhere else tonight"}</Text>
                  <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                    {ja ? `保存せずに今夜だけ使います。明日は${usualLabel}に戻ります。` : `Not saved. Tomorrow you’re back to ${usualLabel}.`}
                  </Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {canAdd ? (
          <SecondaryButton
            label={ja ? "帰る場所を追加" : "Save another destination"}
            onPress={() => router.push({ pathname: "/home-station", params: { new: "1" } })}
            testID="add-destination"
          />
        ) : (
          <Card highlighted style={styles.premium}>
            <View style={styles.premiumHead}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>{ja ? "帰る場所を追加" : "Save more destinations"}</Text>
              <PremiumTag label={ja ? "プレミアム" : "Premium"} />
            </View>
            <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
              {ja
                ? "実家や職場など、帰る場所を複数登録してすぐに切り替えられます。無料プランでは1件まで登録できます。"
                : "Save a partner’s place, your parents’, work — as many as you like, one tap to switch. The free plan keeps one."}
            </Text>
            <SecondaryButton tone="accent" label={ja ? "プレミアムを見る" : "See Premium"} onPress={() => router.push("/paywall")} testID="destinations-premium" />
          </Card>
        )}

        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          {ja ? "登録した帰る場所は、この端末にのみ保存されます。" : "Destinations are stored only on this device."}
        </Text>
      </ScrollView>
      <BottomNav language={language} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  topbar: { flexDirection: "row" },
  heading: { gap: 6 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.6 },
  list: { gap: 10 },
  section: { gap: 8 },
  row: { alignItems: "center", borderRadius: 18, flexDirection: "row", padding: 13 },
  rowMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12 },
  icon: { alignItems: "center", borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  copy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "800" },
  rowMeta: { fontSize: 12, lineHeight: 17 },
  actions: { alignItems: "center", flexDirection: "row", gap: 16, paddingLeft: 10 },
  premium: { gap: 10, padding: 16 },
  premiumHead: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footnote: { fontSize: 12, textAlign: "center" },
});
