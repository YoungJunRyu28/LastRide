/**
 * What the lock-screen / Dynamic Island Live Activity says at each point of
 * the night. Pure so it can be tested; lib/liveActivity.ts shows it. The count
 * follows lib/nightPhase.ts, like the app and the widgets.
 */
import type { NightPlan } from "@/lib/planner";
import { phaseAt, phaseLabel, railStops, stopLabel, stopState, type PhasePlan } from "@/lib/nightPhase";
import { recommendedLeaveTime } from "@/lib/reliability";
import { trainChoiceLabel } from "@/lib/trainChoice";
import { formatJstTime, MINUTE_MS } from "@/lib/time";
import { arrivalText, checkedLine, toLine, type WidgetBar, type WidgetStop } from "@/lib/widgetContent";
import { widgetPalette, type WidgetPalette, type WidgetThemeId } from "@/lib/widgetThemes";

export type LiveActivityContent = {
  /** One line each for Android's countdown notification: "23:37に出る — 渋谷駅から". */
  title: string;
  subtitle: string;
  /** Epoch ms the on-screen timer counts down to. */
  countdownTo: number;
  /** Over the countdown: "ここを出るまで", "23:33発まで", "終電 23:45発まで". */
  label: string;
  /** Dynamic Island, left of the camera: "出るまで" / "23:33発" / "終電" ("Leave in" / "Train in" / "Last train"). */
  island: string;
  tone: "leave" | "train";
  /** "渋谷駅から" */
  from: string;
  /** 「自宅へ · 00:39 着」: where to, and when you get there (as on the medium widget). */
  to: string;
  /** The two halves of `to`, so a long saved name shrinks and the arrival stays whole. */
  toName?: string;
  arrival?: string;
  /** When the plan was last checked: "22:41 確認", or "22:41 確認 · 開くと更新" when it only updates with the app open. */
  checked: string;
  stops: WidgetStop[];
  bars: WidgetBar[];
  colors: WidgetPalette;
  /**
   * Shown instead of a countdown stuck at 0:00 once the night's last countdown
   * has run out and the app hasn't been woken to end the activity (iOS marks
   * it stale then): 「終電は発車しました」 / 「開いて確認」.
   */
  gone: { label: string; value: string; island: string; short: string };
};

type Language = "ja" | "en";

/** Null once the last train has gone: the activity should end. */
export function liveActivityContent(
  plan: PhasePlan & Pick<NightPlan, "station" | "computedAt" | "destination">,
  language: Language,
  nowMs: number,
  theme?: WidgetThemeId,
  /** Tracking only while the app is open: the times are from the last visit. */
  whileOpenOnly = false,
  /** The saved place's name (「自宅」), as on the widgets; the station's name if not given. */
  destinationLabel?: string,
): LiveActivityContent | null {
  const phase = phaseAt(plan, nowMs);
  if (!phase) return null;

  const ja = language === "ja";
  const station = ja ? plan.station.nameJa : plan.station.name;
  const { label, island } = phaseLabel(phase, ja);
  const train = phase.plan.lastTrain;
  const trainTime = `${formatJstTime(train.departsAt)}${train.approximate ? (ja ? "（目安）" : " (approx.)") : ""}`;
  const trainName = trainChoiceLabel(phase.plan.trainChoice, ja);
  const leave = formatJstTime(recommendedLeaveTime(phase.plan));
  const stops = railStops(plan);
  const states = stops.map((stop) => stopState(stop, phase, nowMs));
  const starts = [stops[0].at - 60 * MINUTE_MS, ...stops.map((stop) => stop.at)];

  const toName = ja ? `${destinationLabel ?? plan.destination.nameJa}へ` : `To ${destinationLabel ?? plan.destination.name}`;
  const arrival = arrivalText(phase.plan, ja);
  return {
    title:
      phase.kind === "leave"
        ? ja
          ? `${leave}に出る — ${station}駅から`
          : `Leave at ${leave} — from ${station}`
        : ja
          ? `今すぐ駅へ — ${trainName} ${trainTime}発`
          : `Head to the station — ${phase.plan.trainChoice ? trainName.toLowerCase() : "last train"} ${trainTime}`,
    subtitle: ja
      ? `${station}まで徒歩${plan.walkingMinutes}分 · ${trainName} ${trainTime}発`
      : `${plan.walkingMinutes} min walk to ${station} · ${phase.plan.trainChoice ? trainName.toLowerCase() : "last train"} ${trainTime}`,
    countdownTo: phase.countdownTo,
    label,
    island,
    tone: phase.kind,
    from: ja ? `${station}駅から` : `From ${station}`,
    to: toLine(toName, arrival),
    toName,
    arrival,
    checked: checkedLine(plan.computedAt, ja, whileOpenOnly),
    stops: stops.map((stop, index) => ({ time: formatJstTime(stop.at), ...stopLabel(stop, states[index], ja), state: states[index] })),
    bars: stops.map((stop, index) => ({
      state: nowMs >= stop.at ? "full" : nowMs >= starts[index] ? "live" : "empty",
      from: starts[index],
      to: stop.at,
    })),
    colors: widgetPalette(theme),
    gone: ja
      ? { label: "終電は発車しました", value: "開いて確認", island: "終電", short: "発車済" }
      : { label: "The last train has left", value: "Open the app", island: "Last", short: "Gone" },
  };
}

/** The parts of the content that change from one countdown to the next. */
export type LiveActivityNext = Pick<LiveActivityContent, "countdownTo" | "label" | "island" | "tone" | "to" | "stops" | "bars">;

/**
 * What the activity shows once the current countdown ends (leave time → the
 * train's departure), without the app: it is the activity's stale date, and
 * components/LeaveCountdownActivity switches to this when iOS marks it stale.
 * The app usually isn't woken at the leave time (standing still, no location
 * update), so without it the countdown would sit at 0:00 until the app opened.
 * Null when nothing follows (the last train).
 */
export function nextLiveActivityPhase(
  plan: Parameters<typeof liveActivityContent>[0],
  language: Language,
  content: LiveActivityContent,
  theme?: WidgetThemeId,
  whileOpenOnly = false,
  destinationLabel?: string,
): LiveActivityNext | null {
  const after = liveActivityContent(plan, language, content.countdownTo + 1, theme, whileOpenOnly, destinationLabel);
  if (!after || after.countdownTo <= content.countdownTo) return null;
  const { countdownTo, label, island, tone, to, stops, bars } = after;
  return { countdownTo, label, island, tone, to, stops, bars };
}

/** Identifies what is on screen, so unchanged content isn't re-sent. */
export function contentSignature(content: LiveActivityContent): string {
  return JSON.stringify([
    content.label,
    content.countdownTo,
    content.from,
    content.subtitle,
    content.checked,
    content.stops.map((stop) => [stop.short, stop.state]),
    content.bars.map((bar) => bar.state),
    content.colors.background,
    content.colors.leave,
  ]);
}
