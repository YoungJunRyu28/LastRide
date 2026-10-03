/**
 * The last-train engine: a Connection Scan over one service day's trains.
 *
 * A "connection" is one train going from one stop to the next. Scanning every
 * connection of the day once, latest first, gives for every station at once
 * the latest moment you can leave it and still reach the destination tonight
 * (reverse CSA), which is exactly what "when is my last train" asks. A forward
 * scan gives the earliest arrival, for the first train in the morning.
 *
 * Staying on the same physical train (including through-running onto another
 * operator) needs no change; changing at one station takes
 * SAME_STATION_CHANGE_MINUTES; walking between operators' stations takes the
 * footpath time (transfers.ts).
 */
import type { StopTime, TransitSnapshot } from "./model";
import { serviceRunsOn } from "./services";
import {
  buildFootpaths,
  SAME_STATION_CHANGE_MINUTES,
  type Footpath,
} from "./transfers";

type Connection = {
  from: number;
  to: number;
  dep: number;
  arr: number;
  trip: number;
  vehicle: number;
};

export type Timetable = {
  snapshot: TransitSnapshot;
  date: string;
  /** Sorted by departure, earliest first. */
  connections: Connection[];
  footpaths: Footpath[][];
};

export type TrainLeg = {
  kind: "train";
  from: number;
  to: number;
  departs: number;
  arrives: number;
  /** The lines ridden, more than one when the train through-runs onto another operator. */
  lines: { name: string; nameJa: string }[];
  headsign?: { name: string; nameJa: string };
};
export type WalkLeg = {
  kind: "walk";
  from: number;
  to: number;
  minutes: number;
};
export type Leg = TrainLeg | WalkLeg;

export type Journey = {
  /** Minutes after service-day midnight. */
  departs: number;
  arrives: number;
  legs: Leg[];
  transfers: number;
};

const MAX_LEGS = 12;

function connectionsOf(
  stops: StopTime[],
  trip: number,
  vehicle: number,
): Connection[] {
  const connections: Connection[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const [from, , depart] = stops[i];
    const [to, arrive, departNext] = stops[i + 1];
    const dep = depart;
    const arr = arrive ?? departNext;
    if (dep === null || arr === null) continue;
    connections.push({ from, to, dep, arr, trip, vehicle });
  }
  return connections;
}

/** The trains running on one service date ("YYYY-MM-DD"), ready to scan. */
export function buildTimetable(
  snapshot: TransitSnapshot,
  date: string,
  footpaths = buildFootpaths(snapshot.stations),
): Timetable {
  const vehicles = new Map<string, number>();
  const connections: Connection[] = [];
  snapshot.trips.forEach((trip, index) => {
    const service = snapshot.services[trip.service];
    if (!service || !serviceRunsOn(service, date)) return;
    const key = trip.vehicle ?? trip.id;
    let vehicle = vehicles.get(key);
    if (vehicle === undefined) {
      vehicle = vehicles.size;
      vehicles.set(key, vehicle);
    }
    connections.push(...connectionsOf(trip.stops, index, vehicle));
  });
  connections.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
  return { snapshot, date, connections, footpaths };
}

function lineOf(timetable: Timetable, trip: number) {
  return timetable.snapshot.trips[trip].line;
}

function trainLeg(
  timetable: Timetable,
  board: Connection,
  alight: Connection,
  ridden: number[],
): TrainLeg {
  const lines: TrainLeg["lines"] = [];
  for (const trip of ridden) {
    const line = lineOf(timetable, trip);
    if (!lines.some((existing) => existing.nameJa === line.nameJa))
      lines.push(line);
  }
  return {
    kind: "train",
    from: board.from,
    to: alight.to,
    departs: board.dep,
    arrives: alight.arr,
    lines,
    headsign: timetable.snapshot.trips[alight.trip].headsign,
  };
}

