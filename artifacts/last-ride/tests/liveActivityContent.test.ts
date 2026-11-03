/**
 * The Live Activity counts what the app and the widgets count, at the same
 * moment, and ends once the last train has gone.
 */
import { describe, expect, test } from "vitest";
import { contentSignature, liveActivityContent, nextLiveActivityPhase } from "@/lib/liveActivityContent";
import type { StationOption } from "@/lib/stations";
import { MINUTE_MS } from "@/lib/time";

function jst(hours: number, minutes = 0) {
  return Date.UTC(2026, 9, 9, hours - 9, minutes);
}

const LEAVE_BY = jst(23, 41);
const RECOMMENDED_LEAVE_BY = jst(23, 37);
const LAST_TRAIN = jst(23, 52);
const shibuya = { name: "Shibuya", nameJa: "渋谷", latitude: 35.658, longitude: 139.701 } as StationOption;
const plan = {
  leaveByMs: LEAVE_BY,
  lastTrain: { departsAt: LAST_TRAIN, source: "live" as const },
  walkingMinutes: 8,
  station: shibuya,
  destination: { name: "Kikuna", nameJa: "菊名", latitude: 35.5098, longitude: 139.6304 } as StationOption,
  computedAt: jst(22, 41),
};

describe("liveActivityContent", () => {
  test("counts down to the leave time while there is time", () => {
    expect(liveActivityContent(plan, "en", jst(23, 0))).toMatchObject({
      label: "Leave in",
      island: "Leave in",
      from: "From Shibuya",
      countdownTo: RECOMMENDED_LEAVE_BY,
      title: "Leave at 23:37 — from Shibuya",
    });
  });

  test("is in Japanese when the app is", () => {
    expect(liveActivityContent(plan, "ja", jst(23, 0))).toMatchObject({
      label: "ここを出るまで",
      island: "出るまで",
      from: "渋谷駅から",
      to: "菊名へ",
      checked: "22:41 確認",
    });
  });

  test("counts to the train once the leave time has passed", () => {
    const content = liveActivityContent(plan, "en", RECOMMENDED_LEAVE_BY + MINUTE_MS);
    expect(content).toMatchObject({ label: "Last train 23:52 in", island: "Last train", tone: "train", countdownTo: LAST_TRAIN });
    expect(content?.stops.map((stop) => stop.state)).toEqual(["done", "next"]);
  });

  test("ends once the last train has gone", () => {
    expect(liveActivityContent(plan, "en", LAST_TRAIN + MINUTE_MS)).toBeNull();
  });

  test("changes signature only when what is shown changes", () => {
    const early = liveActivityContent(plan, "en", jst(23, 0))!;
    const later = liveActivityContent(plan, "en", jst(23, 10))!;
    expect(contentSignature(early)).toBe(contentSignature(later));
    const moved = liveActivityContent({ ...plan, leaveByMs: LEAVE_BY + 5 * MINUTE_MS }, "en", jst(23, 10))!;
    expect(contentSignature(moved)).not.toBe(contentSignature(early));
    expect(contentSignature(liveActivityContent(plan, "en", jst(23, 10), "forest")!)).not.toBe(contentSignature(later));
  });

  test("says when it was last checked, and that app-only tracking needs the app", () => {
    expect(liveActivityContent(plan, "ja", jst(23, 0))?.checked).toBe("22:41 確認");
    expect(liveActivityContent(plan, "ja", jst(23, 0), undefined, true)?.checked).toBe("22:41 確認 · 開くと更新");
    expect(liveActivityContent(plan, "en", jst(23, 0), undefined, true)?.checked).toBe("Checked 22:41 · open to update");
  });
});

describe("nextLiveActivityPhase (shown by itself once iOS marks the activity stale)", () => {
  test("before the leave time: the train countdown that follows it", () => {
    const content = liveActivityContent(plan, "ja", jst(23, 0))!;
    const next = nextLiveActivityPhase(plan, "ja", content)!;
    expect(next).toMatchObject({ tone: "train", countdownTo: LAST_TRAIN, island: "終電" });
    expect(next.stops.map((stop) => stop.state)).toEqual(["done", "next"]);
    // The same thing the app would send at that moment.
    const atLeave = liveActivityContent(plan, "ja", RECOMMENDED_LEAVE_BY + 1)!;
    expect(next.label).toBe(atLeave.label);
  });

  test("nothing after the last train's countdown", () => {
    const content = liveActivityContent(plan, "en", RECOMMENDED_LEAVE_BY + MINUTE_MS)!;
    expect(nextLiveActivityPhase(plan, "en", content)).toBeNull();
  });

  test("with 1本前: after its departure, the last train", () => {
    const earlier = { ...plan, trainChoice: 1 as const, nightLastTrain: { departsAt: jst(0 + 24, 5), source: "live" as const } };
    const content = liveActivityContent(earlier, "en", jst(23, 0));
    if (!content) return;
    const next = nextLiveActivityPhase(earlier, "en", content);
    expect(next === null || next.countdownTo > content.countdownTo).toBe(true);
  });

  test("content plus the next countdown stays well inside ActivityKit's 4 KB", () => {
    for (const language of ["ja", "en"] as const) {
      const content = liveActivityContent(plan, language, jst(23, 0))!;
      const props = { ...content, shownAt: jst(23, 0), next: nextLiveActivityPhase(plan, language, content) };
      expect(new TextEncoder().encode(JSON.stringify(props)).length).toBeLessThan(3000);
    }
  });
});

describe("top right: the same three lines as the medium widget", () => {
  test("where to and the arrival, with the saved place's name", () => {
    const withArrival = { ...plan, lastTrain: { ...plan.lastTrain, arrivesAt: jst(24, 39) } };
    const content = liveActivityContent(withArrival, "ja", jst(23, 0), undefined, false, "自宅")!;
    expect(content.from).toBe("渋谷駅から");
    expect(content.to).toBe("自宅へ · 00:39 着");
    expect(content.checked).toBe("22:41 確認");
  });
});
