/**
 * The monthly timetable refresh: a broken result is never published, and the
 * API serves whichever timetable is newer (S3 refresh or the bundled copy).
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { refreshProblem } from "../src/transitRefresh";
import { newerSnapshot } from "../src/lib/timetableEngine";

const allOperators = { TokyoMetro: 10000, Toei: 5600, MIR: 840, TWR: 560, TamaMonorail: 470, YokohamaMunicipal: 1300 };
const previous = { stations: 424, trips: 18769 };

describe("whether a refreshed timetable may replace the one in place", () => {
  it("a normal refresh is published", () => {
    expect(refreshProblem({ stations: 424, trips: 18800, trainsByOperator: allOperators }, previous)).toBeNull();
    // The very first refresh, with nothing in place yet.
    expect(refreshProblem({ stations: 424, trips: 18800, trainsByOperator: allOperators }, null)).toBeNull();
  });

  it("an operator missing from ODPT's dump is not published", () => {
    expect(refreshProblem({ stations: 424, trips: 13000, trainsByOperator: { ...allOperators, Toei: 0 } }, previous)).toMatch(/no trains for Toei/);
  });

  it("far fewer trains or stations than the timetable in place is not published", () => {
    expect(refreshProblem({ stations: 424, trips: 9000, trainsByOperator: allOperators }, previous)).toMatch(/9000 trains/);
    expect(refreshProblem({ stations: 300, trips: 18800, trainsByOperator: allOperators }, previous)).toMatch(/300 stations/);
  });
});

describe("which timetable the API serves", () => {
  const at = (generatedAt: string) => ({ raw: { generatedAt } });
  it("the newer one, S3 refresh or bundled copy", () => {
    const bundled = at("2026-10-11T06:28:57.799Z");
    const refreshed = at("2026-11-01T19:30:00.000Z");
    expect(newerSnapshot(bundled, refreshed)).toBe(refreshed);
    expect(newerSnapshot(refreshed, bundled)).toBe(refreshed);
  });
  it("whichever exists when only one does", () => {
    const bundled = at("2026-10-11T06:28:57.799Z");
    expect(newerSnapshot(bundled, null)).toBe(bundled);
    expect(newerSnapshot(null, bundled)).toBe(bundled);
    expect(newerSnapshot(null, null)).toBeNull();
  });
});
