import { PremiumOffer } from '@/components/PremiumOffer';
import { IconButton } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Premium paywall, opened from Settings, Groups, Destinations and the Leave card.
 * On iPhone it's a sheet, which already starts below the status bar: no inset on
 * top. It only scrolls when it doesn't fit (small phones, large text).
 */
export default function PaywallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language !== 'en';
  const close = () => (router.canGoBack() ? router.back() : router.replace('/ride'));
  const [frameHeight, setFrameHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrolls = frameHeight > 0 && contentHeight > frameHeight + 1;
  const top = Platform.OS === 'ios' ? 18 : insets.top + (Platform.OS === 'web' ? 24 : 12);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        scrollEnabled={scrolls}
        bounces={scrolls}
        onLayout={(event) => setFrameHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContentHeight(height)}
        contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: insets.bottom + 16 }]}
      >
        <View style={styles.heading}>
          <View style={styles.topbar}>
            <Text style={[styles.kicker, { color: colors.primary }]}>LASTRIDE PREMIUM</Text>
            <IconButton icon="x" label={ja ? '閉じる' : 'Close'} onPress={close} testID="close-paywall" />
          </View>
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
  content: { flexGrow: 1, gap: 22, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  heading: { gap: 4 },
  kicker: { fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40 },
});
