import { OnboardingFrame, OnboardingHeading, SETUP_HAS_ALARMS, SETUP_STEPS } from '@/components/Onboarding';
import { Card, Chip, Divider, PrimaryButton, Row, TextButton } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { reminderLabel } from '@/lib/settings';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

/** Setup: reminder timing, then the notification permission. */
export default function OnboardingNotificationsScreen() {
  const colors = useColors();
  const { language, reminderIntervals, toggleReminderInterval, missedCheckIn, setMissedCheckIn, throughFocus, setThroughFocus, requestNotifications } = useLastRide();
  const ja = language === 'ja';
  const [asking, setAsking] = useState(false);
  const next = () => router.replace(SETUP_HAS_ALARMS ? '/onboarding-alarms' : '/onboarding-margin');

  const allow = async () => {
    setAsking(true);
    await requestNotifications().catch(() => false);
    setAsking(false);
    next();
  };

  return (
    <OnboardingFrame
      step={SETUP_STEPS.notifications}
      backLabel={ja ? '戻る' : 'Back'}
      onBack={() => router.replace({ pathname: '/home-station', params: { setup: '1' } })}
      actions={
        <>
          <PrimaryButton label={ja ? '通知を許可' : 'Allow notifications'} onPress={() => void allow()} loading={asking} testID="allow-notifications" />
          <TextButton label={ja ? 'あとで' : 'Not now'} onPress={next} testID="skip-notifications" />
        </>
      }
    >
      <OnboardingHeading
        kicker={ja ? '通知' : 'NOTIFICATIONS'}
        title={ja ? '出発時刻を\n通知でお知らせ' : 'We’ll tell you\nwhen to go'}
        lead={
          ja
            ? '夜間の案内中に、出発前のリマインダーと出発時刻のお知らせを送ります。'
            : 'Only while night tracking is on: reminders before you need to leave, and a “leave now”.'
        }
      />

      <Card style={styles.preview}>
        <View style={[styles.appIcon, { backgroundColor: colors.primary }]}>
          <Text style={[styles.appIconText, { color: colors.primaryForeground }]}>帰</Text>
        </View>
        <View style={styles.previewText}>
          <Text style={[styles.previewTitle, { color: colors.foreground }]}>{ja ? 'LastRide — 出発まであと15分' : 'LastRide — 15 min'}</Text>
          <Text style={[styles.previewBody, { color: colors.mutedForeground }]}>
            {ja ? '23:41に渋谷駅へ向かう予定です。出発の準備をしましょう。' : 'Leave for Shibuya at 23:41. Time to wrap up.'}
          </Text>
        </View>
        <Text style={[styles.previewTime, { color: colors.mutedForeground }]}>{ja ? '今' : 'now'}</Text>
      </Card>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {ja ? '出発の何分前に通知しますか？' : 'How early should we remind you?'}
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>{ja ? '（複数選択可）' : '  (pick any)'}</Text>
        </Text>
        <View style={styles.chips}>
          {REMINDER_CHOICES.map((minutes) => (
            <Chip
              key={minutes}
              testID={`reminder-${minutes}`}
              label={reminderLabel(minutes, ja)}
              selected={reminderIntervals.includes(minutes)}
              onPress={() => toggleReminderInterval(minutes)}
            />
          ))}
        </View>
      </View>

      <Card style={styles.toggleCard}>
        {Platform.OS === 'ios' && (
          <>
            <Row
              testID="toggle-through-focus"
              title={ja ? '集中モード中も通知' : 'Through Focus'}
              subtitle={ja ? 'おやすみモードなどの集中モード中も、出発のお知らせを届けます（即時通知）' : 'Leave reminders still come through Sleep and other Focus modes (Time Sensitive)'}
              switchValue={throughFocus}
              onSwitch={setThroughFocus}
            />
            <Divider />
          </>
        )}
        <Row
          testID="toggle-missed-check-in"
          title={ja ? '終電後の案内' : 'After the last train'}
          subtitle={ja ? '乗り遅れたときの選択肢を通知' : 'A check-in with your other ways home'}
          switchValue={missedCheckIn}
          onSwitch={setMissedCheckIn}
        />
      </Card>

      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        {ja ? '通知のタイミングは、あとから設定で変更できます。' : 'You can change these later in Settings.'}
      </Text>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  appIcon: { alignItems: 'center', borderRadius: 9, height: 36, justifyContent: 'center', width: 36 },
  appIconText: { fontSize: 17, fontWeight: '900' },
  previewText: { flex: 1, gap: 2 },
  previewTitle: { fontSize: 14, fontWeight: '800' },
  previewBody: { fontSize: 13, lineHeight: 18 },
  previewTime: { alignSelf: 'flex-start', fontSize: 11 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionHint: { fontSize: 12, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleCard: { borderWidth: 1 },
  footnote: { fontSize: 12, lineHeight: 18 },
});
