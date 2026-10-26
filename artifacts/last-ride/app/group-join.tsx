import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, IconButton, PrimaryButton } from '@/components/ui';
import { errorStatus, useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { readDisplayName } from '@/lib/groupMemberships';
import { readPendingGroupJoin } from '@/lib/pendingGroupJoin';

/**
 * Join a group with just a display name. Opened by an invite link
 * (last-ride://group-join?invite=…) or from the Groups tab with a code.
 */
export default function JoinGroupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ invite?: string; code?: string }>();
  const { language } = useLastRide();
  const { join } = useGroups();
  const ja = language !== 'en';
  const invite = typeof params.invite === 'string' ? params.invite : undefined;
  const [code, setCode] = useState(typeof params.code === 'string' ? params.code : '');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readDisplayName().then((saved) => setDisplayName((current) => current || saved));
    void readPendingGroupJoin().then((pending) => {
      if (!pending) return;
      setDisplayName(pending.displayName);
      if (pending.joinCode) setCode(pending.joinCode);
    }).catch(() => undefined);
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const { group, alreadyMember } = await join({
        ...(invite ? { inviteToken: invite } : { joinCode: code.trim().toUpperCase() }),
        displayName: displayName.trim(),
      });
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
      if (alreadyMember)
        Alert.alert(
          ja ? 'すでに参加しています' : 'You’re already in this group',
          ja ? `「${group.name}」にはこの端末で参加済みです。` : `This device is already in “${group.name}”.`,
        );
    } catch (error) {
      const status = errorStatus(error);
      if (error instanceof Error && error.message === 'PENDING_GROUP_JOIN') {
        Alert.alert(
          ja ? '参加処理を復元してください' : 'Finish your pending group join',
          ja ? '通信が切れた場合、前回の招待で再試行してください。重複登録を避けるため、別の招待にはまだ参加できません。' : 'Retry your previous invite first. The original join may have succeeded, and switching invites could create duplicate memberships.',
        );
        return;
      }
      Alert.alert(
        ja ? '参加できませんでした' : 'Couldn’t join',
        status === 409
          ? ja
            ? 'このグループは満員です。'
            : 'This group is full.'
          : status === 400
            ? ja
              ? '招待が無効か、再発行されています。ホストに新しいリンクをもらってください。'
              : 'The invite is invalid or was replaced. Ask the host for a new link.'
            : ja
              ? 'しばらくしてからもう一度お試しください。'
              : 'Please try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  };

  const shares: Array<{ icon: React.ComponentProps<typeof Feather>['name']; text: string; off?: boolean }> = [
    { icon: 'user', text: ja ? '表示名' : 'Display name' },
    { icon: 'clock', text: ja ? '今夜の出発時刻' : 'Tonight’s leave time' },
    { icon: 'slash', text: ja ? '現在地・自宅・駅・経路は共有しません' : 'Never your location, home, station or route', off: true },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 8), paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/groups'))} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {invite ? (ja ? 'グループに招待されました' : 'You’re invited to a group') : ja ? '招待コードで参加' : 'Join with a code'}
        </Text>

        {!invite && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '招待コード' : 'Invite code'}</Text>
            <TextInput
              testID="join-code-input"
              accessibilityLabel={ja ? '招待コード' : 'Invite code'}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              placeholder="ABCD-1234"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.code, { backgroundColor: colors.card, borderColor: code.trim() ? colors.primary : colors.input, color: colors.foreground }]}
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>{ja ? 'グループで表示する名前' : 'Your name in the group'}</Text>
          <TextInput
            testID="join-display-name-input"
            accessibilityLabel={ja ? '表示名' : 'Display name'}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={40}
            placeholder={ja ? '例：佐藤' : 'e.g. Sato'}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: displayName.trim() ? colors.primary : colors.input, color: colors.foreground }]}
          />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {ja ? '前回使った名前を表示しています。グループごとに変えられます。' : 'Your last-used name. You can change it per group.'}
          </Text>
        </View>

        <Card style={styles.shares}>
          <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '共有するのは2つだけ' : 'Only two things are shared'}</Text>
          {shares.map((item) => (
            <View key={item.text} style={styles.shareRow}>
              <Feather name={item.icon} size={15} color={item.off ? colors.mutedForeground : colors.primary} />
              <Text style={[styles.shareText, { color: item.off ? colors.mutedForeground : colors.foreground }]}>{item.text}</Text>
            </View>
          ))}
        </Card>

        <PrimaryButton
          label={ja ? 'グループに参加' : 'Join group'}
          onPress={() => void submit()}
          loading={busy}
          disabled={!displayName.trim() || (!invite && !code.trim())}
          testID="join-group"
        />
        <Text style={[styles.note, styles.center, { color: colors.mutedForeground }]}>
          {ja ? '参加は無料・アカウント不要。いつでも退出できます。' : 'Free, no account. Leave any time.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  title: { fontSize: 26, fontWeight: '800', marginTop: 6 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  input: { borderRadius: 16, borderWidth: 1.5, fontSize: 16, minHeight: 54, paddingHorizontal: 15 },
  code: { fontSize: 20, fontWeight: '800', letterSpacing: 2 },
  note: { fontSize: 12, lineHeight: 18 },
  center: { textAlign: 'center' },
  shares: { borderWidth: 1, gap: 10, padding: 16 },
  shareRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  shareText: { flex: 1, fontSize: 13 },
});
