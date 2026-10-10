/**
 * iOS Live Activity for night-out tracking: the leave-by countdown on the lock
 * screen and in the Dynamic Island. It follows tracking — started and updated
 * whenever the night is re-planned (foreground or background), ended when
 * tracking stops or the last train has gone.
 *
 * Only active in iOS builds made with ENABLE_LIVE_ACTIVITY=true (app.config.js),
 * since the widget extension needs an App Group, which free signing rejects.
 * On Android the same content drives an ongoing countdown notification
 * (modules/countdown-notification), promoted to a Live Update on Android 16.
 * Everywhere else every call here is a no-op. It is a premium feature: for
 * free users sync ends any running activity instead.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  contentSignature,
  liveActivityContent,
} from "@/lib/liveActivityContent";
import type { NightPlan } from "@/lib/planner";
import { readPremiumCache } from "@/lib/premiumCache";
import {
  countdownNotificationAvailable,
  dismissCountdown,
  showCountdown,
} from "@/modules/countdown-notification/src";
import { MINUTE_MS } from "@/lib/time";

export const liveActivityEnabled =
  Platform.OS === "ios" &&
  Constants.expoConfig?.extra?.liveActivityEnabled === true;

/** Loaded lazily so builds without the widget extension never touch it. */
function factory() {
  return (
    require("@/components/LeaveCountdownActivity") as typeof import("@/components/LeaveCountdownActivity")
  ).default;
}

/** What is on screen now, so a re-plan that changes nothing isn't re-sent. */
let shownSignature: string | null = null;

/** Shows the current plan, starting the activity if none is running. */
export async function syncLiveActivity(
  plan: NightPlan,
  language: "ja" | "en",
  nowMs = Date.now(),
  /** Known premium state; read from the on-disk cache when omitted (background task). */
  premium?: boolean,
): Promise<void> {
  if (!liveActivityEnabled && !countdownNotificationAvailable) return;
  const content = liveActivityContent(plan, language, nowMs);
  if (!content || !(premium ?? (await readPremiumCache()))) {
    await endLiveActivity();
    return;
  }
  if (countdownNotificationAvailable) {
    const signature = contentSignature(content);
    if (shownSignature === signature) return;
    const ja = language === "ja";
    const { latitude, longitude } = plan.station;
    showCountdown({
      title: content.title,
      body: content.subtitle,
      countdownTo: content.countdownTo,
      url: "last-ride://ride",
      mapLabel: ja ? "地図" : "Map",
      mapUrl: `geo:${latitude},${longitude}?q=${latitude},${longitude}`,
      stopLabel: ja ? "トラッキングを停止" : "Stop tracking",
      stopUrl: "last-ride://ride?stop=1",
      channelName: ja ? "夜のカウントダウン" : "Night countdown",
    });
    shownSignature = signature;
    return;
  }
  const activities = factory();
  const running = activities.getInstances()[0];
  const signature = contentSignature(content);
  if (running && shownSignature === signature) return;

  const props = { ...content, shownAt: nowMs };
  // If the app never wakes again, iOS dims the countdown shortly after the last train.
  const staleDate = new Date(plan.lastTrain.departsAt + 5 * MINUTE_MS);
  if (running) {
    await running.update(props, staleDate);
  } else {
    activities.start(props, "last-ride://ride", staleDate);
  }
  shownSignature = signature;
}

/** Ends every LastRide activity, removing it from the lock screen immediately. */
export async function endLiveActivity(): Promise<void> {
  if (countdownNotificationAvailable) {
    shownSignature = null;
    dismissCountdown();
    return;
  }
  if (!liveActivityEnabled) return;
  shownSignature = null;
  await Promise.all(
    factory()
      .getInstances()
      .map((activity) => activity.end("immediate").catch(() => undefined)),
  );
}
