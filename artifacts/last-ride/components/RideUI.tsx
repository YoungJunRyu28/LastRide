import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function PressableIcon({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  /** Spoken by screen readers; the button shows only an icon. */
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.55 : 1 }]}
    >
      <Feather color={colors.foreground} name={icon} size={22} />
    </Pressable>
  );
}

export function RailwayMark({ size = 30 }: { size?: number }) {
  const colors = useColors();
  return <MaterialCommunityIcons name="train-car" size={size} color={colors.primary} />;
}

export function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: colors.secondary }]}>
      <Feather name={icon} color={colors.primary} size={20} />
      <View style={styles.noticeText}>
        <Text style={[styles.noticeTitle, { color: colors.secondaryForeground }]}>{title}</Text>
        <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  notice: { alignItems: 'flex-start', borderRadius: 18, flexDirection: 'row', gap: 12, padding: 16 },
  noticeText: { flex: 1, gap: 3 },
  noticeTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  noticeBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
});