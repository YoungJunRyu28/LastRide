import { RailwayMark } from "@/components/RideUI";
import { useLastRide } from "@/context/LastRideContext";
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
  } = useLastRide();
  const ja = language === "ja";

  const choose = (id: string) => {
    selectDestination(id);
    router.replace("/ride");
  };

  const remove = (id: string, label: string) => {
    if (destinations.length <= 1) return;
    const perform = () => deleteDestination(id);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(
        ja ? `「${label}」を削除しますか？` : `Delete “${label}”?`,
      )) perform();
      return;
    }
    Alert.alert(
      ja ? "帰り先を削除" : "Delete destination",
      ja ? `「${label}」を削除しますか？` : `Delete “${label}”?`,
      [
        { text: ja ? "キャンセル" : "Cancel", style: "cancel" },
        { text: ja ? "削除" : "Delete", style: "destructive", onPress: perform },
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
            {ja ? "帰り先" : "DESTINATIONS"}
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {ja ? "今夜はどこへ？" : "Where are you heading?"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {ja
              ? "自宅、会社、友人宅などを端末内だけに保存できます。"
              : "Save Home, Work, a friend’s place, or anywhere else. These stay on this device."}
          </Text>
        </View>

        <View style={styles.list}>
          {destinations.map((destination) => {
            const active = destination.id === activeDestinationId;
            const station = ja ? destination.station.nameJa : destination.station.name;
            return (
              <View
                key={destination.id}
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Pressable
                  testID={`select-destination-${destination.id}`}
                  onPress={() => choose(destination.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.rowMain,
                    { opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <View
                    style={[
                      styles.icon,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.secondary,
                      },
                    ]}
                  >
                    <Feather
                      name={active ? "check" : "map-pin"}
                      size={16}
                      color={
                        active
                          ? colors.primaryForeground
                          : colors.secondaryForeground
                      }
                    />
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                      {destination.label}
                    </Text>
                    <Text
                      style={[styles.rowMeta, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {station}
                      {destination.address ? ` · ${destination.address.label}` : ""}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.actions}>
                  <Pressable
                    testID={`edit-destination-${destination.id}`}
                    onPress={() =>
                      router.push({
                        pathname: "/home-station",
                        params: { id: destination.id },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={ja ? "編集" : "Edit"}
                    hitSlop={8}
                  >
                    <Feather name="edit-3" size={17} color={colors.mutedForeground} />
                  </Pressable>
                  {destinations.length > 1 && (
                    <Pressable
                      testID={`delete-destination-${destination.id}`}
                      onPress={() => remove(destination.id, destination.label)}
                      accessibilityRole="button"
                      accessibilityLabel={ja ? "削除" : "Delete"}
                      hitSlop={8}
                    >
                      <Feather name="trash-2" size={17} color={colors.destructive} />
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          testID="add-destination"
          onPress={() =>
            router.push({ pathname: "/home-station", params: { new: "1" } })
          }
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.addButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <Feather name="plus" size={18} color={colors.primaryForeground} />
          <Text style={[styles.addText, { color: colors.primaryForeground }]}>
            {ja ? "帰り先を追加" : "Add destination"}
          </Text>
        </Pressable>
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
  title: { fontFamily: "Inter_700Bold", fontSize: 32, letterSpacing: -1.1 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  list: { gap: 10 },
  row: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1.5,
    flexDirection: "row",
    padding: 13,
  },
  rowMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12 },
  icon: {
    alignItems: "center",
    borderRadius: 11,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  copy: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  rowMeta: { fontFamily: "Inter_400Regular", fontSize: 12 },
  actions: { alignItems: "center", flexDirection: "row", gap: 16, paddingLeft: 10 },
  addButton: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
  },
  addText: { fontFamily: "Inter_700Bold", fontSize: 14 },
});
