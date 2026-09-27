import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

import {
  clearNightHistory,
  readNightHistory,
  recordNightPlan,
} from "@/lib/nightHistory";
import type { NightPlan } from "@/lib/planner";
import { STORAGE_KEYS } from "@/lib/settings";

function plan(overrides: Partial<NightPlan> = {}): NightPlan {
  return {
    station: {
      name: "Shibuya",
      nameJa: "渋谷",
      latitude: 35.658,
      longitude: 139.7016,
    },
    walkingMinutes: 8,
    distanceMeters: 600,
    lastTrain: {
      departsAt: Date.parse("2026-09-26T14:30:00Z"),
      arrivesAt: Date.parse("2026-09-26T15:10:00Z"),
      transfers: 0,
      fareYen: 230,
      legs: [],
      source: "live",
    },
    leaveByMs: Date.parse("2026-09-26T14:19:00Z"),
    destination: {
      name: "Tokyo",
      nameJa: "東京",
      latitude: 35.6812,
      longitude: 139.7671,
    },
    coordinates: { latitude: 35.66, longitude: 139.7 },
    alternatives: [],
    autoPick: undefined as unknown as NightPlan["autoPick"],
    pinned: false,
    computedAt: Date.parse("2026-09-26T13:00:00Z"),
    ...overrides,
  };
}

describe("night history", () => {
  beforeEach(() => storage.clear());

  it("upserts replans for the same service night and destination", async () => {
    const destination = { id: "work", label: "Work" };
    await recordNightPlan(plan(), destination);
    await recordNightPlan(
      plan({
        leaveByMs: Date.parse("2026-09-26T14:24:00Z"),
        computedAt: Date.parse("2026-09-26T13:10:00Z"),
      }),
      destination,
    );

    const history = await readNightHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.destinationLabel).toBe("Work");
    expect(history[0]?.leaveByMs).toBe(Date.parse("2026-09-26T14:24:00Z"));
  });

  it("keeps different destinations as separate entries", async () => {
    await recordNightPlan(plan(), { id: "home", label: "Home" });
    await recordNightPlan(plan(), { id: "work", label: "Work" });

    const history = await readNightHistory();
    expect(history.map((entry) => entry.destinationLabel).sort()).toEqual([
      "Home",
      "Work",
    ]);
  });

  it("clears local history", async () => {
    await recordNightPlan(plan(), { id: "home", label: "Home" });
    await clearNightHistory();

    expect(await readNightHistory()).toEqual([]);
    expect(storage.has(STORAGE_KEYS.nightHistory)).toBe(false);
  });
});
