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
    expect(JSON.parse(storage.get(STORAGE_KEYS.homeStation) || "null")).toEqual(
      workStation,
    );
  });
});
