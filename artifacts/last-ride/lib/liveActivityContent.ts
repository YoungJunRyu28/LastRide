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
import type { WidgetBar, WidgetStop } from "@/lib/widgetContent";
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
  /** "帰り時 · 1本前" */
  choice: string;
  stops: WidgetStop[];
  bars: WidgetBar[];
  colors: WidgetPalette;
};

type Language = "ja" | "en";

/** Null once the last train has gone: the activity should end. */
export function liveActivityContent(
  plan: PhasePlan & Pick<NightPlan, "station">,
  language: Language,
  nowMs: number,
  theme?: WidgetThemeId,
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
    choice: ja ? `帰り時 · ${trainName}` : `LastRide · ${phase.plan.trainChoice ? trainName.toLowerCase() : "last train"}`,
    stops: stops.map((stop, index) => ({ time: formatJstTime(stop.at), ...stopLabel(stop, states[index], ja), state: states[index] })),
    bars: stops.map((stop, index) => ({
      state: nowMs >= stop.at ? "full" : nowMs >= starts[index] ? "live" : "empty",
      from: starts[index],
      to: stop.at,
    })),
    colors: widgetPalette(theme),
  };
}

/** Identifies what is on screen, so unchanged content isn't re-sent. */
export function contentSignature(content: LiveActivityContent): string {
  return JSON.stringify([
    content.label,
    content.countdownTo,
    content.from,
    content.subtitle,
    content.stops.map((stop) => [stop.short, stop.state]),
    content.bars.map((bar) => bar.state),
    content.colors.background,
    content.colors.leave,
  ]);
}
