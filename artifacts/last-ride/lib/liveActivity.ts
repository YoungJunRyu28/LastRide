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
  nextLiveActivityPhase,
} from "@/lib/liveActivityContent";
import type { NightPlan } from "@/lib/planner";
import { readPremiumCache } from "@/lib/premiumCache";
import { readWidgetTheme } from "@/lib/settings";
import type { WidgetThemeId } from "@/lib/widgetThemes";
import {
  countdownNotificationAvailable,
  dismissCountdown,
  showCountdown,
} from "@/modules/countdown-notification/src";
import { MINUTE_MS } from "@/lib/time";
import { debugEvent } from "@/lib/debugEvents";

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
  /** The widgets' colour theme; read from settings when omitted. */
  theme?: WidgetThemeId,
  /** Tracking only while the app is open (says so under the check time). */
  whileOpenOnly = false,
): Promise<void> {
  if (!liveActivityEnabled && !countdownNotificationAvailable) return;
  const widgetTheme = theme ?? (await readWidgetTheme());
  const content = liveActivityContent(plan, language, nowMs, widgetTheme, whileOpenOnly);
  if (!content) {
    await endLiveActivity(`no content (${plan.station.nameJa} ${plan.trainChoice ?? 0} ${new Date(plan.lastTrain.departsAt).toISOString()})`);
    return;
  }
  // Only end for "not Premium" when that's known for sure (the open app). The
  // background task only has a saved flag; a running activity keeps updating,
  // and a closed app can't start one anyway.
  if (!(premium ?? (await readPremiumCache()))) {
    if (premium === false) await endLiveActivity("not premium");
    else debugEvent("sync skipped: premium cache says no");
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
      stopLabel: ja ? "案内を終了" : "Stop tracking",
      stopUrl: "last-ride://ride?stop=1",
      channelName: ja ? "夜のカウントダウン" : "Night countdown",
    });
    shownSignature = signature;
    return;
  }
  const activities = factory();
  const instances = activities.getInstances();
  const running = instances[0];
  const signature = contentSignature(content);
  if (running && shownSignature === signature) {
    void debugEvent(`sync: unchanged (${instances.length} running)`);
    return;
  }

  // The next countdown rides along: at the end of this one (the stale date) the
  // activity switches to it by itself, even if the app isn't woken then.
  const next = nextLiveActivityPhase(plan, language, content, widgetTheme, whileOpenOnly);
  const props = { ...content, shownAt: nowMs, next };
  // Nothing follows: stale shortly after the night's real last train (with
  // 1本前 / 2本前 the plan's own train goes first, and the later ones still show).
  const staleDate = next ? new Date(content.countdownTo) : new Date((plan.nightLastTrain ?? plan.lastTrain).departsAt + 5 * MINUTE_MS);
  debugEvent(`${running ? "update" : "start"}: ${content.label} ${content.countdownTo > nowMs ? Math.round((content.countdownTo - nowMs) / 1000) + "s" : "past"}`);
  if (running) {
    await running.update(props, staleDate).catch(async (error: unknown) => {
      await debugEvent(`update failed: ${String(error)}`);
      throw error;
    });
  } else {
    activities.start(props, "last-ride://ride", staleDate);
  }
  shownSignature = signature;
}

/** Ends every LastRide activity, removing it from the lock screen immediately. */
export async function endLiveActivity(reason = "unspecified"): Promise<void> {
  await debugEvent(`end: ${reason}`);
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
