/**
 * What the home- and lock-screen widgets show over the night. Pure so it can
 * be tested; lib/widgets.ts hands the timeline to WidgetKit. All text (and the
 * colours) is built here because the widget runs in WidgetKit's runtime with
 * only its props.
 *
 * Four states:
 * - "live": while tracking (or just after a check), the timeline rail and the
 *   countdown from lib/nightPhase.ts, the same count as the app and the Live Activity.
 * - "plan": not tracking: tonight's train time leads (still right if you move),
 *   with the leave time smaller and when it was checked.
 * - "first": the last train has gone: the first train.
 * - "message": the next day from 05:00, no route (with the reason), or not set up.
 */
import { nightEndsAt, lastTrainLeftAt, type NightPlan } from "@/lib/planner";
import { nightPhases, phaseLabel, railStops, stopLabel, stopState, type NightPhase, type PhasePlan, type RailStop } from "@/lib/nightPhase";
import { recommendedLeaveTime } from "@/lib/reliability";
import type { TrainTime } from "@/lib/timetable";
import { trainChoiceLabel } from "@/lib/trainChoice";
import { formatJstTime, HOUR_MS, MINUTE_MS, serviceDayStart } from "@/lib/time";
import type { BoardedRecord } from "@/lib/boarding";
import { widgetPalette, type WidgetPalette, type WidgetThemeId } from "@/lib/widgetThemes";

type Language = "ja" | "en";

export type WidgetStop = { time: string; label: string; short: string; state: "done" | "next" | "later" };
/** The bar leading into a stop: already passed, filling now, or still ahead. */
export type WidgetBar = { state: "full" | "live" | "empty"; from: number; to: number };

export type LeaveWidgetProps = {
  kind: "live" | "plan" | "first" | "message";
  colors: WidgetPalette;
  /** "帰り時 · 自宅へ" */
  heading: string;
  /** One line for the lock screen, times only: "23:19に出る · 23:33発". */
  inline: string;

  // live
  /** Over the countdown: "ここを出るまで", "23:33発まで", "終電 23:45発まで". */
  label: string;
  /** "leave": counting to the leave time (accent); "train": to a departure (second accent). */
  tone: "leave" | "train";
  /** Epoch ms: the timer counts down from shownAt to countdownTo. */
  shownAt: number;
  countdownTo: number;
  /** The time counted to, for the round lock-screen widget: "23:19". */
  countdownTime: string;
  /** "渋谷駅から" */
  from: string;
  /** "自宅（菊名）へ" */
  to: string;
  /** "00:19 着", or "" when unknown. */
  arrival: string;
  stops: WidgetStop[];
  bars: WidgetBar[];

  // plan (not tracking)
  /** "終電 · 渋谷" */
  trainHeading: string;
  /** "23:45" */
  trainTime: string;
  /** "発" / "dep." after the time. */
  trainSuffix: string;
  /** "出る 23:31（目安）" */
  leaveLine: string;
  /** "22:10に確認" */
  checked: string;
  /** "今夜スタートで、移動に合わせて更新" */
  footnote: string;

  // first
  /** "終電は発車しました" */
  title: string;
  /** "ほかの帰り方 ›" */
  link: string;

  // message
  icon: "moon" | "alert" | "tram";
  message: string;
  hint: string;
};

export type WidgetEntry = { date: Date; props: LeaveWidgetProps };

/** Not tracking: the live countdown is shown only this long after the plan was checked. */
const FRESH_FOR_MS = 30 * MINUTE_MS;

const EMPTY = {
  heading: "",
  inline: "",
  label: "",
  tone: "leave" as const,
  shownAt: 0,
  countdownTo: 0,
  countdownTime: "",
  from: "",
  to: "",
  arrival: "",
  stops: [],
  bars: [],
  trainHeading: "",
  trainTime: "",
  trainSuffix: "",
  leaveLine: "",
  checked: "",
  footnote: "",
  title: "",
  link: "",
  icon: "tram" as const,
  message: "",
  hint: "",
};

export type WidgetMessageReason =
  | "no-plan"
  | "premium"
  | "ended"
  | "morning"
  | "location-off"
  | "near-home"
  | "no-route";

