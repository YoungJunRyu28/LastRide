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
import {
  widgetMessage,
  widgetTimeline,
  type LeaveWidgetProps,
} from "@/lib/widgetContent";

/** Loaded lazily so builds without the widget extension never touch it. */
function widget() {
  return (
    require("@/components/LeaveWidget") as typeof import("@/components/LeaveWidget")
  ).default;
}

let shownSignature: string | null = null;

function signature(entries: Array<{ date: Date; props: LeaveWidgetProps }>) {
  return JSON.stringify(entries.map(({ date, props }) => [date.getTime(), props.kind, props.inline, props.countdownTo, props.message]));
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
): Promise<void> {
  if (!liveActivityEnabled) return;
  const entitled = premium ?? (await readPremiumCache());
  const entries = !entitled
    ? [{ date: new Date(nowMs), props: widgetMessage(language, "premium") }]
    : plan
      ? widgetTimeline(plan, destinationLabel, language, nowMs)
      : [{ date: new Date(nowMs), props: widgetMessage(language, "no-plan") }];
  const next = signature(entries);
  if (next === shownSignature) return;
  widget().updateTimeline(entries);
  shownSignature = next;
}