/** Trips of one vehicle between boarding and alighting, in riding order. */
function tripsRidden(
  timetable: Timetable,
  boardIndex: number,
  alightIndex: number,
  vehicle: number,
): number[] {
  const trips: number[] = [];
  const [low, high] =
    boardIndex <= alightIndex
      ? [boardIndex, alightIndex]
      : [alightIndex, boardIndex];
  for (let i = low; i <= high; i++) {
    const connection = timetable.connections[i];
    if (connection.vehicle === vehicle && !trips.includes(connection.trip))
      trips.push(connection.trip);
  }
  return trips;
}

export type LastTrains = {
  /** Latest minute you can leave this station and still reach a destination station tonight. */
  latestDeparture(station: number): number | null;
  journeyFrom(station: number): Journey | null;
};

/**
 * Reverse scan: for every station, the latest departure that still reaches
 * any of `targets` (all stations of the destination, e.g. every operator's
 * Kichijoji). `arriveBy` optionally caps the arrival time.
 */
export function lastTrains(
  timetable: Timetable,
  targets: number[],
  arriveBy = Infinity,
): LastTrains {
  const stationCount = timetable.snapshot.stations.length;
  const isTarget = new Uint8Array(stationCount);
  for (const target of targets) isTarget[target] = 1;

  // latest[s]: latest time you can be ready at s and still get home.
  const latest = new Float64Array(stationCount).fill(-Infinity);
  for (const target of targets) latest[target] = Infinity;
  // How that time is achieved: board a connection there, or walk to another station.
  const boardAt = new Int32Array(stationCount).fill(-1);
  const walkTo = new Int32Array(stationCount).fill(-1);
  // Vehicles that reach home if you stay on, and the connection to get off at.
  const alightAt = new Map<number, number>();

  const { connections, footpaths } = timetable;
  for (let index = connections.length - 1; index >= 0; index--) {
    const connection = connections[index];
    let reaches = alightAt.has(connection.vehicle);
    if (!reaches) {
      const to = connection.to;
      if (isTarget[to]) {
        reaches = connection.arr <= arriveBy;
      } else {
        // Boarding directly at `to` needs a change; a walk onward already includes it.
        const change = boardAt[to] >= 0 ? SAME_STATION_CHANGE_MINUTES : 0;
        reaches = connection.arr + change <= latest[to];
      }
      if (reaches) alightAt.set(connection.vehicle, index);
    }
    if (
      !reaches ||
      isTarget[connection.from] ||
      connection.dep <= latest[connection.from]
    )
      continue;

    latest[connection.from] = connection.dep;
    boardAt[connection.from] = index;
    walkTo[connection.from] = -1;
    for (const { to: neighbor, minutes } of footpaths[connection.from]) {
      const leaveBy = connection.dep - minutes;
      if (isTarget[neighbor] || leaveBy <= latest[neighbor]) continue;
      latest[neighbor] = leaveBy;
      walkTo[neighbor] = connection.from;
      boardAt[neighbor] = -1;
    }
  }

  return {
    latestDeparture(station) {
      const value = latest[station];
      return Number.isFinite(value) ? value : null;
    },
    journeyFrom(origin) {
      if (!Number.isFinite(latest[origin])) return null;
      const legs: Leg[] = [];
      let station = origin;
      while (!isTarget[station] && legs.length < MAX_LEGS) {
        if (walkTo[station] >= 0) {
          const next = walkTo[station];
          const minutes =
            footpaths[station].find((path) => path.to === next)?.minutes ?? 0;
          legs.push({ kind: "walk", from: station, to: next, minutes });
          station = next;
          continue;
        }
        const board = connections[boardAt[station]];
        const alightIndex = alightAt.get(board.vehicle)!;
        const alight = connections[alightIndex];
        legs.push(
          trainLeg(
            timetable,
            board,
            alight,
            tripsRidden(
              timetable,
              boardAt[station],
              alightIndex,
              board.vehicle,
            ),
          ),
        );
        station = alight.to;
      }
      if (!isTarget[station]) return null;
      return journeyOf(legs, latest[origin]);
    },
  };
}

