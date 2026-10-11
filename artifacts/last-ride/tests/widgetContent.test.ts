/**
 * Home/lock widgets: the timeline handed to WidgetKit for the night.
 */
import { describe, expect, test } from "vitest";
import type { StationOption } from "@/lib/stations";
import { widgetMessage, widgetTimeline } from "@/lib/widgetContent";

/** Epoch ms for a wall-clock time in Japan (UTC+9). */
function jst(hours: number, minutes = 0) {
  return Date.UTC(2026, 9, 9, hours - 9, minutes);
}

const shibuya = { name: "Shibuya", nameJa: "渋谷", latitude: 35.658, longitude: 139.701 } as StationOption;
const oshiage = { name: "Oshiage", nameJa: "押上", latitude: 35.71, longitude: 139.813 } as StationOption;
const plan = {
  leaveByMs: jst(23, 41),
  lastTrain: { departsAt: jst(23, 52), arrivesAt: jst(24, 24), source: "live" as const },
  walkingMinutes: 8,
  station: shibuya,
  destination: oshiage,
};

describe("widgetTimeline", () => {
  test("counts down to leave-by, then to the last train, then ends", () => {
    const entries = widgetTimeline(plan, "自宅", "ja", jst(23, 0));
    expect(entries.map((entry) => entry.date.getTime())).toEqual([jst(23, 0), jst(23, 37), jst(23, 57)]);
    expect(entries[0].props).toMatchObject({
      kind: "plan",
      heading: "帰り時 · 自宅へ",
      bigTime: "23:37",
      inline: "23:37 出発 · 終電 23:52",
      countdownLabel: "出発まで",
      countdownTo: jst(23, 37),
      footer: "23:37 渋谷",
      arrival: "押上着 00:24",
    });
    expect(entries[1].props).toMatchObject({ countdownLabel: "終電まで", countdownTo: jst(23, 52), bigTime: "23:52" });
    expect(entries[2].props).toEqual(widgetMessage("ja", "ended"));
  });

  test("starts on the last-train countdown once leave-by has passed", () => {
    const entries = widgetTimeline(plan, "Home", "en", jst(23, 45));
    expect(entries).toHaveLength(2);
    expect(entries[0].props).toMatchObject({ inline: "Leave now · last 23:52", shownAt: jst(23, 45) });
  });

  test("shows only the ended notice after the last train", () => {
    const entries = widgetTimeline(plan, "Home", "en", jst(24, 30));
    expect(entries).toHaveLength(1);
    expect(entries[0].props.kind).toBe("message");
  });

  test("marks an approximate (Apple, maybe-walking) last train as 目安", () => {
    const approx = { ...plan, lastTrain: { ...plan.lastTrain, source: "apple" as const, approximate: true } };
    const entries = widgetTimeline(approx, "自宅", "ja", jst(23, 0));
    expect(entries[0].props.inline).toBe("23:37 出発 · 終電 23:52（目安）");
  });

  test("labels an Apple arrival as roughly when you leave the station", () => {
    const apple = { ...plan, lastTrain: { ...plan.lastTrain, source: "apple" as const } };
    expect(widgetTimeline(apple, "自宅", "ja", jst(23, 0))[0].props.arrival).toBe("押上 00:24ごろ");
  });
});
