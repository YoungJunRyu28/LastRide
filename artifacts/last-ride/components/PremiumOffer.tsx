import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, TextButton } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { trialLabel, usePremium, type PlanChoice } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** Legal pages; set per build so the URLs can move without an app change. */
import { TERMS_URL, TOKUSHOHO_URL, siteLink } from '@/lib/links';

export function premiumFeatures(ja: boolean): Array<{ icon: IconName; title: string; body: string }> {
  return [
    { icon: 'users', title: ja ? 'グループを作成・ホストになる' : 'Create groups and host', body: ja ? 'メンバーの参加は無料' : 'Members join free' },
    {
      icon: 'lock',
      title: ja ? 'ロック画面のカウントダウン' : 'Lock-screen countdown',
      body: ja ? 'ライブアクティビティ · Androidは通知' : 'Live Activity · a notification on Android',
    },
    {
      icon: 'bell',
      title: ja ? 'アラームをもっと' : 'More alarms',
      body: ja ? '出発時以外のタイミングと音の選択 · アラームはiOS 26以降' : 'At other times, with a choice of sound · alarms need iOS 26+',
    },
    { icon: 'grid', title: ja ? 'ホーム画面ウィジェット' : 'Home-screen widgets', body: ja ? '今夜の出発時刻をひと目で' : 'Tonight’s leave time at a glance' },
    { icon: 'map-pin', title: ja ? '帰り先を無制限に' : 'Unlimited destinations', body: ja ? '無料プランは1件まで' : 'Free plan: one' },
  ];
}

const trialText = trialLabel;