export function widgetMessage(
  language: Language,
  reason: WidgetMessageReason,
  theme?: WidgetThemeId,
  destinationLabel?: string,
): LeaveWidgetProps {
  const ja = language === "ja";
  const text: Record<WidgetMessageReason, [string, string, string, string]> = {
    // No upsell: extensions may not show product promotion or purchase offers
    // (Apple Developer Program License Agreement 3.3.7(E)).
    premium: ["帰り時を開いてウィジェットを設定してください", "", "Open LastRide to set up this widget", ""],
    ended: ["今夜の終電は発車しました", "開いてほかの帰り方を確認", "Tonight’s last train has left", "Open for other ways home"],
    "no-plan": ["今夜の出発時刻は、帰り時を開くと表示", "タップして開く", "Open LastRide to see tonight’s leave time", "Tap to open"],
    morning: ["今夜の出発時刻は、帰り時を開くと表示", "タップして開く", "Open LastRide to see tonight’s leave time", "Tap to open"],
    "location-off": ["位置情報がオフです", "開いて、iPhoneの設定で許可してください", "Location is off", "Open to allow it in iPhone Settings"],
    "near-home": ["帰り先の近くです", "電車に乗る必要はありません", "You’re near your destination", "No train needed from here"],
    "no-route": ["電車が見つかりません", "開いて確認", "No train found", "Open to check"],
  };
  const [jaMessage, jaHint, enMessage, enHint] = text[reason];
  const icon = reason === "morning" || reason === "no-plan" ? "moon" : reason === "premium" ? "tram" : "alert";
  const heading = ja ? "帰り時" : "LastRide";
  return {
    ...EMPTY,
    kind: "message",
    colors: widgetPalette(theme),
    heading: destinationLabel ? (ja ? `${heading} · ${destinationLabel}へ` : `${heading} · to ${destinationLabel}`) : heading,
    message: ja ? jaMessage : enMessage,
    hint: ja ? jaHint : enHint,
    inline: ja ? jaMessage : enMessage,
    icon,
  };
}

type WidgetPlan = PhasePlan & Pick<NightPlan, "station" | "destination" | "computedAt">;

export type WidgetOptions = {
  /** Night-out tracking is on: the plan follows the user, so the live countdown is right. */
  tracking: boolean;
  /** The first train after tonight's last, for the state after it has gone. */
  firstTrain?: TrainTime | null;
  theme?: WidgetThemeId;
};

function arrivalText(plan: WidgetPlan, ja: boolean): string {
  const arriveMs = plan.arriveHomeMs ?? plan.lastTrain.arrivesAt;
  if (!arriveMs) return "";
  const time = formatJstTime(arriveMs);
  // Apple's arrival without a walk home is a station arrival, give or take.
  const approx = plan.lastTrain.source === "apple" && !plan.walkHomeMinutes;
  if (ja) return approx ? `${time}ごろ着` : `${time} 着`;
  return approx ? `~${time} arr.` : `${time} arr.`;
}

function liveProps(
  plan: WidgetPlan,
  stops: RailStop[],
  phase: NightPhase<WidgetPlan>,
  atMs: number,
  base: Pick<LeaveWidgetProps, "colors" | "heading" | "to">,
  ja: boolean,
): LeaveWidgetProps {
  const { label } = phaseLabel(phase, ja);
  const station = ja ? plan.station.nameJa : plan.station.name;
  const time = formatJstTime(phase.plan.lastTrain.departsAt);
  const leave = formatJstTime(recommendedLeaveTime(phase.plan));
  const states = stops.map((stop) => stopState(stop, phase, atMs));
  // The rail starts an hour before the first stop.
  const starts = [stops[0].at - 60 * MINUTE_MS, ...stops.map((stop) => stop.at)];
  const inline =
    phase.kind === "leave"
      ? ja
        ? `${leave}に出る · ${time}発`
        : `Leave ${leave} · ${time} dep.`
      : ja
        ? `急いで · ${phase.last ? "終電 " : ""}${time}発`
        : `Hurry · ${phase.last ? "last " : ""}${time} dep.`;
  return {
    ...EMPTY,
    ...base,
    kind: "live",
    inline,
    label,
    tone: phase.kind,
    shownAt: atMs,
    countdownTo: phase.countdownTo,
    countdownTime: formatJstTime(phase.countdownTo),
    from: ja ? `${station}駅から` : `From ${station}`,
    arrival: arrivalText(phase.plan, ja),
    stops: stops.map((stop, index) => ({ time: formatJstTime(stop.at), ...stopLabel(stop, states[index], ja), state: states[index] })),
    bars: stops.map((stop, index) => ({
      state: atMs >= stop.at ? "full" : atMs >= starts[index] ? "live" : "empty",
      from: starts[index],
      to: stop.at,
    })),
  };
}

function planProps(
  phase: NightPhase<WidgetPlan>,
  base: Pick<LeaveWidgetProps, "colors" | "heading" | "to">,
  ja: boolean,
): LeaveWidgetProps {
  const plan = phase.plan;
  const station = ja ? plan.station.nameJa : plan.station.name;
  const choice = trainChoiceLabel(plan.trainChoice, ja);
  const time = formatJstTime(plan.lastTrain.departsAt);
  const checkedAt = formatJstTime(plan.computedAt);
  const leave = formatJstTime(recommendedLeaveTime(plan));
  const approx = plan.lastTrain.approximate ? (ja ? "（目安）" : " (approx.)") : "";
  return {
    ...EMPTY,
    ...base,
    kind: "plan",
    trainHeading: ja ? `${plan.trainChoice ? choice : "終電"} · ${station}` : `${plan.trainChoice ? choice : "Last train"} · ${station}`,
    trainTime: time + approx,
    trainSuffix: ja ? "発" : "dep.",
    leaveLine: ja ? `出る ${leave}（目安）` : `Leave ~${leave}`,
    checked: ja ? `${checkedAt}に確認` : `Checked ${checkedAt}`,
    arrival: arrivalText(plan, ja),
    footnote: ja ? "今夜スタートで、移動に合わせて更新" : "Start tonight to follow you as you move",
    inline: ja ? `${plan.trainChoice ? choice : "終電"} ${time}発 · ${checkedAt}確認` : `${plan.trainChoice ? choice : "Last"} ${time} dep. · checked ${checkedAt}`,
  };
}

