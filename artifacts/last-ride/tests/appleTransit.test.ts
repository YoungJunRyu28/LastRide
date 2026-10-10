import { describe, expect, it } from "vitest";
import { lastTrainArriveBy, looksLikeWalking } from "@/lib/appleTransit";

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

describe("looksLikeWalking", () => {
  it("treats a trip about as slow as walking as a walk", () => {
    // Isezakichojamachi → Minatomirai: 37 min "transit", 38 min on foot.
    expect(looksLikeWalking(37 * 60, 38 * 60)).toBe(true);
  });

  it("keeps a trip clearly faster than walking", () => {
    // Shibuya → Kichijoji: ~35 min by train, ~3 h on foot.
    expect(looksLikeWalking(35 * 60, 180 * 60)).toBe(false);
  });
});
