/**
 * Asks the engine for tonight's last train (and tomorrow's first) between two
 * stations, using a snapshot made by transit:build.
 *
 *   pnpm --filter @workspace/api-server transit:last-train --from 渋谷 --to 吉祥寺
 *     [--date 2026-10-09]   service day (default: tonight in Japan)
 *     [--snapshot data/transit-snapshot.json.gz] [--en]
 */
import { parseArgs } from "node:util";
import {
  describeJourney,
  findStations,
  firstTrainBetween,
  lastTrainBetween,
  readSnapshot,
} from "../snapshot";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    date: { type: "string" },
    snapshot: { type: "string", default: "data/transit-snapshot.json.gz" },
    en: { type: "boolean", default: false },
  },
});

/** Tonight's service day in Japan: before 04:00 it is still yesterday's. */
function tonight(): string {
  return new Date(Date.now() + (9 - 4) * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
}

async function main() {
  if (!values.from || !values.to) {
    console.error(
      "Usage: transit:last-train --from 渋谷 --to 吉祥寺 [--date YYYY-MM-DD]",
    );
    process.exit(1);
  }
  const snapshot = await readSnapshot(values.snapshot!);
  const from = findStations(snapshot, values.from);
  const to = findStations(snapshot, values.to);
  if (from.length === 0 || to.length === 0) {
    console.error(
      `Unknown station: ${from.length === 0 ? values.from : values.to}`,
    );
    process.exit(1);
  }
  const date = values.date ?? tonight();
  const language = values.en ? "en" : "ja";
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
    });

  const last = lastTrainBetween(snapshot, date, from, to);
  console.log(
    `Last train ${values.from} → ${values.to} on the night of ${date}:`,
  );
  console.log(
    last
      ? `${time(last.departsAt)} → ${time(last.arrivesAt)}, ${last.transfers} change(s)\n${describeJourney(last, language)}`
      : "  none",
  );

  const first = firstTrainBetween(snapshot, date, from, to);
  console.log(`\nFirst train the next morning:`);
  console.log(
    first
      ? `${time(first.departsAt)} → ${time(first.arrivesAt)}\n${describeJourney(first, language)}`
      : "  none",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