function journeyOf(legs: Leg[], departs: number): Journey {
  let arrives = departs;
  for (const leg of legs)
    arrives = leg.kind === "train" ? leg.arrives : arrives + leg.minutes;
  return {
    departs,
    arrives,
    legs,
    transfers: Math.max(
      0,
      legs.filter((leg) => leg.kind === "train").length - 1,
    ),
  };
}

/**
 * Forward scan: the earliest arrival at any of `targets` leaving one of
 * `origins` no earlier than `notBefore` — the first train of the morning.
 */
export function firstTrain(
  timetable: Timetable,
  origins: number[],
  targets: number[],
  notBefore: number,
): Journey | null {
  const stationCount = timetable.snapshot.stations.length;
  const isTarget = new Uint8Array(stationCount);
  for (const target of targets) isTarget[target] = 1;
  // ready[s]: earliest time you can board at s; arrival[s]: when you got there.
  const ready = new Float64Array(stationCount).fill(Infinity);
  const arrival = new Float64Array(stationCount).fill(Infinity);
  const cameBy = new Int32Array(stationCount).fill(-1);
  const walkedFrom = new Int32Array(stationCount).fill(-1);
  const boarded = new Map<number, number>();
  for (const origin of origins) {
    ready[origin] = notBefore;
    arrival[origin] = notBefore;
  }

  const { connections, footpaths } = timetable;
  for (let index = 0; index < connections.length; index++) {
    const connection = connections[index];
    if (!boarded.has(connection.vehicle)) {
      if (ready[connection.from] > connection.dep) continue;
      boarded.set(connection.vehicle, index);
    }
    if (connection.arr >= arrival[connection.to]) continue;
    arrival[connection.to] = connection.arr;
    ready[connection.to] = connection.arr + SAME_STATION_CHANGE_MINUTES;
    cameBy[connection.to] = index;
    walkedFrom[connection.to] = -1;
    for (const { to: neighbor, minutes } of footpaths[connection.to]) {
      const reach = connection.arr + minutes;
      if (reach >= arrival[neighbor]) continue;
      arrival[neighbor] = reach;
      ready[neighbor] = reach;
      cameBy[neighbor] = -1;
      walkedFrom[neighbor] = connection.to;
    }
  }

  let best = -1;
  for (const target of targets) {
    if (
      Number.isFinite(arrival[target]) &&
      (best < 0 || arrival[target] < arrival[best])
    )
      best = target;
  }
  if (best < 0) return null;

  // Walk back from the destination to the origin.
  const legs: Leg[] = [];
  const isOrigin = new Set(origins);
  let station = best;
  while (!isOrigin.has(station) && legs.length < MAX_LEGS) {
    if (walkedFrom[station] >= 0) {
      const from = walkedFrom[station];
      const minutes =
        footpaths[from].find((path) => path.to === station)?.minutes ?? 0;
      legs.unshift({ kind: "walk", from, to: station, minutes });
      station = from;
      continue;
    }
    const alight = connections[cameBy[station]];
    const boardIndex = boarded.get(alight.vehicle)!;
    const board = connections[boardIndex];
    legs.unshift(
      trainLeg(
        timetable,
        board,
        alight,
        tripsRidden(timetable, boardIndex, cameBy[station], alight.vehicle),
      ),
    );
    station = board.from;
  }
  if (!isOrigin.has(station)) return null;
  const firstTrainLeg = legs.find(
    (leg): leg is TrainLeg => leg.kind === "train",
  );
  const departs = firstTrainLeg
    ? firstTrainLeg.departs -
      legs
        .slice(0, legs.indexOf(firstTrainLeg))
        .reduce((sum, leg) => sum + (leg.kind === "walk" ? leg.minutes : 0), 0)
    : notBefore;
  return { ...journeyOf(legs, departs), arrives: arrival[best] };
}
