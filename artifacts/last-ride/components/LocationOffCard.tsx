/**
 * Shown while location is turned off (for LastRide, or for the whole iPhone).
 * iOS asks only once, so the way back is Settings; the app notices by itself
 * when the user returns and picks location up again. Until then, 「駅を選ぶ」
 * lets the app work without location: pick the station you'll leave from.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function LocationOffCard({ ja }: { ja: boolean }) {
  const colors = useColors();
  return (
    <View testID="location-off" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}>
      <View style={styles.head}>
        <Feather name="crosshair" color={colors.primary} size={22} />
        <Text style={[styles.title, { color: colors.foreground }]}>{ja ? "位置情報がオフです" : "Location is off"}</Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {ja
          ? "iPhoneの設定で、帰り時の位置情報を許可してください。戻ると自動で更新します。"
          : "Allow location for LastRide in iPhone Settings. The app updates by itself when you come back."}
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {ja
          ? "位置情報なしでも、出発する駅を選べば終電と出発時刻を表示できます（徒歩時間なし）。"
          : "Without location, choose the station you’ll leave from to see its last train and leave time (no walk time)."}
      </Text>
      <View style={styles.actions}>
        <Pressable
          testID="open-location-settings"
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{ja ? "設定を開く" : "Open Settings"}</Text>
        </Pressable>
        <Pressable
          testID="choose-station-without-location"
          onPress={() => router.push("/departure-station")}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, { borderColor: colors.input, borderWidth: 1, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.foreground }]}>{ja ? "駅を選ぶ" : "Choose station"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1.5, gap: 10, padding: 18 },
  head: { alignItems: "center", flexDirection: "row", gap: 10 },
  title: { fontSize: 18, fontWeight: "800" },
  body: { fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  button: { alignItems: "center", borderRadius: 14, flex: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 12 },
  buttonText: { fontSize: 15, fontWeight: "800" },
});
