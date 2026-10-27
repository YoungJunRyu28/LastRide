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

/** Setup: 出発までの余裕時間 (余裕), how many minutes before the latest time to leave. */
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
        kicker={ja ? '出発までの余裕時間' : 'LEAVE EARLY BY'}
        title={ja ? '何分前に\n出発しますか？' : 'How much time\nto spare?'}
        lead={
          ja
            ? '計算した最終の出発時刻より、何分早く出るかを設定します。'
            : 'Instead of the very latest time, we’ll tell you to leave this much earlier.'
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
          ? '乗り換えや駅までの徒歩時間に応じて、余裕時間を追加する場合があります。あとから設定で変更できます。'
          : 'A little more is added for routes with changes or long walks. You can change this later in Settings.'}
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
