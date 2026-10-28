import { Section, SettingsPage } from '@/components/SettingsUI';
import { Row } from '@/components/ui';
import { useGroups } from '@/context/GroupsContext';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

/**
 * Settings → データを消去: says exactly what goes (and what stays) before the
 * button, which still asks once more. Kept off the main Settings page so it
 * isn't tapped by accident.
 */
export default function ResetScreen() {
  const colors = useColors();
  const { language, resetAll } = useLastRide();
  const { leaveAll } = useGroups();
  const ja = language === 'ja';

  const erased = ja
    ? [
        '帰り先（自宅・保存した行き先）',
        '通知・アラーム・早めに出る時間などの設定',
        '今夜の予定とトラッキング',
        '参加中のグループ（退出します。ホストのグループは解散されます）',
      ]
    : [
        'Where you go home to (home and saved places)',
        'Settings such as reminders, alarms and leave-early time',
        'Tonight’s plan and tracking',
        'Your groups (you leave them; groups you host are disbanded)',
      ];

  const confirm = () =>
    Alert.alert(
      ja ? 'すべてのデータを消去しますか？' : 'Erase all data?',
      ja ? 'この操作は取り消せません。' : 'This can’t be undone.',
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: ja ? '消去する' : 'Erase',
          style: 'destructive',
          onPress: () => {
            void leaveAll()
              .then(resetAll)
              .then(() => router.replace('/'))
              .catch(() =>
                Alert.alert(
                  ja ? 'グループの退出に失敗しました' : 'Could not leave your groups',
                  ja
                    ? '接続を確認してもう一度お試しください。グループのデータは保持されました。'
                    : 'Check your connection and try again. Your group credentials were kept on this device.',
                ),
              );
          },
        },
      ],
    );

  return (
    <SettingsPage title={ja ? 'データを消去' : 'Erase data'} backLabel={ja ? '設定' : 'Settings'}>
      <Text style={[styles.lead, { color: colors.foreground }]}>
        {ja
          ? 'この端末のLastRideのデータをすべて消去して、最初の設定からやり直します。'
          : 'Erases LastRide data on this device and starts again from setup.'}
      </Text>

      <View style={styles.block}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{ja ? '消去されるもの' : 'WHAT’S ERASED'}</Text>
        {erased.map((item) => (
          <Text key={item} style={[styles.item, { color: colors.foreground }]}>
            ・{item}
          </Text>
        ))}
      </View>

      <View style={styles.block}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{ja ? '残るもの' : 'WHAT STAYS'}</Text>
        <Text style={[styles.item, { color: colors.foreground }]}>
          ・{ja ? 'プレミアムの購読（解約はiPhoneのサブスクリプション設定から）' : 'Your Premium subscription (cancel it in your iPhone’s subscription settings)'}
        </Text>
      </View>

      <Section>
        <Row testID="reset-all" title={ja ? 'すべてのデータを消去' : 'Erase all data'} onPress={confirm} destructive />
      </Section>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 15, lineHeight: 22, paddingHorizontal: 4 },
  block: { gap: 6, paddingHorizontal: 4 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  item: { fontSize: 14, lineHeight: 20 },
});
