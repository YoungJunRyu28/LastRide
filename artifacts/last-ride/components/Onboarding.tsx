import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

/** Shared frame for the three setup steps: back, "n / 3", scrolling body, pinned actions. */
export function OnboardingFrame({
  step,
  onBack,
  backLabel,
  children,
  actions,
}: {
  step: 1 | 2 | 3;
  onBack: () => void;
  backLabel: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 8) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <IconButton icon="chevron-left" label={backLabel} onPress={onBack} testID="onboarding-back" />
          <View style={styles.progress} accessible accessibilityLabel={`${step} / 3`}>
            {[1, 2, 3].map((index) => (
              <View
                key={index}
                style={[styles.progressDot, { backgroundColor: index <= step ? colors.primary : colors.secondary }]}
              />
            ))}
            <Text style={[styles.progressText, { color: colors.mutedForeground }]}>{step} / 3</Text>
          </View>
        </View>
        {children}
      </ScrollView>
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 16) }]}>{actions}</View>
    </View>
  );
}

/** Kicker + large title + lead paragraph at the top of a setup step. */
export function OnboardingHeading({ kicker, title, lead }: { kicker: string; title: string; lead?: string }) {
  const colors = useColors();
  return (
    <View style={styles.heading}>
      <Text style={[styles.kicker, { color: colors.primary }]}>{kicker}</Text>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.5} style={[styles.title, { color: colors.foreground }]}>
        {title}
      </Text>
      {lead ? <Text style={[styles.lead, { color: colors.mutedForeground }]}>{lead}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 24, paddingBottom: 24, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  progress: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  progressDot: { borderRadius: 3, height: 6, width: 18 },
  progressText: { fontSize: 12, fontWeight: '700', marginLeft: 6 },
  heading: { gap: 10 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40 },
  lead: { fontSize: 15, lineHeight: 23 },
  actions: { gap: 6, paddingHorizontal: 20, paddingTop: 10 },
});
