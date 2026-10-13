/**
 * Shared pieces for Settings and its sub-pages (iOS Settings style: a list of
 * rows on the main page, each opening a page for that setting).
 */
import { Card, IconButton, SectionLabel } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { alarmAuthorizationStatus } from '@/lib/notifications';
import type { LeaveMargin } from '@/lib/reliability';
import type { NightLocationMode, ReminderSound } from '@/lib/settings';
import { reminderLabel } from '@/lib/settings';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function SettingsPage({
  title,
  backLabel,
  onBack,
  children,
}: {
  title: string;
  backLabel: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/settings')));
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        // Rebuilt on a language switch: iOS can otherwise keep text sized for the
        // old language (e.g. after the phone was locked), cutting the new text off.
        key={language}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 12), paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <IconButton icon="chevron-left" label={backLabel} onPress={back} testID="settings-back" />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          <View style={styles.topbarSpacer} />
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

/** A labelled group of rows, with an optional footer note under it. */
export function Section({
  label,
  footer,
  children,
}: {
  label?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      <Card style={styles.card}>{children}</Card>
      {typeof footer === 'string' ? (
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>{footer}</Text>
      ) : (
        footer ?? null
      )}
    </View>
  );
}

/** AlarmKit permission, rechecked on mount, when `revision` changes and on return from iPhone Settings. */
export function useAlarmStatus(revision?: unknown) {
  const [status, setStatus] = useState<string>('unknown');
  const check = useCallback(() => {
    void alarmAuthorizationStatus()
      .then(setStatus)
      .catch(() => setStatus('unsupported'));
  }, []);
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && check());
    return () => subscription.remove();
  }, [check, revision]);
  return [status, setStatus] as const;
}

export const soundLabel = (sound: ReminderSound, ja: boolean) =>
  ({ default: ja ? 'iOS標準' : 'iOS default', pulse: 'Pulse', chime: 'Chime', urgent: ja ? '緊急' : 'Urgent' })[sound];

export const marginLabel = (margin: LeaveMargin, ja: boolean) => (ja ? `${margin}分` : `${margin} min`);

export const nightLocationLabel = (mode: NightLocationMode, ja: boolean) =>
  ({ ask: ja ? '未選択' : 'Not set', foreground: ja ? 'アプリのみ' : 'App open', background: ja ? '閉じても更新' : 'When closed' })[mode];

/** "30・15分前 · ⏰出発時" style summary of what will be delivered. */
export function reminderSummary(notifications: number[], alarms: number[], ja: boolean): string {
  const list = (times: number[]) => times.map((minutes) => reminderLabel(minutes, ja)).join(ja ? '・' : ', ');
  const parts = [];
  if (notifications.length) parts.push(list(notifications));
  if (alarms.length) parts.push(`⏰ ${list(alarms)}`);
  return parts.length ? parts.join(' · ') : ja ? 'オフ' : 'Off';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 20, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  topbarSpacer: { width: 44 },
  title: { fontSize: 17, fontWeight: '800' },
  section: { gap: 8 },
  card: { overflow: 'hidden', padding: 0 },
  footer: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
});
