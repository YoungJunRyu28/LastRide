/**
 * The lock-screen countdown: what it says, and what it counts down to, as the
 * night moves from "plenty of time" to "go now" to "the last train has gone".
 */
import { describe, expect, test } from "vitest";
import {
  contentSignature,
  liveActivityContent,
} from "@/lib/liveActivityContent";
import type { StationOption } from "@/lib/stations";
import { MINUTE_MS } from "@/lib/time";

/** Epoch ms for a wall-clock time in Japan (UTC+9). */
function jst(hours: number, minutes = 0) {
  return Date.UTC(2026, 9, 9, hours - 9, minutes);
}

const LEAVE_BY = jst(23, 41);
const RECOMMENDED_LEAVE_BY = jst(23, 37);
const LAST_TRAIN = jst(23, 52);
const shibuya: StationOption = {
  name: "Shibuya",
  nameJa: "渋谷",
  latitude: 35.658,
  longitude: 139.701,
} as StationOption;
const plan = {
  leaveByMs: LEAVE_BY,
  lastTrain: { departsAt: LAST_TRAIN, source: "live" as const },
  walkingMinutes: 8,
  station: shibuya,
};

describe("liveActivityContent", () => {
  test("counts down to leave-by while there is time", () => {
    const content = liveActivityContent(plan, "en", jst(23, 0));
    expect(content).toEqual({
      title: "Leave by 23:37",
      subtitle: "8 min walk to Shibuya · last train 23:52",
      countdownTo: RECOMMENDED_LEAVE_BY,
    });
  });

  test("is in Japanese when the app is", () => {
    expect(liveActivityContent(plan, "ja", jst(23, 0))).toMatchObject({
      title: "23:37までに出発",
      subtitle: "渋谷まで徒歩8分 · 終電 23:52",
    });
  });

  test("switches to the last train once the recommended departure has passed", () => {
    const content = liveActivityContent(
      plan,
      "en",
      RECOMMENDED_LEAVE_BY + MINUTE_MS,
    );
    expect(content?.title).toBe("Leave now — last train 23:52");
    expect(content?.countdownTo).toBe(LAST_TRAIN);
  });

  test("ends once the last train has gone", () => {
    expect(liveActivityContent(plan, "en", LAST_TRAIN + MINUTE_MS)).toBeNull();
  });

  test("changes signature only when what is shown changes", () => {
    const early = liveActivityContent(plan, "en", jst(22, 0))!;
    const later = liveActivityContent(plan, "en", jst(23, 0))!;
    expect(contentSignature(early)).toBe(contentSignature(later));
    const moved = liveActivityContent(
      { ...plan, leaveByMs: LEAVE_BY + 5 * MINUTE_MS },
      "en",
      jst(23, 0),
    )!;
    expect(contentSignature(moved)).not.toBe(contentSignature(early));
  });
});