function firstProps(first: TrainTime, plan: WidgetPlan, base: Pick<LeaveWidgetProps, "colors" | "heading" | "to">, ja: boolean): LeaveWidgetProps {
  const station = ja ? plan.station.nameJa : plan.station.name;
  const time = formatJstTime(first.departsAt);
  return {
    ...EMPTY,
    ...base,
    kind: "first",
    title: ja ? "終電は発車しました" : "Last train has left",
    trainHeading: ja ? `始発 · ${station}発` : `First train · ${station}`,
    trainTime: time,
    arrival: first.arrivesAt ? (ja ? `${formatJstTime(first.arrivesAt)} 着` : `${formatJstTime(first.arrivesAt)} arr.`) : "",
    link: ja ? "ほかの帰り方 ›" : "Other ways home ›",
    inline: ja ? `終電は発車 · 始発 ${time}` : `Last train gone · first ${time}`,
  };
}

/**
 * Timeline for tonight, from `nowMs` to 05:00 the next morning. Entries change
 * at each phase boundary, so the widget follows the night with the app closed.
 */
export function widgetTimeline(
  plan: WidgetPlan,
  destinationLabel: string,
  language: Language,
  nowMs: number,
  options: WidgetOptions = { tracking: true },
): WidgetEntry[] {
  const ja = language === "ja";
  const base = {
    colors: widgetPalette(options.theme),
    heading: ja ? `帰り時 · ${destinationLabel}へ` : `LastRide · to ${destinationLabel}`,
    to: ja ? `${destinationLabel}へ` : `To ${destinationLabel}`,
  };
  const morning = nightEndsAt(plan, null, { firstTrainPending: true });
  const lastGone = lastTrainLeftAt(plan);
  const stops = railStops(plan);
  // Not tracking, the countdown is only right shortly after the check (the user may move).
  const liveUntil = options.tracking ? Infinity : plan.computedAt + FRESH_FOR_MS;

  const entries: WidgetEntry[] = [];
  for (const phase of nightPhases(plan, nowMs)) {
    if (phase.from < liveUntil) entries.push({ date: new Date(phase.from), props: liveProps(plan, stops, phase, phase.from, base, ja) });
    const planFrom = Math.max(phase.from, liveUntil);
    if (planFrom < phase.until) entries.push({ date: new Date(planFrom), props: planProps(phase, base, ja) });
  }

  if (nowMs < morning) {
    const goneAt = Math.max(nowMs, lastGone);
    const first = options.firstTrain;
    entries.push({
      date: new Date(goneAt),
      props: first && first.departsAt > goneAt ? firstProps(first, plan, base, ja) : widgetMessage(language, "ended", options.theme),
    });
  }
  entries.push({ date: new Date(Math.max(nowMs, morning)), props: widgetMessage(language, "morning", options.theme, destinationLabel) });
  return entries;
}

/** 〔乗った〕: the earlier train taken, until 05:00, then the next-day message. */
export function boardedTimeline(
  record: BoardedRecord,
  destinationLabel: string,
  language: Language,
  nowMs: number,
  theme?: WidgetThemeId,
): WidgetEntry[] {
  const ja = language === "ja";
  const label = trainChoiceLabel(record.choice, ja);
  const departs = formatJstTime(record.trainDepartsAt);
  const arrival = record.arrivesAt ? formatJstTime(record.arrivesAt) : null;
  const morning = serviceDayStart(record.trainDepartsAt) + 25 * HOUR_MS;
  const props: LeaveWidgetProps = {
    ...widgetMessage(language, "morning", theme, destinationLabel),
    icon: "tram",
    message: ja ? `${label}（${departs}発）に乗車` : `On the ${departs} train (${label.toLowerCase()})`,
    hint: arrival ? (ja ? `${arrival}ごろ着` : `Arriving ~${arrival}`) : ja ? "おつかれさまでした" : "Have a good night",
    inline: ja ? `${label}に乗車${arrival ? ` · ${arrival}ごろ着` : ""}` : `On the ${departs} train${arrival ? ` · ~${arrival}` : ""}`,
  };
  return [
    { date: new Date(nowMs), props },
    { date: new Date(Math.max(nowMs, morning)), props: widgetMessage(language, "morning", theme, destinationLabel) },
  ];
}
