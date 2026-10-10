/**
 * What the home- and lock-screen widgets show over the night. Pure so it can
 * be tested; lib/widgets.ts hands the timeline to WidgetKit. All text is built
 * here because the widget runs in WidgetKit's runtime with only its props.
 */
import type { NightPlan } from "@/lib/planner";
import { recommendedLeaveTime } from "@/lib/reliability";
import { formatJstTime, MINUTE_MS } from "@/lib/time";

type Language = "ja" | "en";

export type LeaveWidgetProps = {
  /** "plan": tonight's times; "message": just `message` (no plan, ended, or not premium). */
  kind: "plan" | "message";
  /** "帰り時 · 自宅へ" */
  heading: string;
  /** "自宅へ" */
  short: string;
  /** Big time: when to leave, or the last train once leave-by has passed. */
  bigTime: string;
  /** "渋谷から · 終電 23:52 · 徒歩8分" */
  detail: string;
  /** One line for the lock screen: "23:37 出発 · 終電 23:52". */
  inline: string;
  /** "23:37 渋谷" */
  footer: string;
  /** "押上着 00:24", or "" when unknown. */
  arrival: string;
  /** "出発まで" or "終電まで". */
  countdownLabel: string;
  /** Epoch ms: the timer counts down from shownAt to countdownTo. */
  shownAt: number;
  countdownTo: number;
  message: string;
};

export type WidgetEntry = { date: Date; props: LeaveWidgetProps };

const EMPTY = {
  heading: "",
  short: "",
  bigTime: "",
  detail: "",
  inline: "",
  footer: "",
  arrival: "",
  countdownLabel: "",
  shownAt: 0,
  countdownTo: 0,
};

export function widgetMessage(
  language: Language,
  reason: "no-plan" | "premium" | "ended",
): LeaveWidgetProps {
  const ja = language === "ja";
  const message =
    reason === "premium"
      ? ja
        ? "ウィジェットはプレミアムの機能です"
        : "Widgets are part of Premium"
      : reason === "ended"
        ? ja
          ? "今夜の終電は発車しました"
          : "Tonight’s last train has left"
        : ja
          ? "帰り時を開くと今夜の出発時刻が表示されます"
          : "Open LastRide to see tonight’s leave time";
  return {
    ...EMPTY,
    kind: "message",
    heading: ja ? "帰り時" : "LastRide",
    message,
  };
}

/**
 * Timeline for tonight: the plan now, a switch to the last-train countdown at
 * leave-by, and an "ended" message shortly after the last train.
 */
export function widgetTimeline(
  plan: Pick<
    NightPlan,
    | "leaveByMs"
    | "recommendedLeaveByMs"
    | "safetyMarginMinutes"
    | "lastTrain"
    | "walkingMinutes"
    | "station"
    | "arriveHomeMs"
    | "destination"
  >,
  destinationLabel: string,
  language: Language,
  nowMs: number,
): WidgetEntry[] {
  const ja = language === "ja";
  const leaveAt = recommendedLeaveTime(plan);
  const lastTrainAt = plan.lastTrain.departsAt;
  const endedAt = lastTrainAt + 5 * MINUTE_MS;
  if (nowMs >= endedAt)
    return [{ date: new Date(nowMs), props: widgetMessage(language, "ended") }];

  const leave = formatJstTime(leaveAt);
  const lastTrain = formatJstTime(lastTrainAt);
  const station = ja ? plan.station.nameJa : plan.station.name;
  const arriveMs = plan.arriveHomeMs ?? plan.lastTrain.arrivesAt;
  const arrivalStation = ja ? plan.destination.nameJa : plan.destination.name;
  const short = ja ? `${destinationLabel}へ` : `To ${destinationLabel}`;
  const base = {
    kind: "plan" as const,
    heading: ja ? `帰り時 · ${destinationLabel}へ` : `LastRide · to ${destinationLabel}`,
    short,
    detail: ja
      ? `${station}から · 終電 ${lastTrain} · 徒歩${plan.walkingMinutes}分`
      : `From ${station} · last ${lastTrain} · ${plan.walkingMinutes} min walk`,
    footer: `${leave} ${station}`,
    arrival: arriveMs
      ? ja
        ? `${arrivalStation}着 ${formatJstTime(arriveMs)}`
        : `${arrivalStation} ${formatJstTime(arriveMs)}`
      : "",
    message: "",
  };

  const entries: WidgetEntry[] = [];
  if (nowMs < leaveAt) {
    entries.push({
      date: new Date(nowMs),
      props: {
        ...base,
        bigTime: leave,
        inline: ja ? `${leave} 出発 · 終電 ${lastTrain}` : `Leave ${leave} · last ${lastTrain}`,
        countdownLabel: ja ? "出発まで" : "Leave in",
        shownAt: nowMs,
        countdownTo: leaveAt,
      },
    });
  }
  const urgentFrom = Math.max(nowMs, leaveAt);
  entries.push({
    date: new Date(urgentFrom),
    props: {
      ...base,
      bigTime: lastTrain,
      inline: ja ? `今すぐ出発 · 終電 ${lastTrain}` : `Leave now · last ${lastTrain}`,
      countdownLabel: ja ? "終電まで" : "Last train in",
      shownAt: urgentFrom,
      countdownTo: lastTrainAt,
    },
  });
  entries.push({ date: new Date(endedAt), props: widgetMessage(language, "ended") });
  return entries;
}
