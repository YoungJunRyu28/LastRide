import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, PrimaryButton } from '@/components/ui';
import { errorStatus, useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { readDisplayName } from '@/lib/groupMemberships';
import { readPendingGroupCreation } from '@/lib/pendingGroupCreation';

/** Create a group (premium; the server checks the entitlement). You become its ホスト. */
export default function NewGroupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const { create } = useGroups();
  const ja = language !== 'en';
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readDisplayName().then((saved) => setDisplayName((current) => current || saved));
    // If the app closed after a successful server insert but before saving the
    // host credential, prefill the interrupted operation instead of making an
    // unrelated second group with a new key.
    void readPendingGroupCreation().then((pending) => {
      if (!pending) return;
      setName(pending.name);
      setDisplayName(pending.displayName);
    }).catch(() => undefined);
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const group = await create(name.trim(), displayName.trim());
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (error) {
      if (errorStatus(error) === 402) router.replace('/paywall');
      else if (error instanceof Error && error.message === 'PENDING_GROUP_CREATION') {
        Alert.alert(
          ja ? '作成中のグループがあります' : 'A group creation is pending',
          ja ? '前回のグループ作成を再試行してください。二重作成を防ぐため、別のグループはまだ作れません。' : 'Please retry your previous group creation first. A different group cannot be created until that request is recovered.',
        );
      } else Alert.alert(ja ? '作成できませんでした' : 'Couldn’t create the group', ja ? '接続を確認し、同じ情報で再度お試しください。作成済みの場合はグループを復元します。' : 'Check your connection and retry with the same details. If your group was already created, it will be recovered.');
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, onChange: (text: string) => void, placeholder: string, max: number, testID: string) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        maxLength={max}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { backgroundColor: colors.card, borderColor: value.trim() ? colors.primary : colors.input, color: colors.foreground }]}
      />
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 8), paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/groups'))} />
        <Text style={[styles.kicker, { color: colors.primary }]}>{ja ? 'グループを作成' : 'NEW GROUP'}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {ja ? 'いつものメンバーで\nグループを作る' : 'Make a group for\nthe usual crowd'}
        </Text>
        {field(ja ? 'グループ名' : 'Group name', name, setName, ja ? '例：営業部 飲み会' : 'e.g. Sales team drinks', 80, 'group-name-input')}
        {field(ja ? 'あなたの表示名' : 'Your display name', displayName, setDisplayName, ja ? '例：田中' : 'e.g. Tanaka', 40, 'group-display-name-input')}
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          {ja
            ? 'あなたがホストになります。グループは残るので、次の飲み会は「今夜をはじめる」だけ。'
            : 'You’ll be the host. The group stays, so next time just start tonight.'}
        </Text>
        <PrimaryButton label={ja ? '作成する' : 'Create'} onPress={() => void submit()} loading={busy} disabled={!name.trim() || !displayName.trim()} testID="create-group" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
  title: { fontSize: 28, fontWeight: '800', lineHeight: 36 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  input: { borderRadius: 16, borderWidth: 1.5, fontSize: 16, minHeight: 54, paddingHorizontal: 15 },
  note: { fontSize: 12, lineHeight: 18 },
});
