/**
 * Keeps the home- and lock-screen widgets (components/LeaveWidget.tsx) in step
 * with tonight's plan. Widgets are premium; free users see a short notice.
 *
 * Only active in iOS builds with the widget extension (ENABLE_LIVE_ACTIVITY in
 * app.config.js — the same extension carries the Live Activity). Everywhere
 * else every call here is a no-op.
 */
import { liveActivityEnabled } from "@/lib/liveActivity";
import type { NightPlan } from "@/lib/planner";
import { readPremiumCache } from "@/lib/premiumCache";
import { readWidgetTheme } from "@/lib/settings";
import type { TrainTime } from "@/lib/timetable";
import type { BoardedRecord } from "@/lib/boarding";
import {
  boardedTimeline,
  widgetMessage,
  widgetTimeline,
  type LeaveWidgetProps,
  type WidgetMessageReason,
} from "@/lib/widgetContent";
import type { WidgetThemeId } from "@/lib/widgetThemes";

/** Loaded lazily so builds without the widget extension never touch it. */
function widget() {
  return (
    require("@/components/LeaveWidget") as typeof import("@/components/LeaveWidget")
  ).default;
}

let shownSignature: string | null = null;

function signature(entries: Array<{ date: Date; props: LeaveWidgetProps }>) {
  return JSON.stringify(entries.map(({ date, props }) => [date.getTime(), props]));
}

export type WidgetSyncOptions = {
  /** Night-out tracking is on (the background task always is). */
  tracking: boolean;
  firstTrain?: TrainTime | null;
  /** Why there is no plan (a location/planning error code), for the widget's short reason. */
  reason?: string | null;
  /** Read from settings when omitted (background task). */
  theme?: WidgetThemeId;
  /** 〔乗った〕 tonight: show the train taken instead of the plan. */
  boarded?: BoardedRecord | null;
};

function messageReason(reason: string | null | undefined): WidgetMessageReason {
  if (reason === "permission") return "location-off";
  if (reason === "near-home") return "near-home";
  if (reason === "no-route" || reason === "no-station") return "no-route";
  return "no-plan";
}

/**
 * Shows tonight's plan (or a notice) on every LeaveWidget. `premium` is the
 * known premium state; the on-disk cache is read when omitted (background task).
 */
export async function syncWidgets(
  plan: NightPlan | null,
  destinationLabel: string,
  language: "ja" | "en",
  nowMs = Date.now(),
  premium?: boolean,
  options: WidgetSyncOptions = { tracking: true },
): Promise<void> {
  if (!liveActivityEnabled) return;
  const entitled = premium ?? (await readPremiumCache());
  const theme = options.theme ?? (await readWidgetTheme());
  const entries = !entitled
    ? [{ date: new Date(nowMs), props: widgetMessage(language, "premium") }]
    : options.boarded
      ? boardedTimeline(options.boarded, destinationLabel, language, nowMs, theme)
    : plan
      ? widgetTimeline(plan, destinationLabel, language, nowMs, { tracking: options.tracking, firstTrain: options.firstTrain, theme })
      : [{ date: new Date(nowMs), props: widgetMessage(language, messageReason(options.reason), theme, destinationLabel) }];
  const next = signature(entries);
  if (next === shownSignature) return;
  widget().updateTimeline(entries);
  shownSignature = next;
}
