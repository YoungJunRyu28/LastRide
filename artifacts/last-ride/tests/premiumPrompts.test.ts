import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));

import { leaveCardFor, leaveCardVariant } from "@/lib/premiumPrompts";

describe("leaveCardFor", () => {
  it("shows to free users", () => {
    expect(leaveCardFor({ isPremium: false, opens: 3, dismissed: false })).toBe("widget");
  });

  it("never shows to premium users or once closed", () => {
    expect(leaveCardFor({ isPremium: true, opens: 3, dismissed: false })).toBeNull();
    expect(leaveCardFor({ isPremium: false, opens: 3, dismissed: true })).toBeNull();
  });

  it("waits for the opening count", () => {
    expect(leaveCardFor({ isPremium: false, opens: null, dismissed: false })).toBeNull();
  });
});

describe("leaveCardVariant", () => {
  it("switches on every opening", () => {
    expect(leaveCardVariant(4)).toBe("lock");
    expect(leaveCardVariant(5)).toBe("widget");
    expect(leaveCardVariant(6)).toBe("lock");
  });
});
