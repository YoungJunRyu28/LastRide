/**
 * Is this place a real passenger railway station? Apple files bus stops
 * (「横浜本牧駅」 is a bus stop by a freight terminal), gondola stops (運河パーク)
 * and stations alike as public transport named 「…駅」, and a route "from" any
 * of them looks fine. This checks a place against every passenger station in
 * Japan (lib/stationPointsData.ts, from 国土数値情報, refreshed yearly): the
 * same name nearby, or any station right there (a name spelt differently).
 *
 * Used to prefer, never to forbid (lib/applePlaces.ts): a station that opened
 * after the data still works when nothing known is in reach.
 */
import { STATION_POINTS } from '@/lib/stationPointsData';

/** Same name within this: Apple's pin and the platforms of a big station can be far apart. */
const SAME_NAME_METERS = 1000;
/** Any station this close: the place is that station under another spelling (or in English). */
const RIGHT_THERE_METERS = 150;
/** Grid cells of about 1 km (0.01°), searched two cells out: always covers SAME_NAME_METERS. */
const CELL = 100;

type Point = { name: string; latitude: number; longitude: number };

/** Must match normalize() in scripts/build-station-points.py. */
export function normalizeStationName(name: string): string {
  return name
    .replace(/[〈<＜（(［[][^〉>＞）)］\]]*[〉>＞）)］\]]/g, '')
    .replace(/\s+/g, '')
    .replace(/ヶ/g, 'ケ')
    .replace(/ヵ/g, 'カ')
    .replace(/^JR/, '')
    .replace(/駅$/, '');
}

let grid: Map<string, Point[]> | null = null;

const cellKey = (latitude: number, longitude: number) => `${Math.floor(latitude * CELL)}:${Math.floor(longitude * CELL)}`;

function load(): Map<string, Point[]> {
  if (grid) return grid;
  grid = new Map();
  for (const line of STATION_POINTS.split('\n')) {
    const [name, lat, lon] = line.split('\t');
    const point = { name, latitude: Number(lat), longitude: Number(lon) };
    const key = cellKey(point.latitude, point.longitude);
    const cell = grid.get(key);
    if (cell) cell.push(point);
    else grid.set(key, [point]);
  }
  return grid;
}

function meters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dy = (a.latitude - b.latitude) * 111_320;
  const dx = (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** The stations within about 2–3 km of a spot (its grid cell and two rings around it). */
function around(latitude: number, longitude: number): Point[] {
  const cells = load();
  const row = Math.floor(latitude * CELL);
  const column = Math.floor(longitude * CELL);
  const found: Point[] = [];
  for (let dRow = -2; dRow <= 2; dRow++) {
    for (let dColumn = -2; dColumn <= 2; dColumn++) {
      const cell = cells.get(`${row + dRow}:${column + dColumn}`);
      if (cell) found.push(...cell);
    }
  }
  return found;
}

/**
 * A known passenger station: one of that name within 1 km, or any station
 * within 150 m. `nameJa` is the Japanese name where known (an English Apple
 * name is translated first, lib/stationNames).
 */
export function isKnownStation(place: { nameJa: string; latitude: number; longitude: number }): boolean {
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return false;
  const name = normalizeStationName(place.nameJa);
  return around(place.latitude, place.longitude).some((point) => {
    const distance = meters(place, point);
    return distance <= RIGHT_THERE_METERS || (point.name === name && distance <= SAME_NAME_METERS);
  });
}

/**
 * The passenger stations within `radiusMeters` of a spot, nearest first: the
 * stand-in when Apple's search answers with nothing (it can, especially on a
 * phone set to another country, or when MapKit is having a bad moment).
 */
export function knownStationsNear(
  spot: { latitude: number; longitude: number },
  radiusMeters: number,
): Array<{ nameJa: string; latitude: number; longitude: number; meters: number }> {
  if (!Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)) return [];
  return around(spot.latitude, spot.longitude)
    .map((point) => ({ nameJa: point.name, latitude: point.latitude, longitude: point.longitude, meters: meters(spot, point) }))
    .filter((point) => point.meters <= radiusMeters)
    .sort((a, b) => a.meters - b.meters);
}
