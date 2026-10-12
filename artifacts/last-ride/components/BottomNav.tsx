import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { router, usePathname } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Tab = {
  icon: React.ComponentProps<typeof Feather>['name'];
  route: '/ride' | '/alternatives' | '/groups';
  label: string;
  labelJa: string;
  /** Other screens that belong to this tab (a group's own page is /group/<id>). */
  also?: string[];
};

/** The three nightly screens. Settings is reached from the gear on Leave. */
const TABS: Tab[] = [
  { icon: 'clock', route: '/ride', label: 'Leave', labelJa: '帰る時間' },
  { icon: 'compass', route: '/alternatives', label: 'If missed', labelJa: '乗れなかったら' },
  { icon: 'users', route: '/groups', label: 'Groups', labelJa: 'グループ', also: ['/group/', '/group-'] },
];

export function BottomNav({ language }: { language: 'ja' | 'en' | null }) {
  const colors = useColors();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { backgroundColor: colors.background, borderColor: colors.secondary, paddingBottom: Math.max(insets.bottom, 12) },
      ]}
    >
      {TABS.map((tab) => {
        const active =
          pathname === tab.route ||
          pathname.startsWith(`${tab.route}/`) ||
          (tab.also ?? []).some((prefix) => pathname.startsWith(prefix));
        const label = language === 'ja' ? tab.labelJa : tab.label;
        const color = active ? colors.primary : colors.mutedForeground;
        return (
          <Pressable
            key={tab.route}
            testID={`tab-${tab.route.slice(1)}`}
            onPress={() => {
              // Tabs are roots: drop pushed screens (settings, destinations) first.
              if (router.canDismiss()) router.dismissAll();
              router.replace(tab.route);
            }}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name={tab.icon} size={22} color={color} />
            <Text style={[styles.label, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: 1, flexDirection: 'row', paddingTop: 6 },
  tab: { alignItems: 'center', flex: 1, gap: 3, justifyContent: 'center', minHeight: 52 },
  label: { fontSize: 11, fontWeight: '700' },
});
