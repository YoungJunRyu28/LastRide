/**
 * The last-train engine on a small made-up network:
 *
 *   A-line (Metro):  Alpha ─ Bravo ─ Central(M)
 *   B-line (Rail):   Central(R) ─ Delta ─ Echo        Central(M) ↔ Central(R): a walk
 *   Through train:   Metro trip ends at Central(M), the same train continues on
 *                    the Rail side from Central(R) with no change needed.
 *
 * Times are minutes after service-day midnight (23:00 = 1380, 00:30 = 1470).
 */
import { describe, expect, it } from "vitest";
import { buildTimetable, firstTrain, lastTrains } from "../src/lib/transit/csa";
import type { Station, TransitSnapshot, Trip } from "../src/lib/transit/model";
import { formatClock, parseClock } from "../src/lib/transit/model";
import { dayTypeOf, serviceRunsOn } from "../src/lib/transit/services";
import {
  epochOf,
  findStations,
  lastTrainBetween,
} from "../src/lib/transit/snapshot";
import {
  interchangeMinutes,
  normalizeStationName,
  SAME_STATION_CHANGE_MINUTES,
} from "../src/lib/transit/transfers";

const station = (
  id: string,
  nameJa: string,
  name: string,
  lat: number,
  lon: number,
  operator: string,
): Station => ({
  id,
  nameJa,
  name,
  lat,
  lon,
  operator,
});

// 0 Alpha, 1 Bravo, 2 Central(M), 3 Central(R) ~100 m away, 4 Delta, 5 Echo
const stations: Station[] = [
  station("m.alpha", "アルファ", "Alpha", 35.7, 139.6, "Metro"),
  station("m.bravo", "ブラボー", "Bravo", 35.7, 139.61, "Metro"),
  station("m.central", "中央", "Central", 35.7, 139.62, "Metro"),
  station("r.central", "中央駅", "Central", 35.7009, 139.62, "Rail"),
  station("r.delta", "デルタ", "Delta", 35.7, 139.63, "Rail"),
  station("r.echo", "エコー", "Echo", 35.7, 139.64, "Rail"),
];

const metro = { name: "A Line", nameJa: "A線" };
const rail = { name: "B Line", nameJa: "B線" };
const t = (clock: string) => parseClock(clock);

const trips: Trip[] = [
  // Metro to Central: the 23:30 is the last one that makes the rail connection.
  {
    id: "m1",
    service: "weekday",
    line: metro,
    stops: [
      [0, null, t("23:00")],
      [1, t("23:05"), t("23:05")],
      [2, t("23:10"), null],
    ],
  },
  {
    id: "m2",
    service: "weekday",
    line: metro,
    stops: [
      [0, null, t("23:30")],
      [1, t("23:35"), t("23:35")],
      [2, t("23:40"), null],
    ],
  },
  {
    id: "m3",
    service: "weekday",
    line: metro,
    stops: [
      [0, null, t("24:00")],
      [1, t("24:05"), t("24:05")],
      [2, t("24:10"), null],
    ],
  },
  // Rail from Central: last train 23:55; arriving at 23:40 leaves time to walk over.
  {
    id: "r1",
    service: "weekday",
    line: rail,
    stops: [
      [3, null, t("23:20")],
      [4, t("23:25"), t("23:25")],
      [5, t("23:30"), null],
    ],
  },
  {
    id: "r2",
    service: "weekday",
    line: rail,
    stops: [
      [3, null, t("23:55")],
      [4, t("24:00"), t("24:00")],
      [5, t("24:05"), null],
    ],
  },
  // A through train: Metro part then Rail part, one vehicle, later than any connection above.
  {
    id: "x1",
    service: "weekday",
    vehicle: "x",
    line: metro,
    stops: [
      [0, null, t("24:10")],
      [2, t("24:20"), null],
    ],
  },
  {
    id: "x2",
    service: "weekday",
    vehicle: "x",
    line: rail,
    stops: [
      [3, null, t("24:20")],
      [5, t("24:30"), null],
    ],
  },
  // Holiday timetable: one train only.
  {
    id: "h1",
    service: "holiday",
    line: metro,
    stops: [
      [0, null, t("22:00")],
      [2, t("22:10"), null],
    ],
  },
  {
    id: "h2",
    service: "holiday",
    line: rail,
    stops: [
      [3, null, t("22:30")],
      [5, t("22:40"), null],
    ],
  },
  // Morning first trains (next service day).
  {
    id: "f1",
    service: "weekday",
    line: metro,
    stops: [
      [0, null, t("05:00")],
      [2, t("05:10"), null],
    ],
  },
  {
    id: "f2",
    service: "weekday",
    line: rail,
    stops: [
      [3, null, t("05:20")],
      [5, t("05:30"), null],
    ],
  },
];

const snapshot: TransitSnapshot = {
  version: 1,
  generatedAt: "2026-10-01T00:00:00.000Z",
  sources: [],
  stations,
  services: {
    weekday: { dayTypes: ["weekday"] },
    holiday: { dayTypes: ["holiday"] },
  },
  trips,
};

