import { BottomNav } from '@/components/BottomNav';
import { RailwayMark } from '@/components/RideUI';
import { REMINDER_CHOICES, useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { businessEnabled } from '@/lib/features';
import { recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS } from '@/lib/time';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A labelled group of rows. */
function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>
      {hint ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
    </View>
  );
}

/** One row inside a section: a title (with optional subtitle) on the left, a control on the right. */
function Row({ title, subtitle, children, onPress, testID, destructive }: { title: string; subtitle?: string; children?: React.ReactNode; onPress?: () => void; testID?: string; destructive?: boolean }) {
  const colors = useColors();
  const body = (
    <>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: destructive ? colors.destructive : colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {children}
      {onPress && !children ? <Feather name="chevron-right" color={colors.mutedForeground} size={18} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      {body}
    </Pressable>
  );
}

/** Two or three mutually exclusive choices, shown side by side. */
function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  const colors = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.background }]}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          testID={`choose-${option.value}`}
          onPress={() => onChange(option.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: option.value === value }}
          style={[styles.segment, { backgroundColor: option.value === value ? colors.primary : 'transparent' }]}
        >
          <Text style={[styles.segmentText, { color: option.value === value ? colors.primaryForeground : colors.mutedForeground }]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    language, homeStation, destination, walkingSpeed, setWalkingSpeed, setLanguage,
    reminderIntervals, toggleReminderInterval, notificationsAllowed,
    missedCheckIn, setMissedCheckIn,
    demoActive, setDemoNow, nowMs, plan, currentTime, leaveBy, triggerTestNotification, resetAll,
  } = useLastRide();
  const ja = language === 'ja';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 18), paddingBottom: 26 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <View style={styles.brand}><RailwayMark size={22} /><Text style={[styles.brandText, { color: colors.foreground }]}>LastRide</Text></View>
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{ja ? '設定' : 'Settings'}</Text>

        <Section label={ja ? '帰り先' : 'DESTINATION'}>
          <Row
            testID="edit-home-station"
            title={destination || (ja ? '未設定' : 'Not set')}
            subtitle={homeStation ? (ja ? `最寄り駅：${homeStation}` : `Nearest station: ${homeStation}`) : (ja ? '帰り先を設定' : 'Choose where you are heading')}
            onPress={() => router.push('/destinations')}
          />
        </Section>

        <Section
          label={ja ? '出発リマインダー' : 'LEAVE REMINDERS'}
          hint={
            Platform.OS === 'web'
              ? ja
                ? 'ブラウザ版ではこのタブを開いている間のみ届きます。'
                : 'In the browser, reminders only arrive while this tab is open.'
              : ja
                ? '夜のトラッキング中に届きます。出発時刻ちょうどと、終電後の案内も送ります。'
                : 'Sent while night-out tracking is on, including when it’s time to go and after the last train.'
          }
        >
          <View style={styles.row}>
            <View style={styles.chipRow}>
              {REMINDER_CHOICES.map((minutes) => {
                const active = reminderIntervals.includes(minutes);
                return (
                  <Pressable key={minutes} testID={`reminder-${minutes}`} onPress={() => toggleReminderInterval(minutes)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, { backgroundColor: active ? colors.primary : colors.secondary }]}>
                    <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{ja ? `${minutes}分前` : `${minutes} min`}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Row title={ja ? '終電後の案内' : 'After the last train'} subtitle={ja ? '乗り遅れたときの選択肢を通知します' : 'A check-in with your other ways home'}>
            <Switch
              testID="toggle-missed-check-in"
              accessibilityLabel={ja ? '終電後の案内' : 'After the last train'}
              value={missedCheckIn}
              onValueChange={setMissedCheckIn}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.card}
            />
          </Row>
          {notificationsAllowed === false && (
            <Row title={ja ? '通知が許可されていません' : 'Notifications are off'} subtitle={ja ? '端末の設定から許可してください。' : 'Enable them in your device settings.'} destructive />
          )}
        </Section>

        <Section label={ja ? '好みの設定' : 'PREFERENCES'} hint={ja ? '歩くペースは出発時刻の計算に使います。' : 'Your walking pace sets how early you need to leave.'}>
          <Row title={ja ? '歩くペース' : 'Walking pace'}>
            <Segmented
              value={walkingSpeed}
              onChange={setWalkingSpeed}
              options={[
                { value: 'relaxed', label: ja ? 'ゆっくり' : 'Relaxed' },
                { value: 'normal', label: ja ? 'ふつう' : 'Normal' },
                { value: 'fast', label: ja ? '速め' : 'Fast' },
              ]}
            />
          </Row>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Row title={ja ? '言語' : 'Language'}>
            <Segmented
              value={language ?? 'en'}
              onChange={setLanguage}
              options={[
                { value: 'ja', label: '日本語' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Row>
        </Section>

        {businessEnabled && (
          <Section label={ja ? 'グループ' : 'GROUPS'}>
            <Row
              testID="join-group"
              title={ja ? '飲み会に参加' : 'Join a group'}
              subtitle={ja ? '幹事のコードで出発時刻を共有' : 'Share your leave time with an organizer'}
              onPress={() => router.push('/join')}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Row
              testID="business-mode"
              title={ja ? '幹事モード' : 'LastRide for Business'}
              subtitle={ja ? '法人イベントを作成・管理' : 'Create and manage organization events'}
              onPress={() => router.push('/business')}
            />
          </Section>
        )}

        <Section label={ja ? '通知とデータ' : 'NOTIFICATIONS & DATA'}>
          <Row
            testID="open-night-history"
            title={ja ? '夜の履歴' : 'Night history'}
            subtitle={ja ? 'この端末に保存された過去のプラン' : 'Past plans stored only on this device'}
            onPress={() => router.push('/history')}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Row testID="test-notification" title={ja ? 'テスト通知を送る' : 'Send test notification'} subtitle={ja ? '通知の見え方を確認します' : 'Check how reminders look'} onPress={() => void triggerTestNotification()}>
            <Feather name="bell" color={colors.mutedForeground} size={18} />
          </Row>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Row testID="open-privacy" title={ja ? 'プライバシー' : 'Privacy'} subtitle={ja ? '位置情報の扱いについて' : 'How your location is used'} onPress={() => router.push('/privacy')} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Row
            testID="reset-all"
            title={ja ? '最初からやり直す' : 'Reset & start over'}
            subtitle={ja ? '言語・帰り先・設定を消去します' : 'Clears your language, destinations and settings'}
            onPress={() => void resetAll().then(() => router.replace('/'))}
            destructive
          >
            <Feather name="rotate-ccw" color={colors.destructive} size={18} />
          </Row>
        </Section>

        {__DEV__ && (
          <Section
            label={ja ? 'デモモード（開発用）' : 'DEMO MODE (DEV ONLY)'}
            hint={ja ? 'デモ中は1分＝1秒で進みます。通知は夜のトラッキング中のみ届きます。' : 'While the demo clock runs, 1 minute = 1 second. Notifications need tracking on.'}
          >
            <Row title={ja ? '時刻を動かす' : 'Shift the clock'} subtitle={ja ? `現在 ${currentTime} · 出発 ${leaveBy}` : `Now ${currentTime} · leave by ${leaveBy}`}>
              {demoActive && (
                <Pressable testID="demo-reset" onPress={() => setDemoNow(null)} accessibilityRole="button" style={[styles.chip, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.chipText, { color: colors.secondaryForeground }]}>{ja ? 'リセット' : 'Reset'}</Text>
                </Pressable>
              )}
            </Row>
            <View style={styles.row}>
              <View style={styles.chipRow}>
                {[-30, -5, 5, 30].map((delta) => (
                  <Pressable key={delta} testID={`demo-shift-${delta}`} onPress={() => setDemoNow(nowMs + delta * MINUTE_MS)} accessibilityRole="button" style={[styles.chip, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.chipText, { color: colors.secondaryForeground }]}>{delta > 0 ? `+${delta}` : delta}{ja ? '分' : 'm'}</Text>
                  </Pressable>
                ))}
                {plan && (
                  <Pressable testID="demo-jump-leave" onPress={() => setDemoNow(recommendedLeaveTime(plan) - (Math.max(0, ...reminderIntervals) + 1) * MINUTE_MS)} accessibilityRole="button" style={[styles.chip, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.chipText, { color: colors.primaryForeground }]}>{ja ? '出発直前へ' : 'Jump near leave'}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </Section>
        )}
      </ScrollView>
      <BottomNav language={language} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brand: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  brandText: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: -1.3, marginTop: 2 },
  section: { gap: 8 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.9 },
  card: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  rowSub: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  divider: { height: 1, marginHorizontal: 16 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  chipRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { alignItems: 'center', borderRadius: 13, paddingHorizontal: 13, paddingVertical: 9 },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  segmented: { borderRadius: 14, flexDirection: 'row', padding: 3 },
  segment: { alignItems: 'center', borderRadius: 11, paddingHorizontal: 12, paddingVertical: 8 },
  segmentText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
});
