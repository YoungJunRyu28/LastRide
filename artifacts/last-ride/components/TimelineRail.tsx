/**
 * Tonight on one line: leave → the chosen train → any later ones → 終電, with
 * a marker for now. The same stops and states as the widgets and the Live
 * Activity (lib/nightPhase.ts). Stops are evenly spaced so their labels never
 * collide; "now" moves between them by time.
 */
import React, { useState } from "react";
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
  const [width, setWidth] = useState(0);
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
  // Each label gets the room between its neighbours, kept inside the rail at both ends.
  const gap = stops.length > 1 ? ((LAST - FIRST) * width) / (stops.length - 1) : width;
  const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.max(40, gap - 6));

  return (
    <View
      style={styles.rail}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={stops
        .map((stop) => `${stopLabel(stop, stopState(stop, phase, nowMs), ja).label} ${formatJstTime(stop.at)}`)
        .join(ja ? "、" : ", ")}
    >
      <View style={[styles.track, { backgroundColor: colors.border }]} />
      <View style={[styles.track, { backgroundColor: colors.mutedForeground, width: `${now * 100}%` }]} />
      {width > 0 &&
        stops.map((stop, index) => {
          const state = stopState(stop, phase, nowMs);
          const tone = index === 0 ? colors.primary : colors.train;
          const color = state === "done" ? colors.mutedForeground : state === "next" ? tone : colors.subtle;
          const x = at(index) * width;
          const left = Math.min(Math.max(0, x - labelWidth / 2), width - labelWidth);
          return (
            <React.Fragment key={`${stop.kind}-${stop.at}`}>
              <View
                style={[
                  styles.dot,
                  { left: x - DOT / 2 },
                  state === "later"
                    ? { backgroundColor: colors.background, borderColor: colors.mutedForeground }
                    : { backgroundColor: state === "next" ? tone : colors.secondary, borderColor: state === "next" ? tone : colors.input },
                ]}
              />
              <View style={[styles.label, { left, width: labelWidth }]}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.2} style={[styles.name, { color }]}>
                  {stopLabel(stop, state, ja).label}
                </Text>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.2} style={[styles.time, { color }]}>
                  {formatJstTime(stop.at)}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      <View style={[styles.now, { left: `${now * 100}%`, backgroundColor: colors.foreground }]} />
    </View>
  );
}

const DOT = 14;
/** Labels never get wider than this, even with only two stops. */
const MAX_LABEL_WIDTH = 84;

const styles = StyleSheet.create({
  rail: { height: 58, marginTop: 2 },
  track: { borderRadius: 2, height: 4, left: 0, position: "absolute", right: 0, top: 9 },
  dot: { borderRadius: DOT / 2, borderWidth: 2, height: DOT, position: "absolute", top: 4, width: DOT },
  label: { alignItems: "center", position: "absolute", top: 22 },
  name: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  time: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "800", textAlign: "center" },
  now: { borderRadius: 2, height: 22, position: "absolute", top: 0, transform: [{ translateX: -2 }], width: 4 },
});
