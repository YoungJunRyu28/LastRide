import { Feather } from '@expo/vector-icons';
import { groupInviteLink } from '@/lib/inviteLinks';
import {
  disbandGroup,
  endGroupTonight,
  joinGroupTonight,
  leaveGroup,
  leaveGroupTonight,
  removeGroupMember,
  rotateGroupInvite,
  startGroupTonight,
  updateGroup,
  updateMyGroupMembership,
  type GroupDetail,
  type GroupMemberSummary,
} from '@workspace/api-client-react';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomNav } from '@/components/BottomNav';
import { Card, IconButton, PrimaryButton, SecondaryButton, TextButton } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { errorStatus, useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { usePremium } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';
import { recommendedLeaveTime } from '@/lib/reliability';
import { formatJstTime, MINUTE_MS } from '@/lib/time';
import { formatCountdown } from '@/lib/countdown';
import { useSecondClock } from '@/hooks/useSecondClock';

type Sheet = null | 'menu' | 'rename' | 'displayName' | 'members' | 'notifications';

/** Yes/no confirmation that also works on web. */
function confirm(title: string, message: string, action: string, cancel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}

function inviteMessage(detail: GroupDetail, ja: boolean) {
  if (!detail.invite) return null;
  const link = groupInviteLink(detail.invite.inviteToken);
  return ja
    ? `「${detail.name}」に参加して、帰る時間を共有しよう（帰り時アプリ）\n${link}\n招待コード：${detail.invite.joinCode}`
    : `Join “${detail.name}” on LastRide to share leave times\n${link}\nInvite code: ${detail.invite.joinCode}`;
}

/** One group: tonight's leave times, and the member / host options. */
export default function GroupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language, plan, nowMs, demoActive } = useLastRide();
  const clockMs = useSecondClock(nowMs, demoActive);
  const { groups, apply, forget, memberOptions } = useGroups();
  const { isPremium } = usePremium();
  const ja = language !== 'en';
  const [sheet, setSheet] = useState<Sheet>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const detail = groups.find((entry) => entry.membership.groupId === id)?.detail ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/groups'));

  if (!detail) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
        <View style={styles.content}>
          <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={back} />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? '読み込み中…' : 'Loading…'}</Text>
        </View>
      </View>
    );
  }

  const host = detail.me.role === 'host';
  const tonight = detail.tonight;
  const mine = tonight.participants.find((participant) => participant.memberId === detail.me.memberId);
  const hostName = detail.members.find((member) => member.role === 'host')?.displayName ?? '';
  const options = memberOptions(detail.id);

  /** Runs a server action; 404 means the group is gone for us. */
  const run = async (action: () => Promise<GroupDetail | void>, after?: () => void) => {
    setBusy(true);
    try {
      const result = await action();
      if (result) apply(result);
      after?.();
    } catch (error) {
      if (errorStatus(error) === 404) {
        await forget(detail.id);
        router.replace('/groups');
        return;
      }
      Alert.alert(ja ? 'できませんでした' : 'That didn’t work', ja ? 'しばらくしてからもう一度お試しください。' : 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const leaveGone = async (action: () => Promise<void>) => {
    setSheet(null);
    await run(action, () => {
      void forget(detail.id);
      router.replace('/groups');
    });
  };

  /**
   * Shares your current leave time. Separate from night tracking: with tracking
   * on it keeps updating as you move; without it, it stays as shared (it is
   * refreshed only when the app re-plans, e.g. when you open it).
   */
  const joinTonight = () =>
    run(() => joinGroupTonight(detail.id, { leaveBy: plan ? new Date(recommendedLeaveTime(plan)).toISOString() : null }, options));

  /** The host starting tonight is going too: start, and share their own time. */
  const startTonight = () =>
    run(async () => {
      await startGroupTonight(detail.id, options);
      return joinGroupTonight(detail.id, { leaveBy: plan ? new Date(recommendedLeaveTime(plan)).toISOString() : null }, options);
    });

  const stopSharingTonight = () =>
    confirm(
      ja ? '今夜の参加をやめる' : 'Stop sharing tonight',
      ja ? '今夜の出発時刻の共有をやめます。グループからは退出しません。' : 'Your leave time stops being shared tonight. You stay in the group.',
      ja ? 'やめる' : 'Stop',
      ja ? 'キャンセル' : 'Cancel',
      () => void run(() => leaveGroupTonight(detail.id, options)),
    );

  const notificationSwitches = (
    <View style={styles.sheetList}>
      {[
        {
          key: 'notifications' as const,
          testID: 'toggle-tonight-alerts',
          title: ja ? '今夜の開始' : 'Tonight starts',
          subtitle: ja ? 'ホストが今夜の会をはじめたとき' : 'When the host starts tonight',
          value: detail.me.notifications,
        },
        {
          key: 'leaveTimeAlerts' as const,
          testID: 'toggle-leave-time-alerts',
          title: ja ? 'メンバーの出発時刻' : 'Members’ leave times',
          subtitle: ja ? 'オフにしても一覧は見られ、自分の時刻も共有されます' : 'Off still shows the list and shares your own time',
          value: detail.me.leaveTimeAlerts,
        },
      ].map((item, index) => (
        <View key={item.key} style={[styles.alertsRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 }]}>
          <View style={styles.alertsText}>
            <Text style={[styles.menuTitle, { color: colors.foreground }]}>{item.title}</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>{item.subtitle}</Text>
          </View>
          <Switch
            testID={item.testID}
            accessibilityLabel={item.title}
            value={item.value}
            onValueChange={(value) => void run(() => updateMyGroupMembership(detail.id, { [item.key]: value }, options))}
            trackColor={{ false: colors.input, true: colors.primary }}
            thumbColor={colors.background}
          />
        </View>
      ))}
    </View>
  );

  /** "今夜の開始 · 出発時刻" (whichever are on), for the menu item. */
  const notificationSummary =
    [detail.me.notifications ? (ja ? '今夜の開始' : 'Tonight starts') : null, detail.me.leaveTimeAlerts ? (ja ? 'メンバーの出発時刻' : 'leave times') : null]
      .filter(Boolean)
      .join(' · ') || (ja ? 'オフ' : 'Off');

  const share = async () => {
    const message = inviteMessage(detail, ja);
    if (message) await Share.share({ message });
  };

  const statusFor = (leaveBy: string | null) => {
    if (!leaveBy) return { text: ja ? '計算中…' : 'Calculating…', tone: colors.mutedForeground };
    const msLeft = Date.parse(leaveBy) - clockMs;
    if (msLeft <= 0) return { text: ja ? '出発時刻' : 'Time to go', tone: colors.destructive };
    // h:mm for an hour or more, then mm:ss, like the home screen.
    const tone = msLeft <= 10 * MINUTE_MS ? colors.primary : colors.mutedForeground;
    return { text: ja ? `あと${formatCountdown(msLeft)}` : `in ${formatCountdown(msLeft)}`, tone };
  };

  const menuItem = (key: string, title: string, subtitle: string | null, onPress: () => void, destructive = false, trailing?: React.ReactNode) => (
    <Pressable
      key={key}
      testID={`group-option-${key}`}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuItem, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: destructive ? colors.destructive : colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.menuSub, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {trailing ?? <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </Pressable>
  );

  const memberPicker = (members: GroupMemberSummary[], onPick: (member: GroupMemberSummary) => void, icon: 'user-x' | 'award') => (
    <View style={styles.sheetList}>
      {members.length === 0 ? (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? 'ほかのメンバーはいません。' : 'No other members yet.'}</Text>
      ) : (
        members.map((member) =>
          menuItem(member.id, member.displayName, null, () => onPick(member), icon === 'user-x', <Feather name={icon} size={17} color={icon === 'user-x' ? colors.destructive : colors.primary} />),
        )
      )}
    </View>
  );
  const others = detail.members.filter((member) => member.id !== detail.me.memberId);

  const sheetBody = () => {
    switch (sheet) {
      case 'rename':
      case 'displayName': {
        const renaming = sheet === 'rename';
        return (
          <View style={styles.sheetList}>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              maxLength={renaming ? 80 : 40}
              accessibilityLabel={renaming ? (ja ? 'グループ名' : 'Group name') : ja ? '表示名' : 'Display name'}
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.primary, color: colors.foreground }]}
            />
            <PrimaryButton
              label={ja ? '保存' : 'Save'}
              disabled={!draft.trim()}
              loading={busy}
              onPress={() =>
                void run(
                  () => (renaming ? updateGroup(detail.id, { name: draft.trim() }, options) : updateMyGroupMembership(detail.id, { displayName: draft.trim() }, options)),
                  () => setSheet(null),
                )
              }
            />
          </View>
        );
      }
      case 'notifications':
        return notificationSwitches;
      case 'members':
        return memberPicker(others, (member) =>
          confirm(
            ja ? 'メンバーを削除' : 'Remove member',
            ja ? `${member.displayName}さんをグループから削除しますか？` : `Remove ${member.displayName} from the group?`,
            ja ? '削除' : 'Remove',
            ja ? 'キャンセル' : 'Cancel',
            () => void run(() => removeGroupMember(detail.id, member.id, options)),
          ),
        'user-x');
      default:
        return host ? (
          <View style={styles.sheetList}>
            {tonight.active &&
              menuItem('end-tonight', ja ? '今夜を終了する' : 'End tonight', ja ? '全員の今夜の出発時刻を削除して終了' : 'Deletes everyone’s leave times for tonight', () =>
                confirm(ja ? '今夜を終了' : 'End tonight', ja ? '全員の今夜の出発時刻を削除します。' : 'Everyone’s leave times for tonight will be deleted.', ja ? '終了する' : 'End', ja ? 'キャンセル' : 'Cancel', () =>
                  void run(() => endGroupTonight(detail.id, options), () => setSheet(null)),
                ),
              )}
            {menuItem('members', ja ? 'メンバーを管理' : 'Manage members', ja ? 'メンバーを削除できます' : 'Remove members', () => setSheet('members'))}
            {menuItem('rename', ja ? 'グループ名を変更' : 'Rename group', null, () => {
              setDraft(detail.name);
              setSheet('rename');
            })}
            {menuItem('notifications', ja ? '通知' : 'Notifications', notificationSummary, () => setSheet('notifications'))}
            {menuItem('display-name', ja ? '表示名を変更' : 'Change display name', ja ? `いまの表示名：${detail.me.displayName}` : `Now: ${detail.me.displayName}`, () => {
              setDraft(detail.me.displayName);
              setSheet('displayName');
            })}
            {menuItem('rotate', ja ? '招待リンクを再発行' : 'New invite link', ja ? '以前のリンクは使えなくなります' : 'The old link stops working', () =>
              confirm(ja ? '招待リンクを再発行' : 'New invite link', ja ? '以前のリンクとコードは使えなくなります。' : 'The old link and code will stop working.', ja ? '再発行' : 'Replace', ja ? 'キャンセル' : 'Cancel', () =>
                void run(async () => {
                  const invite = await rotateGroupInvite(detail.id, options);
                  apply({ ...detail, invite });
                }),
              ),
            )}
            {menuItem('disband', ja ? 'グループを解散' : 'Disband group', ja ? '全員の参加データを削除します。元に戻せません' : 'Deletes everyone’s data. Can’t be undone', () =>
              confirm(ja ? 'グループを解散' : 'Disband group', ja ? '全員の参加データを削除します。元に戻せません。' : 'Everyone’s data is deleted. This can’t be undone.', ja ? '解散する' : 'Disband', ja ? 'キャンセル' : 'Cancel', () =>
                void leaveGone(() => disbandGroup(detail.id, options)),
              ),
            true)}
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? 'ホストはグループを解散すると退出できます。' : 'As host, you leave by disbanding the group.'}
            </Text>
          </View>
        ) : (
          <View style={styles.sheetList}>
            {menuItem('notifications', ja ? '通知' : 'Notifications', notificationSummary, () => setSheet('notifications'))}
            {menuItem('display-name', ja ? '表示名を変更' : 'Change display name', ja ? `いまの表示名：${detail.me.displayName}` : `Now: ${detail.me.displayName}`, () => {
              setDraft(detail.me.displayName);
              setSheet('displayName');
            })}
            {menuItem('leave-group', ja ? 'グループから退出' : 'Leave group', ja ? '表示名と出発時刻はすぐに削除されます' : 'Your name and leave time are deleted right away', () =>
              confirm(ja ? 'グループから退出' : 'Leave group', ja ? `「${detail.name}」から退出しますか？` : `Leave “${detail.name}”?`, ja ? '退出する' : 'Leave', ja ? 'キャンセル' : 'Cancel', () =>
                void leaveGone(() => leaveGroup(detail.id, options)),
              ),
            true)}
          </View>
        );
    }
  };

  const sheetTitle =
    sheet === 'rename'
      ? ja ? 'グループ名を変更' : 'Rename group'
      : sheet === 'displayName'
        ? ja ? '表示名を変更' : 'Change display name'
        : sheet === 'members'
          ? ja ? 'メンバーを管理' : 'Manage members'
          : sheet === 'notifications'
            ? ja ? 'このグループの通知' : 'Notifications for this group'
          : host
              ? ja ? 'ホストのオプション · あなたがホストです' : 'Host options · you’re the host'
              : ja ? 'メンバーのオプション' : 'Member options';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 8) }]}>
        <View style={styles.topbar}>
          <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={back} />
          <View style={styles.topActions}>
            {detail.invite && (
              <Pressable onPress={() => void share()} accessibilityRole="button" style={({ pressed }) => [styles.invitePill, { borderColor: colors.input, opacity: pressed ? 0.7 : 1 }]}>
                <Feather name="link" size={14} color={colors.foreground} />
                <Text style={[styles.invitePillText, { color: colors.foreground }]}>{ja ? '招待リンク' : 'Invite link'}</Text>
              </Pressable>
            )}
            <IconButton icon="more-horizontal" label={ja ? 'グループのオプション' : 'Group options'} onPress={() => setSheet('menu')} testID="group-options" />
          </View>
        </View>

        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{detail.name}</Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {ja ? `ホスト：${hostName} · メンバー${detail.members.length}人` : `Host: ${hostName} · ${detail.members.length} members`}
          </Text>
        </View>

        {tonight.active ? (
          <>
            <Card highlighted style={styles.tonightCard}>
              <Text style={[styles.badge, { backgroundColor: colors.primary, color: colors.primaryForeground }]}>{ja ? '今夜アクティブ' : 'Tonight'}</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? '明日の朝8:00に自動で終了 · 出発時刻は削除' : 'Ends at 8:00 tomorrow · leave times are deleted'}
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
                <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? 'まだ誰も参加していません。' : 'Nobody has joined tonight yet.'}</Text>
              )}
            </Card>
            {mine && (
              // A status line, not a button: you're sharing; stopping is the small link at the end.
              <View style={styles.sharingRow}>
                <View style={[styles.sharingDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.sharingText, { color: colors.mutedForeground }]} numberOfLines={1}>
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
                  <Text style={[styles.sharingStop, { color: colors.mutedForeground }]}>{ja ? '今夜はやめる' : 'Stop tonight'}</Text>
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
            <Card style={styles.tonightCard}>
              <Text style={[styles.menuTitle, { color: colors.foreground }]}>{ja ? '今夜の会をはじめる' : 'Start tonight'}</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {ja ? 'メンバーに通知が届き、参加した人の出発時刻が並びます。明日の朝8:00に自動で終了します。' : 'Members get a notification, and those who join line up by leave time. Ends at 8:00 tomorrow.'}
              </Text>
            </Card>
            <PrimaryButton label={ja ? '今夜をはじめる' : 'Start tonight'} loading={busy} onPress={() => void startTonight()} testID="start-tonight" />
            {detail.invite && <SecondaryButton label={ja ? '招待リンクを共有' : 'Share invite link'} onPress={() => void share()} />}
          </>
        ) : (
          <Card style={styles.tonightCard}>
            <Text style={[styles.menuTitle, { color: colors.foreground }]}>{ja ? '今夜はまだ始まっていません' : 'Not started tonight'}</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? 'ホストが今夜をはじめると通知が届きます。' : 'You’ll get a notification when the host starts tonight.'}
            </Text>
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
          {ja
            ? '表示されるのは名前と出発時刻だけ。現在地や帰り先は共有されません。出発時刻になると、今夜参加しているメンバーに通知します（⋯ の「通知」で変更できます）。'
            : 'Only names and leave times are shown — never your location or destination. Tonight’s participants are notified at each leave time (change it under ⋯ → Notifications).'}
        </Text>
      </ScrollView>
      <BottomNav language={language} />

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.scrim} onPress={() => setSheet(null)} accessibilityLabel={ja ? '閉じる' : 'Close'} />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.grabber, { backgroundColor: colors.input }]} />
          <Text style={[styles.sheetGroup, { color: colors.foreground }]}>{detail.name}</Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>{sheetTitle}</Text>
          <ScrollView style={styles.sheetScroll}>{sheetBody()}</ScrollView>
          <TextButton label={sheet === 'menu' ? (ja ? '閉じる' : 'Close') : ja ? '戻る' : 'Back'} onPress={() => setSheet(sheet === 'menu' ? null : 'menu')} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, paddingBottom: 32, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  topActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
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
