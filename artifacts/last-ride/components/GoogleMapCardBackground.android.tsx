/** Android's native Google Maps SDK. A native map is only mounted if a
 * restricted build-time key exists; otherwise MapCard draws its fallback. */
import React, { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { GoogleMaps } from 'expo-maps';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { googleMapOverlays, googleZoomForFrame, type MapFrame, type Point, type Pin } from '@/lib/googleMapGeometry';

export const googleMapsConfigured = Constants.expoConfig?.extra?.androidGoogleMapsEnabled === true;

export default function GoogleMapCardBackground({ frame, you, target, path, pins, stationTag, walkLabel }: {
  frame: MapFrame; you?: Point | null; target?: Point | null;
  path?: Point[]; pins?: Pin[]; stationTag?: string; walkLabel?: string;
}) {
  const colors = useColors();
  const mapRef = useRef<GoogleMaps.MapView>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!googleMapsConfigured || loaded) return;
    const timer = setTimeout(() => setLoadTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, [loaded]);
  const mapZoom = googleZoomForFrame(frame);
  // `cameraPosition` is initial-only in Expo Maps. Reframe when the user
  // changes stations/location instead of displaying stale map imagery.
  useEffect(() => {
    if (googleMapsConfigured && loaded) {
      mapRef.current?.setCameraPosition({ coordinates: frame.center, zoom: mapZoom, duration: 0 });
    }
  }, [loaded, frame.center.latitude, frame.center.longitude, mapZoom]);
  const { markers, walkLine } = googleMapOverlays({ you, target, pins, path });
  if (!googleMapsConfigured) return null;
  return (
    <>
      <GoogleMaps.View
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        cameraPosition={{ coordinates: frame.center, zoom: mapZoom }}
        onMapLoaded={() => setLoaded(true)}
        markers={markers}
        polylines={walkLine.length >= 2 ? [{ id: 'walking-route', coordinates: walkLine, color: colors.primary, width: 5 }] : []}
        uiSettings={{ compassEnabled: false, mapToolbarEnabled: false,
          myLocationButtonEnabled: false, scrollGesturesEnabled: false,
          zoomGesturesEnabled: false, rotationGesturesEnabled: false, tiltGesturesEnabled: false }}
      />
      {!loaded ? (
        <View pointerEvents="none" style={[styles.loading, { backgroundColor: colors.map }]}>
          <Text style={[styles.loadingText, { color: colors.foreground }]}>
            {loadTimedOut
              ? '地図を表示できません / Map tiles unavailable'
              : '地図を読み込み中 / Loading map…'}
          </Text>
        </View>
      ) : null}
      {(stationTag || walkLabel) ? (
        <View pointerEvents="none" style={styles.chips}>
          {stationTag ? <Text numberOfLines={1} style={[styles.tag, { backgroundColor: colors.line, color: '#FFFFFF' }]}>{stationTag}</Text> : null}
          {walkLabel ? <Text numberOfLines={1} style={[styles.tag, { backgroundColor: colors.background, color: colors.foreground }]}>{walkLabel}</Text> : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  loading: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 11, fontWeight: '600' },
  chips: { position: 'absolute', top: 8, right: 10, maxWidth: '75%', alignItems: 'flex-end', gap: 5 },
  tag: { borderRadius: 7, fontSize: 11, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
});
