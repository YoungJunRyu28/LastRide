/**
 * The static map card (design 3). Not interactive: tapping hands off to the
 * phone's maps app for walking directions.
 *
 * On iOS builds with modules/apple-maps it shows an Apple map snapshot with
 * the route and labels drawn on top, plus Apple's attribution and legal link
 * (required whenever Apple map data is shown). Elsewhere it draws a stand-in
 * map. Apple's terms require Apple's transit data to be shown with an Apple
 * map, so Apple-sourced times must only ship where the snapshot is available.
 */
import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { AppleMaps } from '@/modules/apple-maps/src';

type Point = { latitude: number; longitude: number };

export type MapPin = { label: string; emphasis?: boolean } & Partial<Point>;

const APPLE_LEGAL_URL = 'https://gspe21-ssl.ls.apple.com/html/attribution.html';
const METERS_PER_DEGREE = 111_320;

/**
 * Opens public-transport directions from the current location to `to` in the
 * maps app: the whole trip, with transfers and walks, not just the boarding
 * station. Apple Maps' URL scheme can't set a departure time; it plans from
 * now, which after the last train means the morning's first trains.
 */
export function openTransitRoute(to: Point) {
  const { latitude, longitude } = to;
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=r`
      : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=transit`;
  void Linking.openURL(url).catch(() => undefined);
}

