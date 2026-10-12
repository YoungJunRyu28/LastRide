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
  readTrainChoice,
  trainChoiceUntil,
  writeTrainChoice,
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

  it("reads the saved minutes, converts older presets and falls back to 4", async () => {
    expect((await readSettings()).leaveMargin).toBe(4);
    storage.set(STORAGE_KEYS.leaveMargin, "7");
    expect((await readSettings()).leaveMargin).toBe(7);
    storage.set(STORAGE_KEYS.leaveMargin, "relaxed");
    expect((await readSettings()).leaveMargin).toBe(10);
    storage.set(STORAGE_KEYS.leaveMargin, "nonsense");
    expect((await readSettings()).leaveMargin).toBe(4);
  });
});

describe("tonight's train (終電 / 1本前 / 2本前)", () => {
  it("is kept until the night it was chosen for is over", async () => {
    const until = Date.now() + 60_000;
    await writeTrainChoice(1, until);
    expect((await readSettings()).trainChoice).toBe(1);
    expect(await readTrainChoice(until + 1)).toBe(0);
    await writeTrainChoice(0, until);
    expect(storage.has(STORAGE_KEYS.trainChoice)).toBe(false);
  });

  it("ends at 05:00 after the night", () => {
    // 23:30 on 9 Oct → 05:00 on 10 Oct (Japan time).
    expect(trainChoiceUntil(Date.UTC(2026, 9, 9, 14, 30))).toBe(Date.UTC(2026, 9, 9, 20, 0));
  });

  it("drops the old walking-pace setting", async () => {
    storage.set("lastride-walking-speed", "fast");
    await readSettings();
    expect(storage.has("lastride-walking-speed")).toBe(false);
  });
});

