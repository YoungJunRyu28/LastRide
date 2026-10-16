/**
 * A plain outline block standing in for content that is still loading (a
 * route, places nearby), so the screen keeps its layout instead of jumping
 * when the content arrives. A gentle fade, no shimmer; still with Reduce Motion.
 */
import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, type DimensionValue, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

export function PlaceholderBlock({ height, width = "100%", radius }: { height: number; width?: DimensionValue; radius?: number }) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.55, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.9, duration: 900, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius ?? colors.radius, height, opacity, width },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: { borderWidth: 1 },
});
