/** The group's members, from group settings: everyone listed; the host can remove others. */
import { Feather } from '@expo/vector-icons';
import { removeGroupMember } from '@workspace/api-client-react';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Section, SettingsPage } from '@/components/SettingsUI';
import { Divider } from '@/components/ui';
import { useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { confirmAction, useGroupActions } from '@/lib/groupActions';

export default function GroupMembersScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language } = useLastRide();
  const ja = language !== 'en';
  const { groups, memberOptions } = useGroups();
  const { run, busy } = useGroupActions(id, ja);
  const detail = groups.find((entry) => entry.membership.groupId === id)?.detail ?? null;
  if (!detail) return <SettingsPage title={ja ? 'メンバー' : 'Members'} backLabel={ja ? '戻る' : 'Back'}>{null}</SettingsPage>;

  const host = detail.me.role === 'host';
  const options = memberOptions(detail.id);
  const remove = (memberId: string, name: string) =>
    confirmAction(
      ja ? 'メンバーを削除' : 'Remove member',
      ja ? `${name}さんをグループから削除しますか？` : `Remove ${name} from the group?`,
      ja ? '削除' : 'Remove',
      ja ? 'キャンセル' : 'Cancel',
      () => void run(() => removeGroupMember(detail.id, memberId, options)),
    );
  // Host first, then everyone else in the order they joined.
  const members = [...detail.members].sort((a, b) => Number(b.role === 'host') - Number(a.role === 'host'));

  return (
    <SettingsPage title={ja ? `メンバー（${detail.members.length}人）` : `Members (${detail.members.length})`} backLabel={ja ? '戻る' : 'Back'}>
      <Section>
        {members.map((member, index) => {
          const me = member.id === detail.me.memberId;
          return (
            <React.Fragment key={member.id}>
              {index > 0 && <Divider />}
              <View style={styles.row}>
                <View style={[styles.avatar, { backgroundColor: me ? colors.primary : colors.secondary }]}>
                  <Text style={[styles.avatarText, { color: me ? colors.primaryForeground : colors.foreground }]}>{Array.from(member.displayName)[0] ?? ''}</Text>
                </View>
                <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
                  {me ? (ja ? `${member.displayName}（あなた）` : `${member.displayName} (you)`) : member.displayName}
                </Text>
                {member.role === 'host' ? (
                  <Text style={[styles.tag, { color: colors.primary }]}>{ja ? 'ホスト' : 'Host'}</Text>
                ) : host && !me ? (
                  <Pressable
                    testID={`remove-member-${member.id}`}
                    disabled={busy}
                    onPress={() => remove(member.id, member.displayName)}
                    accessibilityRole="button"
                    accessibilityLabel={ja ? `${member.displayName}さんを削除` : `Remove ${member.displayName}`}
                    hitSlop={10}
                  >
                    <Feather name="user-x" size={18} color={colors.destructive} />
                  </Pressable>
                ) : null}
              </View>
            </React.Fragment>
          );
        })}
      </Section>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 8 },
  avatar: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  avatarText: { fontSize: 14, fontWeight: '800' },
  name: { flex: 1, fontSize: 15, fontWeight: '600' },
  tag: { fontSize: 12, fontWeight: '800' },
});
