/**
 * What the group screens share: run a server action (a 404 means the group is
 * gone for this phone), start or join tonight, leave or disband with the local
 * cleanup, and a yes/no confirmation. Used by the groups list, app/group/[id].tsx
 * and the group settings pages.
 */
import { joinGroupTonight, startGroupTonight, type GroupDetail } from '@workspace/api-client-react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { errorStatus, useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { usePremium } from '@/context/PremiumContext';
import { completeGroupDeparture } from '@/lib/groupDeparture';
import { recommendedLeaveTime } from '@/lib/reliability';

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
  const { apply, forget, memberOptions } = useGroups();
  const { plan } = useLastRide();
  const { groupCreationHeaders } = usePremium();
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

  /**
   * Shares your current leave time. Separate from night tracking: with tracking
   * on it keeps updating as you move; without it, it stays as shared (it is
   * refreshed only when the app re-plans, e.g. when you open it).
   */
  const shareLeaveTime = (id: string) =>
    joinGroupTonight(id, { leaveBy: plan ? new Date(recommendedLeaveTime(plan)).toISOString() : null }, memberOptions(id));

  const joinTonight = async () => {
    if (!groupId) return;
    await run(() => shareLeaveTime(groupId));
  };

  /**
   * The host starting tonight is going too: start, and share their own time.
   * Hosting needs Premium each night (the server checks): after a trial or a
   * cancellation, say so and offer Premium, instead of a generic failure.
   */
  const startTonight = async () => {
    if (!groupId) return;
    await run(async () => {
      const options = memberOptions(groupId);
      const premiumHeaders = await groupCreationHeaders().catch(() => ({} as Record<string, string>));
      const withPremium = { ...options, headers: { ...(options.headers as Record<string, string> | undefined), ...premiumHeaders } };
      try {
        await startGroupTonight(groupId, withPremium);
      } catch (error) {
        if (errorStatus(error) !== 402) throw error;
        Alert.alert(
          ja ? '今夜の開始にはプレミアムが必要です' : 'Starting tonight needs Premium',
          ja
            ? 'グループのホストとして今夜を始めるには、プレミアムが必要です。メンバーは今まで通り参加できます。'
            : 'Hosting a night needs Premium. Members can still join as before.',
          [
            { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
            { text: ja ? 'プレミアムを見る' : 'See Premium', onPress: () => router.push('/paywall') },
          ],
        );
        return;
      }
      return shareLeaveTime(groupId);
    });
  };

  return { busy, run, leaveGone, joinTonight, startTonight };
}
