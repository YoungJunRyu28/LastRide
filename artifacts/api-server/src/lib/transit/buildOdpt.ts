/**
 * Downloads ODPT's full data dumps and imports the chosen operators. Shared by
 * the command-line build (cli/build.ts, which can add GTFS feeds) and the
 * monthly AWS refresh (src/transitRefresh.ts), so both make the same snapshot.
 */
import type { Service, SnapshotSource, Station, Trip } from "./model";
import { importOdpt, type OdptData } from "./importers/odpt";

/**
 * Operators whose train timetables ODPT publishes under licences that allow
 * commercial use (checked October 2026 in the ODPT catalogue). JR East and the
 * private railways (Tokyu, Odakyu, Keio, Keikyu, Seibu, Tobu, Sotetsu) are
 * only under the Challenge-limited licence, which does not.
 */
export const ODPT_LICENSES: Record<string, string> = {
  TokyoMetro: "公共交通オープンデータ基本ライセンス",
  Toei: "CC BY 4.0",
  MIR: "公共交通オープンデータ基本ライセンス",
  TWR: "公共交通オープンデータ基本ライセンス",
  TamaMonorail: "公共交通オープンデータ基本ライセンス",
  YokohamaMunicipal: "公共交通オープンデータ基本ライセンス",
};
export const DEFAULT_ODPT_OPERATORS = Object.keys(ODPT_LICENSES);
export const DEFAULT_ODPT_BASE = "https://api.odpt.org/api/v4";

export type SnapshotParts = {
  sources: SnapshotSource[];
  stationIndex: Map<string, number>;
  stations: Station[];
  services: Record<string, Service>;
  trips: Trip[];
  /** Trains imported per operator short name ("TokyoMetro": 10123). */
  trainsByOperator: Record<string, number>;
};

/** `url` with the ODPT consumer key, for odpt.org addresses only. */
export function withOdptKey(url: string, key: string): string {
  if (!/odpt\.org/.test(url) || url.includes("acl:consumerKey")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}acl:consumerKey=${encodeURIComponent(key)}`;
}

export async function downloadOdpt(
  key: string,
  { operators = DEFAULT_ODPT_OPERATORS, base = DEFAULT_ODPT_BASE, fetchImpl = fetch }: {
    operators?: string[];
    base?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SnapshotParts> {
  const operatorIds = operators.map((name) => `odpt.Operator:${name.trim()}`);
  const fetchJson = async <T>(url: string): Promise<T> => {
    const response = await fetchImpl(withOdptKey(url, key));
    // Never echo the key-bearing URL.
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    return (await response.json()) as T;
  };
  const keep = <T extends { "odpt:operator"?: string }>(items: T[]) =>
    items.filter((item) => !item["odpt:operator"] || operatorIds.includes(item["odpt:operator"]));

  const [allStations, railways, calendars, timetables] = await Promise.all([
    fetchJson<OdptData["stations"]>(`${base}/odpt:Station.json`),
    fetchJson<OdptData["railways"]>(`${base}/odpt:Railway.json`),
    fetchJson<NonNullable<OdptData["calendars"]>>(`${base}/odpt:Calendar.json`),
    fetchJson<OdptData["trainTimetables"]>(`${base}/odpt:TrainTimetable.json`),
  ]);
  const stationIndex = new Map<string, number>();
  const stations: Station[] = [];
  const odpt = importOdpt(
    { stations: keep(allStations), railways, calendars, trainTimetables: keep(timetables) },
    stationIndex,
    stations,
  );
  const sources: SnapshotSource[] = [];
  const trainsByOperator: Record<string, number> = {};
  for (const operator of operatorIds) {
    const name = operator.split(":")[1];
    const count = odpt.trips.filter((trip) => trip.id.includes(`:${name}.`)).length;
    trainsByOperator[name] = count;
    if (count > 0)
      sources.push({
        operator,
        format: "odpt",
        url: base,
        license: ODPT_LICENSES[name] ?? "unknown — check the ODPT catalogue before production use",
      });
  }
  return { sources, stationIndex, stations, services: { ...odpt.services }, trips: [...odpt.trips], trainsByOperator };
}