/** Opens walking directions from the current location to `to` in the maps app. */
export function openWalkingRoute(to: Point) {
  const { latitude, longitude } = to;
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=walking`;
  void Linking.openURL(url).catch(() => undefined);
}

/** A map frame: centre and vertical extent in metres; projects coordinates to pixels. */
type Frame = { center: Point; spanMeters: number; width: number; height: number };

function frameFor(points: Point[], width: number, height: number): Frame {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const center = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
  const cos = Math.cos((center.latitude * Math.PI) / 180);
  const northSpan = (Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEGREE;
  const eastSpan = (Math.max(...lons) - Math.min(...lons)) * METERS_PER_DEGREE * cos;
  // Fit both directions with a margin; at least 500 m tall so a short walk isn't a blur.
  const spanMeters = Math.max(500, northSpan * 1.6, (eastSpan * 1.4 * height) / width);
  return { center, spanMeters, width, height };
}

function project(frame: Frame, point: Point) {
  const metersPerPx = frame.spanMeters / frame.height;
  const cos = Math.cos((frame.center.latitude * Math.PI) / 180);
  const east = (point.longitude - frame.center.longitude) * METERS_PER_DEGREE * cos;
  const north = (point.latitude - frame.center.latitude) * METERS_PER_DEGREE;
  return { x: frame.width / 2 + east / metersPerPx, y: frame.height / 2 - north / metersPerPx };
}

/** Apple map snapshot for this frame, or null while loading / unavailable. */
function useSnapshot(frame: Frame | null) {
  const [uri, setUri] = useState<string | null>(null);
  const key = frame
    ? `${frame.center.latitude.toFixed(4)},${frame.center.longitude.toFixed(4)},${Math.round(frame.spanMeters)},${Math.round(frame.width)}x${frame.height}`
    : null;
  useEffect(() => {
    if (!AppleMaps || !frame) return;
    let active = true;
    void AppleMaps.snapshot({ center: frame.center, spanMeters: frame.spanMeters, width: frame.width, height: frame.height })
      .then((result) => {
        if (active) setUri(result);
      })
      .catch(() => {
        if (active) setUri(null);
      });
    return () => {
      active = false;
    };
    // The key captures everything about the frame that changes the image.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return uri;
}

export function MapCard({
  height = 186,
  stationTag,
  walkLabel,
  pins,
  you,
  target,
  path,
  onPress,
  accessibilityLabel,
  openLabel,
}: {
  height?: number;
  /** Station tag at the end of the walk, e.g. "渋谷 A2". */
  stationTag?: string;
  /** Walking-time bubble, e.g. "徒歩8分". */
  walkLabel?: string;
  /** Places shown instead of a walk (the If missed screen). */
  pins?: MapPin[];
  /** Where the user is. With `target` (or pins with coordinates) the card shows a real map where available. */
  you?: Point | null;
  target?: Point | null;
  /** Walking path from `you` to `target`, if known. */
  path?: Point[];
  onPress?: () => void;
  accessibilityLabel: string;
  openLabel: string;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const showWalk = !pins;
  const geoPoints: Point[] = [
    ...(you ? [you] : []),
    ...(showWalk && target ? [target] : []),
    ...(pins ?? []).filter((pin): pin is MapPin & Point => pin.latitude !== undefined && pin.longitude !== undefined),
  ];
  const frame = AppleMaps && width > 0 && geoPoints.length >= 2 ? frameFor(geoPoints, width, height) : null;
  const snapshot = useSnapshot(frame);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.card,
        { height, backgroundColor: colors.map, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {frame && snapshot ? (
          <RealOverlay
            frame={frame}
            snapshot={snapshot}
            you={you ?? null}
            target={showWalk ? (target ?? null) : null}
            path={path}
            stationTag={stationTag}
            walkLabel={walkLabel}
            pins={pins}
          />
        ) : (
          <DrawnMap height={height} showWalk={showWalk} stationTag={stationTag} walkLabel={walkLabel} pins={pins} />
        )}

        {onPress ? (
          <View style={[styles.openChip, { backgroundColor: 'rgba(10, 19, 34, 0.85)' }]}>
            <Text style={[styles.openText, { color: colors.foreground }]}>{openLabel}</Text>
            <Feather name="arrow-up-right" size={12} color={colors.foreground} />
          </View>
        ) : null}
      </View>
      {frame && snapshot ? (
        // The snapshot carries Apple's Maps logo; the legal link sits beside it,
        // outside the pointer-disabled layer so it stays tappable.
        <Pressable onPress={() => void Linking.openURL(APPLE_LEGAL_URL)} accessibilityRole="link" hitSlop={8} style={styles.attribution}>
          <Text style={styles.attributionText}>法的情報</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function RealOverlay({
  frame,
  snapshot,
  you,
  target,
  path,
  stationTag,
  walkLabel,
  pins,
}: {
  frame: Frame;
  snapshot: string;
  you: Point | null;
  target: Point | null;
  path?: Point[];
  stationTag?: string;
  walkLabel?: string;
  pins?: MapPin[];
}) {
  const colors = useColors();
  const line = you && target ? (path && path.length > 1 ? path : [you, target]).map((point) => project(frame, point)) : [];
  const middle = line.length > 0 ? line[Math.floor(line.length / 2)] : null;
  const youPx = you ? project(frame, you) : null;
  const targetPx = target ? project(frame, target) : null;
  return (
    <>
      <Image source={{ uri: snapshot }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
      {line.length > 1 && (
        <Svg width={frame.width} height={frame.height} style={StyleSheet.absoluteFill}>
          <Polyline
            points={line.map(({ x, y }) => `${x},${y}`).join(' ')}
            stroke={colors.primary}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 9"
            fill="none"
          />
        </Svg>
      )}
      {targetPx && stationTag ? (
        <View style={[styles.stationTag, { left: targetPx.x - 40, top: targetPx.y - 30, width: 80 }]}>
          <Text numberOfLines={1} style={[styles.stationTagText, { backgroundColor: colors.line }]}>
            {stationTag}
          </Text>
          <View style={[styles.stationDot, { backgroundColor: colors.line, borderColor: colors.map }]} />
        </View>
      ) : null}
      {middle && walkLabel ? (
        <Text
          style={[
            styles.bubble,
            { left: middle.x - 30, top: middle.y - 10, backgroundColor: colors.background, borderColor: colors.input, color: colors.foreground },
          ]}
        >
          {walkLabel}
        </Text>
      ) : null}
      {(pins ?? []).slice(0, 4).map((pin, index) => {
        if (pin.latitude === undefined || pin.longitude === undefined) return null;
        const { x, y } = project(frame, { latitude: pin.latitude, longitude: pin.longitude });
        return (
          <Text
            key={`${index}-${pin.label}`}
            numberOfLines={1}
            style={[
              styles.bubble,
              { left: x - 40, top: y - 10 },
              pin.emphasis
                ? { backgroundColor: colors.primary, borderColor: colors.primary, color: colors.primaryForeground }
                : { backgroundColor: colors.background, borderColor: colors.input, color: colors.foreground },
            ]}
          >
            {pin.label}
          </Text>
        );
      })}
      {youPx ? <View style={[styles.you, { left: youPx.x - 11, top: youPx.y - 11, borderColor: colors.primary }]} /> : null}
    </>
  );
}

/** The stand-in map: roads, river, and labels at fixed spots. */
function DrawnMap({
  height,
  showWalk,
  stationTag,
  walkLabel,
  pins,
}: {
  height: number;
  showWalk: boolean;
  stationTag?: string;
  walkLabel?: string;
  pins?: MapPin[];
}) {
  const colors = useColors();
  return (
    <>
      <View style={[styles.road, { top: height * 0.62, height: 30, backgroundColor: colors.mapWater, transform: [{ rotate: '-8deg' }] }]} />
      <View style={[styles.road, { top: height * 0.3, height: 12, backgroundColor: colors.mapRoad, transform: [{ rotate: '-12deg' }] }]} />
      <View style={[styles.avenue, { left: '34%', backgroundColor: colors.mapRoad, transform: [{ rotate: '14deg' }] }]} />
      <View style={[styles.avenue, { left: '74%', width: 8, backgroundColor: colors.mapRoad, transform: [{ rotate: '-6deg' }] }]} />

      {showWalk && (
        <>
          <Svg width="100%" height="100%" viewBox={`0 0 350 ${height}`} preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
            <Path
              d={`M60 ${height - 38} C 100 ${height - 56}, 130 ${height * 0.53}, 170 ${height * 0.48} S 240 ${height * 0.34}, 270 ${height * 0.21}`}
              stroke={colors.primary}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray="2 9"
              fill="none"
            />
          </Svg>
          <View style={[styles.you, { left: '14%', top: height - 49, borderColor: colors.primary }]} />
          {stationTag ? (
            <View style={[styles.stationTag, { left: '70%', top: 12 }]}>
              <Text style={[styles.stationTagText, { backgroundColor: colors.line }]}>{stationTag}</Text>
              <View style={[styles.stationDot, { backgroundColor: colors.line, borderColor: colors.map }]} />
            </View>
          ) : null}
          {walkLabel ? (
            <Text style={[styles.bubble, { left: '39%', top: height * 0.52, backgroundColor: colors.background, borderColor: colors.input, color: colors.foreground }]}>
              {walkLabel}
            </Text>
          ) : null}
        </>
      )}

      {pins && (
        <>
          <View style={[styles.you, { left: '46%', top: height * 0.46, borderColor: colors.primary }]} />
          {pins.slice(0, 4).map((pin, index) => {
            const spots = [
              { left: '60%', top: 0.2 },
              { left: '6%', top: 0.16 },
              { left: '50%', top: 0.56 },
              { left: '6%', top: 0.62 },
            ][index];
            return (
              <Text
                key={`${index}-${pin.label}`}
                numberOfLines={1}
                style={[
                  styles.bubble,
                  { left: spots.left as `${number}%`, top: height * spots.top },
                  pin.emphasis
                    ? { backgroundColor: colors.primary, borderColor: colors.primary, color: colors.primaryForeground }
                    : { backgroundColor: colors.background, borderColor: colors.input, color: colors.foreground },
                ]}
              >
                {pin.label}
              </Text>
            );
          })}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1, overflow: 'hidden' },
  road: { left: -40, position: 'absolute', right: -40 },
  avenue: { bottom: -40, position: 'absolute', top: -40, width: 10 },
  you: {
    backgroundColor: '#FFFFFF',
    borderRadius: 11,
    borderWidth: 5,
    height: 22,
    position: 'absolute',
    width: 22,
  },
  stationTag: { alignItems: 'center', gap: 3, position: 'absolute' },
  stationTagText: {
    borderRadius: 7,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  stationDot: { borderRadius: 6, borderWidth: 3, height: 12, width: 12 },
  bubble: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    position: 'absolute',
  },
  openChip: {
    alignItems: 'center',
    borderRadius: 8,
    bottom: 8,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    right: 10,
  },
  openText: { fontSize: 11, fontWeight: '700' },
  attribution: { bottom: 7, left: 64, position: 'absolute' },
  attributionText: { color: '#C9D4DE', fontSize: 10, fontWeight: '600', textDecorationLine: 'underline' },
});
