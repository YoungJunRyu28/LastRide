import { Notice } from '@/components/RideUI';
import { Section, SettingsPage, useAlarmStatus } from '@/components/SettingsUI';
import { Chip, Divider, Row, SectionLabel } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { alarmKitAvailable, iosMajorVersion, requestAlarmAuthorization, sendTestAlarm } from '@/lib/notifications';
import { reminderLabel } from '@/lib/settings';
import React from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';

/** Settings → Leave reminders: notification and alarm times, alarm sound, check-in. */
export default function ReminderSettingsScreen() {
  const colors = useColors();
  const {
    language, trackingMode,
    reminderIntervals, toggleReminderInterval, alarmsEnabled, setAlarmsEnabled, alarmIntervals, toggleAlarmInterval,
    reminderVibrate, setReminderVibrate, throughFocus, setThroughFocus, notificationsAllowed,
    missedCheckIn, setMissedCheckIn,
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
    const sent = status === 'authorized' && (await sendTestAlarm(language ?? 'en').catch(() => false));
    if (!sent) alarmsNotAllowed();
  };

  return (
    <SettingsPage title={ja ? '出発リマインダー' : 'Leave reminders'} backLabel={ja ? '設定' : 'Settings'}>
      <Notice
        icon={trackingMode ? 'check-circle' : 'moon'}
        title={
          trackingMode
            ? ja ? '今夜の案内が開始されています' : 'Night-out tracking is on'
            : ja ? '夜間の案内中に通知します' : 'Sent during night-out tracking'
        }
        body={
          trackingMode
            ? ja ? '設定したタイミングで通知します。' : 'Reminders arrive at the times below.'
            : ja ? 'ホーム画面で「案内を開始」を押すと、設定した時刻に通知します。' : 'Tap Start on the Leave screen and they arrive at the times below.'
        }
      />

      {notificationsAllowed === false && (
        <Section>
          <Row
            title={ja ? '通知が許可されていません' : 'Notifications are off'}
            subtitle={ja ? 'タップしてiPhoneの設定から通知を許可してください' : 'Tap to allow them in iPhone Settings'}
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

      {/* Before iOS 26 there are no real alarms (no AlarmKit): only how to get them. */}
      {Platform.OS === 'ios' && !alarmKitAvailable && (
        <View style={styles.preAlarms}>
          <SectionLabel>{ja ? 'アラーム' : 'ALARMS'}</SectionLabel>
          <Notice
            icon="alert-circle"
            title={ja ? 'アラームはiOS 26以降で使えます' : 'Alarms need iOS 26 or later'}
            body={
              ja
                ? `このiPhoneはiOS ${iosMajorVersion ?? ''}です。アップデートすると、マナーモードでも鳴るアラームを設定できます。iPhoneの設定 › 一般 › ソフトウェアアップデート`
                : `This iPhone is on iOS ${iosMajorVersion ?? ''}. After updating, you can set alarms that ring even in silent mode. iPhone Settings › General › Software Update`
            }
          />
        </View>
      )}

      {Platform.OS === 'ios' && alarmKitAvailable && (
        <Section
          label={ja ? 'アラーム' : 'ALARMS'}
          footer={
            alarmsEnabled ? (
              <Text style={[styles.footer, { color: colors.mutedForeground }]}>
                {ja
                  ? '同じ時刻には、通知またはアラームのいずれかでお知らせします。アラームを設定した場合は、内容を確認できる音なしの通知も表示されます。'
                  : 'Each time is either a notification or an alarm. Alarm times also leave a silent notification with the details.'}
              </Text>
            ) : null
          }
        >
          <Row
            testID="toggle-alarms"
            title={ja ? 'アラーム' : 'Alarms'}
            subtitle={ja ? 'マナーモードでも鳴ります' : 'Rings even in silent mode'}
            switchValue={alarmsEnabled}
            onSwitch={(enabled) => void switchAlarms(enabled)}
          />
          {alarmsEnabled && alarmStatus === 'denied' && (
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
              {/* Real alarms: only Apple's alarm sound rings through silent mode, so no choice. */}
              <Row
                testID="alarm-sound-fixed"
                title={ja ? '音' : 'Sound'}
                subtitle={ja ? 'iOS標準のアラーム音 · マナーモードでも鳴ります' : 'iOS alarm sound · rings even in silent mode'}
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
          title={ja ? '終電を逃したときの案内' : 'After the last train'}
          subtitle={ja ? '始発やタクシーなどの帰宅手段をお知らせします' : 'A check-in with other ways home'}
          switchValue={missedCheckIn}
          onSwitch={setMissedCheckIn}
        />
        {Platform.OS === 'android' && (
          <>
            <Divider />
            <Row testID="reminder-vibrate" title={ja ? 'バイブレーション' : 'Vibration'} switchValue={reminderVibrate} onSwitch={setReminderVibrate} />
          </>
        )}
      </Section>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  alarmChips: { paddingTop: 0 },
  preAlarms: { gap: 8 },
  footer: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
});
