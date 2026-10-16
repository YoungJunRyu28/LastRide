/**
 * Settings → Widget colours: the theme of the widgets and the Live Activity
 * (Premium, like them). Each choice shows a small preview of its colours.
 */
import { Section, SettingsPage } from '@/components/SettingsUI';
import { Divider } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { WIDGET_THEMES, widgetPalette, type WidgetThemeId } from '@/lib/widgetThemes';
import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** A tiny widget: the countdown in the leave colour and a rail with the train colour. */
function Swatch({ id }: { id: WidgetThemeId }) {
  const c = widgetPalette(id);
  return (
    <View style={[styles.swatch, { backgroundColor: c.background, borderColor: c.dark ? '#26344d' : '#cdd6e3' }]}>
      <Text style={[styles.swatchCount, { color: c.leave }]}>20:41</Text>
      <View style={styles.swatchRail}>
        <View style={[styles.swatchTrack, { backgroundColor: c.track }]} />
        <View style={[styles.swatchDot, { left: 4, backgroundColor: c.leave }]} />
        <View style={[styles.swatchDot, { left: 24, backgroundColor: c.background, borderColor: c.train, borderWidth: 2 }]} />
        <View style={[styles.swatchDot, { left: 44, backgroundColor: c.background, borderColor: c.train, borderWidth: 2 }]} />
      </View>
    </View>
  );
}

export default function WidgetThemeScreen() {
  const colors = useColors();
  const { language, widgetTheme, setWidgetTheme } = useLastRide();
  const ja = language === 'ja';
  const groups = [
    { label: ja ? '暗い背景' : 'DARK', themes: WIDGET_THEMES.filter((theme) => widgetPalette(theme.id).dark) },
    { label: ja ? '白い背景' : 'WHITE', themes: WIDGET_THEMES.filter((theme) => !widgetPalette(theme.id).dark) },
  ];

  return (
    <SettingsPage title={ja ? 'ウィジェットの色' : 'Widget colours'} backLabel={ja ? '戻る' : 'Back'}>
      {groups.map((group, groupIndex) => (
        <Section
          key={group.label}
          label={group.label}
          footer={
            groupIndex === groups.length - 1
              ? ja
                ? 'ホーム画面・ロック画面のウィジェットと、ライブアクティビティの色です。ロック画面の小さなウィジェットはiOSが色を決めます。'
                : 'For the home- and lock-screen widgets and the Live Activity. iOS colours the small lock-screen widgets itself.'
              : undefined
          }
        >
          {group.themes.map((theme, index) => {
            const selected = widgetTheme === theme.id;
            return (
              <React.Fragment key={theme.id}>
                {index > 0 && <Divider />}
                <Pressable
                  testID={`widget-theme-${theme.id}`}
                  onPress={() => setWidgetTheme(theme.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Swatch id={theme.id} />
                  <Text style={[styles.name, { color: colors.foreground }]}>{ja ? theme.ja : theme.en}</Text>
                  {selected && <Feather name="check" size={20} color={colors.primary} />}
                </Pressable>
              </React.Fragment>
            );
          })}
        </Section>
      ))}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
  swatch: { borderRadius: 10, borderWidth: 1, height: 44, justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 5, width: 64 },
  swatchCount: { fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '800' },
  swatchRail: { height: 8 },
  swatchTrack: { borderRadius: 1, height: 2, left: 0, position: 'absolute', right: 0, top: 3 },
  swatchDot: { borderRadius: 4, height: 8, position: 'absolute', top: 0, width: 8 },
});
