import {
  createEnterpriseEvent,
  listEnterpriseEvents,
  type EnterpriseEvent,
} from "@workspace/api-client-react";
import {
  enterpriseDevAuthAvailable,
  enterpriseOtpConfigured,
  enterpriseRequestOptions,
  getEnterpriseAccessToken,
  requestEnterpriseOtp,
  signInEnterpriseDev,
  signOutEnterpriseHost,
  verifyEnterpriseOtp,
} from "@/lib/enterpriseHostAuth";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import {
  registerEnterprisePushDevice,
  unregisterEnterprisePushDevice,
} from "@/lib/enterprisePush";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function nextEightAmJst(now = Date.now()): Date {
  const JST = 9 * 60 * 60 * 1000;
  const shifted = new Date(now + JST);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const targetDay = day + (hour >= 8 ? 1 : 0);
  return new Date(Date.UTC(year, month, targetDay, 8, 0, 0) - JST);
}

function formatEventTime(iso: string, ja: boolean): string {
  return new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", {
    timeZone: "Asia/Tokyo",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function BusinessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLastRide();
  const ja = language === "ja";

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [events, setEvents] = useState<EnterpriseEvent[]>([]);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [title, setTitle] = useState("");
  const [alertLead, setAlertLead] = useState("10");
  const [participantLimit, setParticipantLimit] = useState("30");
  const [busy, setBusy] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const options = await enterpriseRequestOptions();
      setEvents(await listEnterpriseEvents(options));
      setError(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) setSignedIn(false);
      setError(
        status === 403
          ? ja
            ? "このアカウントは法人プランに登録されていません。"
            : "This account is not provisioned for LastRide for Business."
          : ja
            ? "イベントを読み込めませんでした。"
            : "Couldn’t load business events.",
      );
    } finally {
      setLoadingEvents(false);
    }
  }, [ja]);

  useEffect(() => {
    void getEnterpriseAccessToken().then((token) => {
      setSignedIn(Boolean(token));
      if (token) {
        void refreshEvents();
        void registerEnterprisePushDevice();
      }
    });
  }, [refreshEvents]);

  const sendOtp = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestEnterpriseOtp(email);
      setOtpSent(true);
    } catch {
      setError(
        ja
          ? "サインインコードを送信できませんでした。"
          : "Couldn’t send the sign-in code.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!email.trim() || !otp.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEnterpriseOtp(email, otp);
      setSignedIn(true);
      setOtp("");
      await refreshEvents();
      void registerEnterprisePushDevice();
    } catch {
      setError(
        ja
          ? "コードが無効か期限切れです。"
          : "That code is invalid or expired.",
      );
    } finally {
      setBusy(false);
    }
  };

  const devSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInEnterpriseDev();
      setSignedIn(true);
      await refreshEvents();
      void registerEnterprisePushDevice();
    } catch {
      setError("Development organizer sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const createTonightEvent = async () => {
    const cleanTitle = title.trim();
    const lead = Number(alertLead);
    const limit = Number(participantLimit);
    if (
      !cleanTitle ||
      !Number.isInteger(lead) ||
      lead < 1 ||
      lead > 120 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      busy
    ) {
      setError(
        ja
          ? "イベント名・通知時間・参加上限を確認してください。"
          : "Check the event name, alert time, and participant limit.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const options = await enterpriseRequestOptions();
      const now = new Date();
      const created = await createEnterpriseEvent(
        {
          title: cleanTitle,
          startsAt: now.toISOString(),
          expiresAt: nextEightAmJst(now.getTime()).toISOString(),
          alertLeadMinutes: lead,
          participantLimit: limit,
        },
        options,
      );
      setTitle("");
      await refreshEvents();
      router.push({
        pathname: "/business-event",
        params: {
          id: created.id,
          code: created.joinCode,
          token: created.inviteToken,
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 403
          ? ja
            ? "このアカウントにはイベント作成権限がありません。"
            : "This account cannot create business events."
          : ja
            ? "イベントを作成できませんでした。"
            : "Couldn’t create the event.",
      );
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    await unregisterEnterprisePushDevice().catch(() => undefined);
    await signOutEnterpriseHost();
    setEvents([]);
    setSignedIn(false);
    setBusy(false);
  };

  if (signedIn === null) {
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
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Feather name="arrow-left" size={21} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>
            {ja ? "戻る" : "Back"}
          </Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            LASTRIDE FOR BUSINESS
          </Text>
          <Text style={[styles.titleText, { color: colors.foreground }]}>
            {ja ? "幹事モード" : "Organizer mode"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {ja
              ? "参加者が帰るタイミングを、空気を壊さず幹事から伝えられます。"
              : "Help people leave on time without making them break the room’s flow."}
          </Text>
        </View>

        {!signedIn ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {!enterpriseOtpConfigured() ? (
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {ja
                  ? "法人サインインはまだサーバー設定されていません。"
                  : "Organizer sign-in has not been configured on this build yet."}
              </Text>
            ) : (
              <>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                  {ja ? "法人メール" : "Work email"}
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="name@company.jp"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                />
                {otpSent && (
                  <>
                    <Text
                      style={[
                        styles.fieldLabel,
                        { color: colors.foreground, marginTop: 14 },
                      ]}
                    >
                      {ja ? "6桁コード" : "Email code"}
                    </Text>
                    <TextInput
                      value={otp}
                      onChangeText={setOtp}
                      keyboardType="number-pad"
                      autoCorrect={false}
                      placeholder="123456"
                      placeholderTextColor={colors.mutedForeground}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    />
                  </>
                )}
                <Pressable
                  disabled={busy}
                  onPress={() => void (otpSent ? verifyOtp() : sendOtp())}
                  style={[
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: busy ? 0.6 : 1,
                    },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text
                      style={[
                        styles.primaryButtonText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {otpSent
                        ? ja
                          ? "コードを確認"
                          : "Verify code"
                        : ja
                          ? "コードを送信"
                          : "Send sign-in code"}
                    </Text>
                  )}
                </Pressable>
              </>
            )}

            {enterpriseDevAuthAvailable() && (
              <Pressable
                disabled={busy}
                onPress={() => void devSignIn()}
                style={[styles.devButton, { borderColor: colors.border }]}
              >
                <Text
                  style={[styles.devText, { color: colors.mutedForeground }]}
                >
                  Development organizer
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {ja ? "今夜の飲み会を作成" : "Create tonight’s event"}
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                maxLength={160}
                placeholder={
                  ja ? "例：営業部 飲み会" : "e.g. Sales team drinks"
                }
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              />
              <View style={styles.inlineFields}>
                <View style={styles.inlineField}>
                  <Text
                    style={[
                      styles.smallLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {ja ? "通知（分前）" : "Alert (min)"}
                  </Text>
                  <TextInput
                    value={alertLead}
                    onChangeText={setAlertLead}
                    keyboardType="number-pad"
                    style={[
                      styles.smallInput,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </View>
                <View style={styles.inlineField}>
                  <Text
                    style={[
                      styles.smallLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {ja ? "参加上限" : "Participant cap"}
                  </Text>
                  <TextInput
                    value={participantLimit}
                    onChangeText={setParticipantLimit}
                    keyboardType="number-pad"
                    style={[
                      styles.smallInput,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </View>
              </View>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {ja
                  ? "参加者データは翌朝8:00（日本時間）に自動削除されます。"
                  : "Participant data automatically expires at 8:00 AM Japan time."}
              </Text>
              <Pressable
                disabled={busy}
                onPress={() => void createTonightEvent()}
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
                  {ja ? "イベントを作成" : "Create event"}
                </Text>
              </Pressable>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {ja ? "イベント" : "Events"}
              </Text>
              <Pressable
                onPress={() => void refreshEvents()}
                disabled={loadingEvents}
              >
                <Feather
                  name="refresh-cw"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>

            {loadingEvents && events.length === 0 ? (
              <ActivityIndicator color={colors.primary} />
            ) : events.length === 0 ? (
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {ja ? "まだイベントがありません。" : "No events yet."}
              </Text>
            ) : (
              events.map((event) => (
                <Pressable
                  key={event.id}
                  onPress={() =>
                    router.push({
                      pathname: "/business-event",
                      params: { id: event.id },
                    })
                  }
                  style={[
                    styles.eventRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.eventCopy}>
                    <Text
                      style={[styles.eventTitle, { color: colors.foreground }]}
                    >
                      {event.title}
                    </Text>
                    <Text
                      style={[
                        styles.eventMeta,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {formatEventTime(event.startsAt, ja)} ·{" "}
                      {event.participantCount}/{event.participantLimit}{" "}
                      {ja ? "人" : "joined"}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.status,
                      {
                        color:
                          event.status === "active"
                            ? colors.primary
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {event.status.toUpperCase()}
                  </Text>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              ))
            )}

            <Pressable
              disabled={busy}
              onPress={() => void signOut()}
              style={[styles.signOut, { borderColor: colors.border }]}
            >
              <Text
                style={[styles.signOutText, { color: colors.mutedForeground }]}
              >
                {ja ? "幹事アカウントからサインアウト" : "Sign out organizer"}
              </Text>
            </Pressable>
          </>
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
  heading: { gap: 7, marginTop: 8 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1.1 },
  titleText: { fontFamily: "Inter_700Bold", fontSize: 32, letterSpacing: -1.1 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  inlineFields: { flexDirection: "row", gap: 12 },
  inlineField: { flex: 1, gap: 6 },
  smallLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  smallInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  primaryButton: {
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 2,
  },
  primaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  devButton: {
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  devText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  eventRow: {
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 15,
  },
  eventCopy: { flex: 1, gap: 3 },
  eventTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  eventMeta: { fontFamily: "Inter_400Regular", fontSize: 12 },
  status: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5 },
  signOut: {
    borderRadius: 15,
    borderWidth: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  signOutText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  error: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
});