/** Paywall body shared by the paywall and the one-time trial offer. */
export function PremiumOffer({
  ja,
  onDone,
  secondary,
}: {
  ja: boolean;
  /** Called after a purchase or restore that unlocked premium. */
  onDone: () => void;
  /** Extra action under the main button, e.g. "あとで（無料で使う）". */
  secondary?: React.ReactNode;
}) {
  const colors = useColors();
  const { plans, purchase, restore, live } = usePremium();
  const [selectedId, setSelectedId] = useState<PlanChoice['id']>('annual');
  const [busy, setBusy] = useState(false);
  const selected = plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null;

  useEffect(() => {
    if (plans.length > 0 && !plans.some((plan) => plan.id === selectedId)) setSelectedId(plans[0].id);
  }, [plans, selectedId]);

  const store = Platform.OS === 'android' ? (ja ? 'Googleアカウント' : 'Google account') : 'Apple ID';
  const trial = selected?.trialDays ?? null;
  const trialLabel = trialText(trial, ja);

  const buy = async () => {
    if (!selected) return;
    setBusy(true);
    const result = await purchase(selected);
    setBusy(false);
    if (result === 'purchased') onDone();
    else if (result === 'failed')
      Alert.alert(ja ? '購入できませんでした' : 'Purchase didn’t go through', ja ? 'しばらくしてからもう一度お試しください。' : 'Please try again in a moment.');
  };

  const restorePurchases = async () => {
    setBusy(true);
    const entitled = await restore();
    setBusy(false);
    if (entitled) onDone();
    else Alert.alert(ja ? '復元できる購入がありません' : 'Nothing to restore', ja ? `この${store}での購入は見つかりませんでした。` : `No purchase was found for this ${store}.`);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.features}>
        {premiumFeatures(ja).map((feature) => (
          <View key={feature.title} style={styles.feature}>
            <View style={[styles.featureIcon, { backgroundColor: colors.accent }]}>
              <Feather name={feature.icon} size={17} color={colors.primary} />
            </View>
            <View style={styles.featureText}>
              <Text style={[styles.featureTitle, { color: colors.foreground }]}>{feature.title}</Text>
              <Text style={[styles.featureBody, { color: colors.mutedForeground }]}>{feature.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.plans} accessibilityRole="radiogroup">
        {plans.map((plan) => {
          const active = plan.id === selected?.id;
          const annual = plan.id === 'annual';
          return (
            <Pressable
              key={plan.id}
              testID={`plan-${plan.id}`}
              onPress={() => setSelectedId(plan.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              style={({ pressed }) => [
                styles.plan,
                { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border, borderWidth: active ? 2 : 1, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              {annual && (
                <Text style={[styles.planBadge, { backgroundColor: colors.primary, color: colors.primaryForeground }]}>{ja ? 'おすすめ' : 'Best value'}</Text>
              )}
              <Text style={[styles.planName, { color: colors.mutedForeground }]}>{annual ? (ja ? '年額' : 'Yearly') : ja ? '月額' : 'Monthly'}</Text>
              <Text style={[styles.planPrice, { color: colors.foreground }]}>
                {plan.price}
                <Text style={[styles.planPer, { color: colors.mutedForeground }]}>{annual ? (ja ? '/年' : '/yr') : ja ? '/月' : '/mo'}</Text>
              </Text>
              <Text style={[styles.planNote, { color: active ? colors.primary : colors.mutedForeground }]}>
                {trialText(plan.trialDays, ja) ?? (ja ? 'いつでも解約' : 'Cancel any time')}
              </Text>
            </Pressable>
          );
        })}
        {plans.length === 0 && (
          <Text style={[styles.legal, { color: colors.mutedForeground }]}>{ja ? 'プランを読み込めませんでした。' : 'Couldn’t load plans.'}</Text>
        )}
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={trialLabel ? (ja ? `${trialLabel}で試す` : `Try ${trialLabel}`) : ja ? 'プレミアムにする' : 'Get Premium'}
          onPress={() => void buy()}
          loading={busy}
          disabled={!selected}
          testID="start-premium"
        />
        {secondary}
        {!live && (
          <Text style={[styles.testMode, { color: colors.destructive }]}>
            {ja ? 'テストモード：実際の請求はありません（開発ビルドのみ）' : 'Test mode: no real charge (development builds only)'}
          </Text>
        )}
        <Text style={[styles.legal, { color: colors.mutedForeground }]}>
          {trial
            ? ja
              ? `無料期間終了後、${store}に自動で請求されます。終了の24時間前までに解約すれば請求されません。`
              : `After the trial your ${store} is charged automatically. Cancel at least 24 hours before it ends to avoid a charge.`
            : ja
              ? `${store}に請求され、解約するまで自動で更新されます。`
              : `Charged to your ${store}; renews automatically until cancelled.`}
        </Text>
        <View style={styles.links}>
          <TextButton label={ja ? '購入を復元' : 'Restore purchases'} onPress={() => void restorePurchases()} testID="restore-purchases" />
          <TextButton label={ja ? '利用規約' : 'Terms'} onPress={() => void WebBrowser.openBrowserAsync(siteLink(TERMS_URL, ja))} />
          <TextButton label={ja ? 'プライバシー' : 'Privacy'} onPress={() => router.push('/privacy')} />
          <TextButton label={ja ? '特定商取引法' : 'Legal notice'} onPress={() => void WebBrowser.openBrowserAsync(siteLink(TOKUSHOHO_URL, ja))} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 22 },
  features: { gap: 14 },
  feature: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  featureIcon: { alignItems: 'center', borderRadius: 11, height: 36, justifyContent: 'center', width: 36 },
  featureText: { flex: 1, gap: 1 },
  featureTitle: { fontSize: 15, fontWeight: '800' },
  featureBody: { fontSize: 12 },
  plans: { flexDirection: 'row', gap: 10 },
  plan: { borderRadius: 18, flex: 1, gap: 3, padding: 14, paddingTop: 18 },
  planBadge: { alignSelf: 'flex-start', borderRadius: 6, fontSize: 10, fontWeight: '900', left: 12, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2, position: 'absolute', top: -9 },
  planName: { fontSize: 12, fontWeight: '700' },
  planPrice: { fontFamily: DIGITS, fontSize: 22 },
  planPer: { fontFamily: undefined, fontSize: 12, fontWeight: '600' },
  planNote: { fontSize: 12, fontWeight: '700' },
  actions: { gap: 8 },
  testMode: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  legal: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
