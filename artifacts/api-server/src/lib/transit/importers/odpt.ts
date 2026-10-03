/**
 * ODPT (公共交通オープンデータセンター) JSON → snapshot pieces. Covers the
 * operators that publish odpt:Station / odpt:Railway / odpt:TrainTimetable
 * (Tokyo Metro, Toei, most private railways). Through-running is followed via
 * odpt:nextTrainTimetable, so a Hanzomon Line train continuing onto the
 * Den-en-toshi Line is one vehicle.
 */
import {
  MINUTES_PER_DAY,
  parseClock,
  type DayType,
  type Service,
  type Station,
  type StopTime,
  type Trip,
} from "../model";

type LocalizedTitle = { ja?: string; en?: string };

export type OdptStation = {
  "owl:sameAs": string;
  "dc:title"?: string;
  "odpt:stationTitle"?: LocalizedTitle;
  "odpt:operator": string;
  "geo:lat"?: number;
  "geo:long"?: number;
};

export type OdptRailway = {
  "owl:sameAs": string;
  "dc:title"?: string;
  "odpt:railwayTitle"?: LocalizedTitle;
};

export type OdptCalendar = {
  "owl:sameAs": string;
  /** Explicit dates ("YYYY-MM-DD") for operator-specific calendars. */
  "odpt:day"?: string[];
};

type OdptStopObject = {
  "odpt:departureTime"?: string;
  "odpt:departureStation"?: string;
  "odpt:arrivalTime"?: string;
  "odpt:arrivalStation"?: string;
};

export type OdptTrainTimetable = {
  "owl:sameAs": string;
  "odpt:operator": string;
  "odpt:railway": string;
  "odpt:calendar": string;
  "odpt:trainTimetableObject": OdptStopObject[];
  "odpt:destinationStation"?: string[];
  "odpt:nextTrainTimetable"?: string[];
};

export type OdptData = {
  stations: OdptStation[];
  railways: OdptRailway[];
  calendars?: OdptCalendar[];
  trainTimetables: OdptTrainTimetable[];
};

const STANDARD_CALENDARS: Record<string, DayType[]> = {
  "odpt.Calendar:Weekday": ["weekday"],
  "odpt.Calendar:Saturday": ["saturday"],
  "odpt.Calendar:Holiday": ["holiday"],
  "odpt.Calendar:Sunday": ["holiday"],
  "odpt.Calendar:SaturdayHoliday": ["saturday", "holiday"],
};

/** Times on a train never go backwards; after midnight they continue past 24:00. */
function serviceDayMinutes(clock: string, previous: number | null): number {
  let minutes = parseClock(clock);
  // A train whose first stop is after midnight but before the morning belongs to the night before.
  if (previous === null && minutes < 3 * 60) minutes += MINUTES_PER_DAY;
  while (previous !== null && minutes < previous - 12 * 60)
    minutes += MINUTES_PER_DAY;
  return minutes;
}

/** The first trip of a through-running chain names the vehicle for the whole chain. */
function vehicleIds(timetables: OdptTrainTimetable[]): Map<string, string> {
  const previous = new Map<string, string>();
  for (const timetable of timetables) {
    for (const next of timetable["odpt:nextTrainTimetable"] ?? [])
      previous.set(next, timetable["owl:sameAs"]);
  }
  const vehicles = new Map<string, string>();
  for (const timetable of timetables) {
    let root = timetable["owl:sameAs"];
    const seen = new Set<string>();
    while (previous.has(root) && !seen.has(root)) {
      seen.add(root);
      root = previous.get(root)!;
    }
    vehicles.set(timetable["owl:sameAs"], root);
  }
  return vehicles;
}

function title(object: { "dc:title"?: string }, localized?: LocalizedTitle) {
  const nameJa = localized?.ja ?? object["dc:title"] ?? "";
  return { nameJa, name: localized?.en ?? nameJa };
}

export type ImportResult = {
  stations: Station[];
  services: Record<string, Service>;
  trips: Trip[];
};

/**
 * Converts one operator's (or several operators') ODPT data. `stationIndex`
 * maps station IDs already added from other sources, so indexes stay unique.
 */
export function importOdpt(
  data: OdptData,
  stationIndex = new Map<string, number>(),
  stations: Station[] = [],
): ImportResult {
  for (const station of data.stations) {
    const id = station["owl:sameAs"];
    if (
      stationIndex.has(id) ||
      station["geo:lat"] === undefined ||
      station["geo:long"] === undefined
    )
      continue;
    stationIndex.set(id, stations.length);
    stations.push({
      id,
      ...title(station, station["odpt:stationTitle"]),
      lat: station["geo:lat"],
      lon: station["geo:long"],
      operator: station["odpt:operator"],
    });
  }

  const railways = new Map(
    data.railways.map((railway) => [
      railway["owl:sameAs"],
      title(railway, railway["odpt:railwayTitle"]),
    ]),
  );

  const services: Record<string, Service> = {};
  for (const [id, dayTypes] of Object.entries(STANDARD_CALENDARS))
    services[id] = { dayTypes };
  for (const calendar of data.calendars ?? []) {
    const id = calendar["owl:sameAs"];
    if (STANDARD_CALENDARS[id]) continue;
    services[id] = { added: calendar["odpt:day"] ?? [] };
  }

  const vehicles = vehicleIds(data.trainTimetables);
  const trips: Trip[] = [];
  for (const timetable of data.trainTimetables) {
    const stops: StopTime[] = [];
    let previous: number | null = null;
    for (const object of timetable["odpt:trainTimetableObject"]) {
      const stationId =
        object["odpt:departureStation"] ?? object["odpt:arrivalStation"];
      const station = stationId ? stationIndex.get(stationId) : undefined;
      if (station === undefined) continue;
      const arrivalClock = object["odpt:arrivalTime"];
      const departureClock = object["odpt:departureTime"];
      const arrival: number | null = arrivalClock
        ? serviceDayMinutes(arrivalClock, previous)
        : null;
      if (arrival !== null) previous = arrival;
      const departure: number | null = departureClock
        ? serviceDayMinutes(departureClock, previous)
        : null;
      if (departure !== null) previous = departure;
      // Intermediate stops often list only a departure; treat it as the arrival too.
      stops.push([station, arrival ?? departure, departure]);
    }
    if (stops.length < 2) continue;
    stops[stops.length - 1][2] = null;

    const destinationId = timetable["odpt:destinationStation"]?.[0];
    const destination =
      destinationId !== undefined ? stationIndex.get(destinationId) : undefined;
    const line = railways.get(timetable["odpt:railway"]) ?? {
      name: timetable["odpt:railway"],
      nameJa: timetable["odpt:railway"],
    };
    trips.push({
      id: timetable["owl:sameAs"],
      service: timetable["odpt:calendar"],
      vehicle: vehicles.get(timetable["owl:sameAs"]),
      line,
      headsign:
        destination !== undefined
          ? {
              name: stations[destination].name,
              nameJa: stations[destination].nameJa,
            }
          : undefined,
      stops,
    });
  }
  return { stations, services, trips };
}
