/**
 * The static map card (design 3). Not interactive: tapping hands off to the
 * phone's maps app for walking directions.
 *
 * On iOS builds with modules/apple-maps it shows an Apple map snapshot with
 * the route and labels drawn on top, plus Apple's attribution and legal link
 * (required whenever Apple map data is shown). Android uses the
 * Google Maps native SDK when a restricted API key is provisioned; otherwise
 * it uses the illustrated, non-geographic placeholder. Apple's terms require Apple's transit data to be shown with an Apple
 * map, so Apple-sourced times must only ship where the snapshot is available.
 */
import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { AppleMaps } from '@/modules/apple-maps/src';
import GoogleMapCardBackground, { googleMapsConfigured } from './GoogleMapCardBackground';
import { isSafeMapSnapshotFrame, isValidMapCoordinate } from '@/lib/mapSnapshotGuard';
import { verifiedMapPath } from '@/lib/verifiedMapPath';

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

/** Opens driving directions (a taxi ride) from the current location to `to` in the maps app. */
export function openDrivingRoute(to: Point) {
  const { latitude, longitude } = to;
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
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

/** Kept clear at the bottom of the map for the attribution and "Open route in Maps". */
const BOTTOM_BAND = 34;

/** How close the walk-to-the-station map can zoom: about two blocks top to bottom. */
const WALK_MIN_SPAN_METERS = 280;

/** A map frame: centre and vertical extent in metres; projects coordinates to pixels. */
type Frame = { center: Point; spanMeters: number; width: number; height: number };

function frameFor(points: Point[], width: number, height: number, minSpanMeters = 500): Frame {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const center = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
  const cos = Math.cos((center.latitude * Math.PI) / 180);
  const northSpan = (Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEGREE;
  const eastSpan = (Math.max(...lons) - Math.min(...lons)) * METERS_PER_DEGREE * cos;
  // Fit both directions with a margin, with a floor so a short walk isn't a blur,
  // into the part of the card above the bottom row ("Open route in Maps").
  const content = height - BOTTOM_BAND;
  const contentSpan = Math.max(minSpanMeters, northSpan * 1.6, (eastSpan * 1.4 * content) / width);
  const spanMeters = (contentSpan * height) / content;
  // Move the centre south so the points sit in that upper part.
  const shiftMeters = (BOTTOM_BAND / 2) * (spanMeters / height);
  return { center: { latitude: center.latitude - shiftMeters / METERS_PER_DEGREE, longitude: center.longitude }, spanMeters, width, height };
}

function project(frame: Frame, point: Point) {
  const metersPerPx = frame.spanMeters / frame.height;
  const cos = Math.cos((frame.center.latitude * Math.PI) / 180);
  const east = (point.longitude - frame.center.longitude) * METERS_PER_DEGREE * cos;
  const north = (point.latitude - frame.center.latitude) * METERS_PER_DEGREE;
  return { x: frame.width / 2 + east / metersPerPx, y: frame.height / 2 - north / metersPerPx };
}

/**
 * Apple map snapshot for this frame, with the frame it was taken for (so
 * overlays line up with the image while a new one loads), or null while
 * loading / unavailable.
 */
function useSnapshot(frame: Frame | null) {
  const [shot, setShot] = useState<{ uri: string; frame: Frame; key: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = frame
    ? `${frame.center.latitude.toFixed(4)},${frame.center.longitude.toFixed(4)},${Math.round(frame.spanMeters)},${Math.round(frame.width)}x${frame.height}`
    : null;
  useEffect(() => {
    if (!AppleMaps || !frame) return;
    let active = true;
    void AppleMaps.snapshot({ center: frame.center, spanMeters: frame.spanMeters, width: frame.width, height: frame.height })
      .then((uri) => {
        if (!active) return;
        setShot(uri && key ? { uri, frame, key } : null);
        setFailedKey(uri ? null : key);
      })
      .catch(() => {
        if (!active) return;
        setShot(null);
        setFailedKey(key);
      });
    return () => {
      active = false;
    };
    // The key captures everything about the frame that changes the image.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Don't show old geographic tiles under a new user's position while the
  // replacement image is still loading. The fallback cannot misplace a pin.
  return {
    snapshot: frame && shot?.key === key ? shot : null,
    failed: !!key && key === failedKey,
  };
}

export function MapCard({
  height = 186,
  stationTag,
  walkLabel,
  pins,
  frameTo,
  you,
  target,
  path,
  onPress,
  accessibilityLabel,
  openLabel,
  legalLabel = '法的情報',
}: {
  height?: number;
  /** Station tag at the end of the walk, e.g. "渋谷 A2". */
  stationTag?: string;
  /** Walking-time bubble, e.g. "徒歩8分". */
  walkLabel?: string;
  /** Places shown instead of a walk (the If missed screen). */
  pins?: MapPin[];
  /**
   * Extra points the map is framed to include without a label (e.g. the rest of
   * a list), so picking a different pin doesn't move the map.
   */
  frameTo?: Point[];
  /** Where the user is. With `target` (or pins with coordinates) the card shows a real map where available. */
  you?: Point | null;
  target?: Point | null;
  /** Walking path from `you` to `target`, if known. */
  path?: Point[];
  onPress?: () => void;
  accessibilityLabel: string;
  openLabel: string;
  /** Apple's required legal link next to the Maps logo. */
  legalLabel?: string;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const showWalk = !pins;
  const safePath = verifiedMapPath(path);
  const geoPoints: Point[] = [
    ...(you ? [you] : []),
    ...(showWalk && target ? [target] : []),
    ...(pins ?? []).filter((pin): pin is MapPin & Point => pin.latitude !== undefined && pin.longitude !== undefined),
  ];
  const framePoints = [...geoPoints, ...(frameTo ?? [])];
  const hasValidFrame =
    framePoints.length >= 2 &&
    framePoints.every(isValidMapCoordinate) &&
    Number.isFinite(width) && Number.isFinite(height) &&
    width >= 1 && width <= 4096 && height >= 1 && height <= 4096;
  const candidateFrame = (AppleMaps || googleMapsConfigured) && hasValidFrame
    ? frameFor(framePoints, width, height, showWalk ? WALK_MIN_SPAN_METERS : undefined)
    : null;
  const frame = candidateFrame && isSafeMapSnapshotFrame(candidateFrame) ? candidateFrame : null;
  const { snapshot, failed: snapshotFailed } = useSnapshot(AppleMaps ? frame : null);
  const googleReady = Platform.OS === 'android' && googleMapsConfigured && frame !== null;

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
        {googleReady ? (
          <GoogleMapCardBackground
            frame={frame!}
            you={you}
            target={showWalk ? target : null}
            path={showWalk ? safePath : undefined}
            pins={pins}
            stationTag={stationTag}
            walkLabel={walkLabel ? `≈ ${walkLabel}` : undefined}
          />
        ) : snapshot ? (
          <RealOverlay
            frame={snapshot.frame}
            snapshot={snapshot.uri}
            you={you ?? null}
            target={showWalk ? (target ?? null) : null}
            path={safePath}
            stationTag={stationTag}
            walkLabel={walkLabel}
            pins={pins}
          />
        ) : (
          <DrawnMap height={height} showWalk={showWalk} stationTag={stationTag} walkLabel={walkLabel} pins={pins} />
        )}

        {(Platform.OS === 'ios' && !snapshot && !!AppleMaps && frame !== null ||
          Platform.OS === 'android' && !googleMapsConfigured && hasValidFrame) ? (
          <View style={styles.mapUnavailable}>
            <Text style={styles.mapUnavailableText}>{Platform.OS === 'ios' && !snapshotFailed
              ? '地図を読み込み中 / Loading map…'
              : '地図プレビューを表示できません / Map preview unavailable'}</Text>
          </View>
        ) : null}

        {onPress ? (
          <View style={[styles.openChip, { backgroundColor: 'rgba(10, 19, 34, 0.85)' }]}>
            <Text style={[styles.openText, { color: colors.foreground }]}>{openLabel}</Text>
            <Feather name="arrow-up-right" size={12} color={colors.foreground} />
          </View>
        ) : null}
      </View>
      {snapshot ? (
        // The snapshot carries Apple's Maps logo; the legal link sits beside it,
        // outside the pointer-disabled layer so it stays tappable.
        <Pressable onPress={() => void Linking.openURL(APPLE_LEGAL_URL)} accessibilityRole="link" hitSlop={8} style={styles.attribution}>
          <Text style={styles.attributionText}>{legalLabel}</Text>
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
  // Never draw an imaginary straight-line walk on an Apple map when MapKit
  // provided an ETA but not an actual polyline (barriers and crossings matter).
  const line = you && target ? verifiedMapPath(path).map((point) => project(frame, point)) : [];
  const middle = line.length > 0 ? line[Math.floor(line.length / 2)] : null;
  const youPx = you ? project(frame, you) : null;
  const targetPx = target ? project(frame, target) : null;
  // Labels sit above their dot, but slide inward at the map's edges (never cut
  // off); the dot always stays exactly on the place.
  const stationWidth = stationTag ? Math.min(labelWidth(stationTag, 13), frame.width - 2 * EDGE) : 0;
  const walkWidth = walkLabel ? Math.min(labelWidth(walkLabel, 11), frame.width - 2 * EDGE) : 0;
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
        <>
          <View style={[styles.stationDot, styles.placed, { left: targetPx.x - 6, top: targetPx.y - 6, backgroundColor: colors.line, borderColor: colors.map }]} />
          <Text
            numberOfLines={1}
            style={[
              styles.stationTagText,
              styles.placed,
              {
                left: clampLeft(targetPx.x, stationWidth, frame.width),
                // On the side away from you, so it doesn't cover the walk coming in.
                top: youPx && youPx.y < targetPx.y
                  ? labelBelow(targetPx.y, 22, 9, frame.height)
                  : labelTop(targetPx.y, 22, 9, frame.height),
                maxWidth: frame.width - 2 * EDGE,
                backgroundColor: colors.line,
              },
            ]}
          >
            {stationTag}
          </Text>
        </>
      ) : null}
      {walkLabel ? (
        <Text
          numberOfLines={1}
          style={[
            styles.bubble,
            {
              // Beside the line (right of it, or left near the right edge), not on it.
              left: middle ? besideLeft(middle.x, walkWidth, frame.width) : 10,
              top: middle ? clampTop(middle.y - 10, 20, frame.height) : 10,
              maxWidth: frame.width - 2 * EDGE,
              backgroundColor: colors.background,
              borderColor: colors.input,
              color: colors.foreground,
            },
          ]}
        >
          {walkLabel}
        </Text>
      ) : null}
      {placePinLabels(pinsToDraw(pins), frame, youPx).map(({ pin, x, y, width, label }, index) => {
        return (
          <React.Fragment key={`${index}-${pin.label}`}>
            {/* A small dot exactly on the place (taxi stand, somewhere to wait), its label above. */}
            <View
              style={[
                styles.pinDot,
                styles.placed,
                { left: x - 5, top: y - 5, backgroundColor: pin.emphasis ? colors.primary : colors.foreground, borderColor: colors.map },
              ]}
            />
            {label ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.bubble,
                  { left: label.left, top: label.top, maxWidth: width },
                  pin.emphasis
                    ? { backgroundColor: colors.primary, borderColor: colors.primary, color: colors.primaryForeground }
                    : { backgroundColor: colors.background, borderColor: colors.input, color: colors.foreground },
                ]}
              >
                {pin.label}
              </Text>
            ) : null}
          </React.Fragment>
        );
      })}
      {youPx ? <View style={[styles.you, { left: youPx.x - 11, top: youPx.y - 11, borderColor: colors.primary }]} /> : null}
    </>
  );
}

/** Labels keep at least this far from the map's edges. */
const EDGE = 4;
/** The bottom strip holds the Apple Maps logo, 法的情報 and the open-in-Maps button: no labels there. */
const BOTTOM_RESERVED = 40;

/** A label's rough drawn width: full-width (Japanese) characters ~1 em, others ~0.6 em, plus padding. */
function labelWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? fontSize : fontSize * 0.62;
  return Math.ceil(width + 16);
}

/** Left edge for a label centred on `center`, slid inward to stay inside the map. */
function clampLeft(center: number, width: number, frameWidth: number): number {
  return Math.max(EDGE, Math.min(center - width / 2, frameWidth - width - EDGE));
}

function clampTop(top: number, height: number, frameHeight: number): number {
  return Math.max(EDGE, Math.min(top, frameHeight - height - BOTTOM_RESERVED));
}

/** Left edge for a label just right of a line at `x`, or just left of it when there's no room. */
function besideLeft(x: number, width: number, frameWidth: number): number {
  const right = x + 10;
  return right + width + EDGE <= frameWidth ? right : Math.max(EDGE, x - 10 - width);
}

/** Top for a label just below a dot at `y`, or just above when there's no room below. */
function labelBelow(y: number, height: number, gap: number, frameHeight: number): number {
  const below = y + gap;
  return clampTop(below + height + BOTTOM_RESERVED <= frameHeight ? below : y - gap - height, height, frameHeight);
}

/** Top for a label just above a dot at `y` (`gap` from its centre), or just below when there's no room above. */
function labelTop(y: number, height: number, gap: number, frameHeight: number): number {
  const above = y - gap - height;
  return clampTop(above >= EDGE ? above : y + gap, height, frameHeight);
}

const PIN_LABEL_HEIGHT = 20;

type PlacedPin = { pin: MapPin; x: number; y: number; width: number; label: { left: number; top: number } | null };

/**
 * Where each pin's label goes: above its dot, else below, right or left, the
 * first spot that doesn't overlap a label already placed. The highlighted pin
 * is placed first; one with no free spot keeps just its dot.
 */
function placePinLabels(pins: MapPin[], frame: Frame, you: { x: number; y: number } | null): PlacedPin[] {
  // Your own position marker counts as taken too, so no label covers it.
  const taken: Array<{ left: number; top: number; right: number; bottom: number }> = you
    ? [{ left: you.x - 14, top: you.y - 14, right: you.x + 14, bottom: you.y + 14 }]
    : [];
  const overlaps = (box: { left: number; top: number; right: number; bottom: number }) =>
    taken.some((other) => box.left < other.right + 2 && box.right > other.left - 2 && box.top < other.bottom + 2 && box.bottom > other.top - 2);
  const placed = new Map<MapPin, PlacedPin>();
  const order = [...pins.filter((pin) => pin.emphasis), ...pins.filter((pin) => !pin.emphasis)];
  for (const pin of order) {
    if (pin.latitude === undefined || pin.longitude === undefined) continue;
    const { x, y } = project(frame, { latitude: pin.latitude, longitude: pin.longitude });
    const width = Math.min(labelWidth(pin.label, 11), frame.width - 2 * EDGE);
    const h = PIN_LABEL_HEIGHT;
    const candidates = [
      { left: clampLeft(x, width, frame.width), top: y - 7 - h },
      { left: clampLeft(x, width, frame.width), top: y + 7 },
      { left: x + 9, top: y - h / 2 },
      { left: x - 9 - width, top: y - h / 2 },
    ]
      .filter(({ left, top }) => left >= EDGE && left + width <= frame.width - EDGE && top >= EDGE && top + h <= frame.height - BOTTOM_RESERVED);
    const spot = candidates.find(({ left, top }) => !overlaps({ left, top, right: left + width, bottom: top + h }))
      ?? (pin.emphasis ? { left: clampLeft(x, width, frame.width), top: labelTop(y, h, 7, frame.height) } : null);
    if (spot) taken.push({ left: spot.left, top: spot.top, right: spot.left + width, bottom: spot.top + h });
    placed.set(pin, { pin, x, y, width, label: spot });
  }
  // Drawn in the given order (the highlighted one last, on top).
  return pins.map((pin) => placed.get(pin)).filter((entry): entry is PlacedPin => entry !== undefined);
}

/** The first four pins plus the highlighted one, drawn last so it's on top. */
function pinsToDraw(pins: MapPin[] | undefined): MapPin[] {
  const shown = (pins ?? []).filter((pin, index) => index < 4 || pin.emphasis);
  return [...shown.filter((pin) => !pin.emphasis), ...shown.filter((pin) => pin.emphasis)];
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
          {pinsToDraw(pins).map((pin, index) => {
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
  mapUnavailable: { position: 'absolute', top: 6, left: 8, right: 8, alignItems: 'flex-start' },
  mapUnavailableText: { backgroundColor: 'rgba(10, 19, 34, 0.84)', color: '#FFFFFF', fontSize: 10, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6 },
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
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  stationDot: { borderRadius: 6, borderWidth: 3, height: 12, width: 12 },
  pinDot: { borderRadius: 5, borderWidth: 2, height: 10, width: 10 },
  placed: { position: 'absolute' },
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
  attribution: { bottom: 7, left: 76, position: 'absolute' },
  attributionText: { color: '#C9D4DE', fontSize: 10, fontWeight: '600', textDecorationLine: 'underline' },
});
