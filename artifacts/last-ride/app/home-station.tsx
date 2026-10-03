import { RailwayMark, PressableIcon } from '@/components/RideUI';
import { searchAddresses, searchStations, StationOption, useLastRide, type HomeAddress } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeStationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; new?: string }>();
  const { language, homeStationOption, homeAddress, destinations, activeDestinationId, saveDestination, resetLanguage } = useLastRide();
  const ja = language === 'ja';
  const isNew = params.new === '1';
  const requestedId = typeof params.id === 'string' ? params.id : null;
  const editingId = isNew ? null : requestedId ?? activeDestinationId;
  const editingDestination = destinations.find((destination) => destination.id === editingId) ?? null;
  const initialSetup = destinations.length === 0 && !isNew && !requestedId;
  const initialStation = editingDestination?.station ?? (initialSetup ? homeStationOption : null);
  const initialAddress = editingDestination?.address ?? (initialSetup ? homeAddress : null);
  const [label, setLabel] = useState(editingDestination?.label ?? (initialSetup ? (ja ? '自宅' : 'Home') : ''));
  const [query, setQuery] = useState(initialStation ? (ja ? initialStation.nameJa : initialStation.name) : '');
  const [results, setResults] = useState<StationOption[]>([]);
  const [selected, setSelected] = useState<StationOption | null>(initialStation);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchToken = useRef(0);
  const [addressQuery, setAddressQuery] = useState(initialAddress?.label ?? '');
  const [addressResults, setAddressResults] = useState<HomeAddress[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<HomeAddress | null>(initialAddress);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const addressToken = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const selectedLabel = selected ? (ja ? selected.nameJa : selected.name) : null;
    const token = ++searchToken.current;
    if (trimmed.length < 2 || trimmed === selectedLabel) {
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
  }, [query, selected, ja]);

  useEffect(() => {
    const trimmed = addressQuery.trim();
    const token = ++addressToken.current;
    if (trimmed.length < 2 || trimmed === selectedAddress?.label) {
      setAddressResults([]);
      setIsSearchingAddress(false);
      return;
    }
    setIsSearchingAddress(true);
    const timer = setTimeout(() => {
      searchAddresses(trimmed)
        .then((results) => {
          if (token !== addressToken.current) return;
          setAddressResults(results);
          setIsSearchingAddress(false);
        })
        .catch(() => {
          if (token !== addressToken.current) return;
          setAddressResults([]);
          setIsSearchingAddress(false);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [addressQuery, selectedAddress]);

  const pickStation = (station: StationOption) => {
    setSelected(station);
    setQuery(ja ? station.nameJa : station.name);
    setResults([]);
  };

  const continueToRide = () => {
    if (!selected || !label.trim()) return;
    saveDestination({
      ...(editingId ? { id: editingId } : {}),
      label: label.trim(),
      station: selected,
      address: selectedAddress,
    });
    router.replace('/ride');
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12), paddingBottom: Platform.OS === 'web' ? 46 : 28 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.topbar}>
          <PressableIcon
            icon="arrow-left"
            label={ja ? '戻る' : 'Back'}
            onPress={() => {
              if (initialSetup) {
                // Clear the language choice first — otherwise the welcome screen redirects right back here.
                resetLanguage();
                router.replace('/');
              } else {
                router.back();
              }
            }}
            testID="back-to-language"
          />
          <RailwayMark size={25} />
          <View style={styles.placeholder} />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.kicker, { color: colors.primary }]}>
            {initialSetup ? (ja ? 'まずは帰る場所' : 'ONE-TIME SETUP') : isNew ? (ja ? '帰り先を追加' : 'ADD DESTINATION') : (ja ? '帰り先を編集' : 'EDIT DESTINATION')}
          </Text>
          <Text maxFontSizeMultiplier={1.5} style={[styles.title, { color: colors.foreground }]}>
            {initialSetup ? (ja ? '自宅の最寄り駅を\n教えてください。' : 'Where should we\nget you home to?') : isNew ? (ja ? '帰り先を\n追加します。' : 'Add somewhere\nyou might go.') : (ja ? '帰り先を\n編集します。' : 'Edit this\ndestination.')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{ja ? '名前と最寄り駅を設定してください。' : 'Give it a name and choose the nearest station.'}</Text>
        </View>
        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '名前' : 'Name'}</Text>
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: label.trim() ? colors.primary : colors.border }]}>
            <Feather name="bookmark" color={colors.mutedForeground} size={19} />
            <TextInput
              accessibilityLabel={ja ? '名前' : 'Name'}
              testID="destination-label-input"
              autoFocus={!initialSetup}
              value={label}
              onChangeText={setLabel}
              maxLength={40}
              placeholder={ja ? '例：自宅、会社、友人宅' : 'e.g. Home, Work, Nick’s place'}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground }]}
              returnKeyType="next"
            />
          </View>
        </View>
        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '最寄り駅' : 'Nearest station'}</Text>
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.border }]}>
            <Feather name="search" color={colors.mutedForeground} size={19} />
            <TextInput
              accessibilityLabel={ja ? '最寄り駅' : 'Nearest station'}
              testID="home-station-input"
              autoFocus={initialSetup}
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setSelected(null);
              }}
              placeholder={ja ? '例：渋谷、横浜' : 'e.g. Shibuya, Yokohama'}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground }]}
              returnKeyType="search"
            />
            {isSearching ? <ActivityIndicator size="small" color={colors.primary} /> : selected ? <Feather name="check-circle" color={colors.primary} size={19} /> : null}
          </View>
          {results.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {results.map((station, index) => (
                <Pressable accessibilityRole="button"
                  key={`${station.nameJa}-${station.latitude}-${station.longitude}`}
                  testID={`station-result-${index}`}
                  onPress={() => pickStation(station)}
                  style={({ pressed }) => [styles.resultRow, { borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <View style={[styles.resultIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name="map-pin" color={colors.secondaryForeground} size={15} />
                  </View>
                  <View style={styles.resultCopy}>
                    <Text style={[styles.resultTitle, { color: colors.foreground }]}>{ja ? station.nameJa : station.name}</Text>
                    <Text style={[styles.resultSub, { color: colors.mutedForeground }]}>
                      {[ja ? station.regionJa : station.region, ja ? station.name : station.nameJa].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Feather name="chevron-right" color={colors.mutedForeground} size={17} />
                </Pressable>
              ))}
            </View>
          )}
          {searchError && <Text style={[styles.helper, { color: colors.destructive ?? '#d05656' }]}>{ja ? '検索に失敗しました。もう一度お試しください。' : 'Search failed. Please try again.'}</Text>}
          {!searchError && !selected && query.trim().length >= 2 && !isSearching && results.length === 0 && (
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>{ja ? '駅が見つかりませんでした。漢字やかなでも検索してみてください。' : 'No stations found. Try the station’s Japanese name, e.g. 渋谷.'}</Text>
          )}
          {selected && <Text style={[styles.helper, { color: colors.mutedForeground }]}>{ja ? `「${selected.nameJa}」を「${label || '帰り先'}」の最寄り駅として保存します。` : `“${selected.name}” will be saved for “${label || 'this destination'}”.`}</Text>}
        </View>
        <View style={styles.form}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '住所' : 'Address'}</Text>
            <Text style={[styles.optional, { color: colors.mutedForeground }]}>{ja ? '任意' : 'optional'}</Text>
          </View>
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: selectedAddress ? colors.primary : colors.border }]}>
            <Feather name="home" color={colors.mutedForeground} size={19} />
            <TextInput
              accessibilityLabel={ja ? '住所（任意）' : 'Address (optional)'}
              testID="home-address-input"
              value={addressQuery}
              onChangeText={(value) => {
                setAddressQuery(value);
                setSelectedAddress(null);
              }}
              placeholder={ja ? '例：渋谷区道玄坂' : 'e.g. 渋谷区道玄坂'}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground }]}
              returnKeyType="search"
            />
            {isSearchingAddress ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : selectedAddress ? (
              <Pressable
                testID="clear-home-address"
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={ja ? '住所を削除' : 'Clear address'}
                onPress={() => {
                  setSelectedAddress(null);
                  setAddressQuery('');
                }}
              >
                <Feather name="x-circle" color={colors.mutedForeground} size={19} />
              </Pressable>
            ) : null}
          </View>
          {addressResults.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {addressResults.map((address, index) => (
                <Pressable accessibilityRole="button"
                  key={`${address.label}-${address.latitude}`}
                  testID={`address-result-${index}`}
                  onPress={() => {
                    setSelectedAddress(address);
                    setAddressQuery(address.label);
                    setAddressResults([]);
                  }}
                  style={({ pressed }) => [styles.resultRow, { borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <View style={[styles.resultIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name="home" color={colors.secondaryForeground} size={15} />
                  </View>
                  <Text style={[styles.resultTitle, { color: colors.foreground, flex: 1 }]}>{address.label}</Text>
                  <Feather name="chevron-right" color={colors.mutedForeground} size={17} />
                </Pressable>
              ))}
            </View>
          )}
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            {ja
              ? '住所を入れると、到着側の駅から目的地までの徒歩時間やタクシー料金も含めて計算します。'
              : 'With an address, LastRide can include the walk from the arrival station and estimate taxis to the exact destination.'}
          </Text>
        </View>

        <Pressable accessibilityRole="button" testID="save-home-station" disabled={!selected || !label.trim()} onPress={continueToRide} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: !selected || !label.trim() ? 0.4 : pressed ? 0.8 : 1 }]}>
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            {initialSetup ? (ja ? 'LastRideをはじめる' : 'Start using LastRide') : (ja ? '帰り先を保存' : 'Save destination')}
          </Text>
          <Feather name="arrow-right" color={colors.primaryForeground} size={19} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 26, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  placeholder: { width: 38 },
  heading: { gap: 11, marginTop: 5 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1.3 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 37, letterSpacing: -1.4, lineHeight: 44 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
  form: { gap: 9 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  labelRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  optional: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  inputWrap: { alignItems: 'center', borderRadius: 18, borderWidth: 1.5, flexDirection: 'row', gap: 11, paddingHorizontal: 15 },
  input: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 16, minHeight: 58 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, paddingHorizontal: 2 },
  resultBox: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  resultRow: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingHorizontal: 14, paddingVertical: 12 },
  resultIcon: { alignItems: 'center', borderRadius: 10, height: 32, justifyContent: 'center', width: 32 },
  resultCopy: { flex: 1, gap: 1 },
  resultTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  resultSub: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  button: { alignItems: 'center', borderRadius: 22, flexDirection: 'row', justifyContent: 'center', minHeight: 64, gap: 10 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
});
