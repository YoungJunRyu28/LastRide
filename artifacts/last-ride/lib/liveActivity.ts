/**
 * iOS Live Activity for night-out tracking: the leave-by countdown on the lock
 * screen and in the Dynamic Island. It follows tracking — started and updated
 * whenever the night is re-planned (foreground or background), ended when
 * tracking stops or the last train has gone.
 *
 * Only active in iOS builds made with ENABLE_LIVE_ACTIVITY=true (app.config.js),
 * since the widget extension needs an App Group, which free signing rejects.
 * Everywhere else every call here is a no-op.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  contentSignature,
  liveActivityContent,
} from "@/lib/liveActivityContent";
import type { NightPlan } from "@/lib/planner";
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
): Promise<void> {
  if (!liveActivityEnabled) return;
  const content = liveActivityContent(plan, language, nowMs);
  if (!content) {
    await endLiveActivity();
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
  if (!liveActivityEnabled) return;
  shownSignature = null;
  await Promise.all(
    factory()
      .getInstances()
      .map((activity) => activity.end("immediate").catch(() => undefined)),
  );
}
