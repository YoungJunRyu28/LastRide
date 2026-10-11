/**
 * Apple's transit ETA counts walking as a trip. These tests run the search
 * against a simulated MapKit: a timetable plus the option to walk, answering
 * the way MapKit does (latest departure for "arrive by", earliest arrival for
 * "leave at").
 */
import { describe, expect, it } from "vitest";
import { firstTrainSearchStart, lastTrainArriveBy, searchFirstTrain, searchLastTrain, type EtaQuery } from "@/lib/appleTransit";

/** Epoch ms for a JST clock time on the night of 10 Oct 2026; hours past midnight as 24, 25… */
function jst(hours: number, minutes = 0) {
  return Date.UTC(2026, 9, 10, hours - 9, minutes);
}

type Train = { dep: number; arr: number };

function simulatedMapKit(trains: Train[], walkMinutes: number | null): EtaQuery & { calls: number } {
  const walk = walkMinutes === null ? null : walkMinutes * 60_000;
  const query = (async ({ arriveBy, departAt }) => {
    query.calls += 1;
    if (arriveBy !== undefined) {
      const options = trains.filter((train) => train.arr <= arriveBy).map((train) => ({ departureMs: train.dep, arrivalMs: train.arr }));
      if (walk !== null) options.push({ departureMs: arriveBy - walk, arrivalMs: arriveBy });
      return options.reduce((best, option) => (option.departureMs > best.departureMs ? option : best));
    }
    const start = departAt!;
    const options = trains.filter((train) => train.dep >= start).map((train) => ({ departureMs: train.dep, arrivalMs: train.arr }));
    if (walk !== null) options.push({ departureMs: start, arrivalMs: start + walk });
    return options.reduce((best, option) => (option.arrivalMs < best.arrivalMs ? option : best));
  }) as EtaQuery & { calls: number };
  query.calls = 0;
  return query;
}

// 関内→みなとみらい: last train 00:36→00:58, about a 30-minute walk.
const kannai = [
  { dep: jst(23, 50), arr: jst(24, 12) },
  { dep: jst(24, 14), arr: jst(24, 36) },
  { dep: jst(24, 36), arr: jst(24, 58) },
];

describe("lastTrainArriveBy", () => {
  it("asks for arrival by 03:00 after the evening", () => {
    expect(lastTrainArriveBy(jst(22))).toBe(jst(27));
  });

  it("keeps the same night after midnight", () => {
    expect(lastTrainArriveBy(jst(25, 30))).toBe(jst(27));
  });
});

describe("searchLastTrain", () => {
  it("finds the real last train behind a walking answer", async () => {
    // "Arrive by 03:00" alone answers with a 02:30 walk.
    const found = await searchLastTrain(simulatedMapKit(kannai, 30), jst(22));
    expect(found).toEqual({ departsAt: jst(24, 36), arrivesAt: jst(24, 58) });
  });

  it("takes a long route's train straight away", async () => {
    // 渋谷→吉祥寺: last train 00:20, a 3-hour walk.
    const query = simulatedMapKit([{ dep: jst(24, 20), arr: jst(24, 55) }], 180);
    expect(await searchLastTrain(query, jst(22))).toEqual({ departsAt: jst(24, 20), arrivesAt: jst(24, 55) });
    expect(query.calls).toBe(1);
  });

  it("returns nothing when only walking reaches the destination", async () => {
    expect(await searchLastTrain(simulatedMapKit([], 30), jst(22))).toBeNull();
  });

  it("returns nothing once the deadline is behind us", async () => {
    // At 03:30 the search would only find trains that have already gone.
    expect(await searchLastTrain(simulatedMapKit(kannai, 30), jst(27, 30))).toBeNull();
  });
});

describe("searchFirstTrain", () => {
  it("skips the walk Apple offers before a faster first train", async () => {
    // First train 04:50→04:56; walking takes 22 minutes, so before ~04:35 Apple suggests walking.
    const found = await searchFirstTrain(simulatedMapKit([{ dep: jst(28, 50), arr: jst(28, 56) }], 22), jst(28, 25));
    expect(found).toEqual({ departsAt: jst(28, 50), arrivesAt: jst(28, 56) });
  });

  it("returns nothing when walking is faster than any train", async () => {
    // 関内→元町・中華街: first train 04:50→05:18 via 横浜 (28 min), walking 22 min — walking wins.
    expect(await searchFirstTrain(simulatedMapKit([{ dep: jst(28, 50), arr: jst(29, 18) }], 22), jst(28, 25))).toBeNull();
  });

  it("takes a train straight away when there is no walk", async () => {
    const query = simulatedMapKit([{ dep: jst(28, 50), arr: jst(29, 18) }], null);
    expect(await searchFirstTrain(query, jst(28, 25))).toEqual({ departsAt: jst(28, 50), arrivesAt: jst(29, 18) });
    expect(query.calls).toBe(1);
  });
});

describe("firstTrainSearchStart", () => {
  it("looks from 04:00 when asked during the night", () => {
    expect(firstTrainSearchStart(jst(23, 30))).toBe(jst(28));
    expect(firstTrainSearchStart(jst(24, 40))).toBe(jst(28));
  });

  it("looks from now once trains are running again", () => {
    expect(firstTrainSearchStart(jst(28, 20))).toBe(jst(28, 20));
    expect(firstTrainSearchStart(jst(29, 29))).toBe(jst(29, 29));
  });
});
