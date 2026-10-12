/**
 * Shown while location is turned off (for LastRide, or for the whole iPhone).
 * iOS asks only once, so the way back is Settings; the app notices by itself
 * when the user returns and picks location up again.
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { locationErrorText } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";

export function LocationOffCard({ ja }: { ja: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      testID="location-off"
      onPress={() => void Linking.openSettings()}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Feather name="crosshair" color={colors.primary} size={18} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.foreground }]}>{ja ? "位置情報をオンにする" : "Turn on location"}</Text>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{locationErrorText("permission", ja)}</Text>
      </View>
      <Feather name="chevron-right" color={colors.mutedForeground} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "700" },
  note: { fontSize: 12, lineHeight: 17 },
});
