/**
 * A tiny made-up snapshot shaped like the real ODPT one, for the server-side
 * engine adapter tests (no real timetable data):
 *
 *   Tokyo Metro 半蔵門線:  渋谷 ─ 表参道 ─ 大手町(M)
 *   Toei 浅草線:          大手町(T) ─ 日本橋 ─ 押上〈スカイツリー前〉
 *   Yurikamome (not licensed, must be dropped): 新橋 ─ お台場海浜公園
 *
 * 大手町(M) and 大手町(T) are ~150 m apart: a 5-minute walk to change.
 * Times are service-day minutes, so 24:10 is 00:10 after midnight.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseClock, type Station, type TransitSnapshot, type Trip } from "../../src/lib/transit/model";
import { assembleSnapshot, writeSnapshot } from "../../src/lib/transit/snapshot";

const t = parseClock;

export const STATION = {
  shibuya: { lat: 35.658, lon: 139.7016 },
  otemachiMetro: { lat: 35.6862, lon: 139.766 },
  oshiage: { lat: 35.7104, lon: 139.8132 },
  shimbashi: { lat: 35.666, lon: 139.759 },
};

const stations: Station[] = [
  { id: "odpt.Station:TokyoMetro.Hanzomon.Shibuya", nameJa: "渋谷", name: "Shibuya", ...STATION.shibuya, operator: "odpt.Operator:TokyoMetro" },
  { id: "odpt.Station:TokyoMetro.Hanzomon.OmoteSando", nameJa: "表参道", name: "Omote-sando", lat: 35.6653, lon: 139.7123, operator: "odpt.Operator:TokyoMetro" },
  { id: "odpt.Station:TokyoMetro.Hanzomon.Otemachi", nameJa: "大手町", name: "Otemachi", ...STATION.otemachiMetro, operator: "odpt.Operator:TokyoMetro" },
  { id: "odpt.Station:Yurikamome.Yurikamome.Shimbashi", nameJa: "新橋", name: "Shimbashi", ...STATION.shimbashi, operator: "odpt.Operator:Yurikamome" },
  { id: "odpt.Station:Toei.Asakusa.Otemachi", nameJa: "大手町", name: "Otemachi", lat: 35.6849, lon: 139.7668, operator: "odpt.Operator:Toei" },
  { id: "odpt.Station:Toei.Asakusa.Nihombashi", nameJa: "日本橋", name: "Nihombashi", lat: 35.682, lon: 139.774, operator: "odpt.Operator:Toei" },
  { id: "odpt.Station:Toei.Asakusa.Oshiage", nameJa: "押上〈スカイツリー前〉", name: "Oshiage (SKYTREE)", ...STATION.oshiage, operator: "odpt.Operator:Toei" },
  { id: "odpt.Station:Yurikamome.Yurikamome.OdaibaKaihinkoen", nameJa: "お台場海浜公園", name: "Odaiba-kaihinkoen", lat: 35.6297, lon: 139.7785, operator: "odpt.Operator:Yurikamome" },
];

const hanzomon = { name: "Hanzomon Line", nameJa: "半蔵門線" };
const asakusa = { name: "Asakusa Line", nameJa: "浅草線" };

function metro(id: string, departs: string): Trip {
  const start = t(departs);
  return {
    id: `odpt.TrainTimetable:TokyoMetro.Hanzomon.${id}.Weekday`,
    service: "everyday",
    line: hanzomon,
    stops: [
      [0, null, start],
      [1, start + 3, start + 3],
      [2, start + 20, null],
    ],
  };
}

function toei(id: string, departs: string): Trip {
  const start = t(departs);
  return {
    id: `odpt.TrainTimetable:Toei.Asakusa.${id}.Weekday`,
    service: "everyday",
    line: asakusa,
    stops: [
      [4, null, start],
      [5, start + 3, start + 3],
      [6, start + 15, null],
    ],
  };
}

const trips: Trip[] = [
  metro("A0500", "05:00"),
  metro("A2330", "23:30"),
  metro("A2350", "23:50"), // the last one that makes the Toei connection
  metro("A2400", "24:00"), // reaches 大手町 at 24:20, too late for the 24:20 Toei
  toei("T0530", "05:30"),
  toei("T2358", "23:58"),
  toei("T2420", "24:20"),
  {
    id: "odpt.TrainTimetable:Yurikamome.Yurikamome.Y2400.Weekday",
    service: "everyday",
    line: { name: "Yurikamome", nameJa: "ゆりかもめ" },
    stops: [
      [3, null, t("24:00")],
      [7, t("24:15"), null],
    ],
  },
];

export const fixtureSnapshot: TransitSnapshot = assembleSnapshot(
  [
    { operator: "odpt.Operator:TokyoMetro", format: "odpt", url: "test", license: "test" },
    { operator: "odpt.Operator:Toei", format: "odpt", url: "test", license: "test" },
    { operator: "odpt.Operator:Yurikamome", format: "odpt", url: "test", license: "test" },
  ],
  stations,
  { everyday: { dayTypes: ["weekday", "saturday", "holiday"] } },
  trips,
  "2026-10-01T00:00:00.000Z",
);

/** Writes the fixture as a .json.gz like transit:build does; returns its path. */
export async function writeFixtureSnapshot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lastride-transit-"));
  const file = path.join(dir, "transit-snapshot.json.gz");
  await writeSnapshot(file, fixtureSnapshot);
  return file;
}
