import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, IconButton, SectionLabel, TextButton } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { useColors } from '@/hooks/useColors';

import { SUPPORT_EMAIL } from '@/lib/links';
import { STATION_POINTS_YEAR } from '@/lib/stationPointsData';

const ODPT_URL = 'https://www.odpt.org/';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/deed.ja';
const APPLE_LEGAL_URL = 'https://gspe21-ssl.ls.apple.com/html/attribution.html';
const GOOGLE_MAPS_TERMS_URL = 'https://www.google.com/help/terms_maps/';
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const STATION_NAMES_SOURCE_URL = 'https://github.com/nicknr100/LastRide/tree/main/artifacts/last-ride/scripts';
const KSJ_RAILWAY_URL = `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-${STATION_POINTS_YEAR}.html`;

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

        {Platform.OS === 'android'
          ? section(
              'Google Maps',
              ja
                ? [
                    'Android版の地図表示にはGoogle マップを使用しています。駅や徒歩時間、列車の時刻は、利用できる経路サービスや当社サーバーの交通データを使って調べます。路線や地域によって取得できないことがあります。',
                    '「目安」と表示された時刻は推定値です。実際の終電・乗換時刻は交通事業者の公式情報でも確認してください。',
                  ]
                : [
                    'On Android, maps are displayed using Google Maps. Stations, walking times and train schedules are looked up using available routing services and LastRide’s transit API. Coverage varies by area and route.',
                    'Times marked “approx.” are estimates. Confirm actual last-train times with official operators.',
                  ],
              { label: ja ? 'Google マップの利用規約' : 'Google Maps terms', url: GOOGLE_MAPS_TERMS_URL },
            )
          : section(
              'Apple Maps',
              ja
                ? [
                    '地図、徒歩時間、周辺の施設、JR・私鉄などの時刻はApple Mapsのデータです。',
                    '「目安」と表示された時刻は、電車か徒歩かを確認できなかった推定です。乗換案内アプリでも確認を。',
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

        {/* ODbL 4.6: the database made from OSM (the station-name list in the app) is offered under the ODbL too. */}
        {section(
          ja ? 'OpenStreetMapから作成した駅名データ' : 'Station-name data made from OpenStreetMap',
          ja
            ? ['アプリに含まれる駅名の対応表（OpenStreetMapから作成）と、その作成手順（スクリプト）は、Open Database License（ODbL）のもとで公開しています。']
            : ['The station-name table in the app (made from OpenStreetMap) and the script that builds it are available under the Open Database Licence (ODbL).'],
          { label: ja ? 'データと作成手順（GitHub）' : 'Data and build script (GitHub)', url: STATION_NAMES_SOURCE_URL },
        )}

        {section(
          ja ? '国土数値情報' : 'National Land Numerical Information',
          ja
            ? ['駅の一覧（近くの駅が鉄道の駅かどうかの確認）は、「国土数値情報（鉄道データ）」（国土交通省）を加工して作成しています。クリエイティブ・コモンズ 表示 4.0 国際 ライセンス（CC BY 4.0）。']
            : ['The list of railway stations (used to check that a nearby station is a train station) is adapted from 国土数値情報（鉄道データ）, Ministry of Land, Infrastructure, Transport and Tourism, under the Creative Commons Attribution 4.0 licence (CC BY 4.0).'],
          { label: ja ? '国土数値情報（鉄道データ）' : 'Railway data (MLIT)', url: KSJ_RAILWAY_URL },
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
