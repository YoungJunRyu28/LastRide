import { OnboardingFrame, OnboardingHeading } from '@/components/Onboarding';
import { Card, Chip, PrimaryButton, Row, TextButton } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Setup 2/3: reminder timing, then the notification permission. */
export default function OnboardingNotificationsScreen() {
  const colors = useColors();
  const { language, reminderIntervals, toggleReminderInterval, missedCheckIn, setMissedCheckIn, requestNotifications } = useLastRide();
  const ja = language === 'ja';
  const [asking, setAsking] = useState(false);
  const next = () => router.replace('/onboarding-location');

  const allow = async () => {
    setAsking(true);
    await requestNotifications().catch(() => false);
    setAsking(false);
    next();
  };

  return (
    <OnboardingFrame
      step={2}
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
        title={ja ? '出発の時間を\nお知らせします' : 'We’ll tell you\nwhen to go'}
        lead={
          ja
            ? '夜のトラッキング中だけ、出発前のリマインダーと「今すぐ出発」を通知します。'
            : 'Only while night tracking is on: reminders before you need to leave, and a “leave now”.'
        }
      />

      <Card style={styles.preview}>
        <View style={[styles.appIcon, { backgroundColor: colors.primary }]}>
          <Text style={[styles.appIconText, { color: colors.primaryForeground }]}>帰</Text>
        </View>
        <View style={styles.previewText}>
          <Text style={[styles.previewTitle, { color: colors.foreground }]}>{ja ? 'LastRide — あと15分' : 'LastRide — 15 min'}</Text>
          <Text style={[styles.previewBody, { color: colors.mutedForeground }]}>
            {ja ? '23:41に渋谷駅へ出発。そろそろ支度を。' : 'Leave for Shibuya at 23:41. Time to wrap up.'}
          </Text>
        </View>
        <Text style={[styles.previewTime, { color: colors.mutedForeground }]}>{ja ? '今' : 'now'}</Text>
      </Card>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {ja ? '出発の何分前に知らせる？' : 'How early should we remind you?'}
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>{ja ? '（複数選択可）' : '  (pick any)'}</Text>
        </Text>
        <View style={styles.chips}>
          {REMINDER_CHOICES.map((minutes) => (
            <Chip
              key={minutes}
              testID={`reminder-${minutes}`}
              label={ja ? `${minutes}分前` : `${minutes} min`}
              selected={reminderIntervals.includes(minutes)}
              onPress={() => toggleReminderInterval(minutes)}
            />
          ))}
        </View>
      </View>

      <Card style={styles.toggleCard}>
        <Row
          testID="toggle-missed-check-in"
          title={ja ? '終電後の案内' : 'After the last train'}
          subtitle={ja ? '乗り遅れたときの選択肢を通知' : 'A check-in with your other ways home'}
          switchValue={missedCheckIn}
          onSwitch={setMissedCheckIn}
        />
      </Card>

      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        {ja ? '「今すぐ出発」の通知は常に届きます。あとから設定で変更できます。' : 'The “leave now” alert always comes. You can change this later in Settings.'}
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
