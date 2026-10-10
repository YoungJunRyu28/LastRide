import { OnboardingFrame, OnboardingHeading } from '@/components/Onboarding';
import { PrimaryButton, TextButton } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { usePremium } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';
import { requestNightLocationPermission } from '@/lib/tracking';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Choice = 'background' | 'foreground';

/**
 * Setup 3/3: how night tracking may use location. This screen is the prominent
 * disclosure for background location, so it must name what is collected, when,
 * and where it goes before the OS prompt appears.
 */
export default function OnboardingLocationScreen() {
  const colors = useColors();
  const { language, setNightLocationMode } = useLastRide();
  const ja = language === 'ja';
  const [choice, setChoice] = useState<Choice>('background');
  const [asking, setAsking] = useState(false);
  const { isPremium } = usePremium();
  // Setup ends with the one-time trial offer, unless premium is already active (e.g. restored).
  const finish = () => router.replace(isPremium ? '/ride' : '/trial');

  const confirm = async () => {
    setAsking(true);
    const granted = await requestNightLocationPermission(choice);
    // A refused "when closed" can still leave foreground access; ask again at tracking time otherwise.
    if (granted) setNightLocationMode(choice);
    else if (choice === 'background' && (await requestNightLocationPermission('foreground'))) setNightLocationMode('foreground');
    else setNightLocationMode('ask');
    setAsking(false);
    finish();
  };

  const later = () => {
    setNightLocationMode('ask');
    finish();
  };

  const options: Array<{ value: Choice; title: string; body: string; recommended?: boolean }> = [
    {
      value: 'background',
      title: ja ? '閉じても更新' : 'Update when closed',
      body: ja
        ? '夜のトラッキング中だけ。アプリを閉じても移動に合わせて出発時刻と通知を更新します。毎日ずっと使うわけではありません。'
        : 'Only during night tracking. Your leave time and alerts follow you even with the app closed. Never all day.',
      recommended: true,
    },
    {
      value: 'foreground',
      title: ja ? 'アプリ使用中のみ' : 'Only while using the app',
      body: ja ? '閉じている間は更新せず、最後に計算した予定で通知します。' : 'No updates while closed; alerts use the last plan.',
    },
  ];

  return (
    <OnboardingFrame
      step={3}
      backLabel={ja ? '戻る' : 'Back'}
      onBack={() => router.replace('/onboarding-notifications')}
      actions={
        <>
          <PrimaryButton label={ja ? '続ける' : 'Continue'} onPress={() => void confirm()} loading={asking} testID="confirm-location" />
          <TextButton label={ja ? 'あとで決める' : 'Decide later'} onPress={later} testID="skip-location" />
        </>
      }
    >
      <OnboardingHeading
        kicker={ja ? '位置情報' : 'LOCATION'}
        title={ja ? '移動しても\n出発時刻を正確に' : 'Keep your leave time\nright as you move'}
        lead={
          ja
            ? '位置情報で近くの駅と徒歩時間を調べます。夜のトラッキング中は、アプリを閉じている間も位置情報を使い、駅・出発時刻・リマインダーを更新できます。位置情報は経路の計算のために当社のサーバーと地図サービスに送信されます。'
            : 'Location finds your nearest station and walking time. During night tracking it can also be used while the app is closed, to keep your station, leave time and reminders current. It is sent to our server and a map service to calculate routes.'
        }
      />

      <View style={styles.options} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === choice;
          return (
            <Pressable
              key={option.value}
              testID={`location-${option.value}`}
              onPress={() => setChoice(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                  borderWidth: selected ? 2 : 1,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.input }]}>
                {selected && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
              </View>
              <View style={styles.optionText}>
                <View style={styles.optionHead}>
                  <Text style={[styles.optionTitle, { color: colors.foreground }]}>{option.title}</Text>
                  {option.recommended && (
                    <Text style={[styles.badge, { backgroundColor: colors.accent, color: colors.accentForeground }]}>
                      {ja ? 'おすすめ' : 'Recommended'}
                    </Text>
                  )}
                </View>
                <Text style={[styles.optionBody, { color: colors.mutedForeground }]}>{option.body}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footnoteRow}>
        <Feather name="settings" size={13} color={colors.mutedForeground} />
        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          {ja ? 'あとから設定 › 夜の位置情報 で変更できます。' : 'Change it any time in Settings › Night location.'}
        </Text>
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  options: { gap: 10 },
  option: { alignItems: 'flex-start', borderRadius: 20, flexDirection: 'row', gap: 12, padding: 16 },
  radio: { alignItems: 'center', borderRadius: 11, borderWidth: 2, height: 22, justifyContent: 'center', marginTop: 1, width: 22 },
  radioDot: { borderRadius: 6, height: 12, width: 12 },
  optionText: { flex: 1, gap: 4 },
  optionHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionTitle: { fontSize: 16, fontWeight: '800' },
  badge: { borderRadius: 6, fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2 },
  optionBody: { fontSize: 13, lineHeight: 19 },
  footnoteRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  footnote: { flex: 1, fontSize: 12, lineHeight: 18 },
});
