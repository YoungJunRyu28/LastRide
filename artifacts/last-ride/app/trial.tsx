import { PremiumOffer } from '@/components/PremiumOffer';
import { TextButton } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { markTrialOfferShown } from '@/lib/premiumPrompts';
import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The one-time trial offer at the end of setup. Skipping is always one tap. */
export default function TrialScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language !== 'en';
  const done = () => router.replace('/ride');

  useEffect(() => {
    void markTrialOfferShown();
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 16), paddingBottom: insets.bottom + 20 }]}>
        <Text style={[styles.ready, { color: colors.mutedForeground }]}>{ja ? '準備できました ✓' : 'You’re all set ✓'}</Text>
        <View style={styles.heading}>
          <Text style={[styles.kicker, { color: colors.primary }]}>LASTRIDE PREMIUM</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {ja ? 'プレミアムを\n1週間無料で。' : 'Try Premium\nfree for a week.'}
          </Text>
        </View>
        <PremiumOffer ja={ja} onDone={done} secondary={<TextButton label={ja ? 'あとで（無料で使う）' : 'Not now (keep it free)'} onPress={done} testID="skip-trial" />} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 22, paddingHorizontal: 20 },
  ready: { fontSize: 13, fontWeight: '700' },
  heading: { gap: 8 },
  kicker: { fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40 },
});
