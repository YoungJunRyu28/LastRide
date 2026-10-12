import { Notice } from '@/components/RideUI';
import { Section, SettingsPage, soundLabel, useAlarmStatus } from '@/components/SettingsUI';
import { Chip, Divider, Row } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { alarmKitAvailable, iosMajorVersion, requestAlarmAuthorization, sendTestAlarm } from '@/lib/notifications';
import { reminderLabel } from '@/lib/settings';
import { router } from 'expo-router';
import React from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';

/** Settings → Leave reminders: notification and alarm times, alarm sound, check-in. */
export default function ReminderSettingsScreen() {
  const colors = useColors();
  const {
    language, trackingMode,
    reminderIntervals, toggleReminderInterval, alarmsEnabled, setAlarmsEnabled, alarmIntervals, toggleAlarmInterval,
    alarmSound, reminderVibrate, setReminderVibrate, notificationsAllowed,
    missedCheckIn, setMissedCheckIn, triggerTestNotification,
  } = useLastRide();
  const [alarmStatus, setAlarmStatus] = useAlarmStatus(alarmsEnabled);
  const ja = language === 'ja';

  const alarmsNotAllowed = () =>
    Alert.alert(
      ja ? 'iPhoneの設定でアラームがオフです' : 'Alarms are off in iPhone Settings',
      ja
        ? '許可するまで、アラームの時刻は通知として届きます（マナーモード中は鳴りません）。'
        : 'Until you allow them, alarm times arrive as notifications (silent in silent mode).',
      [{ text: ja ? 'あとで' : 'Later', style: 'cancel' }, { text: ja ? '設定を開く' : 'Open Settings', onPress: () => void Linking.openSettings() }],
    );

  // Every time alarms are switched on: ask (first time), or point to iPhone Settings if they're blocked.
  const switchAlarms = async (enabled: boolean) => {
    setAlarmsEnabled(enabled);
    if (!enabled || !alarmKitAvailable) return;
    const status = await requestAlarmAuthorization().catch(() => 'denied');
    setAlarmStatus(status);
    if (status !== 'authorized') alarmsNotAllowed();
  };

  const testAlarm = async () => {
    const status = await requestAlarmAuthorization().catch(() => 'denied');
    setAlarmStatus(status);
    const sent = status === 'authorized' && (await sendTestAlarm(language ?? 'en', alarmSound).catch(() => false));
    if (!sent) alarmsNotAllowed();
  };

  return (
    <SettingsPage title={ja ? '出発リマインダー' : 'Leave reminders'} backLabel={ja ? '設定' : 'Settings'}>
      <Notice
        icon={trackingMode ? 'check-circle' : 'moon'}
        title={
          trackingMode
            ? ja ? '今夜のトラッキング中です' : 'Night-out tracking is on'
            : ja ? '夜のトラッキング中に届きます' : 'Sent during night-out tracking'
        }
        body={
          trackingMode
            ? ja ? '下で選んだ時刻に届きます。' : 'Reminders arrive at the times below.'
            : ja ? '帰る時間の画面で「開始」を押すと、下で選んだ時刻に届きます。' : 'Tap Start on the Leave screen and they arrive at the times below.'
        }
      />

      {notificationsAllowed === false && (
        <Section>
          <Row
            title={ja ? '通知が許可されていません' : 'Notifications are off'}
            subtitle={ja ? 'タップしてiPhoneの設定で許可してください' : 'Tap to allow them in iPhone Settings'}
            onPress={() => void Linking.openSettings()}
            destructive
          />
        </Section>
      )}

      <Section label={ja ? '通知' : 'NOTIFICATIONS'}>
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
      </Section>

      {Platform.OS === 'ios' && (
        <Section
          label={ja ? 'アラーム' : 'ALARMS'}
          footer={
            <View style={styles.footerStack}>
              {alarmsEnabled && !alarmKitAvailable && (
                <Text style={[styles.footer, { color: colors.mutedForeground }]}>
                  {ja
                    ? `アラームはiOS 26以降で使えます（このiPhoneはiOS ${iosMajorVersion ?? ''}）。それまでは通知として届きます。`
                    : `Alarms need iOS 26 or later (this iPhone has iOS ${iosMajorVersion ?? ''}). Until then they arrive as notifications.`}
                </Text>
              )}
              {alarmsEnabled && (
                <Text style={[styles.footer, { color: colors.mutedForeground }]}>
                  {ja ? '同じ時刻は、通知かアラームのどちらか一方です。' : 'Each time is either a notification or an alarm.'}
                </Text>
              )}
            </View>
          }
        >
          <Row
            testID="toggle-alarms"
            title={ja ? 'アラーム' : 'Alarms'}
            subtitle={ja ? 'マナーモードでも鳴ります' : 'Rings even in silent mode'}
            switchValue={alarmsEnabled}
            onSwitch={(enabled) => void switchAlarms(enabled)}
          />
          {alarmsEnabled && alarmKitAvailable && alarmStatus === 'denied' && (
            <>
              <Divider />
              <Row
                testID="alarm-settings"
                title={ja ? 'iPhoneの設定でアラームがオフです' : 'Alarms are off in iPhone Settings'}
                subtitle={ja ? 'タップして許可してください' : 'Tap to allow them'}
                onPress={() => void Linking.openSettings()}
                destructive
              />
            </>
          )}
          {alarmsEnabled && (
            <>
              <View style={[styles.chips, styles.alarmChips]}>
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
              <Divider />
              <Row
                testID="open-alarm-sound"
                title={ja ? '音' : 'Sound'}
                value={soundLabel(alarmSound, ja)}
                onPress={() => router.push('/settings/sound')}
              />
              {alarmKitAvailable && (
                <>
                  <Divider />
                  <Row
                    testID="test-alarm"
                    title={ja ? '実際のアラームで確認' : 'Check with a real alarm'}
                    subtitle={ja ? '5秒後に鳴ります' : 'Rings in 5 seconds'}
                    onPress={() => void testAlarm()}
                  />
                </>
              )}
            </>
          )}
        </Section>
      )}

      <Section label={ja ? 'その他' : 'MORE'}>
        <Row
          testID="toggle-missed-check-in"
          title={ja ? '終電後の案内' : 'After the last train'}
          subtitle={ja ? '乗り遅れたときの選択肢を通知' : 'A check-in with other ways home'}
          switchValue={missedCheckIn}
          onSwitch={setMissedCheckIn}
        />
        {Platform.OS === 'android' && (
          <>
            <Divider />
            <Row testID="reminder-vibrate" title={ja ? 'バイブレーション' : 'Vibration'} switchValue={reminderVibrate} onSwitch={setReminderVibrate} />
          </>
        )}
        <Divider />
        <Row
          testID="test-notification"
          title={ja ? 'テスト通知を送る' : 'Send a test notification'}
          subtitle={ja ? '通知の見え方を確認' : 'See how reminders look'}
          onPress={() => void triggerTestNotification()}
        />
      </Section>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  alarmChips: { paddingTop: 0 },
  footerStack: { gap: 8 },
  footer: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
});
