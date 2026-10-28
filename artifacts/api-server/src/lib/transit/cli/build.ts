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
import { importGtfs, type GtfsFiles } from "../importers/gtfs";
import { assembleSnapshot, writeSnapshot } from "../snapshot";
import { DEFAULT_ODPT_BASE, DEFAULT_ODPT_OPERATORS, downloadOdpt, withOdptKey } from "../buildOdpt";

const { values } = parseArgs({
  options: {
    operators: { type: "string" },
    gtfs: { type: "string", multiple: true },
    "odpt-base": { type: "string", default: DEFAULT_ODPT_BASE },
    out: { type: "string", default: "data/transit-snapshot.json.gz" },
  },
});

const key = process.env.ODPT_KEY?.trim();
if (!key) {
  console.error("Set ODPT_KEY (your ODPT developer consumer key).");
  process.exit(1);
}

const withKey = (url: string) => withOdptKey(url, key!);

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
  const operators = values.operators?.split(",") ?? DEFAULT_ODPT_OPERATORS;
  const base = values["odpt-base"]!;
  console.log(`Downloading ODPT dumps from ${base} …`);
  const { sources, stationIndex, stations, services, trips, trainsByOperator } = await downloadOdpt(key!, { operators, base });
  for (const [operator, count] of Object.entries(trainsByOperator)) {
    console.log(
      `  ${`odpt.Operator:${operator}`.padEnd(34)} ${count} trains${count === 0 ? "  ← none: not in this API, or needs another endpoint" : ""}`,
    );
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
