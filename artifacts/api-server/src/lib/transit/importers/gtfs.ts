/**
 * GTFS (GTFS-JP) → snapshot pieces. JR East publishes its train timetables on
 * ODPT in this format. Platforms are merged into their parent station, and
 * English names come from translations.txt when present.
 */
import {
  parseClock,
  type Service,
  type Station,
  type StopTime,
  type Trip,
} from "../model";
import type { ImportResult } from "./odpt";

export type GtfsFiles = Record<string, string>;
type Row = Record<string, string>;

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF), first row as header. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  const [header = [], ...body] = rows;
  return body.map((values) =>
    Object.fromEntries(header.map((name, i) => [name.trim(), values[i] ?? ""])),
  );
}

/** GTFS "20261009" → "2026-10-09". */
function isoDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function importGtfs(
  files: GtfsFiles,
  options: { operator: string; idPrefix: string },
  stationIndex = new Map<string, number>(),
  stations: Station[] = [],
): ImportResult {
  const table = (name: string) => (files[name] ? parseCsv(files[name]) : []);

  // English names per field. GTFS-JP keys translations by the Japanese text
  // (field_value); newer feeds by record_id.
  const english = new Map<string, string>();
  for (const row of table("translations.txt")) {
    if (row.language !== "en") continue;
    const key = row.record_id || row.field_value || row.trans_id;
    english.set(`${row.field_name}:${key}`, row.translation);
  }
  const inEnglish = (field: string, ...keys: string[]) =>
    keys.map((key) => english.get(`${field}:${key}`)).find(Boolean);

  // Platforms (location_type 0 with a parent) merge into their station.
  const stops = table("stops.txt");
  const parentOf = new Map<string, string>();
  for (const stop of stops) {
    if (stop.parent_station) parentOf.set(stop.stop_id, stop.parent_station);
  }
  for (const stop of stops) {
    if (stop.parent_station) continue;
    const id = `${options.idPrefix}${stop.stop_id}`;
    if (stationIndex.has(id)) continue;
    stationIndex.set(id, stations.length);
    stations.push({
      id,
      nameJa: stop.stop_name,
      name:
        inEnglish("stop_name", stop.stop_id, stop.stop_name) ?? stop.stop_name,
      lat: Number(stop.stop_lat),
      lon: Number(stop.stop_lon),
      operator: options.operator,
    });
  }
  const stationOf = (stopId: string) =>
    stationIndex.get(`${options.idPrefix}${parentOf.get(stopId) ?? stopId}`);

  const services: Record<string, Service> = {};
  const serviceId = (id: string) => `${options.idPrefix}${id}`;
  for (const row of table("calendar.txt")) {
    const days = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ].map((day) => row[day] === "1") as NonNullable<Service["weekdays"]>;
    services[serviceId(row.service_id)] = {
      weekdays: days,
      startDate: isoDate(row.start_date),
      endDate: isoDate(row.end_date),
    };
  }
  for (const row of table("calendar_dates.txt")) {
    const service = (services[serviceId(row.service_id)] ??= {});
    const list =
      row.exception_type === "1"
        ? (service.added ??= [])
        : (service.removed ??= []);
    list.push(isoDate(row.date));
  }

  const routes = new Map(
    table("routes.txt").map((route) => {
      const nameJa = route.route_long_name || route.route_short_name;
      return [
        route.route_id,
        {
          nameJa,
          name: inEnglish("route_long_name", route.route_id, nameJa) ?? nameJa,
        },
      ];
    }),
  );
  const tripInfo = new Map(
    table("trips.txt").map((trip) => [trip.trip_id, trip]),
  );

  const stopTimes = new Map<string, Row[]>();
  for (const row of table("stop_times.txt")) {
    const list = stopTimes.get(row.trip_id);
    if (list) list.push(row);
    else stopTimes.set(row.trip_id, [row]);
  }

  const trips: Trip[] = [];
  for (const [tripId, rows] of stopTimes) {
    const info = tripInfo.get(tripId);
    if (!info) continue;
    rows.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const tripStops: StopTime[] = [];
    for (const row of rows) {
      const station = stationOf(row.stop_id);
      if (station === undefined) continue;
      const arrival = row.arrival_time ? parseClock(row.arrival_time) : null;
      const departure = row.departure_time
        ? parseClock(row.departure_time)
        : null;
      tripStops.push([station, arrival ?? departure, departure ?? arrival]);
    }
    if (tripStops.length < 2) continue;
    tripStops[tripStops.length - 1][2] = null;
    const line = routes.get(info.route_id) ?? {
      name: info.route_id,
      nameJa: info.route_id,
    };
    trips.push({
      id: `${options.idPrefix}${tripId}`,
      service: serviceId(info.service_id),
      // block_id is not used as a vehicle: a block can chain a whole day of
      // runs, and "staying on" across turnarounds would invent journeys.
      line,
      headsign: info.trip_headsign
        ? {
            name:
              inEnglish("trip_headsign", tripId, info.trip_headsign) ??
              inEnglish("stop_name", info.trip_headsign) ??
              info.trip_headsign,
            nameJa: info.trip_headsign,
          }
        : undefined,
      stops: tripStops,
    });
  }
  return { stations, services, trips };
}
