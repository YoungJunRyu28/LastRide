import { OnboardingFrame, OnboardingHeading, SETUP_STEPS } from '@/components/Onboarding';
import { IconButton, PrimaryButton } from '@/components/ui';
import { searchAddresses, searchStations, StationOption, useLastRide, type HomeAddress } from '@/context/LastRideContext';
import { FREE_DESTINATIONS, usePremium } from '@/context/PremiumContext';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Station search, in three modes:
 * - setup (1/3 of onboarding): station and optional address, saved as "Home";
 * - tonight (`?tonight=1`): a station for tonight only, not saved;
 * - add (`?new=1`) / edit (`?id=`): a saved destination with its own name.
 */
export default function HomeStationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; new?: string; setup?: string; tonight?: string }>();
  const { language, homeStationOption, homeAddress, destinations, activeDestinationId, saveDestination, setTonightDestination, resetLanguage } = useLastRide();
  const ja = language === 'ja';
  const tonight = params.tonight === '1';
  const isNew = params.new === '1';
  const requestedId = typeof params.id === 'string' ? params.id : null;
  const setup = !tonight && (params.setup === '1' || (destinations.length === 0 && !isNew && !requestedId));
  const editingId = tonight || isNew ? null : requestedId ?? activeDestinationId;
  const editingDestination = destinations.find((destination) => destination.id === editingId) ?? null;
  const initialStation = tonight ? null : editingDestination?.station ?? (setup ? homeStationOption : null);
  const initialAddress = tonight ? null : editingDestination?.address ?? (setup ? homeAddress : null);
  const defaultLabel = ja ? '自宅' : 'Home';
  const [label, setLabel] = useState(editingDestination?.label ?? (setup ? defaultLabel : ''));
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
  const { isPremium, ready: premiumReady } = usePremium();

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

  const canSave = !!selected && (setup || tonight || !!label.trim());

  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!selected || !canSave || saving) return;
    if (tonight) {
      setTonightDestination(selected);
      router.dismissTo('/ride');
      return;
    }
    // Saving looks the station up on our server first (see lib/savedStation), so wait for it.
    setSaving(true);
    await saveDestination({
      ...(editingId ? { id: editingId } : {}),
      label: setup ? editingDestination?.label ?? defaultLabel : label.trim(),
      station: selected,
      address: selectedAddress,
    });
    setSaving(false);
    if (setup) router.replace('/onboarding-notifications');
    else router.dismissTo('/ride');
  };

  const back = () => {
    if (setup) {
      // Clear the language choice first — otherwise the welcome screen redirects right back here.
      resetLanguage();
      router.replace('/');
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/ride');
    }
  };

  const stationField = (
    <View style={styles.form}>
      <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '最寄り駅' : 'Nearest station'}</Text>
      <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.input }]}>
        <Feather name="search" color={colors.mutedForeground} size={19} />
        <TextInput
          accessibilityLabel={ja ? '最寄り駅' : 'Nearest station'}
          testID="home-station-input"
          autoFocus={setup || tonight}
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
            <Pressable
              accessibilityRole="button"
              key={`${station.nameJa}-${station.latitude}-${station.longitude}`}
              testID={`station-result-${index}`}
              onPress={() => pickStation(station)}
              style={({ pressed }) => [styles.resultRow, { borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
            >
              <View style={[styles.resultIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="map-pin" color={colors.foreground} size={15} />
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
      {searchError && <Text style={[styles.helper, { color: colors.destructive }]}>{ja ? '検索に失敗しました。もう一度お試しください。' : 'Search failed. Please try again.'}</Text>}
      {!searchError && !selected && query.trim().length >= 2 && !isSearching && results.length === 0 && (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>{ja ? '駅が見つかりませんでした。漢字やかなでも検索してみてください。' : 'No stations found. Try the station’s Japanese name, e.g. 渋谷.'}</Text>
      )}
    </View>
  );

  const addressField = (
    <View style={styles.form}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '住所' : 'Address'}</Text>
        <Text style={[styles.optional, { color: colors.mutedForeground }]}>{ja ? '（任意 · 駅から家までの徒歩も計算）' : 'optional · adds the walk from the station'}</Text>
      </View>
      <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: selectedAddress ? colors.primary : colors.input }]}>
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
            <Pressable
              accessibilityRole="button"
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
                <Feather name="home" color={colors.foreground} size={15} />
              </View>
              <Text style={[styles.resultTitle, { color: colors.foreground, flex: 1 }]}>{address.label}</Text>
              <Feather name="chevron-right" color={colors.mutedForeground} size={17} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  // Saving another destination is premium; the free plan keeps one (deep links included).
  if (isNew && premiumReady && !isPremium && destinations.length >= FREE_DESTINATIONS) return <Redirect href="/paywall" />;

  if (setup) {
    return (
      <OnboardingFrame
        step={SETUP_STEPS.destination}
        backLabel={ja ? '戻る' : 'Back'}
        onBack={back}
        actions={<PrimaryButton label={ja ? '次へ' : 'Next'} icon="arrow-right" onPress={() => void save()} disabled={!canSave || saving} testID="save-home-station" />}
      >
        <OnboardingHeading kicker={ja ? 'まずは帰る場所' : 'WHERE’S HOME'} title={ja ? '自宅の最寄り駅を\n教えてください。' : 'What’s your\nhome station?'} />
        {stationField}
        {addressField}
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
          {ja
            ? `「${editingDestination?.label ?? defaultLabel}」として保存します。名前はあとで変更できます。\n帰り先と設定はこの端末にだけ保存されます。アカウントは不要です。`
            : `Saved as “${editingDestination?.label ?? defaultLabel}”. You can rename it later.\nDestinations and settings stay on this device. No account needed.`}
        </Text>
      </OnboardingFrame>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 8), paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topbar}>
          <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={back} testID="back-to-language" />
        </View>
        <OnboardingHeading
          kicker={tonight ? (ja ? '今夜だけ' : 'TONIGHT ONLY') : isNew ? (ja ? '帰り先を追加' : 'ADD DESTINATION') : (ja ? '帰り先を編集' : 'EDIT DESTINATION')}
          title={tonight ? (ja ? '今夜はどこへ\n帰りますか？' : 'Where are you\nheading tonight?') : isNew ? (ja ? '帰り先を\n追加します。' : 'Add somewhere\nyou might go.') : (ja ? '帰り先を\n編集します。' : 'Edit this\ndestination.')}
          lead={tonight ? (ja ? '保存せずに今夜だけ使います。明日はいつもの帰り先に戻ります。' : 'Used tonight only and not saved. Tomorrow you’re back to your usual destination.') : undefined}
        />
        {!tonight && (
          <View style={styles.form}>
            <Text style={[styles.label, { color: colors.foreground }]}>{ja ? '名前' : 'Name'}</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: label.trim() ? colors.primary : colors.input }]}>
              <Feather name="bookmark" color={colors.mutedForeground} size={19} />
              <TextInput
                accessibilityLabel={ja ? '名前' : 'Name'}
                testID="destination-label-input"
                autoFocus
                value={label}
                onChangeText={setLabel}
                maxLength={40}
                placeholder={ja ? '例：実家、会社、友人宅' : 'e.g. Work, Parents’ place'}
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground }]}
                returnKeyType="next"
              />
            </View>
          </View>
        )}
        {stationField}
        {!tonight && addressField}
        <PrimaryButton
          label={tonight ? (ja ? '今夜はここへ帰る' : 'Head here tonight') : ja ? '帰り先を保存' : 'Save destination'}
          icon="arrow-right"
          onPress={() => void save()}
          disabled={!canSave || saving}
          testID="save-home-station"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 24, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row' },
  form: { gap: 9 },
  label: { fontSize: 14, fontWeight: '700' },
  labelRow: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optional: { fontSize: 12 },
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
