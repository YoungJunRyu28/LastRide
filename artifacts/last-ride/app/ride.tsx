import { BottomNav } from '@/components/BottomNav';
import { Notice, RailwayMark } from '@/components/RideUI';
import { locationErrorText, useLastRide } from '@/context/LastRideContext';
import { sameStation, type RideStatus } from '@/lib/planner';
import { formatDuration, formatJstTime } from '@/lib/time';
import { shortLineName } from '@/lib/timetable';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function statusText(status: RideStatus, minutesLeft: number, lastTrain: string, ja: boolean) {
  switch (status) {
    case 'relaxed':
      return ja ? `あと${formatDuration(minutesLeft, true)}` : `in ${formatDuration(minutesLeft, false)}`;
    case 'soon':
      return ja ? `あと${minutesLeft}分 — そろそろ支度を` : `in ${minutesLeft} min — start wrapping up`;
    case 'now':
      return ja ? '今すぐ出発してください' : 'Leave now';
    case 'hurry':
      return ja ? `急いで — 終電は${lastTrain}発` : `Hurry — last train leaves at ${lastTrain}`;
    case 'departed':
      return ja ? `終電は${lastTrain}に発車しました` : `Last train left at ${lastTrain}`;
  }
}

function copy(language: 'ja' | 'en') {
  return language === 'ja'
    ? { greeting: '今夜の帰り道', walk: '徒歩', leave: '出発する目安', location: '位置情報を使う', locationHelp: '最寄り駅と徒歩時間を正確にします', sample: 'サンプルの時刻です', sampleHelp: '時刻表データはまだ接続されていません。表示中の終電時刻は仮の値で、実際のダイヤではありません。' }
    : { greeting: 'Your way home tonight', walk: 'walk', leave: 'Leave by', location: 'Use my location', locationHelp: 'Find your closest station and walking time.', sample: 'Sample train times', sampleHelp: 'Live timetables aren’t connected yet. The last train shown is a placeholder, not a real schedule.' };
}

/** One stop on the journey strip: a time with a label under it. */
function Stop({ time, label, color, labelColor, align = 'flex-start' }: { time: string; label: string; color: string; labelColor: string; align?: 'flex-start' | 'center' | 'flex-end' }) {
  return (
    <View style={{ alignItems: align, gap: 2 }}>
      <Text style={[styles.stopTime, { color }]}>{time}</Text>
      <Text style={[styles.stopLabel, { color: labelColor }]}>{label}</Text>
    </View>
  );
}

