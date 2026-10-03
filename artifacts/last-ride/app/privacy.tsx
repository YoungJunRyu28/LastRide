import { PressableIcon, RailwayMark } from "@/components/RideUI";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import { router } from "expo-router";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Kept in step with PRIVACY.md at the repo root; this is the short version users see. */
function copy(ja: boolean) {
  return ja
    ? {
        title: "プライバシー",
        intro:
          "通常のLastRideはアカウントなしで使えます。法人向け機能では幹事のみログインし、参加者はアカウント不要です。データを広告目的で利用したり販売したりすることはありません。",
        sections: [
          {
            heading: "通常のLastRide",
            body: "現在地、保存した帰り先の最寄り駅（設定した場合は住所も）、言語・歩くペース・リマインダーなどを使って移動プランを計算します。帰り先と個人設定、夜ごとのプラン時刻の履歴は端末内に保存されます。履歴はGPSの移動軌跡ではありません。",
          },
          {
            heading: "飲み会に参加するとき",
            body: "幹事に共有されるのは、あなたが入力した表示名とLastRideが計算した出発時刻だけです。現在地、自宅、最寄り駅、経路、目的地、歩くペースは法人イベントのデータとして保存・表示されません。",
          },
          {
            heading: "法人イベントの保存期間",
            body: "イベントから退出すると、表示名・出発時刻・参加用トークンはサーバーから直ちに削除されます。退出しない場合も、イベント終了時刻になると自動削除されます。通常、夜のイベントは翌朝8時（日本時間）に期限切れになります。",
          },
          {
            heading: "幹事アカウント",
            body: "幹事の法人ログインではメールアドレスを使います。設定されている場合、認証はSupabaseが処理します。幹事への出発通知のため、端末のプッシュ通知トークンを保存し、ExpoおよびApple/Googleの通知サービスを利用します。",
          },
          {
            heading: "位置情報と外部サービス",
            body: "経路計算に必要な位置・駅情報は駅すぱあと API、NAVITIME JAPAN（RapidAPI経由）へ送信されます。開発・明示的なテストビルドでは補助的にOpenStreetMap系サービスを利用する場合があります。法人イベント参加者の表示名がこれらの交通・地図サービスへ送られることはありません。",
          },
          {
            heading: "クラッシュレポート",
            body: "アプリの不具合を直すため、エラー内容・アプリのバージョン・端末とOSの機種をSentryに送信することがあります。位置情報、帰り先、駅、検索内容、表示名、参加リンクは含まれません。",
          },
        ],
        more: "詳細はリポジトリの PRIVACY.md をご覧ください。",
      }
    : {
        title: "Privacy",
        intro:
          "Personal LastRide works without an account. In LastRide for Business, only organizers sign in; participants still do not need an account. We do not sell data or use it for advertising.",
        sections: [
          {
            heading: "Personal LastRide",
            body: "Your location, saved destinations and their nearest stations (plus an address if you add one), language, walking pace and reminder settings are used to calculate your trip. Destinations, personal settings and a per-night summary of plan times stay on your device. History is not a GPS trail.",
          },
          {
            heading: "When you join a group",
            body: "The organizer only receives the display name you enter and the leave-by time LastRide calculates. Your location, home, station, route, destination and walking pace are not stored in or shown through the Business event.",
          },
          {
            heading: "Business-event retention",
            body: "Leaving a group immediately deletes your participant record, including your display name, leave time and participant token. Otherwise it is automatically deleted when the event expires, normally at 8:00 AM Japan time the following morning.",
          },
          {
            heading: "Organizer accounts",
            body: "Business organizers sign in with a work email. When configured, Supabase handles authentication. To send organizer departure alerts, LastRide stores the device push token and uses Expo plus Apple or Google notification services.",
          },
          {
            heading: "Location and providers",
            body: "Location and station data needed for routing can be sent to 駅すぱあと API and NAVITIME JAPAN (via RapidAPI). Development or explicitly opted-in test builds may also use OpenStreetMap-based fallback services. Your Business display name is not sent to those transit or mapping providers.",
          },
          {
            heading: "Crash reports",
            body: "To fix bugs, the app may send the error, app version and device/OS model to Sentry. Reports never include your location, destinations, stations, searches, display name or join links.",
          },
        ],
        more: "The full policy is in PRIVACY.md in the project repository.",
      };
}

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const text = copy(language === "ja");

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12),
            paddingBottom: 40,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <PressableIcon
            icon="arrow-left"
            label={language === "ja" ? "戻る" : "Back"}
            onPress={() => router.back()}
            testID="privacy-back"
          />
          <RailwayMark size={22} />
          <View style={styles.spacer} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {text.title}
        </Text>
        <Text style={[styles.intro, { color: colors.foreground }]}>
          {text.intro}
        </Text>
        {text.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={[styles.heading, { color: colors.foreground }]}>
              {section.heading}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {section.body}
            </Text>
          </View>
        ))}
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {text.more}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, paddingHorizontal: 20 },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  spacer: { width: 38 },
  title: { fontFamily: "Inter_700Bold", fontSize: 32, letterSpacing: -1.2 },
  intro: { fontFamily: "Inter_500Medium", fontSize: 15, lineHeight: 23 },
  section: { gap: 6 },
  heading: { fontFamily: "Inter_700Bold", fontSize: 15 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
});
