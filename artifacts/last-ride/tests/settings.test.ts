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
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) storage.delete(key);
    }),
  },
}));

import {
  readSettings,
  STORAGE_KEYS,
  writeDestinationState,
  type SavedDestination,
  deliveredReminders,
} from "@/lib/settings";

const homeStation = {
  name: "Shibuya",
  nameJa: "渋谷",
  latitude: 35.658,
  longitude: 139.7016,
};

const workStation = {
  name: "Tokyo",
  nameJa: "東京",
  latitude: 35.6812,
  longitude: 139.7671,
};

describe("saved destinations", () => {
  beforeEach(() => storage.clear());

  it("migrates the legacy single home into a Home destination", async () => {
    storage.set(STORAGE_KEYS.language, "en");
    storage.set(STORAGE_KEYS.homeStation, JSON.stringify(homeStation));

    const settings = await readSettings();

    expect(settings.destinations).toEqual([
      {
        id: "home",
        label: "Home",
        station: homeStation,
        address: null,
      },
    ]);
    expect(settings.activeDestinationId).toBe("home");
    expect(settings.homeStation).toEqual(homeStation);
    expect(storage.get(STORAGE_KEYS.destinations)).toBeTruthy();
  });

  it("uses the selected destination as the legacy-compatible active station", async () => {
    const destinations: SavedDestination[] = [
      { id: "home", label: "Home", station: homeStation, address: null },
      { id: "work", label: "Work", station: workStation, address: null },
    ];

    await writeDestinationState(destinations, "work");
    const settings = await readSettings();

    expect(settings.activeDestinationId).toBe("work");
    expect(settings.homeStation).toEqual(workStation);
    // Long-term storage keeps the name only (lib/storedPlaces); the position comes from tonight's cache.
    expect(JSON.parse(storage.get(STORAGE_KEYS.homeStation) || "null")).toMatchObject({
      nameJa: "東京",
      latitude: 0,
      longitude: 0,
    });
  });
});

describe("余裕 (time to spare)", () => {
  beforeEach(() => storage.clear());

  it("reads the saved choice and falls back to normal", async () => {
    expect((await readSettings()).leaveMargin).toBe("normal");
    storage.set(STORAGE_KEYS.leaveMargin, "relaxed");
    expect((await readSettings()).leaveMargin).toBe("relaxed");
    storage.set(STORAGE_KEYS.leaveMargin, "nonsense");
    expect((await readSettings()).leaveMargin).toBe("normal");
  });

  it("drops the old walking-pace setting", async () => {
    storage.set("lastride-walking-speed", "fast");
    await readSettings();
    expect(storage.has("lastride-walking-speed")).toBe(false);
  });
});

describe("deliveredReminders", () => {
  const chosen = { notifications: [30], alarms: [15, 0], sound: "chime" as const };

  it("delivers every choice with Premium", () => {
    expect(deliveredReminders(chosen, true)).toEqual(chosen);
  });

  it("keeps only the leave-time alarm and the iOS sound on the free plan", () => {
    expect(deliveredReminders(chosen, false)).toEqual({ notifications: [30, 15], alarms: [0], sound: "default" });
  });

  it("never drops a reminder when Premium ends", () => {
    const free = deliveredReminders({ notifications: [], alarms: [30, 10, 5], sound: "urgent" }, false);
    expect(free.notifications).toEqual([30, 10, 5]);
    expect(free.alarms).toEqual([]);
  });
});