export default function RideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language, plan, setPinnedStation, homeStationOption, homeStation, stationName, stationNameJa, destination, leaveBy, lastTrain, lastTrainSource, minutesUntilLeave, status, walkingMinutes, walkingDistanceMeters, isLocationReady, isLocating, locationError, requestLocation, currentTime, demoActive, trackingMode, startTracking, stopTracking } = useLastRide();
  const ja = language === 'ja';
  const text = copy(language ?? 'en');
  const station = ja ? stationNameJa : stationName;

  useEffect(() => {
    if (homeStation && !isLocationReady && !isLocating && !locationError) void requestLocation();
  }, [homeStation, isLocationReady, isLocating, locationError, requestLocation]);

  const statusColor = status === 'hurry' ? colors.destructive : status === 'departed' ? colors.mutedForeground : status === 'relaxed' ? colors.secondary : colors.primary;
  const statusTextColor = status === 'relaxed' ? colors.secondaryForeground : status === 'soon' || status === 'now' ? colors.primaryForeground : colors.card;

  const sharePlan = async () => {
    if (!plan) return;
    const arrivalMs = plan.arriveHomeMs ?? plan.lastTrain.arrivesAt;
    const arrival = arrivalMs ? formatJstTime(arrivalMs) : null;
    const message = ja
      ? `LastRide：${leaveBy}までに出発${arrival ? ` · 到着予定 ${arrival}` : ''}`
      : `LastRide: leave by ${leaveBy}${arrival ? ` · ETA ${arrival}` : ''}`;
    await Share.share({ message });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12), paddingBottom: 28 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <View style={styles.brand}><RailwayMark size={23} /><Text style={[styles.brandText, { color: colors.foreground }]}>LastRide</Text></View>
          <View style={styles.topbarActions}>
            {plan && (
              <Pressable onPress={() => void sharePlan()} testID="share-plan" hitSlop={12} accessibilityRole="button" accessibilityLabel={ja ? '出発時刻を共有' : 'Share leave time'}>
                <Feather name="share-2" color={colors.foreground} size={20} />
              </Pressable>
            )}
            <Pressable onPress={() => router.push('/settings')} testID="open-settings" hitSlop={12} accessibilityRole="button" accessibilityLabel={ja ? '設定' : 'Settings'}><Feather name="sliders" color={colors.foreground} size={21} /></Pressable>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{currentTime} · {text.greeting}{demoActive ? (ja ? ' · デモ時刻' : ' · demo clock') : ''}</Text>
          <Text style={[styles.station, { color: colors.foreground }]}>{station}</Text>
          <Text style={[styles.nearby, { color: colors.mutedForeground }]}>
            {isLocating
              ? ja ? '現在地から最寄り駅を検索中…' : 'Finding your closest station…'
              : [
                  walkingMinutes ? (ja ? `${text.walk}${walkingMinutes}分` : `${walkingMinutes} min ${text.walk}`) : null,
                  // Name the arrival station when the exact destination is reached via another station.
                  plan && homeStationOption && !sameStation(plan.destination, homeStationOption) && destination
                    ? ja
                      ? `${plan.destination.nameJa} 経由で${destination}へ`
                      : `to ${destination} via ${plan.destination.name}`
                    : destination ? (ja ? `${destination}へ` : `to ${destination}`) : null,
                ].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {plan?.pinned && (() => {
          const gain = Math.round((plan.autoPick.leaveByMs - plan.leaveByMs) / 60000);
          const autoName = ja ? plan.autoPick.station.nameJa : plan.autoPick.station.name;
          return (
            <View style={[styles.pinnedBanner, { backgroundColor: colors.secondary }]}>
              <Feather name="map-pin" color={colors.primary} size={18} />
              <View style={styles.flex}>
                <Text style={[styles.rowTitle, { color: colors.secondaryForeground }]}>{ja ? `${station}を選択中` : `You picked ${station}`}</Text>
                <Text style={[styles.note, { color: gain >= 5 ? colors.destructive : colors.mutedForeground }]}>
                  {gain >= 5
                    ? ja ? `自動なら${autoName}で${gain}分遅く出られます。` : `${autoName} would give you ${gain} more minutes.`
                    : ja ? '自動での駅の切り替えは止まっています。' : 'Automatic station switching is paused.'}
                </Text>
              </View>
              <Pressable testID="back-to-auto" onPress={() => setPinnedStation(null)} accessibilityRole="button" style={({ pressed }) => [styles.smallButton, { backgroundColor: colors.foreground, opacity: pressed ? 0.8 : 1 }]}>
                <Text style={[styles.smallButtonText, { color: colors.card }]}>{ja ? '自動に戻す' : 'Back to auto'}</Text>
              </Pressable>
            </View>
          );
        })()}

        {/* Tonight at a glance: when to leave, and the two times that follow from it */}
        <View style={[styles.hero, { backgroundColor: colors.foreground }]}>
          <View style={styles.heroTop}>
            <Text style={[styles.heroLabel, { color: colors.primary }]}>{text.leave}</Text>
            {status && minutesUntilLeave !== null && (
              <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
                <Feather name={status === 'hurry' ? 'alert-triangle' : status === 'departed' ? 'moon' : status === 'relaxed' ? 'clock' : 'bell'} size={13} color={statusTextColor} />
                <Text style={[styles.statusText, { color: statusTextColor }]}>{statusText(status, minutesUntilLeave, lastTrain, ja)}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.leaveTime, { color: colors.card }]}>{leaveBy}</Text>
          <View style={[styles.strip, { borderTopColor: colors.mutedForeground }]}>
            <Stop
              time={walkingMinutes ? (ja ? `徒歩${walkingMinutes}分` : `${walkingMinutes} min`) : '—'}
              label={ja ? '駅まで歩く' : 'walk to station'}
              color={colors.primary}
              labelColor={colors.muted}
            />
            <Stop
              time={`${lastTrain}${lastTrainSource === 'sample' ? (ja ? '（仮）' : '*') : ''}`}
              label={ja ? `${station}発` : `${station} dep.`}
              color={colors.card}
              labelColor={colors.muted}
              align="center"
            />
            <Stop
              time={plan?.arriveHomeMs ? formatJstTime(plan.arriveHomeMs) : plan?.lastTrain.arrivesAt ? formatJstTime(plan.lastTrain.arrivesAt) : '--:--'}
              label={
                plan?.arriveHomeMs
                  ? ja ? `${destination}着（徒歩${plan.walkHomeMinutes ?? 0}分）` : `${destination} (${plan.walkHomeMinutes ?? 0} min walk)`
                  : ja ? `${destination}着` : `${destination} arr.`
              }
              color={colors.card}
              labelColor={colors.muted}
              align="flex-end"
            />
          </View>
        </View>

        {status === 'departed' && (
          <Pressable testID="missed-prompt" onPress={() => router.replace('/alternatives')} accessibilityRole="button" style={({ pressed }) => [styles.promptRow, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
            <Feather name="compass" color={colors.primaryForeground} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.primaryForeground }]}>{ja ? '終電に間に合いませんでしたか？' : 'Missed the last train?'}</Text>
              <Text style={[styles.note, { color: colors.primaryForeground }]}>{ja ? '始発・タクシー・近くで朝まで過ごせる場所を見る' : 'See the first train, a taxi, and places to stay nearby'}</Text>
            </View>
            <Feather name="chevron-right" color={colors.primaryForeground} size={18} />
          </Pressable>
        )}

        {plan?.lastTrain.legs && plan.lastTrain.legs.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{ja ? '終電のルート' : 'LAST TRAIN'}</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {[
                  plan.lastTrain.transfers ? (ja ? `乗換${plan.lastTrain.transfers}回` : `${plan.lastTrain.transfers} transfer${plan.lastTrain.transfers > 1 ? 's' : ''}`) : ja ? '乗換なし' : 'Direct',
                  plan.lastTrain.fareYen ? `¥${plan.lastTrain.fareYen.toLocaleString('en-US')}` : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {plan.lastTrain.legs.map((leg) => (
                <View key={`${leg.line}-${leg.departsAt}`} style={styles.leg}>
                  <Text style={[styles.legTime, { color: colors.foreground }]}>{formatJstTime(leg.departsAt)}</Text>
                  <View style={styles.flex}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{ja ? `${leg.from} → ${leg.to}` : `${leg.fromEn ?? leg.from} → ${leg.toEn ?? leg.to}`}</Text>
                    <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? shortLineName(leg.line) : (leg.lineEn ?? shortLineName(leg.line))}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {plan && (plan.alternatives ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{ja ? 'ほかの駅から' : 'OTHER STATIONS'}</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {plan.alternatives.map((option) => {
                const isAutoPick = plan.pinned && option.station.nameJa === plan.autoPick.station.nameJa;
                const name = ja ? option.station.nameJa : option.station.name;
                return (
                  <Pressable
                    key={option.station.nameJa}
                    testID={`use-station-${option.station.nameJa}`}
                    onPress={() => setPinnedStation(isAutoPick ? null : option.station)}
                    accessibilityRole="button"
                    accessibilityLabel={ja ? `${name}から帰る` : `Leave from ${name} instead`}
                    style={({ pressed }) => [styles.leg, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.legTime, { color: colors.foreground }]}>{formatJstTime(option.leaveByMs)}</Text>
                    <View style={styles.flex}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                        {name}
                        {isAutoPick ? <Text style={[styles.note, { color: colors.primary }]}>{ja ? '  自動のおすすめ' : '  Automatic pick'}</Text> : null}
                      </Text>
                      <Text style={[styles.note, { color: colors.mutedForeground }]}>
                        {ja ? `徒歩${option.walkingMinutes}分 · 終電 ${formatJstTime(option.lastTrain.departsAt)}` : `${option.walkingMinutes} min walk · last train ${formatJstTime(option.lastTrain.departsAt)}`}
                      </Text>
                    </View>
                    <Feather name="repeat" color={colors.mutedForeground} size={16} />
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {ja ? 'タップでその駅に切り替えます。自動では10分以上早く出られる場合のみ遠い駅を選びます。' : 'Tap to switch. On automatic, a farther station is only chosen if it gives you 10+ more minutes.'}
            </Text>
          </View>
        )}

        {/* Where you're heading, and how far you have to walk */}
        <View style={[styles.factsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable style={styles.fact} onPress={() => router.push('/destinations')} testID="edit-destination" accessibilityRole="button">
            <Text style={[styles.factLabel, { color: colors.mutedForeground }]}>{ja ? '行き先' : 'Destination'}</Text>
            <View style={styles.factValueRow}>
              <Text style={[styles.factValue, { color: colors.foreground }]} numberOfLines={1}>{destination || '—'}</Text>
              <Feather name="edit-3" color={colors.mutedForeground} size={14} />
            </View>
          </Pressable>
          <View style={[styles.factDivider, { backgroundColor: colors.border }]} />
          <View style={styles.fact}>
            <Text style={[styles.factLabel, { color: colors.mutedForeground }]}>{ja ? '駅まで' : 'To the station'}</Text>
            <Text style={[styles.factValue, { color: colors.foreground }]}>
              {walkingDistanceMeters
                ? `${(walkingDistanceMeters / 1000).toFixed(1)} km · ${ja ? `${walkingMinutes}分` : `${walkingMinutes} min`}`
                : isLocating ? (ja ? '計算中…' : 'Calculating…') : '—'}
            </Text>
          </View>
        </View>

        {isLocationReady && (status !== 'departed' || trackingMode !== null) && (
          trackingMode === null ? (
            <Pressable testID="start-tracking" onPress={() => void startTracking()} accessibilityRole="button" style={({ pressed }) => [styles.trackRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}>
              <Feather name="navigation" color={colors.secondaryForeground} size={18} />
              <View style={styles.flex}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>{ja ? '夜のトラッキング' : 'Night-out tracking'}</Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>{ja ? 'リマインダーをオンにし、移動に合わせて更新' : 'Reminders on, and your plan follows you'}</Text>
              </View>
              <View style={[styles.smallButton, { backgroundColor: colors.foreground }]}>
                <Text style={[styles.smallButtonText, { color: colors.card }]}>{ja ? '開始' : 'Start'}</Text>
              </View>
            </Pressable>
          ) : (
            <Pressable testID="stop-tracking" onPress={() => void stopTracking()} accessibilityRole="button" style={({ pressed }) => [styles.trackRow, { backgroundColor: colors.secondary, borderColor: colors.secondary, opacity: pressed ? 0.8 : 1 }]}>
              <Feather name="navigation" color={colors.primary} size={18} />
              <View style={styles.flex}>
                <Text style={[styles.rowTitle, { color: colors.secondaryForeground }]}>{ja ? 'トラッキング中' : 'Tracking on'}</Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  {trackingMode === 'background'
                    ? ja ? 'アプリを閉じても更新。終電後に自動で停止。' : 'Updates with the app closed; stops after the last train.'
                    : ja ? 'アプリを開いている間だけ更新します。' : 'Updates while the app is open.'}
                </Text>
              </View>
              <View style={[styles.smallButton, { backgroundColor: colors.card }]}>
                <Text style={[styles.smallButtonText, { color: colors.secondaryForeground }]}>{ja ? '停止' : 'Stop'}</Text>
              </View>
            </Pressable>
          )
        )}

        {!isLocationReady && (
          <Pressable testID="enable-location" onPress={() => void requestLocation()} accessibilityRole="button" style={({ pressed }) => [styles.trackRow, { backgroundColor: colors.secondary, borderColor: colors.secondary, opacity: pressed ? 0.7 : 1 }]}>
            <Feather name="crosshair" color={colors.secondaryForeground} size={18} />
            <View style={styles.flex}>
              <Text style={[styles.rowTitle, { color: colors.secondaryForeground }]}>{isLocating ? (ja ? '最寄り駅を検索中…' : 'Finding your closest station…') : text.location}</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>{locationError ? locationErrorText(locationError, ja) : text.locationHelp}</Text>
            </View>
          </Pressable>
        )}

        {lastTrainSource === 'sample' && <Notice icon="info" title={text.sample} body={text.sampleHelp} />}
      </ScrollView>
      <BottomNav language={language} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 16, paddingHorizontal: 20 },
  flex: { flex: 1, gap: 2 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  topbarActions: { alignItems: 'center', flexDirection: 'row', gap: 18 },
  brand: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  brandText: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  intro: { gap: 3, marginTop: 4 },
  eyebrow: { fontFamily: 'Inter_500Medium', fontSize: 13, letterSpacing: 0.2 },
  station: { fontFamily: 'Inter_700Bold', fontSize: 36, letterSpacing: -1.3 },
  nearby: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  pinnedBanner: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 12, padding: 14 },
  hero: { borderRadius: 26, padding: 22 },
  heroTop: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  heroLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  leaveTime: { fontFamily: 'Inter_700Bold', fontSize: 62, letterSpacing: -2.6, lineHeight: 70, marginTop: 4 },
  statusPill: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 7 },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  strip: { borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 12 },
  stopTime: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  stopLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  promptRow: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 12, padding: 15 },
  section: { gap: 8 },
  sectionHead: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.9 },
  card: { borderRadius: 20, borderWidth: 1, gap: 14, padding: 16 },
  leg: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  legTime: { flexShrink: 0, fontFamily: 'Inter_700Bold', fontSize: 16, width: 52 },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  factsCard: { alignItems: 'center', borderRadius: 20, borderWidth: 1, flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14 },
  fact: { flex: 1, gap: 3 },
  factDivider: { alignSelf: 'stretch', marginHorizontal: 14, width: 1 },
  factLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  factValueRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  factValue: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  trackRow: { alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  smallButton: { borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9 },
  smallButtonText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
});
