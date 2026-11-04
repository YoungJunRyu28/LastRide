/**
 * Two engine edge cases found in the pre-release review: a same-named station's
 * other platform far away, and a train that passes home before a later one
 * comes back to it.
 */
import { describe, expect, it } from "vitest";
import { searchTrainIn } from "../src/lib/timetableEngine";
import { lastTrainBetween } from "../src/lib/transit/snapshot";
import type { TransitSnapshot } from "../src/lib/transit/model";

const all = { all: { dayTypes: ["weekday", "saturday", "holiday"] } };

describe("a same-named platform 600 m away", () => {
  const st = (id: string, nameJa: string, lat: number, lon: number) => ({ id, name: id, nameJa, lat, lon, operator: "odpt.Operator:Test" });
  // Metro 浅草 (here) and TX 浅草 (~600 m off); home 北千住.
  const snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: [],
    stations: [st("M", "浅草", 35.711, 139.7983), st("TX", "浅草", 35.7134, 139.7925), st("K", "北千住", 35.749, 139.805)],
    services: all,
    trips: [
      { id: "m", service: "all", line: { name: "G", nameJa: "銀座線" }, stops: [[0, null, 1400], [2, 1420, null]] },
      { id: "tx", service: "all", line: { name: "TX", nameJa: "つくばエクスプレス" }, stops: [[1, null, 1450], [2, 1456, null]] },
    ],
  } as unknown as TransitSnapshot;

  it("counts the walk to it: leaving here before 00:10, not at 00:10", () => {
    const route = searchTrainIn(snapshot, "last", { latitude: 35.711, longitude: 139.7983, name: "浅草" }, { latitude: 35.749, longitude: 139.805, name: "北千住" }, "20261104");
    expect(route).not.toBeNull();
    // 00:10 from TX 浅草, minus the 12-minute walk between the platforms (not 00:10 as if it were here).
    const departs = new Date(route!.departsAt);
    expect(new Date(departs.getTime() + 9 * 3600_000).toISOString().slice(11, 16)).toBe("23:58");
  });
});

describe("a train that passes home", () => {
  const st = (id: string, lat: number) => ({ id, name: id, nameJa: id, lat, lon: 139.7, operator: "odpt.Operator:Test" });
  const snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: [],
    stations: [st("X", 35.6), st("T", 35.62), st("Y", 35.64)],
    services: all,
    trips: [
      { id: "out", service: "all", line: { name: "L", nameJa: "L線" }, stops: [[0, null, 1445], [1, 1450, 1450], [2, 1453, null]] },
      { id: "in", service: "all", line: { name: "L", nameJa: "L線" }, stops: [[2, null, 1460], [1, 1463, null]] },
    ],
  } as unknown as TransitSnapshot;

  it("gets off at home, not past it and back", () => {
    const journey = lastTrainBetween(snapshot, "2026-11-04", [0], [1]);
    expect(journey).not.toBeNull();
    expect(journey!.transfers).toBe(0);
    // Arrives at T at 00:10 (1450), not 00:23 after riding to Y and back.
    expect(journey!.legs).toHaveLength(1);
  });
});
