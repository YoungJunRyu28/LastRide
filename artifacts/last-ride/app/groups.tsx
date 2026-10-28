import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomNav } from '@/components/BottomNav';
import { Card, PremiumTag, PrimaryButton, SecondaryButton } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { useGroups, type GroupEntry } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { trialLabel, usePremium, useTrialDays } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';
import { formatJstTime } from '@/lib/time';

/** Creating (hosting) a group is premium; joining is free. */
function goCreateGroup(isPremium: boolean) {
  router.push(isPremium ? '/group-new' : '/paywall');
}

function Initials({ names }: { names: string[] }) {
  const colors = useColors();
  const shown = names.slice(0, 3);
  return (
    <View style={styles.avatars}>
      {shown.map((name, index) => (
        <View key={`${name}-${index}`} style={[styles.avatar, { backgroundColor: colors.secondary, borderColor: colors.card, marginLeft: index === 0 ? 0 : -8 }]}>
          <Text style={[styles.avatarText, { color: colors.foreground }]}>{name.slice(0, 1)}</Text>
        </View>
      ))}
      {names.length > shown.length && (
        <View style={[styles.avatar, { backgroundColor: colors.muted, borderColor: colors.card, marginLeft: -8 }]}>
          <Text style={[styles.avatarText, { color: colors.mutedForeground }]}>+{names.length - shown.length}</Text>
        </View>
      )}
    </View>
  );
}

