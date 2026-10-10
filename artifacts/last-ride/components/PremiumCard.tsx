import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PremiumTag } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { useColors } from '@/hooks/useColors';
import type { LeaveCardVariant } from '@/lib/premiumPrompts';

/**
 * The free user's premium card at the bottom of Leave. Alternates nightly
 * between a lock-screen countdown preview and a home-widget preview, using
 * tonight's real numbers. Dismissible for the night.
 */
export function PremiumCard({
  variant,
  ja,
  leaveAt,
  countdown,
  station,
  destination,
  onDismiss,
}: {
  variant: LeaveCardVariant;
  ja: boolean;
  leaveAt: string;
  countdown: string;
  station: string;
  destination: string;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const lock = variant === 'lock';
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        testID="premium-card"
        onPress={() => router.push('/paywall')}
        accessibilityRole="button"
        accessibilityLabel={
          lock
            ? ja
              ? 'プレミアム：ロック画面で残り時間を表示。1週間無料で試す'
              : 'Premium: countdown on your lock screen. Try a week free'
            : ja
              ? 'プレミアム：ホーム画面で出発時刻をひと目で。1週間無料で試す'
              : 'Premium: leave time on your home screen. Try a week free'
        }
        style={({ pressed }) => [styles.body, { opacity: pressed ? 0.85 : 1 }]}
      >
        {lock ? (
          <View style={[styles.preview, styles.lockPreview, { backgroundColor: colors.background, borderColor: colors.input }]}>
            <Text style={[styles.previewSmall, { color: colors.mutedForeground }]} numberOfLines={1}>
              {ja ? `${leaveAt}までに出発` : `Leave by ${leaveAt}`}
            </Text>
            <Text style={[styles.previewBig, { color: colors.primary }]}>{countdown}</Text>
          </View>
        ) : (
          <View style={[styles.preview, styles.widgetPreview, { backgroundColor: colors.background, borderColor: colors.input }]}>
            <Text style={[styles.previewSmall, { color: colors.mutedForeground }]} numberOfLines={1}>
              {ja ? `${destination}へ` : `To ${destination}`}
            </Text>
            <Text style={[styles.previewBig, { color: colors.primary }]}>{countdown}</Text>
            <Text style={[styles.previewSmall, { color: colors.subtle }]} numberOfLines={1}>
              {leaveAt} {station}
            </Text>
          </View>
        )}
        <View style={styles.copy}>
          <PremiumTag label={ja ? 'プレミアム' : 'Premium'} />
          <Text style={[styles.title, { color: colors.foreground }]}>
            {lock
              ? ja
                ? 'ロック画面で残り時間を表示'
                : 'See the countdown on your lock screen'
              : ja
                ? 'ホーム画面で出発時刻をひと目で'
                : 'Your leave time on the home screen'}
          </Text>
          <Text style={[styles.cta, { color: colors.primary }]}>{ja ? '1週間無料で試す ›' : 'Try a week free ›'}</Text>
        </View>
      </Pressable>
      <Pressable
        testID="dismiss-premium-card"
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={ja ? '今夜は表示しない' : 'Hide for tonight'}
        hitSlop={12}
        style={styles.close}
      >
        <Feather name="x" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1 },
  body: { alignItems: 'center', flexDirection: 'row', gap: 14, padding: 14, paddingRight: 36 },
  preview: { borderWidth: 1, justifyContent: 'center', paddingHorizontal: 8 },
  lockPreview: { borderRadius: 14, height: 64, width: 96 },
  widgetPreview: { borderRadius: 18, height: 84, width: 84 },
  previewSmall: { fontSize: 10, fontWeight: '700' },
  previewBig: { fontFamily: DIGITS, fontSize: 22, lineHeight: 26 },
  copy: { alignItems: 'flex-start', flex: 1, gap: 5 },
  title: { fontSize: 14, fontWeight: '800', lineHeight: 19 },
  cta: { fontSize: 13, fontWeight: '800' },
  close: { padding: 6, position: 'absolute', right: 8, top: 8 },
});
