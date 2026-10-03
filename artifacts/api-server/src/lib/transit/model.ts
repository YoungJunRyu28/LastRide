/**
 * LastRide's own timetable model: every train of every imported operator,
 * normalised from ODPT JSON or GTFS into one compact snapshot that the
 * last-train engine (csa.ts) searches without any provider call.
 *
 * Times are minutes after midnight of the train's service day, so a train
 * leaving at 00:31 on the night of the 9th is 24*60+31 on the 9th's service
 * day. That is how a late-night last train stays on "tonight".
 */

/** Which timetable a day runs. Sundays and national holidays are "holiday". */
export type DayType = "weekday" | "saturday" | "holiday";

/**
 * When a set of trips runs. ODPT describes this by day type; GTFS by weekday
 * flags over a date range. Either way, explicit dates can be added or removed.
 * Dates are "YYYY-MM-DD".
 */
export type Service = {
  dayTypes?: DayType[];
  /** Monday first, as in GTFS calendar.txt. */
  weekdays?: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  startDate?: string;
  endDate?: string;
  added?: string[];
  removed?: string[];
};

export type Station = {
  /** Provider ID, e.g. "odpt.Station:TokyoMetro.Ginza.Shibuya". */
  id: string;
  name: string;
  nameJa: string;
  lat: number;
  lon: number;
  operator: string;
};

/** [station index, arrival minute or null, departure minute or null]. */
export type StopTime = [number, number | null, number | null];

export type Trip = {
  id: string;
  service: string;
  /**
   * Trips that are one physical train through-running onto another operator
   * share a vehicle, so staying on board needs no transfer.
   */
  vehicle?: string;
  line: { name: string; nameJa: string };
  /** Where the train is going, for "Shibuya → for Kichijoji" style labels. */
  headsign?: { name: string; nameJa: string };
  stops: StopTime[];
};

export type SnapshotSource = {
  operator: string;
  format: "odpt" | "gtfs";
  url: string;
  /** Licence the data was published under; checked by hand before production use. */
  license: string;
};

export type TransitSnapshot = {
  version: 1;
  generatedAt: string;
  sources: SnapshotSource[];
  stations: Station[];
  services: Record<string, Service>;
  trips: Trip[];
};

export const MINUTES_PER_DAY = 24 * 60;

/** "HH:MM" or "HH:MM:SS" (hours may exceed 23) → minutes. */
export function parseClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time: ${value}`);
  return (
    Number(match[1]) * 60 +
    Number(match[2]) +
    (match[3] ? Number(match[3]) / 60 : 0)
  );
}

/** Minutes after service-day midnight → "HH:MM" on a 24-hour clock (25:10 → 01:10). */
export function formatClock(minutes: number): string {
  const whole = Math.floor(minutes);
  const hours = Math.floor(whole / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
