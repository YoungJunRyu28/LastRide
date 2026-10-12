import { reminderSummary, marginLabel, nightLocationLabel, Section, SettingsPage, useAlarmStatus } from '@/components/SettingsUI';
import { Card, Chip, Divider, Row } from '@/components/ui';
import { useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { usePremium } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';
import { SUPPORT_URL, TERMS_URL, TOKUSHOHO_URL, siteLink } from '@/lib/links';
import { alarmKitAvailable } from '@/lib/notifications';
import { recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS } from '@/lib/time';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

/** Settings, pushed from the gear on Leave. Each row opens a page for that setting. */
export default function SettingsScreen() {
  const colors = useColors();
  const {
    language, destination, leaveMargin,
    reminderIntervals, alarmsEnabled, alarmIntervals, alarmSound, notificationsAllowed,
    nightLocationMode, backgroundAllowed,
    demoActive, setDemoNow, nowMs, plan, currentTime, leaveBy, resetAll,
  } = useLastRide();
  const { isPremium, live: premiumLive, setTestPremium } = usePremium();
  const { leaveAll } = useGroups();
  const [alarmStatus] = useAlarmStatus(alarmsEnabled);
  const ja = language === 'ja';

  const remindersNeedAttention =
    notificationsAllowed === false || (alarmsEnabled && alarmKitAvailable && alarmStatus === 'denied');
  const locationNeedsAttention = nightLocationMode === 'background' && backgroundAllowed === false;

  const confirmReset = () =>
    Alert.alert(
      ja ? '最初からやり直しますか？' : 'Reset and start over?',
      ja
        ? '言語・帰り先・設定が消去され、参加中のグループからも退出します（ホストのグループは解散されます）。'
        : 'This clears your language, destinations and settings, and leaves your groups (groups you host are disbanded).',
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: ja ? '消去する' : 'Reset',
          style: 'destructive',
          onPress: () => void leaveAll().then(resetAll).then(() => router.replace('/')),
        },
      ],
    );

  return (
    <SettingsPage
      title={ja ? '設定' : 'Settings'}
      backLabel={ja ? '戻る' : 'Back'}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/ride'))}
    >
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

      <Section>
        <Row
          testID="edit-home-station"
          icon="map-pin"
          title={ja ? '帰り先' : 'Destinations'}
          value={destination || (ja ? '未設定' : 'Not set')}
          onPress={() => router.push('/destinations')}
        />
        <Divider />
        <Row
          testID="open-reminders"
          icon="bell"
          title={ja ? '出発リマインダー' : 'Leave reminders'}
          subtitle={reminderSummary(reminderIntervals, alarmsEnabled ? alarmIntervals : [], ja)}
          warning={remindersNeedAttention}
          onPress={() => router.push('/settings/reminders')}
        />
        <Divider />
        <Row
          testID="open-night-location"
          icon="moon"
          title={ja ? '夜の位置情報' : 'Night location'}
          value={nightLocationLabel(nightLocationMode, ja)}
          warning={locationNeedsAttention}
          onPress={() => router.push('/settings/location')}
        />
        <Divider />
        <Row
          testID="open-margin"
          icon="clock"
          title={ja ? '早めに出る時間' : 'Leave early by'}
          value={marginLabel(leaveMargin, ja)}
          onPress={() => router.push('/settings/margin')}
        />
        <Divider />
        <Row
          testID="open-language"
          icon="globe"
          title={ja ? '言語' : 'Language'}
          value={ja ? '日本語' : 'English'}
          onPress={() => router.push('/settings/language')}
        />
      </Section>

      <Section label={ja ? 'このアプリについて' : 'ABOUT'}>
        <Row testID="open-privacy" icon="shield" title={ja ? 'プライバシー' : 'Privacy'} onPress={() => router.push('/privacy')} />
        <Divider />
        <Row testID="open-data-sources" icon="database" title={ja ? 'データとライセンス' : 'Data & licences'} onPress={() => router.push('/data-sources')} />
        <Divider />
        <Row
          testID="open-support"
          icon="help-circle"
          title={ja ? 'サポート・お問い合わせ' : 'Support & contact'}
          external
          onPress={() => void WebBrowser.openBrowserAsync(siteLink(SUPPORT_URL, ja))}
        />
        <Divider />
        <Row
          testID="open-terms"
          icon="file-text"
          title={ja ? '利用規約' : 'Terms of use'}
          external
          onPress={() => void WebBrowser.openBrowserAsync(siteLink(TERMS_URL, ja))}
        />
        <Divider />
        <Row
          testID="open-tokushoho"
          icon="file"
          title={ja ? '特定商取引法に基づく表記' : 'Legal notice (Japan)'}
          external
          onPress={() => void WebBrowser.openBrowserAsync(siteLink(TOKUSHOHO_URL, ja))}
        />
      </Section>

      <Section>
        <Row testID="reset-all" icon="rotate-ccw" title={ja ? '最初からやり直す' : 'Reset & start over'} onPress={confirmReset} destructive />
      </Section>

      {__DEV__ && (
        <Section
          label={ja ? 'デモモード（開発用）' : 'DEMO MODE (DEV ONLY)'}
          footer={ja ? 'デモ中は1分＝1秒で進みます。通知は夜のトラッキング中のみ届きます。' : 'While the demo clock runs, 1 minute = 1 second. Notifications need tracking on.'}
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
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  premiumBanner: { alignItems: 'center', flexDirection: 'row', gap: 12, padding: 16 },
  premiumUpsell: { borderRadius: 20, borderWidth: 1.5 },
  premiumText: { flex: 1, gap: 2 },
  premiumTitle: { fontSize: 15, fontWeight: '800' },
  premiumBody: { fontSize: 12, lineHeight: 17 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
});
