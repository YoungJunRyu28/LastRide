import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

import { leaveCardFor, leaveCardVariant, type PromptState } from "@/lib/premiumPrompts";
import { serviceDate } from "@/lib/time";

// 2026-10-10 22:00 JST
const night = Date.UTC(2026, 9, 10, 13, 0);
const nextNight = night + 24 * 60 * 60 * 1000;
const fresh: PromptState = { trialOfferShown: true, promptNight: null, cardDismissedNight: null };

describe("leaveCardFor", () => {
  it("shows a card to free users with time to spare", () => {
    expect(leaveCardFor({ isPremium: false, status: "relaxed", state: fresh, nowMs: night })).not.toBeNull();
  });

  it("never shows to premium users or close to leave-by", () => {
    expect(leaveCardFor({ isPremium: true, status: "relaxed", state: fresh, nowMs: night })).toBeNull();
    for (const status of ["soon", "now", "hurry", "departed"] as const) {
      expect(leaveCardFor({ isPremium: false, status, state: fresh, nowMs: night })).toBeNull();
    }
  });

  it("skips the night the trial offer was shown and the night it was dismissed", () => {
    const tonight = serviceDate(night);
    expect(leaveCardFor({ isPremium: false, status: "relaxed", state: { ...fresh, promptNight: tonight }, nowMs: night })).toBeNull();
    expect(leaveCardFor({ isPremium: false, status: "relaxed", state: { ...fresh, cardDismissedNight: tonight }, nowMs: night })).toBeNull();
    expect(leaveCardFor({ isPremium: false, status: "relaxed", state: { ...fresh, cardDismissedNight: tonight }, nowMs: nextNight })).not.toBeNull();
  });

  it("treats after-midnight as the same night", () => {
    const afterMidnight = night + 3 * 60 * 60 * 1000; // 01:00 JST
    const tonight = serviceDate(night);
    expect(leaveCardFor({ isPremium: false, status: "relaxed", state: { ...fresh, cardDismissedNight: tonight }, nowMs: afterMidnight })).toBeNull();
  });
});

describe("leaveCardVariant", () => {
  it("alternates nightly", () => {
    expect(leaveCardVariant(night)).not.toBe(leaveCardVariant(nextNight));
    expect(leaveCardVariant(night)).toBe(leaveCardVariant(nextNight + 24 * 60 * 60 * 1000));
  });
});
