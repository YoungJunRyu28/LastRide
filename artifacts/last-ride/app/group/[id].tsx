import { Feather } from '@expo/vector-icons';
import { groupInviteLink } from '@/lib/inviteLinks';
import { shareLatestGroupInvite } from '@/lib/shareLatestGroupInvite';
import { confirmAction, useGroupActions } from '@/lib/groupActions';
import QRCode from 'react-native-qrcode-svg';
import {
  getGroup,
  leaveGroupTonight,
  type GroupDetail,
} from '@workspace/api-client-react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomNav } from '@/components/BottomNav';
import { Card, IconButton, PrimaryButton } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { usePremium } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';
import { formatJstTime, MINUTE_MS } from '@/lib/time';
import { formatCountdown } from '@/lib/countdown';
import { useSecondClock } from '@/hooks/useSecondClock';

const confirm = confirmAction;

/** "ABCD1234" → "ABCD-1234", easier to read out (joining ignores the dash). */
function formatJoinCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function inviteMessage(detail: GroupDetail, ja: boolean) {
  if (!detail.invite) return null;
  const link = groupInviteLink(detail.invite.inviteToken);
  return ja
    ? `「${detail.name}」に参加して、帰る時間を共有しましょう（帰り時アプリ）\n${link}\n招待コード：${detail.invite.joinCode}`
    : `Join “${detail.name}” on LastRide to share leave times\n${link}\nInvite code: ${detail.invite.joinCode}`;
}

