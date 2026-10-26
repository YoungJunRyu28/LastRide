/**
 * The widgets over a night: the live timeline while tracking, tonight's train
 * when not, the first train after the last has gone, and the next day.
 */
import { describe, expect, test } from "vitest";
import type { NightPlan } from "@/lib/planner";
import { applyTrainChoice, trainOptions } from "@/lib/trainChoice";
import type { TrainTime } from "@/lib/timetable";
import { MINUTE_MS } from "@/lib/time";
import { widgetMessage, widgetSignature, widgetTimeline } from "@/lib/widgetContent";
import { widgetPalette } from "@/lib/widgetThemes";

function jst(hours: number, minutes = 0) {
  return Date.UTC(2026, 9, 9, hours - 9, minutes);
}
function train(dep: number, arr: number, before?: TrainTime[]): TrainTime {
  return { departsAt: dep, arrivesAt: arr, source: "live", ...(before ? { before } : {}) };
}

const shibuya = { name: "Shibuya", nameJa: "渋谷", latitude: 35.658, longitude: 139.701 };
const kikuna = { name: "Kikuna", nameJa: "菊名", latitude: 35.51, longitude: 139.63 };
// Last 23:45 (leave 23:36); 1本前 23:36 (leave 23:27).
const last = train(jst(23, 45), jst(24, 37), [train(jst(23, 36), jst(24, 28))]);

function night(lastTrain = last, computedAt = jst(23, 0)): NightPlan {
  const leaveByMs = lastTrain.departsAt - 5 * MINUTE_MS;
  const base = {
    station: shibuya,
    walkingMinutes: 2,
    distanceMeters: 150,
    lastTrain,
    leaveByMs,
    safetyMarginMinutes: 4,
    recommendedLeaveByMs: leaveByMs - 4 * MINUTE_MS,
    destination: kikuna,
  };
  return { ...base, coordinates: shibuya, alternatives: [], autoPick: base, pinned: false, computedAt };
}

const at = (entries: ReturnType<typeof widgetTimeline>, ms: number) =>
  [...entries].reverse().find((entry) => entry.date.getTime() <= ms)!.props;

describe("tracking: the live timeline", () => {
  const entries = widgetTimeline(night(), "自宅", "ja", jst(23, 0), { tracking: true });

  test("counts to the leave time, then the train, as the app does", () => {
    const before = at(entries, jst(23, 10));
    expect(before).toMatchObject({ kind: "live", label: "ここを出るまで", tone: "leave", countdownTo: jst(23, 36), from: "渋谷駅から" });
    expect(before.stops.map((stop) => [stop.time, stop.short, stop.state])).toEqual([
      ["23:36", "出る 23:36", "next"],
      ["23:45", "終電", "later"],
    ]);
    const after = at(entries, jst(23, 40));
    expect(after).toMatchObject({ label: "終電 23:45発まで", tone: "train", countdownTo: jst(23, 45) });
    expect(after.stops.map((stop) => stop.state)).toEqual(["done", "next"]);
  });

  test("the lock-screen line has times only", () => {
    expect(at(entries, jst(23, 10)).inline).toBe("23:36に出る · 23:45発");
    expect(at(entries, jst(23, 40)).inline).toBe("急いで · 終電 23:45発");
  });

  test("after the last train: the ended notice, then the next day from 05:00", () => {
    expect(at(entries, jst(23, 50))).toMatchObject({ kind: "message", message: "今夜の終電は発車しました" });
    expect(at(entries, jst(29, 0))).toMatchObject({ kind: "message", icon: "moon", message: "今夜の出発時刻は、帰り時を開くと表示" });
  });

  test("with the first train known, it shows that instead", () => {
    const first = train(jst(29, 12) - 5 * MINUTE_MS, jst(30, 1));
    const withFirst = widgetTimeline(night(), "自宅", "ja", jst(23, 0), { tracking: true, firstTrain: first });
    expect(at(withFirst, jst(24, 30))).toMatchObject({ kind: "first", title: "終電は発車しました", trainHeading: "始発 · 渋谷発", trainTime: "05:07" });
  });

  test("1本前: its departure on the rail, then on to the last train", () => {
    const options = trainOptions(night(), 4, jst(23, 0));
    const chosen = widgetTimeline(applyTrainChoice(night(), options, 1), "自宅", "en", jst(23, 0), { tracking: true });
    expect(at(chosen, jst(23, 30))).toMatchObject({ label: "23:36 train in", countdownTo: jst(23, 36) });
    expect(at(chosen, jst(23, 30)).stops.map((stop) => stop.short)).toEqual(["Left", "23:36", "Last"]);
    expect(at(chosen, jst(23, 40))).toMatchObject({ label: "Last train 23:45 in", countdownTo: jst(23, 45) });
    expect(at(chosen, jst(23, 40)).stops.map((stop) => stop.short)).toEqual(["Left", "Gone", "Last 23:45"]);
  });
});

