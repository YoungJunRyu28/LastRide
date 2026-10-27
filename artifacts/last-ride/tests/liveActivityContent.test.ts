/**
 * The Live Activity counts what the app and the widgets count, at the same
 * moment, and ends once the last train has gone.
 */
import { describe, expect, test } from "vitest";
import { contentSignature, liveActivityContent } from "@/lib/liveActivityContent";
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
      label: "出発まで",
      island: "出るまで",
      from: "渋谷駅から",
      choice: "帰り時 · 終電",
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
