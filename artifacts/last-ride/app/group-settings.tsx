/**
 * A group's settings, opened from ⋯ on the group screen: like the app's own
 * Settings, with the current value on each row. Host: the group (name,
 * members, invite), tonight, then you; member: you only. Leaving or
 * disbanding is set apart at the bottom.
 */
import {
  disbandGroup,
  endGroupTonight,
  leaveGroup,
  rotateGroupInvite,
  updateMyGroupMembership,
} from '@workspace/api-client-react';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { Section, SettingsPage } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { confirmAction, useGroupActions } from '@/lib/groupActions';
import { SUPPORT_EMAIL } from '@/lib/links';

export default function GroupSettingsScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language } = useLastRide();
  const ja = language !== 'en';
  const { groups, memberOptions, apply } = useGroups();
  const { run, leaveGone } = useGroupActions(id, ja);
  const detail = groups.find((entry) => entry.membership.groupId === id)?.detail ?? null;

  if (!detail) {
    return (
      <SettingsPage title={ja ? 'グループの設定' : 'Group settings'} backLabel={ja ? '戻る' : 'Back'}>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? '読み込み中…' : 'Loading…'}</Text>
      </SettingsPage>
    );
  }

  const host = detail.me.role === 'host';
  const options = memberOptions(detail.id);
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/group/[id]', params: { id: detail.id } }));
  const edit = (field: 'name' | 'displayName') => router.push({ pathname: '/group-edit', params: { id: detail.id, field } });
  const setAlert = (key: 'notifications' | 'leaveTimeAlerts', value: boolean) =>
    void run(() => updateMyGroupMembership(detail.id, { [key]: value }, options));

  const report = () =>
    void Linking.openURL(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(ja ? '不適切な名前の報告' : 'Inappropriate name report')}&body=${encodeURIComponent(
        ja ? `グループID：${detail.id}\n問題のある名前（グループ名・表示名）：\n` : `Group ID: ${detail.id}\nThe name (group or display name):\n`,
      )}`,
    ).catch(() => undefined);

  return (
    <SettingsPage title={detail.name} backLabel={ja ? '戻る' : 'Back'} onBack={back}>
      {host && (
        <Section label={ja ? 'グループ' : 'GROUP'}>
          <Row testID="group-option-rename" title={ja ? 'グループ名' : 'Name'} value={detail.name} onPress={() => edit('name')} />
          <Divider />
          <Row
            testID="group-option-members"
            title={ja ? 'メンバー' : 'Members'}
            value={ja ? `${detail.members.length}人` : `${detail.members.length}`}
            onPress={() => router.push({ pathname: '/group-members', params: { id: detail.id } })}
          />
          <Divider />
          <Row
            testID="group-option-rotate"
            title={ja ? '招待リンクを再発行' : 'New invite link'}
            onPress={() =>
              confirmAction(
                ja ? '招待リンクを再発行' : 'New invite link',
                ja ? '今の招待リンクとコードは使えなくなります。' : 'The current link and code will stop working.',
                ja ? '再発行' : 'Replace',
                ja ? 'キャンセル' : 'Cancel',
                () =>
                  void run(async () => {
                    const invite = await rotateGroupInvite(detail.id, options);
                    apply({ ...detail, invite });
                  }),
              )
            }
          />
        </Section>
      )}

      {host && detail.tonight.active && (
        <Section label={ja ? '今夜' : 'TONIGHT'}>
          <Row
            testID="group-option-end-tonight"
            title={ja ? '今夜の共有を終了' : 'End tonight'}
            onPress={() =>
              confirmAction(
                ja ? '今夜の共有を終了' : 'End tonight',
                ja ? '全員の今夜の出発時刻を削除して終了します。' : 'Everyone’s leave times for tonight are deleted.',
                ja ? '終了する' : 'End',
                ja ? 'キャンセル' : 'Cancel',
                () => void run(() => endGroupTonight(detail.id, options)),
              )
            }
          />
        </Section>
      )}

      <Section label={ja ? 'あなた' : 'YOU'}>
        <Row testID="group-option-display-name" title={ja ? '表示名' : 'Display name'} value={detail.me.displayName} onPress={() => edit('displayName')} />
      </Section>

      <Section label={ja ? '通知' : 'NOTIFICATIONS'} footer={ja ? 'オフにしても一覧は見られ、自分の時刻も共有されます。' : 'Off still shows the list and shares your own time.'}>
        <Row
          testID="toggle-tonight-alerts"
          title={ja ? '今夜の共有が始まったとき' : 'When tonight starts'}
          switchValue={detail.me.notifications}
          onSwitch={(value) => setAlert('notifications', value)}
        />
        <Divider />
        <Row
          testID="toggle-leave-time-alerts"
          title={ja ? 'メンバーの出発時刻' : 'Members’ leave times'}
          switchValue={detail.me.leaveTimeAlerts}
          onSwitch={(value) => setAlert('leaveTimeAlerts', value)}
        />
      </Section>

      <Section footer={host ? (ja ? 'ホストはグループを解散すると退出できます。' : 'As host, you leave by disbanding the group.') : undefined}>
        {host ? (
          <Row
            testID="group-option-disband"
            title={ja ? 'グループを解散' : 'Disband group'}
            destructive
            onPress={() =>
              confirmAction(
                ja ? 'グループを解散' : 'Disband group',
                ja ? '全員の参加データを削除します。元に戻せません。' : 'Everyone’s data is deleted. This can’t be undone.',
                ja ? '解散する' : 'Disband',
                ja ? 'キャンセル' : 'Cancel',
                () => void leaveGone(() => disbandGroup(detail.id, options)),
              )
            }
          />
        ) : (
          <Row
            testID="group-option-leave-group"
            title={ja ? 'グループから退出' : 'Leave group'}
            destructive
            onPress={() =>
              confirmAction(
                ja ? 'グループから退出' : 'Leave group',
                ja ? `「${detail.name}」から退出しますか？表示名と出発時刻はすぐに削除されます。` : `Leave “${detail.name}”? Your name and leave time are deleted right away.`,
                ja ? '退出する' : 'Leave',
                ja ? 'キャンセル' : 'Cancel',
                () => void leaveGone(() => leaveGroup(detail.id, options)),
              )
            }
          />
        )}
      </Section>

      <Text testID="group-option-report" onPress={report} accessibilityRole="link" style={[styles.report, { color: colors.mutedForeground }]}>
        {ja ? '不適切な名前を報告' : 'Report an inappropriate name'}
      </Text>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 19 },
  report: { alignSelf: 'center', fontSize: 13, paddingVertical: 8, textDecorationLine: 'underline' },
});
