import { OnboardingFrame, OnboardingHeading, SETUP_STEPS } from '@/components/Onboarding';
import { Card, Chip, PrimaryButton, Row, TextButton } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { alarmKitAvailable, iosMajorVersion, requestAlarmAuthorization } from '@/lib/notifications';
import { reminderLabel, STORAGE_KEYS } from '@/lib/settings';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Setup: alarms that ring like the Clock app, even in silent mode (iOS 26+).
 * On the first time this step is shown, with one at the leave time, so people
 * try them; 「アラームは使わない」 turns them off (and they stay off after Back).
 * Older iOS: the same choices, plus a note that updating unlocks real alarms
 * (until then alarm times arrive as notifications with the chosen sound).
 */
export default function OnboardingAlarmsScreen() {
  const colors = useColors();
  const { language, alarmsEnabled, setAlarmsEnabled, alarmIntervals, toggleAlarmInterval } = useLastRide();
  const ja = language === 'ja';
  const [asking, setAsking] = useState(false);
  const next = () => router.replace('/onboarding-margin');

  useEffect(() => {
    if (!alarmKitAvailable) return;
    void AsyncStorage.getItem(STORAGE_KEYS.alarmsOffered).then((offered) => {
      if (offered) return;
      void AsyncStorage.setItem(STORAGE_KEYS.alarmsOffered, 'true');
      if (!alarmsEnabled) setAlarmsEnabled(true);
    }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const proceed = async () => {
    if (alarmsEnabled && alarmKitAvailable) {
      // iOS asks once. Refused: alarms go back off, so the leave time is an ordinary notification again.
      setAsking(true);
      const status = await requestAlarmAuthorization().catch(() => 'denied');
      setAsking(false);
      if (status !== 'authorized') setAlarmsEnabled(false);
    }
    next();
  };

  const skip = () => {
    if (alarmsEnabled) setAlarmsEnabled(false);
    next();
  };

  return (
    <OnboardingFrame
      step={SETUP_STEPS.alarms}
      backLabel={ja ? '戻る' : 'Back'}
      onBack={() => router.replace('/onboarding-notifications')}
      actions={
        <>
          <PrimaryButton
            label={alarmsEnabled && alarmKitAvailable ? (ja ? 'アラームを許可して次へ' : 'Allow alarms and continue') : ja ? '次へ' : 'Continue'}
            onPress={() => void proceed()}
            loading={asking}
            testID="onboarding-alarms-next"
          />
          {alarmsEnabled && <TextButton label={ja ? 'アラームは使わない' : 'No alarms'} onPress={skip} testID="skip-alarms" />}
        </>
      }
    >
      <OnboardingHeading
        kicker={ja ? 'アラーム' : 'ALARMS'}
        title={ja ? 'マナーモードでも\n鳴らせます' : 'Rings even\nin silent mode'}
        lead={
          ja
            ? '時計のアラームのように、画面いっぱいに表示して音で知らせます。飲んでいて通知を見逃しそうな夜に。'
            : 'Like a Clock alarm: full screen, with sound. For nights when a notification is easy to miss.'
        }
      />

      {!alarmKitAvailable && (
        <Card style={[styles.card, styles.updateCard, { borderColor: colors.primary }]}>
          <Text style={[styles.updateTitle, { color: colors.foreground }]}>
            {ja ? 'アラームはiOS 26以降で使えます' : 'Alarms need iOS 26 or later'}
          </Text>
          <Text style={[styles.updateBody, { color: colors.mutedForeground }]}>
            {ja
              ? `このiPhoneはiOS ${iosMajorVersion ?? ''}です。それまでは、出発の時刻を通知でお知らせします。アップデート後に、設定 › 出発リマインダー からアラームを設定できます。`
              : `This iPhone is on iOS ${iosMajorVersion ?? ''}. Until then, notifications tell you when to leave. After updating, set up alarms in Settings › Leave reminders.`}
          </Text>
          <Text style={[styles.updatePath, { color: colors.primary }]}>
            {ja ? 'iPhoneの設定 › 一般 › ソフトウェアアップデート' : 'iPhone Settings › General › Software Update'}
          </Text>
        </Card>
      )}

      {alarmKitAvailable && (
        <>
          <Card style={styles.card}>
            <Row
              testID="toggle-alarms"
              title={ja ? 'アラームを使う' : 'Use alarms'}
              subtitle={ja ? 'マナーモードでも鳴ります' : 'Rings even in silent mode'}
              switchValue={alarmsEnabled}
              onSwitch={setAlarmsEnabled}
            />
          </Card>

          {alarmsEnabled && (
            <>
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  {ja ? 'いつ鳴らす？' : 'When should it ring?'}
                  <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>{ja ? '（複数選択可）' : '  (pick any)'}</Text>
                </Text>
                <View style={styles.chips}>
                  {REMINDER_CHOICES.map((minutes) => (
                    <Chip
                      key={minutes}
                      testID={`alarm-${minutes}`}
                      label={reminderLabel(minutes, ja)}
                      selected={alarmIntervals.includes(minutes)}
                      onPress={() => toggleAlarmInterval(minutes)}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{ja ? '音' : 'Sound'}</Text>
                {/* Only Apple's alarm sound rings through silent mode, so there's no choice. */}
                <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
                  {ja ? 'iOS標準のアラーム音 · マナーモードでも鳴ります' : 'iOS alarm sound · rings even in silent mode'}
                </Text>
              </View>
            </>
          )}

          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            {ja
              ? '同じ時刻は、通知かアラームのどちらか一方です。アラームの時刻には、内容を残すための音なしの通知も届きます。あとから設定で変更できます。'
              : 'Each time is either a notification or an alarm. Alarm times also leave a silent notification with the details. You can change this later in Settings.'}
          </Text>
        </>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  updateCard: { gap: 6, padding: 14 },
  updateTitle: { fontSize: 15, fontWeight: '800' },
  updateBody: { fontSize: 13, lineHeight: 19 },
  updatePath: { fontSize: 13, fontWeight: '700' },
  section: { gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionHint: { fontSize: 12, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footnote: { fontSize: 12, lineHeight: 18 },
});
