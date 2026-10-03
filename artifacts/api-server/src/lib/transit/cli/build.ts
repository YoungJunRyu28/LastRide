/**
 * Builds the timetable snapshot the last-train engine searches.
 *
 *   ODPT_KEY=... pnpm --filter @workspace/api-server transit:build
 *     [--operators TokyoMetro,Toei,...]   ODPT operators to include (default: Tokyo area)
 *     [--gtfs JR-East=<url or .zip path>] GTFS feeds, repeatable (JR East publishes GTFS)
 *     [--odpt-base https://api.odpt.org/api/v4]
 *     [--out data/transit-snapshot.json.gz]
 *
 * Downloads ODPT's full data dumps, keeps the chosen operators, and writes one
 * gzipped snapshot. The output is generated data under each operator's
 * licence: check every source's terms before using it in production, and do
 * not commit it.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";
import type { Service, SnapshotSource, Station, Trip } from "../model";
import { importGtfs, type GtfsFiles } from "../importers/gtfs";
import { importOdpt, type OdptData } from "../importers/odpt";
import { assembleSnapshot, writeSnapshot } from "../snapshot";

/**
 * Operators whose train timetables ODPT publishes under licences that allow
 * commercial use (checked October 2026 in the ODPT catalogue). JR East and the
 * private railways (Tokyu, Odakyu, Keio, Keikyu, Seibu, Tobu, Sotetsu) are
 * only under the Challenge-limited licence, which does not.
 */
const LICENSES: Record<string, string> = {
  TokyoMetro: "公共交通オープンデータ基本ライセンス",
  Toei: "CC BY 4.0",
  MIR: "公共交通オープンデータ基本ライセンス",
  TWR: "公共交通オープンデータ基本ライセンス",
  TamaMonorail: "公共交通オープンデータ基本ライセンス",
  YokohamaMunicipal: "公共交通オープンデータ基本ライセンス",
};
const DEFAULT_OPERATORS = Object.keys(LICENSES);

const { values } = parseArgs({
  options: {
    operators: { type: "string" },
    gtfs: { type: "string", multiple: true },
    "odpt-base": { type: "string", default: "https://api.odpt.org/api/v4" },
    out: { type: "string", default: "data/transit-snapshot.json.gz" },
  },
});

const key = process.env.ODPT_KEY?.trim();
if (!key) {
  console.error("Set ODPT_KEY (your ODPT developer consumer key).");
  process.exit(1);
}

function withKey(url: string): string {
  if (!/odpt\.org/.test(url) || url.includes("acl:consumerKey")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}acl:consumerKey=${encodeURIComponent(key!)}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(withKey(url));
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return (await response.json()) as T;
}

async function readGtfs(location: string): Promise<GtfsFiles> {
  const bytes = /^https?:\/\//.test(location)
    ? new Uint8Array(await (await fetch(withKey(location))).arrayBuffer())
    : new Uint8Array(await readFile(location));
  const decoder = new TextDecoder("utf-8");
  const files: GtfsFiles = {};
  for (const [name, content] of Object.entries(unzipSync(bytes))) {
    files[path.basename(name)] = decoder.decode(content);
  }
  return files;
}

async function main() {
  const operators = (values.operators?.split(",") ?? DEFAULT_OPERATORS).map(
    (name) => `odpt.Operator:${name.trim()}`,
  );
  const base = values["odpt-base"]!;
  const sources: SnapshotSource[] = [];
  const stationIndex = new Map<string, number>();
  const stations: Station[] = [];
  const services: Record<string, Service> = {};
  const trips: Trip[] = [];

  console.log(`Downloading ODPT dumps from ${base} …`);
  const keep = <T extends { "odpt:operator"?: string }>(items: T[]) =>
    items.filter(
      (item) =>
        !item["odpt:operator"] || operators.includes(item["odpt:operator"]),
    );
  const [allStations, railways, calendars, timetables] = await Promise.all([
    fetchJson<OdptData["stations"]>(`${base}/odpt:Station.json`),
    fetchJson<OdptData["railways"]>(`${base}/odpt:Railway.json`),
    fetchJson<NonNullable<OdptData["calendars"]>>(`${base}/odpt:Calendar.json`),
    fetchJson<OdptData["trainTimetables"]>(`${base}/odpt:TrainTimetable.json`),
  ]);
  const odpt = importOdpt(
    {
      stations: keep(allStations),
      railways,
      calendars,
      trainTimetables: keep(timetables),
    },
    stationIndex,
    stations,
  );
  Object.assign(services, odpt.services);
  trips.push(...odpt.trips);
  for (const operator of operators) {
    const count = odpt.trips.filter((trip) =>
      trip.id.includes(`:${operator.split(":")[1]}.`),
    ).length;
    console.log(
      `  ${operator.padEnd(34)} ${count} trains${count === 0 ? "  ← none: not in this API, or needs another endpoint" : ""}`,
    );
    if (count > 0)
      sources.push({
        operator,
        format: "odpt",
        url: base,
        license:
          LICENSES[operator.split(":")[1]] ??
          "unknown — check the ODPT catalogue before production use",
      });
  }

  for (const entry of values.gtfs ?? []) {
    const [operator, location] = entry.includes("=")
      ? entry.split(/=(.*)/s)
      : ["GTFS", entry];
    console.log(`Reading GTFS for ${operator} from ${location} …`);
    const gtfs = importGtfs(
      await readGtfs(location),
      { operator, idPrefix: `${operator}:` },
      stationIndex,
      stations,
    );
    Object.assign(services, gtfs.services);
    trips.push(...gtfs.trips);
    console.log(`  ${operator}: ${gtfs.trips.length} trains`);
    sources.push({
      operator,
      format: "gtfs",
      url: location.replace(/acl:consumerKey=[^&]+/, "acl:consumerKey=…"),
      license: "check this feed's licence",
    });
  }

  const snapshot = assembleSnapshot(sources, stations, services, trips);
  await mkdir(path.dirname(values.out!), { recursive: true });
  await writeSnapshot(values.out!, snapshot);
  console.log(
    `\nWrote ${values.out}: ${stations.length} stations, ${trips.length} trains.`,
  );
  console.log(
    "Check each source's licence before using this snapshot in production.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
