import { Card, Chip, Divider, IconButton, Row, SectionLabel, Segmented } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { alarmKitAvailable, alarmAuthorizationStatus, requestAlarmAuthorization, sendTestAlarm } from '@/lib/notifications';
import type { ReminderMode, ReminderSound } from '@/lib/settings';
import { usePremium } from '@/context/PremiumContext';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS } from '@/lib/time';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A labelled card of rows, with an optional note underneath. */
function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <SectionLabel>{label}</SectionLabel>
      <Card style={styles.card}>{children}</Card>
      {hint ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
    </View>
  );
}

/** Settings, pushed from the gear on Leave. */
export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    language, homeStation, destination, leaveMargin, setLeaveMargin, setLanguage,
    reminderIntervals, toggleReminderInterval, reminderPreferences, setReminderPreference, notificationsAllowed,
    missedCheckIn, setMissedCheckIn, nightLocationMode, setNightLocationMode, backgroundAllowed, requestBackgroundLocation,
    demoActive, setDemoNow, nowMs, plan, currentTime, leaveBy, triggerTestNotification, resetAll,
  } = useLastRide();
  const { isPremium, live: premiumLive, setTestPremium } = usePremium();
  const ja = language === 'ja';
  const back = () => (router.canGoBack() ? router.back() : router.replace('/ride'));
  const [alarmStatus, setAlarmStatus] = useState<string>('unknown');
  useEffect(() => {
    void alarmAuthorizationStatus().then(setAlarmStatus).catch(() => setAlarmStatus('unsupported'));
  }, []);

  async function setMode(minute: number, mode: ReminderMode) {
    if (mode === 'alarm') {
      if (!alarmKitAvailable) {
        Alert.alert(
          ja ? 'アラームを利用できません' : 'System alarm unavailable',
          ja ? 'iOS 26以降のiPhoneとネイティブビルドが必要です。通常の通知は利用できます。'
             : 'System alarms require iOS 26+ and a native iOS build. Standard notifications are still available.',
        );
        return;
      }
      let status = alarmStatus;
      if (status !== 'authorized') {
        status = await requestAlarmAuthorization().catch(() => 'denied');
        setAlarmStatus(status);
      }
      if (status !== 'authorized') {
        Alert.alert(
          ja ? 'アラームの許可が必要です' : 'Allow alarms',
          ja ? 'iPhoneの設定でLastRideのアラームを許可してください。許可されるまでは通常の通知が届きます。'
             : 'Allow LastRide alarms in iPhone Settings. Until enabled, reminders fall back to normal notifications.',
          [{ text: 'OK' }, { text: ja ? '設定を開く' : 'Open settings', onPress: () => void Linking.openSettings() }],
        );
        return;
      }
    }
    setReminderPreference(minute, { mode });
  }

  const leadTimes = [...reminderIntervals.filter((minute) => REMINDER_CHOICES.includes(minute)).sort((a,b) => b-a), 0];
  const soundOptions: { value: ReminderSound; label: string }[] = [
    { value: 'default', label: ja ? 'iOS標準' : 'iOS default' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'chime', label: 'Chime' },
    { value: 'urgent', label: ja ? '緊急' : 'Urgent' },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 12), paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={back} testID="settings-back" />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{ja ? '設定' : 'Settings'}</Text>
          <View style={styles.topbarSpacer} />
        </View>

        {isPremium ? (
          <Card style={styles.premiumBanner}>
            <Feather name="star" size={18} color={colors.primary} />
            <View style={styles.premiumText}>
              <Text style={[styles.premiumTitle, { color: colors.foreground }]}>{ja ? 'プレミアム利用中' : 'Premium is on'}</Text>
              <Text style={[styles.premiumBody, { color: colors.mutedForeground }]}>
                {ja ? '解約は端末のサブスクリプション設定から行えます。' : 'Manage or cancel in your device’s subscription settings.'}
              </Text>
            </View>
          </Card>
        ) : (
          <Pressable
            testID="settings-premium"
            onPress={() => router.push('/paywall')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.premiumBanner, styles.premiumUpsell, { backgroundColor: colors.card, borderColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Feather name="star" size={18} color={colors.primary} />
            <View style={styles.premiumText}>
              <Text style={[styles.premiumTitle, { color: colors.foreground }]}>{ja ? 'プレミアムにアップグレード' : 'Upgrade to Premium'}</Text>
              <Text style={[styles.premiumBody, { color: colors.mutedForeground }]}>
                {ja ? 'グループ作成・ロック画面・ウィジェットなど' : 'Hosting groups, lock screen, widgets and more'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        )}

        <Section label={ja ? '帰り先' : 'DESTINATIONS'}>
          <Row
            testID="edit-home-station"
            title={destination || (ja ? '未設定' : 'Not set')}
            subtitle={homeStation ? (ja ? `最寄り駅：${homeStation}` : `Nearest station: ${homeStation}`) : (ja ? '帰り先を設定' : 'Choose where you are heading')}
            onPress={() => router.push('/destinations')}
          />
        </Section>

        <Section
          label={ja ? '出発リマインダー' : 'LEAVE REMINDERS'}
          hint={
            Platform.OS === 'web'
              ? ja
                ? 'ブラウザ版ではこのタブを開いている間のみ届きます。'
                : 'In the browser, reminders only arrive while this tab is open.'
              : ja
                ? '夜のトラッキング中に届きます。出発時刻ちょうどにも通知します。'
                : 'Sent while night-out tracking is on, including when it’s time to go.'
          }
        >
          <View style={styles.chipRow}>
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
          <Divider />
          <View style={styles.deliverySettings}>
            {leadTimes.map((minute) => {
              const preference = reminderPreferences[minute];
              return (
                <View key={minute} style={[styles.reminderCard, { borderColor: colors.border }]}>
                  <Text style={[styles.reminderLabel, { color: colors.foreground }]}>
                    {minute === 0
                      ? ja ? '出発時刻ちょうど（常に通知）' : 'Leave now (always on)'
                      : ja ? `${minute}分前` : `${minute} minutes before`}
                  </Text>
                  <Segmented
                    stretch
                    value={preference.mode}
                    onChange={(mode) => void setMode(minute, mode as ReminderMode)}
                    options={[
                      { value: 'notification', label: ja ? '通知' : 'Notification' },
                      { value: 'alarm', label: ja ? 'フルアラーム' : 'Full alarm' },
                    ]}
                  />
                  {preference.mode === 'alarm' && (
                    <>
                      <Text style={[styles.reminderSubheading, { color: colors.mutedForeground }]}>
                        {ja ? 'アラーム音' : 'Alarm sound'}
                      </Text>
                      <View style={styles.soundChoices}>
                        {soundOptions.map(({ value, label }) => (
                          <Chip key={value} testID={`alarm-sound-${minute}-${value}`}
                            label={label} selected={preference.sound === value}
                            onPress={() => setReminderPreference(minute, { sound: value })} />
                        ))}
                      </View>
                    </>
                  )}
                  {Platform.OS === 'android' ? (
                    <Row
                      testID={`reminder-vibrate-${minute}`}
                      title={ja ? 'バイブレーション' : 'Vibration'}
                      switchValue={preference.vibrate}
                      onSwitch={(vibrate) => setReminderPreference(minute, { vibrate })}
                    />
                  ) : (
                    <Text style={[styles.reminderHint, { color: colors.mutedForeground }]}>
                      {ja
                        ? '振動はiPhoneの「サウンドと触覚」設定に従います（個別変更不可）。'
                        : 'Vibration follows iPhone Sounds & Haptics settings (not individually controllable).'}
                    </Text>
                  )}
                </View>
              );
            })}
            <Text style={[styles.reminderHint, { color: colors.mutedForeground }]}>
              {ja
                ? 'アラームの音量はiPhone側で管理されます。「設定」→「サウンドと触覚」で調整してください。アプリから最大音量への強制変更はできません。'
                : 'Alarm loudness is controlled by your iPhone. Adjust it in Settings → Sounds & Haptics. Apps cannot force maximum speaker volume.'}
            </Text>
            {alarmStatus === 'denied' && (
              <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>
                  {ja ? 'iPhoneのアラーム許可を確認する ›' : 'Check alarm permission in iPhone settings ›'}
                </Text>
              </Pressable>
            )}
          </View>
          <Divider />
          <Row
            testID="toggle-missed-check-in"
            title={ja ? '終電後の案内' : 'After the last train'}
            subtitle={ja ? '乗り遅れたときの選択肢を通知します' : 'A check-in with your other ways home'}
            switchValue={missedCheckIn}
            onSwitch={setMissedCheckIn}
          />
          {notificationsAllowed === false && (
            <>
              <Divider />
              <Row title={ja ? '通知が許可されていません' : 'Notifications are off'} subtitle={ja ? '端末の設定から許可してください。' : 'Enable them in your device settings.'} destructive />
            </>
          )}
        </Section>

        <Section
          label={ja ? '夜の位置情報' : 'NIGHT LOCATION'}
          hint={
            nightLocationMode === 'ask'
              ? ja
                ? '夜のトラッキング中だけ使います。まだ選ばれていないため、次にトラッキングを始めるときに確認します。'
                : 'Only used while night tracking is on. Not chosen yet, so you’ll be asked when you next start tracking.'
              : ja
                ? '夜のトラッキング中だけ使います。'
                : 'Only used while night tracking is on.'
          }
        >
          <View style={styles.block}>
            <Segmented
              stretch
              value={nightLocationMode}
              onChange={(mode) => {
                setNightLocationMode(mode);
                // 閉じても更新 needs iOS "Always": ask now, while the choice is fresh.
                if (mode === 'background' && Platform.OS !== 'web') void requestBackgroundLocation();
              }}
              options={[
                { value: 'foreground', label: ja ? 'アプリのみ' : 'App open' },
                { value: 'background', label: ja ? '閉じても更新' : 'When closed' },
              ]}
            />
          </View>
          {nightLocationMode === 'background' && backgroundAllowed === false && (
            <>
              <Divider />
              <Row
                testID="background-location-settings"
                title={ja ? 'iPhoneの設定が「常に」ではありません' : 'iPhone Settings isn’t “Always”'}
                subtitle={
                  ja
                    ? 'このままでは、アプリを閉じている間は更新されません。タップして位置情報を「常に」にしてください。'
                    : 'Until then, LastRide can’t update while closed. Tap to set location access to “Always”.'
                }
                onPress={() => void Linking.openSettings()}
                destructive
              />
            </>
          )}
        </Section>

        <Section label={ja ? '好みの設定' : 'PREFERENCES'} hint={ja ? '余裕：「遅くとも」の何分前に出発を勧めるか。ぎりぎり 0分・ふつう 4分・余裕あり 10分（乗り換えや長い徒歩はさらに追加）。' : 'Time to spare: how long before the latest leave time we tell you to go. Tight 0 min, Normal 4, Relaxed 10 (more for transfers and long walks).'}>
          <Row title={ja ? '余裕' : 'Time to spare'}>
            <Segmented
              value={leaveMargin}
              onChange={setLeaveMargin}
              options={[
                { value: 'tight', label: ja ? 'ぎりぎり' : 'Tight' },
                { value: 'normal', label: ja ? 'ふつう' : 'Normal' },
                { value: 'relaxed', label: ja ? '余裕あり' : 'Relaxed' },
              ]}
            />
          </Row>
          <Divider />
          <Row title={ja ? '言語' : 'Language'}>
            <Segmented
              value={language ?? 'en'}
              onChange={setLanguage}
              options={[
                { value: 'ja', label: '日本語' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Row>
        </Section>

        <Section label={ja ? 'その他' : 'MORE'}>
          <Row testID="test-notification" title={ja ? 'テスト通知を送る' : 'Send test notification'} subtitle={ja ? '通知の見え方を確認します' : 'Check how reminders look'} onPress={() => void triggerTestNotification()} />
          {Platform.OS === 'ios' && alarmKitAvailable && (
            <>
              <Divider />
              <Row
                testID="test-alarm"
                title={ja ? '15秒後にアラームをテスト' : 'Test alarm in 15 seconds'}
                subtitle={ja ? '実際のiPhoneで音量を確認できます' : 'Check the actual sound and volume on your iPhone'}
                onPress={() => void (async () => {
                  const status = await requestAlarmAuthorization().catch(() => 'denied');
                  setAlarmStatus(status);
                  if (status !== 'authorized') {
                    Alert.alert(ja ? 'アラーム許可が必要です' : 'Alarm permission needed');
                    return;
                  }
                  try {
                    await sendTestAlarm(language ?? 'en', reminderPreferences[leadTimes.find((minute) => reminderPreferences[minute].mode === 'alarm') ?? 0].sound);
                    Alert.alert(ja ? 'テストを予約しました' : 'Test scheduled', ja ? '15秒後にアラームが鳴ります。' : 'Your alarm will ring in 15 seconds.');
                  } catch {
                    Alert.alert(ja ? 'アラームを設定できませんでした' : 'Could not schedule alarm');
                  }
                })()}
              />
            </>
          )}
          <Divider />
          <Row testID="open-privacy" title={ja ? 'プライバシー' : 'Privacy'} subtitle={ja ? '位置情報の扱いについて' : 'How your location is used'} onPress={() => router.push('/privacy')} />
          <Divider />
          <Row testID="open-data-sources" title={ja ? 'データとライセンス' : 'Data & licences'} subtitle={ja ? '時刻データの提供元と注意事項' : 'Where train times come from'} onPress={() => router.push('/data-sources')} />
          <Divider />
          <Row
            testID="reset-all"
            title={ja ? '最初からやり直す' : 'Reset & start over'}
            subtitle={ja ? '言語・帰り先・設定を消去します' : 'Clears your language, destinations and settings'}
            onPress={() => void resetAll().then(() => router.replace('/'))}
            destructive
          />
        </Section>

        {__DEV__ && (
          <Section
            label={ja ? 'デモモード（開発用）' : 'DEMO MODE (DEV ONLY)'}
            hint={ja ? 'デモ中は1分＝1秒で進みます。通知は夜のトラッキング中のみ届きます。' : 'While the demo clock runs, 1 minute = 1 second. Notifications need tracking on.'}
          >
            {!premiumLive && (
              <>
                <Row
                  testID="toggle-test-premium"
                  title={ja ? 'プレミアム（テスト）' : 'Premium (test mode)'}
                  subtitle={ja ? 'RevenueCatのキー設定前の確認用' : 'Until RevenueCat keys are set'}
                  switchValue={isPremium}
                  onSwitch={setTestPremium}
                />
                <Divider />
              </>
            )}
            <Row title={ja ? '時刻を動かす' : 'Shift the clock'} subtitle={ja ? `現在 ${currentTime} · 出発 ${leaveBy}` : `Now ${currentTime} · leave by ${leaveBy}`} />
            <View style={styles.chipRow}>
              {[-30, -5, 5, 30].map((delta) => (
                <Chip
                  key={delta}
                  testID={`demo-shift-${delta}`}
                  label={`${delta > 0 ? `+${delta}` : delta}${ja ? '分' : 'm'}`}
                  selected={false}
                  onPress={() => setDemoNow(nowMs + delta * MINUTE_MS)}
                />
              ))}
              {plan && (
                <Chip
                  testID="demo-jump-leave"
                  label={ja ? '出発直前へ' : 'Jump near leave'}
                  selected
                  onPress={() => setDemoNow(recommendedLeaveTime(plan) - (Math.max(0, ...reminderIntervals) + 1) * MINUTE_MS)}
                />
              )}
              {demoActive && <Chip testID="demo-reset" label={ja ? 'リセット' : 'Reset'} selected={false} onPress={() => setDemoNow(null)} />}
            </View>
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 20, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  topbarSpacer: { width: 44 },
  title: { fontSize: 17, fontWeight: '800' },
  section: { gap: 8 },
  card: { overflow: 'hidden', padding: 0 },
  block: { padding: 12 },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  premiumBanner: { alignItems: 'center', flexDirection: 'row', gap: 12, padding: 16 },
  premiumUpsell: { borderRadius: 20, borderWidth: 1.5 },
  premiumText: { flex: 1, gap: 2 },
  premiumTitle: { fontSize: 15, fontWeight: '800' },
  premiumBody: { fontSize: 12, lineHeight: 17 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  deliverySettings: { gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  reminderCard: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  reminderLabel: { fontSize: 14, fontWeight: '700' },
  reminderSubheading: { fontSize: 12, fontWeight: '600' },
  soundChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  reminderHint: { fontSize: 11, lineHeight: 16 },
});
