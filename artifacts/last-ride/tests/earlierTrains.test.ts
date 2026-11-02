import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

import { rememberEarlierTrains, resetEarlierTrainsMemory } from "@/lib/earlierTrains";
import type { TrainTime } from "@/lib/timetable";

// 23:00 JST, 2026-11-02 (service night 20261102).
const NOW = Date.parse("2026-11-02T14:00:00Z");
const at = (hhmm: string) => Date.parse(`2026-11-02T${hhmm}:00+09:00`);
const train = (hhmm: string): TrainTime => ({ departsAt: at(hhmm), source: "apple" });
const LAST = train("23:56");

describe("rememberEarlierTrains", () => {
  beforeEach(() => {
    storage.clear();
    resetEarlierTrainsMemory();
  });

  it("keeps 1本前 / 2本前 found earlier when a later search of the same station finds none", async () => {
    const first = await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")], NOW);
    expect(first.map((t) => t.departsAt)).toEqual([at("23:46"), at("23:36")]);
    const again = await rememberEarlierTrains("山手", "菊名", LAST, [], NOW + 60_000);
    expect(again.map((t) => t.departsAt)).toEqual([at("23:46"), at("23:36")]);
  });

  it("also when it finds only one of them", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")], NOW);
    const again = await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46")], NOW);
    expect(again).toHaveLength(2);
  });

  it("takes a new list as long as the remembered one (a changed timetable comes through)", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")], NOW);
    const again = await rememberEarlierTrains("山手", "菊名", LAST, [train("23:47"), train("23:37")], NOW);
    expect(again.map((t) => t.departsAt)).toEqual([at("23:47"), at("23:37")]);
  });

  it("is per station and destination", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46")], NOW);
    expect(await rememberEarlierTrains("石川町", "菊名", LAST, [], NOW)).toEqual([]);
    expect(await rememberEarlierTrains("山手", "渋谷", LAST, [], NOW)).toEqual([]);
  });

  it("drops remembered trains that aren't before tonight's last train", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")], NOW);
    const earlierLast = train("23:40");
    const again = await rememberEarlierTrains("山手", "菊名", earlierLast, [], NOW);
    expect(again.map((t) => t.departsAt)).toEqual([at("23:36")]);
  });

  it("survives a relaunch (on disk), and is forgotten the next night", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46")], NOW);
    resetEarlierTrainsMemory();
    expect(await rememberEarlierTrains("山手", "菊名", LAST, [], NOW)).toHaveLength(1);
    resetEarlierTrainsMemory();
    const nextNight = NOW + 24 * 60 * 60 * 1000;
    const nextLast = { ...LAST, departsAt: LAST.departsAt + 24 * 60 * 60 * 1000 };
    expect(await rememberEarlierTrains("山手", "菊名", nextLast, [], nextNight)).toEqual([]);
  });
});
