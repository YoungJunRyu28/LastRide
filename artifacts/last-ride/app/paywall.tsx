import { PremiumOffer } from '@/components/PremiumOffer';
import { IconButton } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Premium paywall, opened from Settings, Groups, Destinations and the Leave card. */
export default function PaywallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language !== 'en';
  const close = () => (router.canGoBack() ? router.back() : router.replace('/ride'));

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 12), paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.topbar}>
          <IconButton icon="x" label={ja ? '閉じる' : 'Close'} onPress={close} testID="close-paywall" />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.kicker, { color: colors.primary }]}>LASTRIDE PREMIUM</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {ja ? 'みんなで、\n確実に帰る。' : 'Everyone home,\non time.'}
          </Text>
        </View>
        <PremiumOffer ja={ja} onDone={close} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 22, paddingHorizontal: 20 },
  topbar: { alignItems: 'flex-end' },
  heading: { gap: 8 },
  kicker: { fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40 },
});
