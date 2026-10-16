import { Section, SettingsPage } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { searchStations, useLastRide, type StationOption } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/**
 * 「駅を選ぶ」: lock tonight's plan to a station. Nearby stations first (one
 * tap), or search any station. Works without a location: the plan then starts
 * at the station itself (its last train and leave time, no walk).
 */
export default function DepartureStationScreen() {
  const colors = useColors();
  const { language, plan, chooseDepartureStation } = useLastRide();
  const ja = language === 'ja';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StationOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchToken = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const token = ++searchToken.current;
    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      searchStations(trimmed)
        .then((options) => {
          if (token !== searchToken.current) return;
          setResults(options);
          setIsSearching(false);
        })
        .catch(() => {
          if (token !== searchToken.current) return;
          setSearchError(true);
          setResults([]);
          setIsSearching(false);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (station: StationOption) => {
    void chooseDepartureStation(station);
    if (router.canGoBack()) router.back();
    else router.replace('/ride');
  };

  const nearby = plan ? [plan, ...plan.alternatives] : [];
  const name = (station: StationOption) => (ja ? station.nameJa : station.name);

  return (
    <SettingsPage title={ja ? '今夜の出発駅' : 'Tonight’s station'} backLabel={ja ? '戻る' : 'Back'}>
      <Text style={[styles.lead, { color: colors.mutedForeground }]}>
        {ja
          ? '選んだ駅に固定します。移動しても駅は変わらず、徒歩と出発時刻だけ更新します。今夜だけ有効です。'
          : 'Locks tonight’s plan to this station. It won’t switch as you move; only the walk and leave time update. Tonight only.'}
      </Text>

      {nearby.length > 0 && (
        <Section label={ja ? '近くの駅' : 'NEARBY'}>
          {nearby.map((option, index) => (
            <React.Fragment key={option.station.nameJa}>
              {index > 0 && <Divider />}
              <Row
                testID={`nearby-station-${index}`}
                title={name(option.station)}
                subtitle={
                  ja
                    ? `徒歩${option.walkingMinutes}分 · 終電 ${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(option.lastTrain.departsAt))}`
                    : `${option.walkingMinutes} min walk · last ${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(option.lastTrain.departsAt))}`
                }
                onPress={() => choose(option.station)}
              />
            </React.Fragment>
          ))}
        </Section>
      )}

      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '駅を検索' : 'Search for a station'}</Text>
        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.input }]}>
          <Feather name="search" color={colors.mutedForeground} size={19} />
          <TextInput
            accessibilityLabel={ja ? '駅を検索' : 'Search for a station'}
            testID="departure-station-input"
            value={query}
            onChangeText={setQuery}
            placeholder={ja ? '例：渋谷、横浜' : 'e.g. Shibuya, Yokohama'}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            returnKeyType="search"
          />
          {isSearching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        {results.length > 0 && (
          <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {results.map((station, index) => (
              <Pressable
                accessibilityRole="button"
                key={`${station.nameJa}-${station.latitude}-${station.longitude}`}
                testID={`departure-result-${index}`}
                onPress={() => choose(station)}
                style={({ pressed }) => [styles.resultRow, { borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={[styles.resultIcon, { backgroundColor: colors.secondary }]}>
                  <Feather name="map-pin" color={colors.foreground} size={15} />
                </View>
                <View style={styles.resultCopy}>
                  <Text style={[styles.resultTitle, { color: colors.foreground }]}>{name(station)}</Text>
                  <Text style={[styles.resultSub, { color: colors.mutedForeground }]}>
                    {[ja ? station.regionJa : station.region, ja ? station.name : station.nameJa].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Feather name="chevron-right" color={colors.mutedForeground} size={17} />
              </Pressable>
            ))}
          </View>
        )}
        {searchError && (
          <Text style={[styles.helper, { color: colors.destructive }]}>{ja ? '検索に失敗しました。もう一度お試しください。' : 'Search failed. Please try again.'}</Text>
        )}
        {!searchError && query.trim().length >= 2 && !isSearching && results.length === 0 && (
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            {ja ? '駅が見つかりませんでした。漢字やかなでも検索してみてください。' : 'No stations found. Try the station’s Japanese name, e.g. 渋谷.'}
          </Text>
        )}
      </View>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 13, lineHeight: 20, paddingHorizontal: 4 },
  form: { gap: 10 },
  label: { fontSize: 14, fontWeight: '700', paddingHorizontal: 4 },
  inputWrap: { alignItems: 'center', borderRadius: 18, borderWidth: 1.5, flexDirection: 'row', gap: 11, paddingHorizontal: 15 },
  input: { flex: 1, fontSize: 16, fontWeight: '500', minHeight: 56 },
  helper: { fontSize: 12, lineHeight: 18, paddingHorizontal: 2 },
  resultBox: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  resultRow: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingHorizontal: 14, paddingVertical: 12 },
  resultIcon: { alignItems: 'center', borderRadius: 10, height: 32, justifyContent: 'center', width: 32 },
  resultCopy: { flex: 1, gap: 1 },
  resultTitle: { fontSize: 15, fontWeight: '700' },
  resultSub: { fontSize: 12 },
});
