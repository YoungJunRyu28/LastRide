import { describe, expect, it } from "vitest";
import { lastTrainArriveBy } from "@/lib/appleTransit";

/** Epoch ms for a wall-clock time in Japan (UTC+9). */
function jst(day: number, hours: number, minutes = 0) {
  return Date.UTC(2026, 9, day, hours - 9, minutes);
}

describe("lastTrainArriveBy", () => {
  it("asks for arrival by 03:00 after the evening", () => {
    expect(lastTrainArriveBy(jst(10, 22))).toBe(jst(11, 3));
  });

  it("keeps the same night after midnight", () => {
    expect(lastTrainArriveBy(jst(11, 1, 30))).toBe(jst(11, 3));
  });
});
