/**
 * ODPT JSON and GTFS both become the same snapshot, so one engine serves
 * Tokyo Metro/Toei/private railways (ODPT) and JR East (GTFS).
 */
import { describe, expect, it } from "vitest";
import { buildTimetable, lastTrains } from "../src/lib/transit/csa";
import { importGtfs, parseCsv } from "../src/lib/transit/importers/gtfs";
import { importOdpt, type OdptData } from "../src/lib/transit/importers/odpt";
import { formatClock } from "../src/lib/transit/model";
import { assembleSnapshot } from "../src/lib/transit/snapshot";

const odpt: OdptData = {
  stations: [
    {
      "owl:sameAs": "odpt.Station:TokyoMetro.Hanzomon.Jimbocho",
      "odpt:stationTitle": { ja: "神保町", en: "Jimbocho" },
      "odpt:operator": "odpt.Operator:TokyoMetro",
      "geo:lat": 35.6959,
      "geo:long": 139.7577,
    },
    {
      "owl:sameAs": "odpt.Station:TokyoMetro.Hanzomon.Shibuya",
      "odpt:stationTitle": { ja: "渋谷", en: "Shibuya" },
      "odpt:operator": "odpt.Operator:TokyoMetro",
      "geo:lat": 35.6591,
      "geo:long": 139.7022,
    },
    {
      "owl:sameAs": "odpt.Station:Tokyu.DenEnToshi.Shibuya",
      "odpt:stationTitle": { ja: "渋谷", en: "Shibuya" },
      "odpt:operator": "odpt.Operator:Tokyu",
      "geo:lat": 35.6591,
      "geo:long": 139.7023,
    },
    {
      "owl:sameAs": "odpt.Station:Tokyu.DenEnToshi.FutakoTamagawa",
      "odpt:stationTitle": { ja: "二子玉川", en: "Futako-tamagawa" },
      "odpt:operator": "odpt.Operator:Tokyu",
      "geo:lat": 35.6116,
      "geo:long": 139.6267,
    },
  ],
  railways: [
    {
      "owl:sameAs": "odpt.Railway:TokyoMetro.Hanzomon",
      "odpt:railwayTitle": { ja: "半蔵門線", en: "Hanzomon Line" },
    },
    {
      "owl:sameAs": "odpt.Railway:Tokyu.DenEnToshi",
      "odpt:railwayTitle": { ja: "田園都市線", en: "Den-en-toshi Line" },
    },
  ],
  calendars: [
    {
      "owl:sameAs": "odpt.Calendar:Specific.TokyoMetro.NewYearsEve",
      "odpt:day": ["2026-12-31"],
    },
  ],
  trainTimetables: [
    {
      "owl:sameAs": "odpt.TrainTimetable:TokyoMetro.Hanzomon.A2355.Weekday",
      "odpt:operator": "odpt.Operator:TokyoMetro",
      "odpt:railway": "odpt.Railway:TokyoMetro.Hanzomon",
      "odpt:calendar": "odpt.Calendar:Weekday",
      "odpt:destinationStation": [
        "odpt.Station:Tokyu.DenEnToshi.FutakoTamagawa",
      ],
      "odpt:nextTrainTimetable": [
        "odpt.TrainTimetable:Tokyu.DenEnToshi.A2355.Weekday",
      ],
      "odpt:trainTimetableObject": [
        {
          "odpt:departureTime": "23:55",
          "odpt:departureStation": "odpt.Station:TokyoMetro.Hanzomon.Jimbocho",
        },
        {
          "odpt:arrivalTime": "00:07",
          "odpt:arrivalStation": "odpt.Station:TokyoMetro.Hanzomon.Shibuya",
        },
      ],
    },
    {
      "owl:sameAs": "odpt.TrainTimetable:Tokyu.DenEnToshi.A2355.Weekday",
      "odpt:operator": "odpt.Operator:Tokyu",
      "odpt:railway": "odpt.Railway:Tokyu.DenEnToshi",
      "odpt:calendar": "odpt.Calendar:Weekday",
      "odpt:trainTimetableObject": [
        {
          "odpt:departureTime": "00:08",
          "odpt:departureStation": "odpt.Station:Tokyu.DenEnToshi.Shibuya",
        },
        {
          "odpt:arrivalTime": "00:21",
          "odpt:arrivalStation": "odpt.Station:Tokyu.DenEnToshi.FutakoTamagawa",
        },
      ],
    },
    {
      "owl:sameAs": "odpt.TrainTimetable:TokyoMetro.Hanzomon.NYE.Specific",
      "odpt:operator": "odpt.Operator:TokyoMetro",
      "odpt:railway": "odpt.Railway:TokyoMetro.Hanzomon",
      "odpt:calendar": "odpt.Calendar:Specific.TokyoMetro.NewYearsEve",
      "odpt:trainTimetableObject": [
        {
          "odpt:departureTime": "02:30",
          "odpt:departureStation": "odpt.Station:TokyoMetro.Hanzomon.Jimbocho",
        },
        {
          "odpt:arrivalTime": "02:42",
          "odpt:arrivalStation": "odpt.Station:TokyoMetro.Hanzomon.Shibuya",
        },
      ],
    },
  ],
};

