import { Card, Chip, Divider, IconButton, Row, SectionLabel, Segmented } from '@/components/ui';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { usePremium } from '@/context/PremiumContext';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS } from '@/lib/time';
import { router } from 'expo-router';
import React from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
    reminderIntervals, toggleReminderInterval, notificationsAllowed,
    missedCheckIn, setMissedCheckIn, nightLocationMode, setNightLocationMode, backgroundAllowed, requestBackgroundLocation,
    demoActive, setDemoNow, nowMs, plan, currentTime, leaveBy, triggerTestNotification, resetAll,
  } = useLastRide();
  const { isPremium, live: premiumLive, setTestPremium } = usePremium();
  const ja = language === 'ja';
  const back = () => (router.canGoBack() ? router.back() : router.replace('/ride'));

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
});
