import { OnboardingFrame, OnboardingHeading, SETUP_STEPS } from '@/components/Onboarding';
import { soundLabel } from '@/components/SettingsUI';
import { Card, Chip, PrimaryButton, Row, TextButton } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { alarmKitAvailable, iosMajorVersion, previewSound, requestAlarmAuthorization } from '@/lib/notifications';
import { REMINDER_SOUNDS, reminderLabel } from '@/lib/settings';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Setup: alarms that ring like the Clock app, even in silent mode (iOS 26+).
 * Off unless chosen; switching them on starts with one at the leave time.
 * Older iOS: the same choices, plus a note that updating unlocks real alarms
 * (until then alarm times arrive as notifications with the chosen sound).
 */
export default function OnboardingAlarmsScreen() {
  const colors = useColors();
  const { language, alarmsEnabled, setAlarmsEnabled, alarmIntervals, toggleAlarmInterval, alarmSound, setAlarmSound } = useLastRide();
  const ja = language === 'ja';
  const [asking, setAsking] = useState(false);
  const next = () => router.replace('/onboarding-margin');

  const proceed = async () => {
    if (alarmsEnabled && alarmKitAvailable) {
      // iOS asks once; if it's refused, alarm times arrive as notifications instead.
      setAsking(true);
      await requestAlarmAuthorization().catch(() => 'denied');
      setAsking(false);
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
            {ja ? 'iOS 26以降にアップデートすると使えます' : 'Update to iOS 26 or later to use alarms'}
          </Text>
          <Text style={[styles.updateBody, { color: colors.mutedForeground }]}>
            {ja
              ? `このiPhoneはiOS ${iosMajorVersion ?? ''}です。今はアラームの時刻も、選んだ音の通知として届きます（マナーモード中は鳴りません）。アップデート後は、ここで選んだ内容がそのままマナーモードでも鳴るアラームになります。設定 › 出発リマインダー からいつでも変更できます。`
              : `This iPhone is on iOS ${iosMajorVersion ?? ''}. For now, alarm times arrive as notifications with your chosen sound (silent in silent mode). After updating, the same choices become alarms that ring even in silent mode. You can change them any time in Settings › Leave reminders.`}
          </Text>
          <Text style={[styles.updatePath, { color: colors.primary }]}>
            {ja ? 'iPhoneの設定 › 一般 › ソフトウェアアップデート' : 'iPhone Settings › General › Software Update'}
          </Text>
        </Card>
      )}

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
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {ja ? '音' : 'Sound'}
              <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>{ja ? '（タップで試聴）' : '  (tap to hear)'}</Text>
            </Text>
            <View style={styles.chips}>
              {REMINDER_SOUNDS.map((sound) => (
                <Chip
                  key={sound}
                  testID={`alarm-sound-${sound}`}
                  label={soundLabel(sound, ja)}
                  selected={alarmSound === sound}
                  onPress={() => {
                    setAlarmSound(sound);
                    previewSound(sound).catch(() => undefined);
                  }}
                />
              ))}
            </View>
          </View>
        </>
      )}

      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        {ja
          ? '同じ時刻は、通知かアラームのどちらか一方です。あとから設定で変更できます。'
          : 'Each time is either a notification or an alarm. You can change this later in Settings.'}
      </Text>
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
