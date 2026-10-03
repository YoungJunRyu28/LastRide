import {
  createEnterpriseEventInvite,
  getEnterpriseEvent,
  updateEnterpriseEvent,
  type EnterpriseEventDetail,
} from "@workspace/api-client-react";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import { businessEnabled } from "@/lib/features";
import { enterpriseRequestOptions } from "@/lib/enterpriseHostAuth";
import { Feather } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-native-qrcode-svg";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type InviteView = {
  token: string;
  code: string;
  expiresAt?: string;
};

function formatLeaveTime(value: string | null, ja: boolean): string {
  if (!value) return ja ? "計算待ち" : "Waiting";
  return new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !ja,
  }).format(new Date(value));
}

function joinLink(token: string): string {
  const configured = process.env.EXPO_PUBLIC_APP_JOIN_BASE_URL?.replace(
    /\/+$/,
    "",
  );
  const base = configured ? `${configured}/join` : "last-ride://join";
  return `${base}?token=${encodeURIComponent(token)}`;
}

function BusinessEventScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language === "ja";
  const params = useLocalSearchParams<{
    id?: string;
    code?: string;
    token?: string;
  }>();
  const eventId = typeof params.id === "string" ? params.id : "";
  const [event, setEvent] = useState<EnterpriseEventDetail | null>(null);
  const [invite, setInvite] = useState<InviteView | null>(
    typeof params.code === "string" && typeof params.token === "string"
      ? { code: params.code, token: params.token }
      : null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (silent = false) => {
      if (!eventId) return;
      if (!silent) setLoading(true);
      try {
        const options = await enterpriseRequestOptions();
        const next = await getEnterpriseEvent(eventId, options);
        setEvent(next);
        setError(null);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) {
          router.replace("/business");
          return;
        }
        setError(
          ja
            ? "イベント情報を更新できませんでした。"
            : "Couldn’t refresh the event.",
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [eventId, ja],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const startPolling = () => {
      stopPolling();
      void refresh(true);
      timer = setInterval(() => void refresh(true), 15_000);
    };

    void refresh();
    if (AppState.currentState === "active") startPolling();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") startPolling();
      else stopPolling();
    });
    return () => {
      stopPolling();
      subscription.remove();
    };
  }, [refresh]);

  const activeParticipants = useMemo(
    () =>
      (event?.participants ?? [])
        .filter((participant) => participant.status === "active")
        .sort((a, b) => {
          if (!a.leaveBy && !b.leaveBy) {
            return a.displayName.localeCompare(b.displayName);
          }
          if (!a.leaveBy) return 1;
          if (!b.leaveBy) return -1;
          return Date.parse(a.leaveBy) - Date.parse(b.leaveBy);
        }),
    [event?.participants],
  );

  const rotateInvite = async () => {
    if (!eventId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const options = await enterpriseRequestOptions();
      const next = await createEnterpriseEventInvite(eventId, options);
      setInvite({
        token: next.inviteToken,
        code: next.joinCode,
        expiresAt: next.expiresAt,
      });
    } catch {
      setError(
        ja
          ? "新しい参加コードを作成できませんでした。"
          : "Couldn’t create a new join code.",
      );
    } finally {
      setBusy(false);
    }
  };

  const shareInvite = async () => {
    if (!invite || !event) return;
    const link = joinLink(invite.token);
    const message = ja
      ? `「${event.title}」にLastRideで参加してください。\n参加コード: ${invite.code}\n${link}`
      : `Join ${event.title} on LastRide.\nJoin code: ${invite.code}\n${link}`;
    await Share.share({ message });
  };

  const closeEvent = async () => {
    if (!eventId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const options = await enterpriseRequestOptions();
      await updateEnterpriseEvent(eventId, { status: "closed" }, options);
      await refresh(true);
      setInvite(null);
    } catch {
      setError(
        ja ? "イベントを終了できませんでした。" : "Couldn’t close the event.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!eventId) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <Text style={{ color: colors.destructive }}>
          {ja ? "イベントIDがありません。" : "Missing event ID."}
        </Text>
      </View>
    );
  }

  if (loading && !event) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 30 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Feather name="arrow-left" size={21} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>
            {ja ? "幹事モード" : "Organizer"}
          </Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            LASTRIDE FOR BUSINESS
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {event?.title ?? ""}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {activeParticipants.length}/{event?.participantLimit ?? 0}{" "}
              {ja ? "人参加中" : "currently joined"}
            </Text>
            <Text
              style={[
                styles.status,
                {
                  color:
                    event?.status === "active"
                      ? colors.primary
                      : colors.mutedForeground,
                },
              ]}
            >
              {event?.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {event?.status === "active" && (
          <View
            style={[
              styles.inviteCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.inviteHeader}>
              <View style={styles.inviteCopy}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  {ja ? "参加者を招待" : "Invite participants"}
                </Text>
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  {invite
                    ? ja
                      ? "このコードまたはリンクを共有してください。"
                      : "Share this code or link with the group."
                    : ja
                      ? "新しい参加コードを発行します。以前のコードは無効になります。"
                      : "Generate a new join code. Any previous invite will be revoked."}
                </Text>
              </View>
              <Feather name="users" size={21} color={colors.primary} />
            </View>

            {invite ? (
              <>
                <View style={styles.qrWrap}>
                  <QRCode
                    value={joinLink(invite.token)}
                    size={180}
                    quietZone={8}
                    backgroundColor="#FFFFFF"
                    color="#000000"
                  />
                </View>
                <Text style={[styles.code, { color: colors.foreground }]}>
                  {invite.code}
                </Text>
                <Text
                  selectable
                  numberOfLines={2}
                  style={[styles.link, { color: colors.mutedForeground }]}
                >
                  {joinLink(invite.token)}
                </Text>
                <View style={styles.buttonRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void shareInvite()}
                    style={[
                      styles.primaryButton,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Feather
                      name="share"
                      size={16}
                      color={colors.primaryForeground}
                    />
                    <Text
                      style={[
                        styles.primaryButtonText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {ja ? "共有" : "Share"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void rotateInvite()}
                    style={[
                      styles.secondaryButton,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: colors.foreground },
                      ]}
                    >
                      {ja ? "コード更新" : "Rotate"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void rotateInvite()}
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {ja ? "参加コードを発行" : "Generate join code"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={styles.rosterHeader}>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {ja ? "参加者" : "Participants"}
            </Text>
            <Text
              style={[styles.rosterHint, { color: colors.mutedForeground }]}
            >
              {ja
                ? "表示名と出発時刻のみ"
                : "Display name and leave-by time only"}
            </Text>
          </View>
          <Pressable onPress={() => void refresh()} accessibilityRole="button">
            <Feather
              name="refresh-cw"
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>
        </View>

        <View
          style={[
            styles.roster,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.rosterLabels}>
            <Text
              style={[styles.columnLabel, { color: colors.mutedForeground }]}
            >
              {ja ? "名前" : "NAME"}
            </Text>
            <Text
              style={[styles.columnLabel, { color: colors.mutedForeground }]}
            >
              {ja ? "出発" : "LEAVE"}
            </Text>
          </View>
          {activeParticipants.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {ja ? "まだ参加者はいません。" : "No participants yet."}
            </Text>
          ) : (
            activeParticipants.map((participant, index) => (
              <View key={participant.id}>
                {index > 0 && (
                  <View
                    style={[styles.divider, { backgroundColor: colors.border }]}
                  />
                )}
                <View style={styles.participantRow}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.participantName,
                      { color: colors.foreground },
                    ]}
                  >
                    {participant.displayName}
                  </Text>
                  <Text
                    style={[
                      styles.participantTime,
                      {
                        color: participant.leaveBy
                          ? colors.foreground
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {formatLeaveTime(participant.leaveBy, ja)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View
          style={[
            styles.privacy,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          <Feather name="shield" size={19} color={colors.primary} />
          <Text
            style={[styles.body, { color: colors.mutedForeground, flex: 1 }]}
          >
            {ja
              ? "LastRide for Business は参加者の現在地・自宅・駅・経路を幹事画面に表示しません。"
              : "LastRide for Business never exposes a participant’s location, home, station, or route to the organizer."}
          </Text>
        </View>

        {event?.status === "active" && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void closeEvent()}
            style={[styles.closeButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.closeText, { color: colors.destructive }]}>
              {ja ? "イベントを終了" : "Close event"}
            </Text>
          </Pressable>
        )}

        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, gap: 18 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  backText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  heading: { gap: 7, marginTop: 6 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1.1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 31, letterSpacing: -1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  meta: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13 },
  status: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.6 },
  inviteCard: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 13 },
  qrWrap: { alignItems: "center", paddingVertical: 4 },
  inviteHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  inviteCopy: { flex: 1, gap: 4 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  code: {
    fontFamily: "Inter_700Bold",
    fontSize: 34,
    letterSpacing: 5,
    textAlign: "center",
    marginTop: 2,
  },
  link: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  buttonRow: { flexDirection: "row", gap: 10 },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 7,
    flex: 1,
  },
  primaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  rosterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  rosterHint: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  roster: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  rosterLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: 7,
  },
  columnLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.9 },
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 17,
    paddingVertical: 14,
    gap: 16,
  },
  participantName: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  participantTime: { fontFamily: "Inter_700Bold", fontSize: 16 },
  divider: { height: 1, marginHorizontal: 17 },
  empty: { fontFamily: "Inter_400Regular", fontSize: 13, padding: 18 },
  privacy: {
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    padding: 15,
  },
  closeButton: {
    minHeight: 48,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  error: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
});

/** Business can be switched off per build (lib/features.ts); links then land on home. */
export default function BusinessEventScreenRoute() {
  if (!businessEnabled) return <Redirect href="/" />;
  return <BusinessEventScreen />;
}
