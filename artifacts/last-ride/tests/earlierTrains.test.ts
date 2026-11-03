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

const DAY = 24 * 60 * 60 * 1000;
// Night of 2026-11-02 (JST); "24:05" is 00:05 the next morning, still that night.
const at = (hhmm: string, night = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.parse(`2026-11-02T00:00:00+09:00`) + night * DAY + (h * 60 + m) * 60_000;
};
const train = (hhmm: string, night = 0): TrainTime => ({ departsAt: at(hhmm, night), source: "apple" });
const LAST = train("23:56");

describe("rememberEarlierTrains", () => {
  beforeEach(() => {
    storage.clear();
    resetEarlierTrainsMemory();
  });

  it("keeps 1本前 / 2本前 found earlier when a later search of the same last train finds none", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")]);
    const again = await rememberEarlierTrains("山手", "菊名", LAST, []);
    expect(again.map((t) => t.departsAt)).toEqual([at("23:46"), at("23:36")]);
  });

  it("fills in the one this search missed", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")]);
    const again = await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46")]);
    expect(again.map((t) => t.departsAt)).toEqual([at("23:46"), at("23:36")]);
  });

  it("merges by departure: the same train a minute apart counts once, the newest answer wins", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")]);
    const again = await rememberEarlierTrains("山手", "菊名", LAST, [train("23:47")]);
    expect(again.map((t) => t.departsAt)).toEqual([at("23:47"), at("23:36")]);
  });

  it("is per station and destination", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46")]);
    expect(await rememberEarlierTrains("石川町", "菊名", LAST, [])).toEqual([]);
    expect(await rememberEarlierTrains("山手", "渋谷", LAST, [])).toEqual([]);
  });

  it("never lends trains to a different last train (a later one found since)", async () => {
    const server = train("24:08");
    await rememberEarlierTrains("渋谷", "菊名", server, [train("23:55"), train("23:40")]);
    const later = train("24:33");
    const again = await rememberEarlierTrains("渋谷", "菊名", later, [train("24:20")]);
    expect(again.map((t) => t.departsAt)).toEqual([at("24:20")]);
  });

  it("never brings back last night's trains, whatever the time of the call", async () => {
    // Stored while still on last night's plan (e.g. a re-plan at 04:30).
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("23:36")]);
    // Tonight's last train, same station: Apple found only one.
    const tonight = await rememberEarlierTrains("山手", "菊名", train("23:56", 1), [train("23:46", 1)]);
    expect(tonight.map((t) => t.departsAt)).toEqual([at("23:46", 1)]);
  });

  it("survives a relaunch (on disk)", async () => {
    await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46")]);
    resetEarlierTrainsMemory();
    expect(await rememberEarlierTrains("山手", "菊名", LAST, [])).toHaveLength(1);
  });

  it("only keeps trains within two hours before the last train", async () => {
    const kept = await rememberEarlierTrains("山手", "菊名", LAST, [train("23:46"), train("21:30")]);
    expect(kept.map((t) => t.departsAt)).toEqual([at("23:46")]);
  });
});
