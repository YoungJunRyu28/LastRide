/**
 * Monthly timetable refresh (EventBridge → this Lambda, infra/template.yaml).
 *
 * Downloads ODPT's dumps for the licensed operators, builds the snapshot the
 * last-train engine searches, and stores it in S3, where the API loads it
 * (src/lib/timetableEngine.ts) without a redeploy. The server refuses a
 * snapshot more than 30 days old, so this keeps it current without anyone
 * running `pnpm run transit:build` by hand.
 *
 * A result that looks broken (an operator with no trains, far fewer trains or
 * stations than the snapshot in place) is not published: the previous one
 * stays, and the error raises the operations alarm. No database is used.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DEFAULT_ODPT_OPERATORS, downloadOdpt } from "./lib/transit/buildOdpt";
import { assembleSnapshot, decodeSnapshot, encodeSnapshot } from "./lib/transit/snapshot";
import { SNAPSHOT_FILE_NAME } from "./lib/timetableEngine";
import { assertRuntimeTransitFresh } from "./lib/transitFreshness";
import { logger } from "./lib/logger";

type Counts = { stations: number; trips: number };

/** A new snapshot must keep at least this share of the one in place. */
const MIN_TRIP_SHARE = 0.7;
const MIN_STATION_SHARE = 0.9;

/** Why a freshly built snapshot mustn't replace the one in place, or null when it's fine. */
export function refreshProblem(
  next: Counts & { trainsByOperator: Record<string, number> },
  previous: Counts | null,
): string | null {
  const missing = DEFAULT_ODPT_OPERATORS.filter((operator) => !(next.trainsByOperator[operator] > 0));
  if (missing.length > 0) return `no trains for ${missing.join(", ")}`;
  if (next.stations === 0 || next.trips === 0) return "empty snapshot";
  if (previous && next.trips < previous.trips * MIN_TRIP_SHARE)
    return `${next.trips} trains, against ${previous.trips} in the snapshot in place`;
  if (previous && next.stations < previous.stations * MIN_STATION_SHARE)
    return `${next.stations} stations, against ${previous.stations} in the snapshot in place`;
  return null;
}

let s3: S3Client | null = null;

async function currentCounts(bucket: string): Promise<Counts | null> {
  s3 ??= new S3Client({});
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: SNAPSHOT_FILE_NAME }));
    const snapshot = decodeSnapshot(await object.Body!.transformToByteArray());
    return { stations: snapshot.stations.length, trips: snapshot.trips.length };
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null; // the first refresh
    throw err;
  }
}

export async function handler(): Promise<{ stations: number; trips: number; generatedAt: string }> {
  const key = process.env.ODPT_KEY?.trim();
  const bucket = process.env.TRANSIT_SNAPSHOT_BUCKET?.trim();
  if (!key || !bucket) throw new Error("Timetable refresh needs ODPT_KEY and TRANSIT_SNAPSHOT_BUCKET");

  const parts = await downloadOdpt(key);
  const snapshot = assembleSnapshot(parts.sources, parts.stations, parts.services, parts.trips);
  assertRuntimeTransitFresh(snapshot.generatedAt);
  const next = { stations: snapshot.stations.length, trips: snapshot.trips.length, trainsByOperator: parts.trainsByOperator };
  const problem = refreshProblem(next, await currentCounts(bucket));
  if (problem) {
    logger.error({ ...next }, `Timetable refresh not published: ${problem}`);
    throw new Error(`Timetable refresh not published: ${problem}`);
  }

  s3 ??= new S3Client({});
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: SNAPSHOT_FILE_NAME,
    Body: encodeSnapshot(snapshot),
    ContentType: "application/gzip",
    Metadata: { "generated-at": snapshot.generatedAt },
  }));
  logger.info({ ...next, generatedAt: snapshot.generatedAt }, "Timetable snapshot refreshed");
  return { stations: next.stations, trips: next.trips, generatedAt: snapshot.generatedAt };
}
