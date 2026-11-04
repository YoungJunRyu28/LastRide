import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomNav } from '@/components/BottomNav';
import { Card, PremiumTag, PrimaryButton, SecondaryButton } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { useGroups, type GroupEntry } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { trialLabel, usePremium, useTrialDays } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';
import { useSecondClock } from '@/hooks/useSecondClock';
import { formatCountdown } from '@/lib/countdown';
import { useGroupActions } from '@/lib/groupActions';
import { formatJstTime, MINUTE_MS } from '@/lib/time';

/** Creating (hosting) a group is premium; joining is free. */
function goCreateGroup(isPremium: boolean) {
  router.push(isPremium ? '/group-new' : '/paywall');
}

function Initials({ names }: { names: string[] }) {
  const colors = useColors();
  const shown = names.slice(0, 4);
  return (
    <View style={styles.avatars}>
      {shown.map((name, index) => (
        <View key={`${name}-${index}`} style={[styles.avatar, { backgroundColor: colors.secondary, borderColor: colors.card, marginLeft: index === 0 ? 0 : -8 }]}>
          <Text style={[styles.avatarText, { color: colors.foreground }]}>{Array.from(name)[0] ?? ''}</Text>
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

/** Small pill button on a card: start or join tonight without opening the group. */
function CardAction({ label, onPress, busy, testID }: { label: string; onPress: () => void; busy: boolean; testID: string }) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [styles.cardAction, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.primaryForeground} />
      ) : (
        <Text style={[styles.cardActionText, { color: colors.primaryForeground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** How many of tonight's people a card lists before "+N". */
const SHOWN_TONIGHT = 4;

function GroupRow({ entry, ja, clockMs }: { entry: GroupEntry; ja: boolean; clockMs: number }) {
  const colors = useColors();
  const { detail, membership } = entry;
  const { busy, joinTonight, startTonight } = useGroupActions(membership.groupId, ja);
  const active = !!detail?.tonight.active;
  const host = detail?.me.role === 'host';
  const participants = detail?.tonight.participants ?? [];
  const mine = !!detail && participants.some((participant) => participant.memberId === detail.me.memberId);
  const open = () => router.push({ pathname: '/group/[id]', params: { id: membership.groupId } });

  const countdown = (leaveBy: string | null) => {
    if (!leaveBy) return { text: ja ? '計算中' : '…', tone: colors.mutedForeground };
    const msLeft = Date.parse(leaveBy) - clockMs;
    if (msLeft <= 0) return { text: ja ? '出発' : 'Go', tone: colors.destructive };
    return { text: ja ? `あと${formatCountdown(msLeft)}` : `in ${formatCountdown(msLeft)}`, tone: msLeft <= 10 * MINUTE_MS ? colors.primary : colors.mutedForeground };
  };

  return (
    <Pressable
      testID={`group-${membership.groupId}`}
      onPress={open}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border, borderWidth: active ? 2 : 1, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.rowHead}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }]}>
          {detail?.name ?? membership.name}
        </Text>
        {host && <Text style={[styles.hostTag, { color: colors.primary }]}>{ja ? 'ホスト' : 'Host'}</Text>}
        <View style={styles.flex} />
        {active && (
          <Text style={[styles.badge, { backgroundColor: colors.primary, color: colors.primaryForeground }]}>{ja ? '今夜' : 'Tonight'}</Text>
        )}
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>

      {!detail ? (
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{ja ? '読み込み中…' : 'Loading…'}</Text>
      ) : active ? (
        <>
          {participants.length > 0 ? (
            <View style={[styles.people, { borderTopColor: colors.border }]}>
              {participants.slice(0, SHOWN_TONIGHT).map((participant) => {
                const me = participant.memberId === detail.me.memberId;
                const status = countdown(participant.leaveBy);
                return (
                  <View key={participant.memberId} style={styles.person}>
                    <View style={[styles.dot, { backgroundColor: me ? colors.primary : colors.secondary }]} />
                    <Text numberOfLines={1} style={[styles.personName, { color: me ? colors.primary : colors.foreground }]}>
                      {me ? (ja ? 'あなた' : 'You') : participant.displayName}
                    </Text>
                    <Text style={[styles.personTime, { color: participant.leaveBy ? colors.foreground : colors.mutedForeground }]}>
                      {participant.leaveBy ? formatJstTime(Date.parse(participant.leaveBy)) : '--:--'}
                    </Text>
                    <Text numberOfLines={1} style={[styles.personStatus, { color: status.tone }]}>{status.text}</Text>
                  </View>
                );
              })}
              {participants.length > SHOWN_TONIGHT && (
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                  {ja ? `ほか${participants.length - SHOWN_TONIGHT}人` : `+${participants.length - SHOWN_TONIGHT} more`}
                </Text>
              )}
            </View>
          ) : null}
          <View style={styles.rowFoot}>
            <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
              {ja ? `今夜 ${participants.length}/${detail.members.length}人` : `${participants.length}/${detail.members.length} in tonight`}
            </Text>
            {!mine && <CardAction testID={`join-tonight-${detail.id}`} label={ja ? '今夜参加する' : 'Join tonight'} busy={busy} onPress={() => void joinTonight()} />}
          </View>
        </>
      ) : (
        <View style={styles.rowFoot}>
          <Initials names={detail.members.map((member) => member.displayName)} />
          <Text numberOfLines={1} style={[styles.rowSub, styles.flex, { color: colors.mutedForeground }]}>
            {ja ? `${detail.members.length}人 · 今夜の共有は未開始` : `${detail.members.length} people · not tonight yet`}
          </Text>
          {host && <CardAction testID={`start-tonight-${detail.id}`} label={ja ? '共有を開始' : 'Start tonight'} busy={busy} onPress={() => void startTonight()} />}
        </View>
      )}
    </Pressable>
  );
}

/** Groups tab: your groups, or how groups work when you have none. */
export default function GroupsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language, nowMs, demoActive } = useLastRide();
  const clockMs = useSecondClock(nowMs, demoActive);
  const { groups, loading, credentialError, clearUnavailableMemberships, available, refresh } = useGroups();
  const [refreshing, setRefreshing] = React.useState(false);
  useFocusEffect(React.useCallback(() => { void refresh(); }, [refresh]));
  const pullRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }, [refresh]);
  const { isPremium } = usePremium();
  const trialDays = useTrialDays();
  const ja = language !== 'en';
  const forgetUnavailable = React.useCallback(() => {
    Alert.alert(
      ja ? 'この端末のグループ情報を消去しますか？' : 'Forget local group access?',
      ja
        ? 'この端末に保存されたグループの参加情報がすべて失われます。元に戻せません。サーバー上のグループや参加者は削除されません。再参加には新しい招待が必要です。ホストだったグループはサーバー上に残ることがあります。'
        : 'This permanently removes saved group access from this device, including keys that might still be recoverable. It does not delete server-side groups or remove you as a host. You will need new invitations to rejoin.',
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: ja ? 'この端末から消去' : 'Forget on this device',
          style: 'destructive',
          onPress: () => {
            void clearUnavailableMemberships().catch(() => {
              Alert.alert(
                ja ? '削除できませんでした' : 'Could not reset group access',
                ja
                  ? '保留中の参加・作成操作や端末のストレージ設定を確認して、もう一度お試しください。'
                  : 'An unfinished group creation/join or unavailable device storage may be blocking recovery. Please try again.',
              );
            });
          },
        },
      ],
    );
  }, [ja, clearUnavailableMemberships]);

  const empty = groups.length === 0;
  // Groups sharing tonight first; otherwise the order you joined them.
  const sorted = [...groups].sort((a, b) => Number(!!b.detail?.tonight.active) - Number(!!a.detail?.tonight.active));

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

        {credentialError ? (
          <Card style={styles.option}>
            <Text style={[styles.optionTitle, { color: colors.foreground }]}>
              {ja ? 'グループ情報を読み込めません' : 'Saved group credentials are unavailable'}
            </Text>
            <Text style={[styles.optionBody, { color: colors.mutedForeground }]}>
              {ja
                ? '端末の復元などで読み込めなくなることがあります。もう一度読み込むか、ホストに新しい招待を頼んでください。'
                : 'A device restore can make these unreadable. Try again, or ask the host for a new invite.'}
            </Text>
            <SecondaryButton label={ja ? 'もう一度読み込む' : 'Try again'} onPress={() => void refresh()} />
            <Pressable
              accessibilityRole="button"
              testID="groups-recover-local"
              onPress={forgetUnavailable}
              style={{ paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: colors.mutedForeground, textDecorationLine: 'underline', fontSize: 13 }}>
                {ja ? '復元できないグループ情報を消去' : 'Forget inaccessible groups on this device'}
              </Text>
            </Pressable>
          </Card>
        ) : !available ? (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {ja ? '現在グループ機能を利用できません。通信状況を確認してください。' : 'Groups aren’t available right now. Check your connection.'}
          </Text>
        ) : loading && empty ? (
          <ActivityIndicator color={colors.primary} />
        ) : empty ? (
          <>
            <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="users" size={28} color={colors.primary} />
              <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                {ja ? 'みんなで\n帰る時間を共有' : 'Share leave times\nwith your group'}
              </Text>
              <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
                {ja
                  ? 'グループを作って招待するだけ。みんなの出発時刻が並び、出発時に通知が届きます。'
                  : 'Make a group and invite people. Everyone’s leave times line up, and the group is notified when it’s time to go.'}
              </Text>
            </View>
            <View style={styles.options}>
              <Card style={styles.option}>
                <Text style={[styles.optionTitle, { color: colors.foreground }]}>{ja ? '参加する' : 'Join'}</Text>
                <Text style={[styles.free, { color: colors.primary }]}>{ja ? '無料' : 'Free'}</Text>
                <Text style={[styles.optionBody, { color: colors.mutedForeground }]}>{ja ? 'リンクやコードから参加。会員登録は不要' : 'By link or code. No account'}</Text>
              </Card>
              <Card style={styles.option}>
                <Text style={[styles.optionTitle, { color: colors.foreground }]}>{ja ? 'グループを作成' : 'Create & host'}</Text>
                <PremiumTag label={ja ? 'プレミアム' : 'Premium'} />
                <Text style={[styles.optionBody, { color: colors.mutedForeground }]}>{ja ? '繰り返し使えるグループを作成' : 'A group you keep using'}</Text>
              </Card>
            </View>
            <PrimaryButton
              label={isPremium ? (ja ? 'グループを作る' : 'Create a group') : trialDays ? (ja ? `${trialLabel(trialDays, true)}でグループを作る` : `Create a group — ${trialLabel(trialDays, false)}`) : ja ? 'プレミアムでグループを作る' : 'Create a group with Premium'}
              onPress={() => goCreateGroup(isPremium)}
              testID="groups-create"
            />
            <SecondaryButton label={ja ? '招待コードで参加' : 'Join with an invite code'} onPress={() => router.push('/group-join')} testID="groups-join" />
          </>
        ) : (
          <>
            {sorted.map((entry) => (
              <GroupRow key={entry.membership.groupId} entry={entry} ja={ja} clockMs={clockMs} />
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
              {ja ? '参加は無料 · 共有されるのは名前と出発時刻だけ' : 'Joining is free · only names and leave times are shared'}
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
  row: { borderRadius: 20, gap: 12, padding: 16 },
  rowHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  rowTitle: { flexShrink: 1, fontSize: 17, fontWeight: '800' },
  hostTag: { fontSize: 11, fontWeight: '800' },
  flex: { flex: 1 },
  rowSub: { fontSize: 12 },
  rowFoot: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between', minHeight: 32 },
  people: { borderTopWidth: StyleSheet.hairlineWidth, gap: 8, paddingTop: 12 },
  person: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  dot: { borderRadius: 4, height: 8, width: 8 },
  personName: { flex: 1, fontSize: 14, fontWeight: '700' },
  personTime: { fontFamily: DIGITS, fontSize: 15, fontVariant: ['tabular-nums'] },
  personStatus: { fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 72, textAlign: 'right' },
  cardAction: { alignItems: 'center', borderRadius: 16, justifyContent: 'center', minHeight: 32, minWidth: 84, paddingHorizontal: 14 },
  cardActionText: { fontSize: 13, fontWeight: '800' },
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