/** One group: tonight's leave times, and the member / host options. */
export default function GroupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language, nowMs, demoActive } = useLastRide();
  const clockMs = useSecondClock(nowMs, demoActive);
  const { groups, apply, forget, refreshGroup, memberOptions, credentialError, loading } = useGroups();
  const [refreshing, setRefreshing] = useState(false);
  // Silent background pushes are best effort. Always refresh when opening the
  // detail view, and let a person pull to refresh a long-lived active screen.
  useFocusEffect(React.useCallback(() => {
    if (id) void refreshGroup(id);
  }, [id, refreshGroup]));
  const pullRefresh = React.useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try { await refreshGroup(id); } finally { setRefreshing(false); }
  }, [id, refreshGroup]);
  const { isPremium } = usePremium();
  const ja = language !== 'en';
  const { busy, run, joinTonight, startTonight } = useGroupActions(id, ja);
  const [showQr, setShowQr] = useState(false);
  const detail = groups.find((entry) => entry.membership.groupId === id)?.detail ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/groups'));

  if (!detail) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
        <View style={styles.content}>
          <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={back} />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {/* Never spin for ever: unreadable saved keys, or a group no longer on this device. */}
            {credentialError
              ? ja ? 'この端末に保存したグループの情報を読み込めません。「グループ」の画面から復旧できます。' : 'This device’s saved group details can’t be read. You can recover from the Groups screen.'
              : !loading && !groups.some((entry) => entry.membership.groupId === id)
                ? ja ? 'このグループはこの端末にありません。' : 'This group isn’t on this device.'
                : ja ? '読み込み中…' : 'Loading…'}
          </Text>
        </View>
      </View>
    );
  }

  const host = detail.me.role === 'host';
  /** Show the member limit from 40 (of 50), and say so when the group is full. */
  const nearLimit = detail.members.length >= detail.memberLimit - 10;
  const full = detail.members.length >= detail.memberLimit;
  const tonight = detail.tonight;
  const mine = tonight.participants.find((participant) => participant.memberId === detail.me.memberId);
  const hostName = detail.members.find((member) => member.role === 'host')?.displayName ?? '';
  const options = memberOptions(detail.id);


  const stopSharingTonight = () =>
    confirm(
      ja ? '今夜の共有を停止' : 'Stop sharing tonight',
      ja ? '今夜の出発時刻の共有を停止します。グループからは退出しません。' : 'Your leave time stops being shared tonight. You stay in the group.',
      ja ? 'やめる' : 'Stop',
      ja ? 'キャンセル' : 'Cancel',
      () => void run(() => leaveGroupTonight(detail.id, options)),
    );


  const share = async () => {
    try {
      // Invites can be rotated by another member while this screen is open.
      // Never send a cached invite link that may already be invalid.
      const shared = await shareLatestGroupInvite(
        () => getGroup(detail.id, options),
        (current) => inviteMessage(current, ja),
        apply,
        async (message) => { await Share.share({ message }); },
      );
      if (!shared) {
        Alert.alert(
          ja ? '招待リンクを取得できません' : 'Invitation unavailable',
          ja ? 'グループの招待情報を確認してから、もう一度お試しください。' : 'Refresh the group invite and try again.',
        );
      }
    } catch {
      // An offline refresh cannot prove the old invite has not been rotated.
      Alert.alert(
        ja ? '最新の招待リンクを確認できません' : 'Could not verify invite',
        ja ? '通信状況を確認して、もう一度お試しください。以前のリンクは共有しません。'
          : 'Check your connection and try again. The previous link was not shared.',
      );
    }
  };

  const statusFor = (leaveBy: string | null) => {
    if (!leaveBy) return { text: ja ? '計算中…' : 'Calculating…', tone: colors.mutedForeground };
    const msLeft = Date.parse(leaveBy) - clockMs;
    if (msLeft <= 0) return { text: ja ? '出発時刻' : 'Time to go', tone: colors.destructive };
    // h:mm for an hour or more, then mm:ss, like the home screen.
    const tone = msLeft <= 10 * MINUTE_MS ? colors.primary : colors.mutedForeground;
    return { text: ja ? `あと${formatCountdown(msLeft)}` : `in ${formatCountdown(msLeft)}`, tone };
  };


  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullRefresh()} tintColor={colors.primary} />}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 8) }]}>
        <View style={styles.topbar}>
          <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={back} />
          <View style={styles.topActions}>
            {detail.invite && (
              <Pressable onPress={() => void share()} accessibilityRole="button" style={({ pressed }) => [styles.invitePill, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}>
                <Feather name="link" size={14} color={colors.foreground} />
                <Text style={[styles.invitePillText, { color: colors.foreground }]}>{ja ? '招待リンク' : 'Invite link'}</Text>
              </Pressable>
            )}
            <IconButton icon="more-horizontal" label={ja ? 'グループのオプション' : 'Group options'} onPress={() => router.push({ pathname: '/group-settings', params: { id: detail.id } })} testID="group-options" />
          </View>
        </View>

        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{detail.name}</Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {ja ? `ホスト：${hostName} · メンバー${detail.members.length}人` : `Host: ${hostName} · ${detail.members.length} members`}
            {/* The limit only once it's close: nobody needs to know about 50 otherwise. */}
            {nearLimit ? (ja ? `（上限${detail.memberLimit}人）` : ` (limit ${detail.memberLimit})`) : ''}
          </Text>
        </View>

        {/* Host: the code to read out, a QR to scan, or the link to send */}
        {detail.invite && (
          <Card style={styles.inviteCard}>
            <View style={styles.inviteHead}>
              <View style={styles.flex}>
                <Text style={[styles.inviteLabel, { color: colors.mutedForeground }]}>{ja ? '招待コード' : 'Invite code'}</Text>
                <Text selectable testID="group-join-code" style={[styles.inviteCode, { color: colors.foreground }]}>
                  {formatJoinCode(detail.invite.joinCode)}
                </Text>
              </View>
            </View>
            {full ? (
              <Text style={[styles.note, { color: colors.destructive }]}>
                {ja
                  ? `満員（${detail.memberLimit}人）のため、新しいメンバーは参加できません。`
                  : `The group is full (${detail.memberLimit}), so nobody new can join.`}
              </Text>
            ) : null}
            {showQr && (
              <View style={styles.qrWrap}>
                <QRCode value={groupInviteLink(detail.invite.inviteToken)} size={200} quietZone={10} backgroundColor="#FFFFFF" color="#000000" />
              </View>
            )}
            <View style={styles.inviteButtons}>
              <Pressable
                testID="toggle-invite-qr"
                onPress={() => setShowQr((value) => !value)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showQr }}
                style={({ pressed }) => [styles.inviteButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="maximize" size={15} color={colors.foreground} />
                <Text style={[styles.invitePillText, { color: colors.foreground }]}>
                  {showQr ? (ja ? 'QRコードを閉じる' : 'Hide QR code') : ja ? 'QRコード' : 'QR code'}
                </Text>
              </Pressable>
              <Pressable
                testID="share-invite"
                onPress={() => void share()}
                accessibilityRole="button"
                style={({ pressed }) => [styles.inviteButton, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="share" size={15} color={colors.foreground} />
                <Text style={[styles.invitePillText, { color: colors.foreground }]}>{ja ? 'リンクを共有' : 'Share link'}</Text>
              </Pressable>
            </View>
          </Card>
        )}

        {tonight.active ? (
          <>
            <Card highlighted style={styles.tonightCard}>
              <Text style={[styles.badge, { backgroundColor: colors.primary, color: colors.primaryForeground }]}>{ja ? '今夜の共有中' : 'Tonight'}</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? '翌朝8:00に自動で終了' : 'Ends at 8:00 tomorrow'}
              </Text>
            </Card>
            <View style={styles.listHead}>
              <Text style={[styles.count, { color: colors.foreground }]}>
                {tonight.participants.length} / {detail.members.length}
                {ja ? '人' : ''}
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? '出発の早い順' : 'Earliest first'}</Text>
            </View>
            <Card style={styles.list}>
              {tonight.participants.map((participant, index) => {
                const me = participant.memberId === detail.me.memberId;
                const isHost = detail.members.find((member) => member.id === participant.memberId)?.role === 'host';
                const status = statusFor(participant.leaveBy);
                return (
                  <View key={participant.memberId} style={[styles.person, index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 }]}>
                    <View style={[styles.avatar, { backgroundColor: me ? colors.primary : colors.secondary }]}>
                      <Text style={[styles.avatarText, { color: me ? colors.primaryForeground : colors.foreground }]}>
                        {/* Your own initial too (the name reads あなた); the amber circle marks it as you. */}
                        {Array.from(participant.displayName)[0] ?? ''}
                      </Text>
                    </View>
                    <View style={styles.personText}>
                      <Text style={[styles.personName, { color: colors.foreground }]}>
                        {me ? (ja ? 'あなた' : 'You') : participant.displayName}
                        {isHost ? <Text style={[styles.hostTag, { color: colors.primary }]}>{ja ? '  ホスト' : '  Host'}</Text> : null}
                      </Text>
                      <Text style={[styles.personStatus, { color: status.tone }]}>{status.text}</Text>
                    </View>
                    <Text style={[styles.personTime, { color: participant.leaveBy ? colors.foreground : colors.mutedForeground }]}>
                      {participant.leaveBy ? formatJstTime(Date.parse(participant.leaveBy)) : '--:--'}
                    </Text>
                  </View>
                );
              })}
              {tonight.participants.length === 0 && (
                <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? '今夜の参加者はまだいません。' : 'Nobody has joined tonight yet.'}</Text>
              )}
            </Card>
            {mine && (
              // A status line, not a button: you're sharing; stopping is the small link at the end.
              <View style={styles.sharingRow}>
                <View style={[styles.sharingDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.sharingText, { color: colors.mutedForeground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {ja ? 'あなたの出発時刻を共有中' : 'Sharing your leave time'}
                </Text>
                <Pressable
                  testID="leave-tonight"
                  onPress={stopSharingTonight}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? '今夜の共有をやめる' : 'Stop sharing tonight'}
                  hitSlop={12}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={[styles.sharingStop, { color: colors.mutedForeground }]}>{ja ? '共有を停止' : 'Stop tonight'}</Text>
                </Pressable>
              </View>
            )}
            {!mine && (
              <PrimaryButton
                label={ja ? '今夜参加する' : 'Join tonight'}
                loading={busy}
                onPress={() => void joinTonight()}
                testID="join-tonight"
              />
            )}
          </>
        ) : host ? (
          <>
            <PrimaryButton label={ja ? '今夜の共有を開始' : 'Start tonight'} loading={busy} onPress={() => void startTonight()} testID="start-tonight" />
            <Text style={[styles.note, styles.center, { color: colors.mutedForeground }]}>
              {ja ? 'メンバーに通知が届きます · 翌朝8:00に終了' : 'Members are notified · ends at 8:00 tomorrow'}
            </Text>
          </>
        ) : (
          <Card style={styles.tonightCard}>
            <Text style={[styles.menuTitle, { color: colors.foreground }]}>{ja ? '今夜の共有はまだ始まっていません' : 'Not started tonight'}</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? '始まると通知が届きます' : 'You’ll be notified when it starts'}</Text>
          </Card>
        )}


        {!host && !isPremium && (
          <Pressable onPress={() => router.push('/paywall')} accessibilityRole="button" style={styles.hostLine}>
            <Feather name="star" size={13} color={colors.primary} />
            <Text style={[styles.hostLineText, { color: colors.primary }]}>
              {ja ? '自分のグループを作ってホストになるにはプレミアム ›' : 'Host your own group with Premium ›'}
            </Text>
          </Pressable>
        )}

        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          {ja ? '共有されるのは名前と出発時刻だけです。現在地や帰る場所は共有されません。' : 'Only names and leave times are shared, never your location or destination.'}
        </Text>
      </ScrollView>
      <BottomNav language={language} />

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, paddingBottom: 32, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  topActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  inviteCard: { gap: 12, padding: 18 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  inviteHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  inviteLabel: { fontSize: 12, fontWeight: '700' },
  inviteCode: { fontSize: 28, fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: 2, marginTop: 2 },
  inviteButtons: { flexDirection: 'row', gap: 10 },
  inviteButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  qrWrap: { alignItems: 'center', gap: 10, paddingVertical: 4 },
  invitePill: { alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  invitePillText: { fontSize: 13, fontWeight: '700' },
  heading: { gap: 4 },
  title: { fontSize: 26, fontWeight: '800' },
  note: { fontSize: 12, lineHeight: 18 },
  badge: { alignSelf: 'flex-start', borderRadius: 6, fontSize: 11, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2 },
  tonightCard: { gap: 8, padding: 16 },
  listHead: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  count: { fontFamily: DIGITS, fontSize: 18 },
  list: { borderWidth: 1, paddingHorizontal: 14 },
  person: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 12 },
  avatar: { alignItems: 'center', borderRadius: 17, height: 34, justifyContent: 'center', width: 34 },
  avatarText: { fontSize: 14, fontWeight: '800' },
  personText: { flex: 1, gap: 2 },
  personName: { fontSize: 15, fontWeight: '800' },
  sharingRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: -4, paddingHorizontal: 6 },
  sharingDot: { borderRadius: 4, height: 8, width: 8 },
  sharingText: { flex: 1, fontSize: 13, fontWeight: '600' },
  sharingStop: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  hostTag: { fontSize: 11, fontWeight: '800' },
  personStatus: { fontSize: 12, fontWeight: '700' },
  personTime: { fontFamily: DIGITS, fontSize: 20 },
  alertsRow: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 10 },
  alertsText: { flex: 1, gap: 2 },
  hostLine: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: 4 },
  hostLineText: { fontSize: 13, fontWeight: '700' },
  sheetFrame: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)', flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 6, maxHeight: '80%', paddingHorizontal: 20, paddingTop: 10 },
  grabber: { alignSelf: 'center', borderRadius: 3, height: 5, marginBottom: 8, width: 40 },
  sheetGroup: { fontSize: 18, fontWeight: '800' },
  sheetScroll: { marginTop: 8 },
  sheetList: { gap: 2, paddingBottom: 8 },
  menuItem: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 12, minHeight: 56, paddingVertical: 10 },
  menuText: { flex: 1, gap: 2 },
  menuTitle: { fontSize: 15, fontWeight: '800' },
  menuSub: { fontSize: 12 },
  input: { borderRadius: 14, borderWidth: 1.5, fontSize: 16, marginBottom: 10, minHeight: 50, paddingHorizontal: 14 },
});
