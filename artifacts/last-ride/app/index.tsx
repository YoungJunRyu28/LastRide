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
    router.replace('/home-station');
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 20) }]}>
      <View style={styles.orbitOne} />
      <View style={styles.orbitTwo} />
      <View style={styles.hero}>
        <Image source={require('@/assets/images/icon.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <Text style={[styles.appName, { color: colors.foreground }]}>LastRide</Text>
        <Text style={[styles.appNameJa, { color: colors.mutedForeground }]}>帰り時</Text>
      </View>
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={1.5} style={[styles.headline, { color: colors.foreground }]}>Enjoy the night.{'\n'}We’ll watch the clock.</Text>
        <Text style={[styles.subhead, { color: colors.mutedForeground }]}>夜を楽しんで。帰りの時間は、まかせて。</Text>
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
  orbitOne: { backgroundColor: '#DDEBE5', borderRadius: 240, height: 380, position: 'absolute', right: -155, top: -145, width: 380 },
  orbitTwo: { backgroundColor: '#FBE2B9', borderRadius: 170, bottom: 95, height: 250, left: -165, position: 'absolute', width: 250 },
  hero: { alignItems: 'center', gap: 3, marginTop: 18 },
  mark: { borderRadius: 18, height: 80, marginBottom: 10, width: 80 },
  appName: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: -0.5 },
  appNameJa: { fontFamily: 'Inter_600SemiBold', fontSize: 13, letterSpacing: 4 },
  copy: { gap: 14 },
  headline: { fontFamily: 'Inter_700Bold', fontSize: 38, letterSpacing: -1.4, lineHeight: 45 },
  subhead: { fontFamily: 'Inter_500Medium', fontSize: 16 },
  actions: { gap: 12 },
  primaryButton: { alignItems: 'center', borderRadius: 23, minHeight: 70, justifyContent: 'center' },
  primaryJa: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  primaryEn: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 3, opacity: 0.75 },
  secondaryButton: { alignItems: 'center', borderRadius: 23, borderWidth: 1, minHeight: 58, justifyContent: 'center' },
  secondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});