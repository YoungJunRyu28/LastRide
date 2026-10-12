import { IconButton } from "@/components/ui";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import { router } from "expo-router";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SUPPORT_EMAIL } from "@/lib/links";

/** The short version users see; the full policy is site/privacy/index.html and site/en/privacy/index.html (lastride.jp/privacy). Keep them in step. */
function copy(ja: boolean) {
  return ja
    ? {
        title: "プライバシー",
        updated: "最終更新：2026年10月12日",
        intro:
          "LastRideはアカウントなしで使えます。データを広告目的で利用したり、販売したりすることはありません。",
        sections: [
          {
            heading: "端末に保存するもの",
            body: "保存した帰り先（駅の名前と地域、設定した場合は住所の文字列。地図上の位置は長期保存せず、その夜だけ調べ直します）、「今夜だけ別の場所へ」の駅（翌日に自動で消去）、言語・余裕・通知などの設定、今夜のプランです。今夜のプランは夜が終わると削除または次の夜のものに置き換わります。移動履歴や過去の夜の記録は保存しません。",
          },
          {
            heading: "位置情報",
            body: "近くの駅と徒歩時間を調べ、出発時刻を計算するために使います。夜のトラッキングで「閉じても更新」を選んだ場合だけ、アプリを閉じている間も位置情報を使い、終電後（遅くとも午前4時）に自動で止まります。「アプリ使用中のみ」はいつでも設定から選べます。",
          },
          {
            heading: "地図と時刻のデータ",
            body: "iPhoneでは、近くの駅・徒歩時間・住所・周辺の施設・タクシーの所要時間、JRや私鉄の時刻をApple Mapsで調べるため、位置情報と検索内容がApple（Appleのプライバシーポリシーに従う）へ送信されます。地下鉄などの時刻は当社サーバーが公共交通オープンデータセンターのデータで計算するため、出発駅と到着駅（名前と位置）が当社サーバーへ送信されます。Androidでは、近くの駅を探すために位置情報も当社サーバーへ送信されます。これらは計算に使うだけで、アカウントや個人に結びつけて保存しません。",
          },
          {
            heading: "グループ",
            body: "グループに参加すると、当社サーバーにはグループ名、あなたがグループごとに決めた表示名、ホストかメンバーか、通知の言語とオン・オフ、通知用のプッシュトークン、ランダムな参加用トークン（元に戻せない形で保存）が保存されます。「今夜参加する」を選んだ夜は、出発時刻（と「乗り遅れた」の連絡）だけが送られ、メンバーには表示名と出発時刻が見えます。現在地・自宅・駅・経路は共有されません。出発時刻は翌朝8時（日本時間）か、ホストが今夜を終了した時点で削除されます。グループから退出すると、あなたの参加データはすぐに削除されます。ホストがグループを解散すると、すべて削除されます。",
          },
          {
            heading: "プレミアム",
            body: "購入と請求はApple（Androidの場合はGoogle）が行い、当社がカード情報などを受け取ることはありません。購読状態の管理にRevenueCatを使い、アカウント名やメールアドレスではなく、匿名のユーザーIDで管理します。グループを作るとき、当社サーバーはこのIDで購読状態を確認しますが、IDを保存しません。",
          },
          {
            heading: "ウィジェットとロック画面",
            body: "ウィジェットとロック画面のカウントダウン（ライブアクティビティ、Androidは通知）は、今夜の出発時刻を端末の中だけで表示します。当社に送信されることはありません。",
          },
          {
            heading: "通知",
            body: "出発のリマインダーは端末の中で予約されます。グループの通知（今夜の開始、メンバーの出発時刻、乗り遅れた）は、Expoのプッシュ配信とApple・Googleの通知サービスを通じて届きます。通知に広告は含まれません。",
          },
          {
            heading: "法人向けイベント",
            body: "法人向けイベントに招待リンクから参加した場合も、共有されるのは表示名と出発時刻だけで、イベント終了時（通常は翌朝8時）に削除されます。",
          },
          {
            heading: "クラッシュレポート",
            body: "アプリの不具合を直すため、エラー内容・アプリのバージョン・端末とOSの機種をSentryに送信することがあります。位置情報、帰り先、駅、検索内容、表示名、招待リンクは含まれず、90日後に削除されます。",
          },
          {
            heading: "削除とお問い合わせ",
            body: `設定の「最初からやり直す」で端末のデータを消去できます。グループからの退出はグループの「…」から行えます。プライバシーに関するお問い合わせ：${SUPPORT_EMAIL}`,
          },
        ],
      }
    : {
        title: "Privacy",
        updated: "Last updated: 12 October 2026",
        intro:
          "LastRide works without an account. We do not sell your data or use it for advertising.",
        sections: [
          {
            heading: "Stored on your phone",
            body: "Your saved destinations (the station’s name and area, plus an address’s text if you add one — map positions aren’t kept long-term but looked up again for the night), a “tonight only” station (cleared the next day), your language, time-to-spare, reminder and other settings, and tonight’s plan, which is deleted or replaced once the night is over. LastRide keeps no movement history or record of past nights.",
          },
          {
            heading: "Location",
            body: "Used to find nearby stations and walking times and to work out when to leave. Only if you choose “Update when closed” for night tracking is location used while the app is closed, and tracking stops by itself after the last train (by 4:00 AM at the latest). You can switch to “Only while using the app” in Settings at any time.",
          },
          {
            heading: "Map and timetable data",
            body: "On iPhone, nearby stations, walking times, addresses, nearby places, taxi times, and JR and private-railway times come from Apple Maps, so your location and searches are sent to Apple (under Apple’s privacy policy). Subway times are calculated by our server from Public Transportation Open Data Center data, so the departure and arrival stations (names and positions) are sent to our server. On Android your location is also sent to our server to find nearby stations. These are used for the calculation only and are not stored against you.",
          },
          {
            heading: "Groups",
            body: "When you join a group, our server stores the group name, the display name you choose for that group, whether you’re the host or a member, your notification language and on/off setting, a push token for notifications, and a random membership token (stored one-way). On nights you choose “Join tonight”, only your leave-by time (and a “missed it” report) is sent, and members see your display name and leave-by time. Your location, home, station and route are never shared. Leave-by times are deleted at 8:00 AM Japan time the next morning, or when the host ends tonight. Leaving a group deletes your membership right away; disbanding a group deletes everything in it.",
          },
          {
            heading: "Premium",
            body: "Purchases and billing are handled by Apple (or Google on Android); we never receive your card details. Subscription status is managed with RevenueCat using an anonymous user ID, not your name or email. When you create a group, our server checks your subscription with that ID but does not store it.",
          },
          {
            heading: "Widgets and lock screen",
            body: "Widgets and the lock-screen countdown (Live Activity, or a notification on Android) show tonight’s leave time from data on your phone. Nothing is sent to us for them.",
          },
          {
            heading: "Notifications",
            body: "Leave reminders are scheduled on your phone. Group notifications (tonight started, a member’s leave time, missed it) are delivered through Expo’s push service and Apple’s or Google’s notification services. Notifications never contain advertising.",
          },
          {
            heading: "Business events",
            body: "If you join a business event from an invite link, only your display name and leave-by time are shared, and they are deleted when the event ends (normally 8:00 AM the next morning).",
          },
          {
            heading: "Crash reports",
            body: "To fix bugs, the app may send the error, app version and device/OS model to Sentry. Reports never include your location, destinations, stations, searches, display name or invite links, and are deleted after 90 days.",
          },
          {
            heading: "Deleting your data and contact",
            body: `Use “Reset & start over” in Settings to erase LastRide’s data on your phone. Leave a group from its “…” menu. Privacy questions: ${SUPPORT_EMAIL}`,
          },
        ],
      };
}

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language !== "en";
  const text = copy(ja);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 24 : 12),
            paddingBottom: insets.bottom + 40,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <IconButton
            icon="chevron-left"
            label={ja ? "戻る" : "Back"}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))}
            testID="privacy-back"
          />
          <Text accessibilityRole="header" style={[styles.barTitle, { color: colors.foreground }]}>
            {text.title}
          </Text>
          <View style={styles.spacer} />
        </View>
        <Text style={[styles.intro, { color: colors.foreground }]}>{text.intro}</Text>
        {text.sections.map((section) => (
          <View key={section.heading} style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.heading, { color: colors.foreground }]}>{section.heading}</Text>
            <Text style={[styles.body, { color: colors.subtle }]}>{section.body}</Text>
          </View>
        ))}
        <Text style={[styles.updated, { color: colors.mutedForeground }]}>{text.updated}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, paddingHorizontal: 20 },
  topbar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  spacer: { width: 44 },
  barTitle: { fontSize: 17, fontWeight: "800" },
  intro: { fontSize: 15, fontWeight: "600", lineHeight: 23 },
  section: { borderRadius: 18, borderWidth: 1, gap: 6, padding: 16 },
  heading: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 13, lineHeight: 20 },
  updated: { fontSize: 12, textAlign: "center" },
});
