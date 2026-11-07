import { ExampleTag, OnboardingFrame, OnboardingHeading } from '@/components/Onboarding';
import { Card, PrimaryButton } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * How it works, before setup: the app finds the closest station and its last
 * train from where you are, shows when to leave, and 案内を開始 keeps it up to
 * date and tells you when to go.
 */
export default function OnboardingIntroScreen() {
  const colors = useColors();
  const { language, resetLanguage } = useLastRide();
  const ja = language === 'ja';

  const steps: Array<{ icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string; start?: boolean }> = [
    {
      icon: 'map-pin',
      title: ja ? '一番近い駅を自動で探す' : 'Finds your nearest station',
      body: ja ? '現在地から近くの駅と、そこから帰れる終電を調べます。' : 'Using your location, it finds the closest station and tonight’s last train home from there.',
    },
    {
      icon: 'clock',
      title: ja ? '出る時刻がわかる' : 'Tells you when to leave',
      body: ja ? '駅までの徒歩と乗り換えを含めて、何時に出ればいいかを表示します。' : 'It counts the walk to the station and any changes, so you know what time to head out.',
    },
    {
      icon: 'moon',
      start: true,
      title: ja ? '「案内を開始」で、あとはおまかせ' : 'Tap “Start tonight”, then relax',
      body: ja
        ? 'お店を移っても駅と出る時刻を更新し、時間になったら通知やアラームでお知らせ。終電が出たら自動で止まります。'
        : 'As you move between places, your station and leave time keep updating. A reminder or alarm tells you when to go, and it stops by itself after the last train.',
    },
  ];

  return (
    <OnboardingFrame
      backLabel={ja ? '戻る' : 'Back'}
      onBack={() => {
        // Clear the language choice first, or the welcome screen sends you straight back here.
        resetLanguage();
        router.replace('/');
      }}
      actions={<PrimaryButton label={ja ? '設定を始める' : 'Get started'} icon="arrow-right" onPress={() => router.replace({ pathname: '/home-station', params: { setup: '1' } })} testID="intro-next" />}
    >
      <OnboardingHeading
        kicker={ja ? '使い方' : 'HOW IT WORKS'}
        title={ja ? '終電に間に合う時刻を\n自動でお知らせ' : 'Know when to leave\nfor the last train'}
      />

      {/* What the home screen shows, in miniature. */}
      <View>
        <Card style={[styles.preview, { borderColor: colors.border }]}>
          <Text style={[styles.previewLabel, { color: colors.mutedForeground }]}>{ja ? '今夜は' : 'Leave at'}</Text>
          <View style={styles.previewRow}>
            <Text style={[styles.previewTime, { color: colors.primary }]}>23:19</Text>
            {ja && <Text style={[styles.previewSuffix, { color: colors.foreground }]}>に出る</Text>}
          </View>
          <Text style={[styles.previewTrip, { color: colors.foreground }]}>
            {ja ? '渋谷 23:33発 → 自宅 00:32' : 'Shibuya 23:33 → Home 00:32'}
          </Text>
        </Card>
        <ExampleTag ja={ja} />
      </View>

      <View style={styles.steps}>
        {steps.map((step) => (
          <View key={step.icon} style={styles.step}>
            <View style={[styles.stepIcon, { backgroundColor: step.start ? colors.primary : colors.secondary }]}>
              <Feather name={step.icon} size={18} color={step.start ? colors.primaryForeground : colors.primary} />
            </View>
            <View style={styles.stepText}>
              <Text style={[styles.stepTitle, { color: colors.foreground }]}>{step.title}</Text>
              <Text style={[styles.stepBody, { color: colors.mutedForeground }]}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', borderWidth: 1, gap: 2, paddingVertical: 16 },
  previewLabel: { fontSize: 13, fontWeight: '700' },
  previewRow: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
  previewTime: { fontFamily: DIGITS, fontSize: 48, letterSpacing: -1, lineHeight: 54 },
  previewSuffix: { fontSize: 16, fontWeight: '800' },
  previewTrip: { fontSize: 14, fontWeight: '600' },
  steps: { gap: 18 },
  step: { alignItems: 'flex-start', flexDirection: 'row', gap: 14 },
  stepIcon: { alignItems: 'center', borderRadius: 19, height: 38, justifyContent: 'center', width: 38 },
  stepText: { flex: 1, gap: 3 },
  stepTitle: { fontSize: 16, fontWeight: '800' },
  stepBody: { fontSize: 14, lineHeight: 20 },
});