describe("ODPT importer", () => {
  const { stations, services, trips } = importOdpt(odpt);

  it("reads stations, lines and headsigns", () => {
    expect(stations.map((station) => station.nameJa)).toEqual([
      "神保町",
      "渋谷",
      "渋谷",
      "二子玉川",
    ]);
    expect(trips[0].line).toEqual({
      name: "Hanzomon Line",
      nameJa: "半蔵門線",
    });
    expect(trips[0].headsign).toEqual({
      name: "Futako-tamagawa",
      nameJa: "二子玉川",
    });
  });

  it("keeps times after midnight on the same service day", () => {
    expect(
      trips[0].stops.map(([, arrival, departure]) => [arrival, departure]),
    ).toEqual([
      [23 * 60 + 55, 23 * 60 + 55],
      [24 * 60 + 7, null],
    ]);
    // A train whose first departure is 00:08 belongs to the night before.
    expect(trips[1].stops[0][2]).toBe(24 * 60 + 8);
  });

  it("links through-running trains into one vehicle", () => {
    expect(trips[0].vehicle).toBe(trips[1].vehicle);
  });

  it("maps standard and operator-specific calendars", () => {
    expect(services["odpt.Calendar:Weekday"]).toEqual({
      dayTypes: ["weekday"],
    });
    expect(services["odpt.Calendar:SaturdayHoliday"]).toEqual({
      dayTypes: ["saturday", "holiday"],
    });
    expect(services["odpt.Calendar:Specific.TokyoMetro.NewYearsEve"]).toEqual({
      added: ["2026-12-31"],
    });
  });

  it("finds the through train as tonight's last train without a change at Shibuya", () => {
    const snapshot = assembleSnapshot([], stations, services, trips);
    const journey = lastTrains(
      buildTimetable(snapshot, "2026-10-09"),
      [3],
    ).journeyFrom(0)!;
    expect(formatClock(journey.departs)).toBe("23:55");
    expect(journey.transfers).toBe(0);
  });
});

const gtfs = {
  "stops.txt": [
    "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
    "1000,新宿,35.6896,139.7006,1,",
    "1000_1,新宿,35.6896,139.7006,0,1000",
    "2000,吉祥寺,35.7031,139.5798,1,",
    "2000_2,吉祥寺,35.7031,139.5798,0,2000",
  ].join("\n"),
  "routes.txt": "route_id,route_long_name\nchuo,中央線快速",
  "trips.txt":
    'route_id,service_id,trip_id,trip_headsign\nchuo,wk,t1,高尾\nchuo,wk,t2,"三鷹"',
  "stop_times.txt": [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
    "t1,23:58:00,23:58:00,1000_1,1",
    "t1,24:16:00,24:16:00,2000_2,2",
    "t2,24:30:00,24:30:00,1000_1,1",
    "t2,24:47:00,24:47:00,2000_2,2",
  ].join("\r\n"),
  "calendar.txt":
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nwk,1,1,1,1,1,0,0,20260101,20261231",
  "calendar_dates.txt": "service_id,date,exception_type\nwk,20261103,2",
  "translations.txt":
    "table_name,field_name,language,translation,record_id,field_value\nstops,stop_name,en,Shinjuku,,新宿\nstops,stop_name,en,Kichijoji,,吉祥寺\nroutes,route_long_name,en,Chuo Line (Rapid),,中央線快速",
};

describe("GTFS importer", () => {
  it("parses quoted CSV with CRLF line endings", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      { a: "x, y", b: 'say "hi"' },
    ]);
  });

  const { stations, services, trips } = importGtfs(gtfs, {
    operator: "JR-East",
    idPrefix: "jre:",
  });

  it("merges platforms into stations and reads English names", () => {
    expect(stations.map((station) => [station.nameJa, station.name])).toEqual([
      ["新宿", "Shinjuku"],
      ["吉祥寺", "Kichijoji"],
    ]);
  });

  it("finds the last train, skipping a removed date", () => {
    const snapshot = assembleSnapshot([], stations, services, trips);
    const journey = lastTrains(
      buildTimetable(snapshot, "2026-10-09"),
      [1],
    ).journeyFrom(0)!;
    expect(formatClock(journey.departs)).toBe("00:30");
    expect(journey.legs[0]).toMatchObject({
      lines: [{ nameJa: "中央線快速", name: "Chuo Line (Rapid)" }],
      headsign: { nameJa: "三鷹" },
    });
    expect(
      lastTrains(buildTimetable(snapshot, "2026-11-03"), [1]).journeyFrom(0),
    ).toBeNull();
  });
});
