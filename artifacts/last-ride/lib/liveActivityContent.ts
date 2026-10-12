/**
 * What the lock-screen / Dynamic Island Live Activity says at each point of
 * the night. Pure so it can be tested; lib/liveActivity.ts shows it.
 */
import { rideStatus, type NightPlan } from "@/lib/planner";
import { recommendedLeaveTime } from "@/lib/reliability";
import { trainChoiceLabel } from "@/lib/trainChoice";
import { formatJstTime } from "@/lib/time";

export type LiveActivityContent = {
  title: string;
  subtitle: string;
  /** Epoch ms the on-screen timer counts down to. */
  countdownTo: number;
};

type Language = "ja" | "en";

/**
 * Before leave-by the timer counts down to leave-by; after it, to the last
 * train itself, since that is the only deadline left. Null once the last
 * train has gone: the activity should end.
 */
export function liveActivityContent(
  plan: Pick<
    NightPlan,
    | "leaveByMs"
    | "recommendedLeaveByMs"
    | "safetyMarginMinutes"
    | "lastTrain"
    | "walkingMinutes"
    | "station"
    | "trainChoice"
    | "nightLastTrain"
  >,
  language: Language,
  nowMs: number,
): LiveActivityContent | null {
  const status = rideStatus(plan, nowMs);
  if (status === "departed") return null;

  const ja = language === "ja";
  const recommended = recommendedLeaveTime(plan);
  const leaveBy = formatJstTime(recommended);
  const lastTrain = `${formatJstTime(plan.lastTrain.departsAt)}${plan.lastTrain.approximate ? (ja ? "（目安）" : " (approx.)") : ""}`;
  const station = ja ? plan.station.nameJa : plan.station.name;
  const trainLabel = trainChoiceLabel(plan.trainChoice, ja);
  const subtitle = ja
    ? `${station}まで徒歩${plan.walkingMinutes}分 · ${trainLabel} ${lastTrain}`
    : `${plan.walkingMinutes} min walk to ${station} · ${plan.trainChoice ? trainLabel : 'last train'} ${lastTrain}`;

  if (status === "relaxed" || status === "soon") {
    return {
      title: ja ? `${leaveBy}までに出発` : `Leave by ${leaveBy}`,
      subtitle,
      countdownTo: recommended,
    };
  }
  return {
    title: ja
      ? `今すぐ出発 — ${trainLabel} ${lastTrain}`
      : `Leave now — ${plan.trainChoice ? trainLabel : 'last train'} ${lastTrain}`,
    subtitle,
    countdownTo: plan.lastTrain.departsAt,
  };
}

/** Identifies what is on screen, so unchanged content isn't re-sent. */
export function contentSignature(content: LiveActivityContent): string {
  return `${content.title}|${content.subtitle}|${content.countdownTo}`;
}
