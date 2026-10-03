import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { router, usePathname } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type NavItem = { icon: React.ComponentProps<typeof Feather>['name']; route: '/ride' | '/alternatives' | '/settings'; label: string; labelJa: string };
const items: NavItem[] = [
  { icon: 'clock', route: '/ride', label: 'Leave', labelJa: '帰る時間' },
  { icon: 'compass', route: '/alternatives', label: 'If missed', labelJa: '乗れなかったら' },
  { icon: 'sliders', route: '/settings', label: 'Settings', labelJa: '設定' },
];

export function BottomNav({ language }: { language: 'ja' | 'en' | null }) {
  const colors = useColors();
  const pathname = usePathname();
  return (
    <View accessibilityRole="tablist" style={[styles.shell, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {items.map((item) => {
        const active = pathname === item.route;
        return (
          <Pressable key={item.route} testID={`tab-${item.label.toLowerCase().replace(' ', '-')}`} onPress={() => router.replace(item.route)} accessibilityRole="tab" accessibilityLabel={language === 'ja' ? item.labelJa : item.label} accessibilityState={{ selected: active }} style={({ pressed }) => [styles.item, { opacity: pressed ? 0.62 : 1 }]}>
            <Feather name={item.icon} size={20} color={active ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.label, { color: active ? colors.foreground : colors.mutedForeground }]}>{language === 'ja' ? item.labelJa : item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-around', paddingBottom: 18, paddingTop: 11 },
  item: { alignItems: 'center', gap: 5, minWidth: 78 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
});