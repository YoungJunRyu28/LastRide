import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, IconButton, SectionLabel, TextButton } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';

import { SUPPORT_EMAIL } from '@/lib/links';

const ODPT_URL = 'https://www.odpt.org/';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/deed.ja';
const APPLE_LEGAL_URL = 'https://gspe21-ssl.ls.apple.com/html/attribution.html';
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/**
 * Data sources and the notices their licences require. ODPT's 公共交通オープン
 * データ基本ライセンス needs the source, a no-guarantee statement and the app's
 * own contact; Toei's data is CC BY 4.0 and needs a credit. See
 * docs/last-train-engine.md for the operator/licence table.
 */
export default function DataSourcesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language !== 'en';
  const open = (url: string) => void WebBrowser.openBrowserAsync(url);

  const section = (label: string, paragraphs: string[], link?: { label: string; url: string }) => (
    <View style={styles.section}>
      <SectionLabel>{label}</SectionLabel>
      <Card style={styles.card}>
        {paragraphs.map((text) => (
          <Text key={text} style={[styles.body, { color: colors.foreground }]}>
            {text}
          </Text>
        ))}
        {link ? (
          <View style={styles.linkRow}>
            <TextButton label={`${link.label} ↗`} onPress={() => open(link.url)} />
          </View>
        ) : null}
      </Card>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 12), paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.topbar}>
          <IconButton icon="chevron-left" label={ja ? '戻る' : 'Back'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {ja ? 'データとライセンス' : 'Data & licences'}
          </Text>
          <View style={styles.spacer} />
        </View>

        {section(
          ja ? '公共交通データ' : 'Public transport data',
          ja
            ? [
                'このアプリで使用している公共交通データ（東京メトロ、都営地下鉄、つくばエクスプレス、りんかい線、多摩モノレール、横浜市営地下鉄）は、公共交通オープンデータセンターにおいて提供されるものです。',
                '公共交通事業者により提供されたデータを元にしていますが、必ずしも正確・完全なものとは限りません。本アプリの表示内容について、公共交通事業者への直接の問い合わせは行わないでください。',
                `本アプリに関するお問い合わせ：${SUPPORT_EMAIL}`,
              ]
            : [
                'Timetables for Tokyo Metro, Toei Subway, Tsukuba Express, Rinkai Line, Tama Monorail and Yokohama Municipal Subway come from the Public Transportation Open Data Center (公共交通オープンデータセンター).',
                'The data is provided by the operators, but its accuracy and completeness are not guaranteed. Please do not contact the rail operators about anything shown in this app.',
                `Questions about this app: ${SUPPORT_EMAIL}`,
              ],
          { label: ja ? '公共交通オープンデータセンター' : 'Open Data Center', url: ODPT_URL },
        )}

        {section(
          ja ? '東京都交通局' : 'Bureau of Transportation, Tokyo',
          ja
            ? ['都営地下鉄のデータは、東京都交通局が クリエイティブ・コモンズ 表示 4.0 国際 ライセンス（CC BY 4.0）で提供するものを加工して利用しています。']
            : ['Toei Subway data: © 東京都交通局 (Bureau of Transportation, Tokyo Metropolitan Government), used and adapted under the Creative Commons Attribution 4.0 licence (CC BY 4.0).'],
          { label: 'CC BY 4.0', url: CC_BY_URL },
        )}

        {section(
          'Apple Maps',
          ja
            ? [
                '地図、徒歩時間、周辺の施設、JR・私鉄などの時刻はApple Mapsのデータです。',
                '「目安」と表示された時刻は、電車か徒歩かを確認できなかった推定です。乗換案内アプリでも確認してください。',
              ]
            : [
                'Maps, walking times, nearby places, and times for JR and private railways come from Apple Maps.',
                'Times marked “approx.” are estimates that couldn’t be confirmed as a train. Please double-check them.',
              ],
          { label: ja ? 'Apple Mapsの法的情報' : 'Apple Maps legal notices', url: APPLE_LEGAL_URL },
        )}

        {section(
          'OpenStreetMap',
          ja
            ? ['駅名の英語表記（日本語との対応）は、OpenStreetMapのデータを利用しています。© OpenStreetMap contributors（ODbL）。']
            : ['English station names (and their Japanese pairs) use OpenStreetMap data. © OpenStreetMap contributors, available under the Open Database Licence (ODbL).'],
          { label: '© OpenStreetMap contributors', url: OSM_COPYRIGHT_URL },
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 20, paddingHorizontal: 20 },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  spacer: { width: 44 },
  title: { fontSize: 17, fontWeight: '800' },
  section: { gap: 8 },
  card: { borderWidth: 1, gap: 10, padding: 16 },
  body: { fontSize: 14, lineHeight: 22 },
  linkRow: { alignItems: 'flex-start', marginLeft: -12 },
});
