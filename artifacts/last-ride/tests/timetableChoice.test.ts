import { describe, expect, it } from "vitest";
import { earlierFirstTrain, laterLastTrain, type TrainTime } from "@/lib/timetable";

/** Epoch ms for a JST clock time; hours past midnight are passed as 24, 25… (e.g. "24:08"). */
const at = (hhmm: string) => Date.UTC(2026, 9, 10, Number(hhmm.slice(0, 2)) - 9, Number(hhmm.slice(3)));
const odpt = (hhmm: string): TrainTime => ({ departsAt: at(hhmm), source: "live" });
const apple = (hhmm: string, approximate = false): TrainTime => ({ departsAt: at(hhmm), source: "apple", ...(approximate ? { approximate } : {}) });

describe("laterLastTrain", () => {
  it("uses Apple's later train where ODPT only covers an earlier route", () => {
    // 渋谷→池袋: ODPT 00:08 (副都心線), JR 00:33.
    expect(laterLastTrain(odpt("24:08"), apple("24:33")).source).toBe("apple");
  });

  it("keeps ODPT when Apple's later answer may be a walk", () => {
    expect(laterLastTrain(odpt("24:08"), apple("24:50", true)).source).toBe("live");
  });

  it("keeps ODPT when it is later or Apple has nothing", () => {
    expect(laterLastTrain(odpt("24:30"), apple("24:10")).source).toBe("live");
    expect(laterLastTrain(odpt("24:30"), null).source).toBe("live");
  });
});

describe("earlierFirstTrain", () => {
  it("uses Apple's earlier first train unless it may be a walk", () => {
    expect(earlierFirstTrain(odpt("29:01"), apple("28:40")).source).toBe("apple");
    expect(earlierFirstTrain(odpt("29:01"), apple("28:35", true)).source).toBe("live");
  });
});