// Friday 9 October 2026 (weekday) and Tuesday 3 November 2026 (文化の日).
const WEEKDAY = "2026-10-09";
const HOLIDAY = "2026-11-03";

describe("service calendar", () => {
  it("knows weekdays, Saturdays, Sundays and national holidays", () => {
    expect(dayTypeOf("2026-10-09")).toBe("weekday");
    expect(dayTypeOf("2026-10-10")).toBe("saturday");
    expect(dayTypeOf("2026-10-11")).toBe("holiday");
    expect(dayTypeOf(HOLIDAY)).toBe("holiday");
  });

  it("applies GTFS-style weekday flags, date ranges and exceptions", () => {
    const service = {
      weekdays: [true, true, true, true, true, false, false] as [
        boolean,
        boolean,
        boolean,
        boolean,
        boolean,
        boolean,
        boolean,
      ],
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      removed: ["2026-10-09"],
      added: ["2026-10-10"],
    };
    expect(serviceRunsOn(service, "2026-10-08")).toBe(true);
    expect(serviceRunsOn(service, "2026-10-09")).toBe(false);
    expect(serviceRunsOn(service, "2026-10-10")).toBe(true);
    expect(serviceRunsOn(service, "2027-01-04")).toBe(false);
  });
});

describe("last trains", () => {
  const timetable = buildTimetable(snapshot, WEEKDAY);
  const toEcho = lastTrains(timetable, [5]);

  it("prefers the through train, which needs no change", () => {
    const journey = toEcho.journeyFrom(0)!;
    expect(formatClock(journey.departs)).toBe("00:10");
    expect(formatClock(journey.arrives)).toBe("00:30");
    expect(journey.transfers).toBe(0);
    expect(journey.legs).toHaveLength(1);
    expect(journey.legs[0]).toMatchObject({
      kind: "train",
      from: 0,
      to: 5,
      lines: [metro, rail],
    });
  });

  it("changes trains with a walk between operators when there is no through train", () => {
    const withoutThrough = {
      ...snapshot,
      trips: trips.filter((trip) => trip.vehicle !== "x"),
    };
    const journey = lastTrains(
      buildTimetable(withoutThrough, WEEKDAY),
      [5],
    ).journeyFrom(0)!;
    // The 23:30 reaches Central(M) at 23:40; the walk takes ≥ 4 min, so the 23:55 is made.
    expect(formatClock(journey.departs)).toBe("23:30");
    expect(journey.transfers).toBe(1);
    expect(journey.legs.map((leg) => leg.kind)).toEqual([
      "train",
      "walk",
      "train",
    ]);
    expect(formatClock(journey.arrives)).toBe("00:05");
  });

  it("answers for every station in one scan", () => {
    expect(formatClock(toEcho.latestDeparture(4)!)).toBe("00:00");
    expect(toEcho.latestDeparture(5)).toBeNull(); // already there
  });

  it("uses the holiday timetable on holidays", () => {
    const journey = lastTrains(
      buildTimetable(snapshot, HOLIDAY),
      [5],
    ).journeyFrom(0)!;
    expect(formatClock(journey.departs)).toBe("22:00");
  });

  it("returns null when nothing reaches the destination", () => {
    expect(lastTrains(timetable, [0]).journeyFrom(5)).toBeNull();
  });

  it("finds the whole destination by name, across operators", () => {
    expect(findStations(snapshot, "中央")).toEqual([2, 3]);
    expect(findStations(snapshot, "central")).toEqual([2, 3]);
    const journey = lastTrainBetween(
      snapshot,
      WEEKDAY,
      findStations(snapshot, "Alpha"),
      findStations(snapshot, "Echo"),
    )!;
    expect(journey.departsAt).toBe(epochOf(WEEKDAY, t("24:10")));
    expect(new Date(journey.departsAt).toISOString()).toBe(
      "2026-10-09T15:10:00.000Z",
    ); // 00:10 JST on the 10th
  });
});

describe("first train", () => {
  it("finds the earliest morning connection, including the change", () => {
    const journey = firstTrain(
      buildTimetable(snapshot, WEEKDAY),
      [0],
      [5],
      t("04:00"),
    )!;
    expect(formatClock(journey.departs)).toBe("05:00");
    expect(formatClock(journey.arrives)).toBe("05:30");
    expect(journey.transfers).toBe(1);
  });
});

describe("transfers", () => {
  it("normalises station names", () => {
    expect(normalizeStationName("渋谷駅")).toBe("渋谷");
    expect(normalizeStationName("府中（東京都）")).toBe("府中");
    expect(normalizeStationName(" 新宿 ")).toBe("新宿");
  });

  it("makes longer interchanges take longer", () => {
    expect(interchangeMinutes(50)).toBe(4);
    expect(interchangeMinutes(400)).toBeGreaterThan(interchangeMinutes(100));
    expect(SAME_STATION_CHANGE_MINUTES).toBeGreaterThan(0);
  });
});
