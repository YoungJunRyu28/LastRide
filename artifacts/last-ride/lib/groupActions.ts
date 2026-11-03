/**
 * What the group screens share: run a server action (a 404 means the group is
 * gone for this phone), leave or disband with the local cleanup, and a yes/no
 * confirmation. Used by app/group/[id].tsx and the group settings pages.
 */
import type { GroupDetail } from '@workspace/api-client-react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { errorStatus, useGroups } from '@/context/GroupsContext';
import { completeGroupDeparture } from '@/lib/groupDeparture';

/** Yes/no confirmation that also works on web. */
export function confirmAction(title: string, message: string, action: string, cancel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}

export function useGroupActions(groupId: string | undefined, ja: boolean) {
  const { apply, forget } = useGroups();
  const [busy, setBusy] = useState(false);

  /** Runs a server action; 404 means the group is gone for us. */
  const run = async (action: () => Promise<GroupDetail | void>, after?: () => void) => {
    setBusy(true);
    try {
      const result = await action();
      if (result) apply(result);
      after?.();
    } catch (error) {
      if (errorStatus(error) === 404 && groupId) {
        try {
          await forget(groupId);
          router.replace('/groups');
        } catch {
          // The server says this membership is gone, but secure storage could
          // not remove its local key: stay, and say so.
          Alert.alert(
            ja ? '端末のグループ情報を更新できません' : 'Could not clear saved group access',
            ja ? '端末のストレージを確認し、再度お試しください。' : 'Check device storage and try again.',
          );
        }
        return;
      }
      Alert.alert(ja ? 'できませんでした' : 'That didn’t work', ja ? 'しばらくしてからもう一度お試しください。' : 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  /** Leave or disband: the server first, then this phone, then back to the list. */
  const leaveGone = async (action: () => Promise<void>) => {
    if (!groupId) return;
    await run(() => completeGroupDeparture(action, () => forget(groupId), () => router.replace('/groups')));
  };

  return { busy, run, leaveGone };
}