function GroupRow({ entry, ja }: { entry: GroupEntry; ja: boolean }) {
  const colors = useColors();
  const { detail, membership } = entry;
  const active = !!detail?.tonight.active;
  const participants = detail?.tonight.participants ?? [];
  const first = participants.find((participant) => participant.leaveBy)?.leaveBy;
  const subtitle = !detail
    ? ja
      ? '読み込み中…'
      : 'Loading…'
    : active
      ? ja
        ? `今夜 ${participants.length}人参加${first ? ` · 最初の出発 ${formatJstTime(Date.parse(first))}` : ''}`
        : `${participants.length} in tonight${first ? ` · first leaves ${formatJstTime(Date.parse(first))}` : ''}`
      : ja
        ? `${detail.members.length}人 · ${detail.me.role === 'host' ? 'あなたがホスト' : 'あなたはメンバー'}`
        : `${detail.members.length} people · ${detail.me.role === 'host' ? 'you host' : 'member'}`;
  return (
    <Pressable
      testID={`group-${membership.groupId}`}
      onPress={() => router.push({ pathname: '/group/[id]', params: { id: membership.groupId } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border, borderWidth: active ? 2 : 1, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={styles.rowText}>
        <View style={styles.rowHead}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }]}>
            {detail?.name ?? membership.name}
          </Text>
          {active && (
            <Text style={[styles.badge, { backgroundColor: colors.primary, color: colors.primaryForeground }]}>{ja ? '今夜アクティブ' : 'Tonight'}</Text>
          )}
        </View>
        {active && participants.length > 0 && <Initials names={participants.map((participant) => participant.displayName)} />}
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

/** Groups tab: your groups, or how groups work when you have none. */
export default function GroupsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const { groups, loading, available, refresh } = useGroups();
  const [refreshing, setRefreshing] = React.useState(false);
  useFocusEffect(React.useCallback(() => { void refresh(); }, [refresh]));
  const pullRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }, [refresh]);
  const { isPremium } = usePremium();
  const trialDays = useTrialDays();
  const ja = language !== 'en';
  const empty = groups.length === 0;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullRefresh()} tintColor={colors.primary} />}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 12) }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.kicker, { color: colors.mutedForeground }]}>GROUPS</Text>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
              {ja ? 'グループ' : 'Groups'}
            </Text>
          </View>
          <Pressable
            testID="groups-join-code"
            onPress={() => router.push('/group-join')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.joinPill, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="log-in" size={14} color={colors.foreground} />
            <Text style={[styles.joinPillText, { color: colors.foreground }]}>{ja ? 'コードで参加' : 'Join with code'}</Text>
          </Pressable>
        </View>

        {!available ? (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {ja ? 'グループにはサーバー接続が必要です。' : 'Groups need the LastRide server.'}
          </Text>
        ) : loading && empty ? (
          <ActivityIndicator color={colors.primary} />
        ) : empty ? (
          <>
            <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="users" size={28} color={colors.primary} />
              <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                {ja ? '飲み会のみんなと\n帰る時間を共有' : 'Share leave times\nwith your group'}
              </Text>
              <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
                {ja
                  ? 'ホストがグループを作り、リンクを送るだけ。メンバーの出発時刻が並び、出発の時間になると全員に通知されます。'
                  : 'The host makes a group and sends a link. Everyone’s leave time lines up, and the group is notified when it’s someone’s time to go.'}
              </Text>
            </View>
            <View style={styles.options}>
              <Card style={styles.option}>
                <Text style={[styles.optionTitle, { color: colors.foreground }]}>{ja ? '参加する' : 'Join'}</Text>
                <Text style={[styles.free, { color: colors.primary }]}>{ja ? '無料' : 'Free'}</Text>
                <Text style={[styles.optionBody, { color: colors.mutedForeground }]}>{ja ? 'リンクかコードで。アカウント不要' : 'By link or code. No account'}</Text>
              </Card>
              <Card style={styles.option}>
                <Text style={[styles.optionTitle, { color: colors.foreground }]}>{ja ? '作る・ホスト' : 'Create & host'}</Text>
                <PremiumTag label={ja ? 'プレミアム' : 'Premium'} />
                <Text style={[styles.optionBody, { color: colors.mutedForeground }]}>{ja ? '何度でも使えるグループ' : 'A group you keep using'}</Text>
              </Card>
            </View>
            <PrimaryButton
              label={isPremium ? (ja ? 'グループを作る' : 'Create a group') : ja ? `${trialLabel(trialDays, true)}でグループを作る` : `Create a group — ${trialLabel(trialDays, false)}`}
              onPress={() => goCreateGroup(isPremium)}
              testID="groups-create"
            />
            <SecondaryButton label={ja ? '招待コードで参加' : 'Join with an invite code'} onPress={() => router.push('/group-join')} testID="groups-join" />
          </>
        ) : (
          <>
            {groups.map((entry) => (
              <GroupRow key={entry.membership.groupId} entry={entry} ja={ja} />
            ))}
            <Pressable
              testID="groups-create"
              onPress={() => goCreateGroup(isPremium)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.createRow, { borderColor: colors.input, opacity: pressed ? 0.75 : 1 }]}
            >
              <Feather name="plus" size={18} color={colors.foreground} />
              <Text style={[styles.createText, { color: colors.foreground }]}>{ja ? 'グループを作成' : 'Create a group'}</Text>
              {!isPremium && <PremiumTag label={ja ? 'プレミアム' : 'Premium'} />}
            </Pressable>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? '参加は無料。共有されるのは表示名と出発時刻だけです。' : 'Joining is free. Only your display name and leave time are shared.'}
            </Text>
          </>
        )}
      </ScrollView>
      <BottomNav language={language} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, paddingBottom: 32, paddingHorizontal: 20 },
  header: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  title: { fontSize: 28, fontWeight: '800' },
  joinPill: { alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  joinPillText: { fontSize: 13, fontWeight: '700' },
  row: { alignItems: 'center', borderRadius: 20, flexDirection: 'row', gap: 10, padding: 16 },
  rowText: { flex: 1, gap: 8 },
  rowHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowTitle: { flexShrink: 1, fontSize: 17, fontWeight: '800' },
  rowSub: { fontSize: 12 },
  badge: { borderRadius: 6, fontSize: 11, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2 },
  avatars: { flexDirection: 'row' },
  avatar: { alignItems: 'center', borderRadius: 15, borderWidth: 2, height: 30, justifyContent: 'center', width: 30 },
  avatarText: { fontSize: 12, fontWeight: '800' },
  createRow: { alignItems: 'center', borderRadius: 18, borderStyle: 'dashed', borderWidth: 1.5, flexDirection: 'row', gap: 10, justifyContent: 'center', minHeight: 54 },
  createText: { fontSize: 15, fontWeight: '800' },
  note: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  hero: { alignItems: 'flex-start', borderRadius: 22, borderWidth: 1, gap: 10, padding: 20 },
  heroTitle: { fontSize: 22, fontWeight: '800', lineHeight: 30 },
  heroBody: { fontSize: 14, lineHeight: 21 },
  options: { flexDirection: 'row', gap: 10 },
  option: { alignItems: 'flex-start', borderWidth: 1, flex: 1, gap: 6, padding: 14 },
  optionTitle: { fontSize: 15, fontWeight: '800' },
  optionBody: { fontSize: 12, lineHeight: 17 },
  free: { fontFamily: DIGITS, fontSize: 13 },
});
