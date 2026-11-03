/** Edit the group's name (host) or your display name in it, from group settings. */
import { updateGroup, updateMyGroupMembership } from '@workspace/api-client-react';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SettingsPage } from '@/components/SettingsUI';
import { PrimaryButton } from '@/components/ui';
import { useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { useGroupActions } from '@/lib/groupActions';

export default function GroupEditScreen() {
  const colors = useColors();
  const { id, field } = useLocalSearchParams<{ id: string; field: 'name' | 'displayName' }>();
  const { language } = useLastRide();
  const ja = language !== 'en';
  const { groups, memberOptions } = useGroups();
  const { run, busy } = useGroupActions(id, ja);
  const detail = groups.find((entry) => entry.membership.groupId === id)?.detail ?? null;
  const renaming = field === 'name';
  const [draft, setDraft] = useState(detail ? (renaming ? detail.name : detail.me.displayName) : '');
  const title = renaming ? (ja ? 'グループ名' : 'Group name') : ja ? '表示名' : 'Display name';
  if (!detail) return <SettingsPage title={title} backLabel={ja ? '戻る' : 'Back'}>{null}</SettingsPage>;

  const options = memberOptions(detail.id);
  const save = () =>
    void run(
      () => (renaming ? updateGroup(detail.id, { name: draft.trim() }, options) : updateMyGroupMembership(detail.id, { displayName: draft.trim() }, options)),
      () => (router.canGoBack() ? router.back() : undefined),
    );

  return (
    <SettingsPage title={title} backLabel={ja ? '戻る' : 'Back'}>
      <View style={styles.body}>
        <TextInput
          autoFocus
          value={draft}
          onChangeText={setDraft}
          maxLength={renaming ? 80 : 40}
          returnKeyType="done"
          onSubmitEditing={() => draft.trim() && save()}
          accessibilityLabel={title}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.primary, color: colors.foreground }]}
        />
        <PrimaryButton testID="group-edit-save" label={ja ? '保存' : 'Save'} disabled={!draft.trim() || busy} loading={busy} onPress={save} />
      </View>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  input: { borderRadius: 14, borderWidth: 1.5, fontSize: 17, minHeight: 52, paddingHorizontal: 14 },
});
