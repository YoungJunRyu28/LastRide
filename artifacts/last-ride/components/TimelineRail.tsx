/**
 * Tonight on one line: leave → the chosen train → any later ones → 終電, with
 * a marker for now. The same stops and states as the widgets and the Live
 * Activity (lib/nightPhase.ts). Stops are evenly spaced so their labels never
 * collide; "now" moves between them by time.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { phaseAt, railStops, stopLabel, stopState, type PhasePlan } from "@/lib/nightPhase";
import { formatJstTime, MINUTE_MS } from "@/lib/time";

/** Where the first and last stops sit, as fractions of the width. */
const FIRST = 0.22;
const LAST = 0.9;
/** The stretch before the first stop covers this long. */
const LEAD_MS = 60 * MINUTE_MS;

export function TimelineRail({ plan, nowMs, ja }: { plan: PhasePlan; nowMs: number; ja: boolean }) {
  const colors = useColors();
  const stops = railStops(plan);
  const phase = phaseAt(plan, nowMs);
  const at = (index: number) => (stops.length === 1 ? LAST : FIRST + ((LAST - FIRST) * index) / (stops.length - 1));
  // Now: before the first stop, between two stops, or past the last.
  let now: number;
  if (nowMs < stops[0].at) now = FIRST * Math.max(0, 1 - (stops[0].at - nowMs) / LEAD_MS);
  else {
    const next = stops.findIndex((stop) => stop.at > nowMs);
    if (next === -1) now = 1;
    else {
      const from = stops[next - 1].at;
      now = at(next - 1) + (at(next) - at(next - 1)) * ((nowMs - from) / (stops[next].at - from));
    }
  }

  return (
    <View
      style={styles.rail}
      accessible
      accessibilityLabel={stops
        .map((stop) => {
          const words = stopLabel(stop, stopState(stop, phase, nowMs), ja);
          return `${words.label} ${formatJstTime(stop.at)}`;
        })
        .join(ja ? "、" : ", ")}
    >
      <View style={[styles.track, { backgroundColor: colors.border }]} />
      <View style={[styles.track, { backgroundColor: colors.mutedForeground, width: `${now * 100}%` }]} />
      {stops.map((stop, index) => {
        const state = stopState(stop, phase, nowMs);
        const tone = index === 0 ? colors.primary : colors.train;
        const color = state === "done" ? colors.input : state === "next" ? tone : colors.subtle;
        const last = index === stops.length - 1;
        return (
          <View key={`${stop.kind}-${stop.at}`} style={[styles.stop, { left: `${at(index) * 100}%` }]}>
            <View
              style={[
                styles.dot,
                state === "later"
                  ? { backgroundColor: colors.background, borderColor: colors.mutedForeground }
                  : { backgroundColor: state === "next" ? tone : colors.secondary, borderColor: state === "next" ? tone : colors.input },
              ]}
            />
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={[styles.label, last && styles.labelLast, { color: state === "done" ? colors.mutedForeground : color }]}
            >
              {stopLabel(stop, state, ja).short}
            </Text>
          </View>
        );
      })}
      <View style={[styles.now, { left: `${now * 100}%`, backgroundColor: colors.foreground }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { height: 44, marginTop: 2 },
  track: { borderRadius: 2, height: 4, left: 0, position: "absolute", right: 0, top: 9 },
  stop: { alignItems: "center", position: "absolute", top: 4, transform: [{ translateX: -40 }], width: 80 },
  dot: { borderRadius: 7, borderWidth: 2, height: 14, width: 14 },
  label: { fontSize: 12, fontWeight: "700", marginTop: 4, textAlign: "center" },
  labelLast: { alignSelf: "flex-end", marginRight: 30 },
  now: { borderRadius: 2, height: 22, position: "absolute", top: 0, transform: [{ translateX: -2 }], width: 4 },
});
