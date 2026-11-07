import { MarginStepper } from '@/components/MarginStepper';
import { OnboardingFrame, OnboardingHeading, SETUP_HAS_ALARMS, SETUP_STEPS } from '@/components/Onboarding';
import { Card, PrimaryButton } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text } from 'react-native';

/** The example night shown while choosing: the latest you could leave. */
const EXAMPLE_LATEST_MINUTES = 23 * 60 + 41;

function clock(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Setup: 早めに出る時間 (余裕), how many minutes before the latest time to leave. */
export default function OnboardingMarginScreen() {
  const colors = useColors();
  const { language, leaveMargin, setLeaveMargin } = useLastRide();
  const ja = language === 'ja';

  return (
    <OnboardingFrame
      step={SETUP_STEPS.margin}
      backLabel={ja ? '戻る' : 'Back'}
      onBack={() => router.replace(SETUP_HAS_ALARMS ? '/onboarding-alarms' : '/onboarding-notifications')}
      actions={
        <PrimaryButton label={ja ? '次へ' : 'Continue'} onPress={() => router.replace('/onboarding-location')} testID="onboarding-margin-next" />
      }
    >
      <OnboardingHeading
        kicker={ja ? '早めに出る時間' : 'LEAVE EARLY BY'}
        title={ja ? '何分早めに\n出ますか？' : 'How much time\nto spare?'}
        lead={
          ja
            ? 'ぎりぎりの時刻より、この分だけ早い時刻をお知らせします。'
            : 'We’ll tell you to leave this many minutes before the latest possible time.'
        }
      />

      <Card style={styles.card}>
        <MarginStepper value={leaveMargin} onChange={setLeaveMargin} ja={ja} />
      </Card>

      <Text style={[styles.example, { color: colors.mutedForeground }]}>
        {ja ? '例：遅くとも ' : 'Example: latest '}
        <Text style={{ color: colors.foreground }}>{clock(EXAMPLE_LATEST_MINUTES)}</Text>
        {ja ? ' → ' : ' → leave at '}
        <Text style={[styles.exampleTime, { color: colors.primary }]}>{clock(EXAMPLE_LATEST_MINUTES - leaveMargin)}</Text>
        {ja ? 'に出る' : ''}
      </Text>
      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        {ja
          ? 'あとから設定で変更できます。'
          : 'You can change this any time in Settings.'}
      </Text>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  example: { fontSize: 14, lineHeight: 20 },
  exampleTime: { fontWeight: '800' },
  footnote: { fontSize: 12, lineHeight: 18 },
});
