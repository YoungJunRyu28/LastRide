import { Card, Chip, Divider, IconButton, Row, SectionLabel, Segmented } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { alarmKitAvailable, alarmAuthorizationStatus, iosMajorVersion, previewSound, requestAlarmAuthorization, sendTestAlarm } from '@/lib/notifications';
import { REMINDER_SOUNDS, reminderLabel, type ReminderSound } from '@/lib/settings';
import { usePremium } from '@/context/PremiumContext';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS } from '@/lib/time';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SUPPORT_URL, TERMS_URL, TOKUSHOHO_URL, siteLink } from '@/lib/links';
import React, { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
    reminderIntervals, toggleReminderInterval, alarmsEnabled, setAlarmsEnabled, alarmIntervals, toggleAlarmInterval,
    alarmSound, setAlarmSound, reminderVibrate, setReminderVibrate, notificationsAllowed,
    missedCheckIn, setMissedCheckIn, nightLocationMode, setNightLocationMode, backgroundAllowed, requestBackgroundLocation,
    demoActive, setDemoNow, nowMs, plan, currentTime, leaveBy, triggerTestNotification, resetAll,
  } = useLastRide();
  const { isPremium, live: premiumLive, setTestPremium } = usePremium();
  const ja = language === 'ja';
  const back = () => (router.canGoBack() ? router.back() : router.replace('/ride'));
  // Rechecked when alarms are switched on and on return from iPhone Settings.
  const [alarmStatus, setAlarmStatus] = useState<string>('unknown');
  useEffect(() => {
    const check = () => void alarmAuthorizationStatus().then(setAlarmStatus).catch(() => setAlarmStatus('unsupported'));
    check();
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && check());
    return () => subscription.remove();
  }, [alarmsEnabled]);

  const soundLabel = (sound: ReminderSound) =>
    ({ default: ja ? 'iOS標準' : 'iOS default', pulse: 'Pulse', chime: 'Chime', urgent: ja ? '緊急' : 'Urgent' })[sound];

  const chooseSound = (sound: ReminderSound) => {
    setAlarmSound(sound);
    previewSound(sound).catch(() => undefined);
  };

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
                ? '夜のトラッキング中に届きます。同じ時刻は通知かアラームのどちらか一方です。'
                : 'Sent while night-out tracking is on. Each time is either a notification or an alarm.'
          }
        >
          <View style={styles.reminderList}>
            <Text style={[styles.listTitle, { color: colors.foreground }]}>{ja ? '通知' : 'Notifications'}</Text>
            <View style={styles.choiceRow}>
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
          {Platform.OS === 'ios' && (
            <>
              <Divider />
              <Row
                testID="toggle-alarms"
                title={ja ? 'アラーム' : 'Alarms'}
                subtitle={ja ? '時計のアラームのように、マナーモードでも鳴ります' : 'Rings like a Clock alarm, even in silent mode'}
                switchValue={alarmsEnabled}
                onSwitch={(enabled) => void switchAlarms(enabled)}
              />
              {alarmsEnabled && alarmKitAvailable && alarmStatus === 'denied' && (
                <>
                  <Divider />
                  <Row
                    testID="alarm-settings"
                    title={ja ? 'iPhoneの設定でアラームがオフです' : 'Alarms are off in iPhone Settings'}
                    subtitle={
                      ja
                        ? 'このままでは通知として届き、マナーモード中は鳴りません。タップしてアラームを許可してください。'
                        : 'Until then they arrive as notifications and stay silent in silent mode. Tap to allow alarms.'
                    }
                    onPress={() => void Linking.openSettings()}
                    destructive
                  />
                </>
              )}
              {alarmsEnabled && (
                <View style={[styles.reminderList, styles.alarmList]}>
                  <View style={styles.choiceRow}>
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
                  <Text style={[styles.listTitle, { color: colors.foreground }]}>{ja ? '音' : 'Sound'}</Text>
                  <View style={styles.choiceRow}>
                    {REMINDER_SOUNDS.map((sound) => (
                      <Chip
                        key={sound}
                        testID={`alarm-sound-${sound}`}
                        label={soundLabel(sound)}
                        selected={alarmSound === sound}
                        onPress={() => chooseSound(sound)}
                      />
                    ))}
                  </View>
                  <Text style={[styles.listNote, { color: colors.mutedForeground }]}>
                    {ja
                      ? 'タップで試聴できます（メディアの音量で再生）。iOS標準の音と実際の音量は、下の「実際のアラームで確認」で確かめられます。'
                      : 'Tap to preview (plays at media volume). Hear iOS default and the real loudness with “Check with a real alarm” below.'}
                  </Text>
                  {!alarmKitAvailable && (
                    <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}>
                      <Text style={[styles.listNote, { color: colors.mutedForeground }]}>
                        {ja
                          ? `このiPhone（iOS ${iosMajorVersion ?? ''}）ではアラームを使えません。iOS 26以降にアップデートすると使えるようになります。それまでは、選んだ音の通知として届きます（マナーモード中は鳴りません）。`
                          : `Alarms need iOS 26 or later (this iPhone has iOS ${iosMajorVersion ?? ''}). Until you update, they arrive as notifications with your chosen sound, and stay silent in silent mode.`}
                      </Text>
                      <Text style={[styles.listLink, { color: colors.primary }]}>
                        {ja ? '設定 → 一般 → ソフトウェアアップデート ›' : 'Settings → General → Software Update ›'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
              {alarmsEnabled && alarmKitAvailable && (
                <>
                  <Divider />
                  <Row
                    testID="test-alarm"
                    title={ja ? '実際のアラームで確認' : 'Check with a real alarm'}
                    subtitle={ja ? '5秒後に鳴ります。画面をロックすると、実際の見え方を確認できます。' : 'Rings in 5 seconds. Lock your phone to see it as you will on the night.'}
                    onPress={() => void testAlarm()}
                  />
                </>
              )}
            </>
          )}
          {Platform.OS === 'android' && (
            <>
              <Divider />
              <Row
                testID="reminder-vibrate"
                title={ja ? 'バイブレーション' : 'Vibration'}
                switchValue={reminderVibrate}
                onSwitch={setReminderVibrate}
              />
            </>
          )}
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
          <Divider />
          <Row testID="open-privacy" title={ja ? 'プライバシー' : 'Privacy'} subtitle={ja ? '位置情報の扱いについて' : 'How your location is used'} onPress={() => router.push('/privacy')} />
          <Divider />
          <Row testID="open-data-sources" title={ja ? 'データとライセンス' : 'Data & licences'} subtitle={ja ? '時刻データの提供元と注意事項' : 'Where train times come from'} onPress={() => router.push('/data-sources')} />
          <Divider />
          <Row testID="open-support" title={ja ? 'サポート・お問い合わせ' : 'Support & contact'} subtitle={ja ? 'よくある質問と連絡先' : 'Questions and how to reach us'} onPress={() => void WebBrowser.openBrowserAsync(siteLink(SUPPORT_URL, ja))} />
          <Divider />
          <Row testID="open-terms" title={ja ? '利用規約' : 'Terms of use'} onPress={() => void WebBrowser.openBrowserAsync(siteLink(TERMS_URL, ja))} />
          <Divider />
          <Row testID="open-tokushoho" title={ja ? '特定商取引法に基づく表記' : 'Legal notice (Japan)'} onPress={() => void WebBrowser.openBrowserAsync(siteLink(TOKUSHOHO_URL, ja))} />
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
  reminderList: { gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  alarmList: { paddingTop: 0 },
  listTitle: { fontSize: 13, fontWeight: '700' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  listNote: { fontSize: 12, lineHeight: 18 },
  listLink: { fontSize: 13, fontWeight: '700', marginTop: 4 },
});
