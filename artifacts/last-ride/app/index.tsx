import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isHydrated, language, homeStation, setLanguage } = useLastRide();

  useEffect(() => {
    if (!isHydrated) return;
    if (language && homeStation) router.replace('/ride');
    else if (language) router.replace('/home-station');
  }, [homeStation, isHydrated, language]);

  const chooseLanguage = (language: 'ja' | 'en') => {
    setLanguage(language);
    router.replace({ pathname: '/home-station', params: { setup: '1' } });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 20) }]}>
      <View style={[styles.orbitOne, { borderColor: colors.secondary }]} />
      <View style={[styles.orbitTwo, { borderColor: colors.primary }]} />
      <View style={styles.hero}>
        <Image source={require('@/assets/images/icon.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <Text maxFontSizeMultiplier={1.3} style={[styles.appName, { color: colors.foreground }]}>LASTRIDE</Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.appNameJa, { color: colors.primary }]}>帰り時</Text>
      </View>
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={1.5} style={[styles.headline, { color: colors.foreground }]}>
          夜を楽しんで。{'\n'}
          <Text style={{ color: colors.primary }}>帰りの時間は、まかせて。</Text>
        </Text>
        <Text style={[styles.subhead, { color: colors.mutedForeground }]}>Enjoy the night. We’ll watch the clock and tell you when to leave for the last train.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" testID="choose-japanese" onPress={() => chooseLanguage('ja')} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}>
          <Text style={[styles.primaryJa, { color: colors.primaryForeground }]}>日本語で始める</Text>
          <Text style={[styles.primaryEn, { color: colors.primaryForeground }]}>Japanese</Text>
        </Pressable>
        <Pressable accessibilityRole="button" testID="choose-english" onPress={() => chooseLanguage('en')} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.secondaryText, { color: colors.foreground }]}>Continue in English</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between', overflow: 'hidden', paddingBottom: Platform.OS === 'web' ? 34 : 28, paddingHorizontal: 24 },
  orbitOne: { borderRadius: 240, borderWidth: 18, height: 380, position: 'absolute', right: -155, top: -145, width: 380 },
  orbitTwo: { borderRadius: 125, borderWidth: 2, bottom: 95, height: 250, left: -165, opacity: 0.35, position: 'absolute', width: 250 },
  hero: { alignItems: 'center', gap: 6, marginTop: 18 },
  mark: { borderRadius: 22, height: 88, marginBottom: 12, width: 88 },
  appName: { fontWeight: '900', fontSize: 30, letterSpacing: 6 },
  appNameJa: { fontWeight: '800', fontSize: 24, letterSpacing: 8 },
  copy: { gap: 14 },
  headline: { fontWeight: '800', fontSize: 28, letterSpacing: -0.6, lineHeight: 40 },
  subhead: { fontWeight: '500', fontSize: 15, lineHeight: 22 },
  actions: { gap: 12 },
  primaryButton: { alignItems: 'center', borderRadius: 23, minHeight: 70, justifyContent: 'center' },
  primaryJa: { fontWeight: '700', fontSize: 17 },
  primaryEn: { fontWeight: '500', fontSize: 12, marginTop: 3, opacity: 0.75 },
  secondaryButton: { alignItems: 'center', borderRadius: 23, borderWidth: 1, minHeight: 58, justifyContent: 'center' },
  secondaryText: { fontWeight: '600', fontSize: 16 },
});