describe("not tracking", () => {
  test("no countdown at all: tonight's train time leads, even just after a check", () => {
    const entries = widgetTimeline(night(last, jst(23, 0)), "自宅", "ja", jst(23, 0), { tracking: false });
    expect(entries.some((entry) => entry.props.kind === "live")).toBe(false);
    expect(at(entries, jst(23, 0))).toMatchObject({
      kind: "plan",
      trainHeading: "終電 · 渋谷",
      trainTime: "23:45",
      trainSuffix: "発",
      leaveLine: "出る 23:36（目安）",
      checked: "23:00に確認",
      inline: "終電 23:45発 · 23:00確認",
    });
  });

  test("an old check goes straight to the train time", () => {
    const entries = widgetTimeline(night(last, jst(21, 0)), "Home", "en", jst(22, 0), { tracking: false });
    expect(entries[0].props).toMatchObject({ kind: "plan", trainHeading: "Last train · Shibuya", trainSuffix: "dep.", checked: "Checked 21:00" });
  });
});

describe("messages", () => {
  test("say why there is no route", () => {
    expect(widgetMessage("ja", "location-off")).toMatchObject({ message: "位置情報がオフです", icon: "alert" });
    expect(widgetMessage("en", "near-home").message).toBe("You’re near your destination");
  });

  test("never promote a purchase", () => {
    expect(widgetMessage("en", "premium").message).toBe("Open LastRide to set up this widget");
  });

  test("use the chosen theme", () => {
    expect(widgetMessage("en", "morning", "paper").colors).toEqual(widgetPalette("paper"));
    expect(widgetPalette("paper").dark).toBe(false);
    expect(widgetPalette().background).toBe("#0a1322");
  });
});

describe("widget reloads", () => {
  test("a re-plan that changes nothing on screen doesn't reload the widget", () => {
    const first = widgetTimeline(night(), "自宅", "ja", jst(23, 0), { tracking: true });
    const again = widgetTimeline(night(), "自宅", "ja", jst(23, 3), { tracking: true });
    expect(widgetSignature(again, jst(23, 3))).toBe(widgetSignature(first, jst(23, 0)));
  });

  test("a new leave time does", () => {
    const first = widgetTimeline(night(), "自宅", "ja", jst(23, 0), { tracking: true });
    const moved = widgetTimeline({ ...night(), recommendedLeaveByMs: jst(23, 30) }, "自宅", "ja", jst(23, 3), { tracking: true });
    expect(widgetSignature(moved, jst(23, 3))).not.toBe(widgetSignature(first, jst(23, 0)));
  });
});

describe("a locked widget (not premium)", () => {
  test("shows no promotion itself, and a tap opens the Premium screen", () => {
    const props = widgetMessage("ja", "premium");
    expect(props.message).not.toMatch(/プレミアム|円|¥/);
    expect(props.url).toBe("last-ride://paywall?from=widget");
    expect(widgetMessage("ja", "no-plan").url).toBe("last-ride://ride");
  });
});
