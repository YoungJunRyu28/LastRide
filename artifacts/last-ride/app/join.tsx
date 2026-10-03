import {
  joinEnterpriseParticipation,
  leaveCurrentEnterpriseEvent,
  readEnterpriseParticipation,
  syncEnterpriseLeaveBy,
  type EnterpriseParticipation,
} from "@/lib/enterpriseParticipation";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import { businessEnabled } from "@/lib/features";
import { Feather } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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

function JoinBusinessEventScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string; code?: string }>();
  const { language, plan, leaveBy } = useLastRide();
  const ja = language === "ja";
  const inviteToken =
    typeof params.token === "string" ? params.token : undefined;
  const initialCode = typeof params.code === "string" ? params.code : "";

  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState(initialCode);
  const [participation, setParticipation] =
    useState<EnterpriseParticipation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readEnterpriseParticipation()
      .then(setParticipation)
      .finally(() => setLoading(false));
  }, []);

  const canJoin = useMemo(
    () =>
      displayName.trim().length > 0 &&
      (Boolean(inviteToken) || joinCode.trim().length >= 4),
    [displayName, inviteToken, joinCode],
  );

  const join = async () => {
    if (!canJoin || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const joined = await joinEnterpriseParticipation({
        displayName: displayName.trim(),
        ...(inviteToken
          ? { inviteToken }
          : { joinCode: joinCode.trim().toUpperCase() }),
      });
      setParticipation(joined);
      if (plan) {
        await syncEnterpriseLeaveBy(plan.leaveByMs).catch(() => undefined);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 409
          ? ja
            ? "この飲み会は参加上限に達しています。"
            : "This group has reached its participant limit."
          : ja
            ? "参加できませんでした。コードを確認してもう一度お試しください。"
            : "Couldn’t join this group. Check the code and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const leave = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await leaveCurrentEnterpriseEvent();
      setParticipation(null);
    } catch {
      setError(
        ja
          ? "退出処理に失敗しました。通信状況を確認してください。"
          : "Couldn’t leave the group. Check your connection.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
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
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 28 },
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
          <Text style={[styles.title, { color: colors.foreground }]}>
            {participation
              ? participation.eventTitle
              : ja
                ? "飲み会に参加"
                : "Join a group"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {participation
              ? ja
                ? "幹事にはあなたの名前と出発時刻だけが共有されます。"
                : "The organizer only sees your name and leave-by time."
              : ja
                ? "アカウント作成は不要です。"
                : "No personal account required."}
          </Text>
        </View>

        {participation ? (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.cardLabel, { color: colors.mutedForeground }]}
              >
                {ja ? "共有中の出発時刻" : "SHARED LEAVE TIME"}
              </Text>
              <Text
                maxFontSizeMultiplier={1.4}
                style={[styles.leaveTime, { color: colors.foreground }]}
              >
                {plan ? leaveBy : ja ? "計算待ち" : "Waiting for a plan"}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {plan
                  ? ja
                    ? "LastRideが出発時刻を再計算すると、幹事側も自動で更新されます。"
                    : "When LastRide recalculates your leave time, the organizer’s roster updates automatically."
                  : ja
                    ? "いつものLastRideで現在地からプランを計算すると自動で共有されます。"
                    : "Calculate your normal LastRide plan and the leave time will sync automatically."}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => void leave()}
              style={[
                styles.secondaryButton,
                { borderColor: colors.border, opacity: submitting ? 0.6 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.secondaryButtonText,
                  { color: colors.destructive },
                ]}
              >
                {ja ? "この飲み会から退出" : "Leave this group"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                {ja ? "表示名" : "Your name"}
              </Text>
              <TextInput
                accessibilityLabel={ja ? "表示名" : "Your name"}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                maxLength={80}
                placeholder={ja ? "例：田中" : "e.g. Daniel"}
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

              {!inviteToken && (
                <>
                  <Text
                    style={[
                      styles.fieldLabel,
                      { color: colors.foreground, marginTop: 16 },
                    ]}
                  >
                    {ja ? "参加コード" : "Join code"}
                  </Text>
                  <TextInput
                    accessibilityLabel={ja ? "参加コード" : "Join code"}
                    value={joinCode}
                    onChangeText={setJoinCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                    placeholder="K7M4PX"
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
            </View>

            <View
              style={[
                styles.privacy,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather name="shield" size={20} color={colors.primary} />
              <View style={styles.privacyCopy}>
                <Text
                  style={[styles.privacyTitle, { color: colors.foreground }]}
                >
                  {ja ? "共有するのは2つだけ" : "Only two things are shared"}
                </Text>
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  {ja
                    ? "表示名と出発時刻のみ。現在地、自宅、駅、経路は幹事に共有されません。"
                    : "Your display name and leave-by time only. Your location, home, station and route are never shown to the organizer."}
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={!canJoin || submitting}
              onPress={() => void join()}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: !canJoin || submitting ? 0.45 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {ja ? "参加する" : "Join group"}
                </Text>
              )}
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
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 8,
  },
  backText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  heading: { gap: 7, marginTop: 10 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1.1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 32, letterSpacing: -1.1 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  cardLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.9 },
  leaveTime: {
    fontFamily: "Inter_700Bold",
    fontSize: 42,
    letterSpacing: -1.5,
    marginVertical: 8,
  },
  fieldLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    marginBottom: 8,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  privacy: {
    alignItems: "flex-start",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  privacyCopy: { flex: 1, gap: 4 },
  privacyTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  primaryButton: {
    alignItems: "center",
    borderRadius: 16,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 15 },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 50,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  secondaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  error: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
});

/** Business can be switched off per build (lib/features.ts); links then land on home. */
export default function JoinBusinessEventScreenRoute() {
  if (!businessEnabled) return <Redirect href="/" />;
  return <JoinBusinessEventScreen />;
}
