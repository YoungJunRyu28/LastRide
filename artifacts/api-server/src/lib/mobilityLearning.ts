import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import {
  getDb,
  getPool,
  mobilityLearningContributorsTable,
  mobilityLearningObservationsTable,
} from "@workspace/db";

export const CURRENT_LEARNING_CONSENT_VERSION = 1;
export const MOBILITY_OBSERVATION_RETENTION_DAYS = 365;
const PROFILE_LOOKBACK_DAYS = 180;

export type MobilityObservationInput = {
  clientObservationId: string;
  kind: "trip_timing" | "station_traversal";
  stationKey?: string;
  lineKey?: string;
  hourBucket: number;
  dayType: "weekday" | "weekend" | "holiday";
  packupSeconds?: number;
  walkingDistanceMeters?: number;
  providerWalkingSeconds?: number;
  actualWalkingSeconds?: number;
  elevationGainMeters?: number;
  elevationLossMeters?: number;
  stationTraversalSeconds?: number;
  caughtTrain?: boolean;
  confidencePermille: number;
  modelVersion: string;
};

export type StationAccessProfileQuery = {
  stationKey: string;
  lineKey?: string;
  hourBucket: number;
  dayType: "weekday" | "weekend" | "holiday";
};

export type StationAccessProfile = {
  stationKey: string;
  lineKey: string | null;
  hourBucket: number;
  dayType: "weekday" | "weekend" | "holiday";
  sampleCount: number;
  contributorCount: number;
  p50Seconds: number | null;
  p90Seconds: number | null;
  p95Seconds: number | null;
  source:
    | "station-line-context"
    | "station-line"
    | "station"
    | "insufficient";
  lookbackDays: number;
};

type AggregateRow = {
  query_index: number | string;
  level: number | string;
  sample_count: number | string;
  contributor_count: number | string;
  p50_seconds: number | string | null;
  p90_seconds: number | string | null;
  p95_seconds: number | string | null;
};

let lastRetentionPurgeAt = 0;

export function hashLearningToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validLearningToken(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token);
}

async function purgeExpiredObservationsIfDue(now = Date.now()): Promise<void> {
  if (now - lastRetentionPurgeAt < 24 * 60 * 60 * 1000) return;
  lastRetentionPurgeAt = now;
  const cutoff = new Date(
    now - MOBILITY_OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await getDb()
    .delete(mobilityLearningObservationsTable)
    .where(lt(mobilityLearningObservationsTable.createdAt, cutoff));
}

export async function recordMobilityObservations(
  token: string,
  consentVersion: number,
  observations: MobilityObservationInput[],
): Promise<{ accepted: number }> {
  if (!validLearningToken(token)) throw new Error("invalid-learning-token");
  if (consentVersion !== CURRENT_LEARNING_CONSENT_VERSION) {
    throw new Error("learning-consent-version");
  }
  if (observations.length === 0) return { accepted: 0 };

  const contributorHash = hashLearningToken(token);
  const now = new Date();
  await getDb()
    .insert(mobilityLearningContributorsTable)
    .values({
      tokenHash: contributorHash,
      consentVersion,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: mobilityLearningContributorsTable.tokenHash,
      set: { consentVersion, lastSeenAt: now },
    });

  const inserted = await getDb()
    .insert(mobilityLearningObservationsTable)
    .values(
      observations.map((observation) => ({
        ...observation,
        contributorHash,
      })),
    )
    .onConflictDoNothing({
      target: [
        mobilityLearningObservationsTable.contributorHash,
        mobilityLearningObservationsTable.clientObservationId,
      ],
    })
    .returning({ id: mobilityLearningObservationsTable.id });

  await purgeExpiredObservationsIfDue().catch(() => undefined);
  return { accepted: inserted.length };
}

export async function deleteContributorLearningData(
  token: string,
): Promise<boolean> {
  if (!validLearningToken(token)) return false;
  const contributorHash = hashLearningToken(token);
  const deleted = await getDb()
    .delete(mobilityLearningContributorsTable)
    .where(eq(mobilityLearningContributorsTable.tokenHash, contributorHash))
    .returning({ tokenHash: mobilityLearningContributorsTable.tokenHash });
  return deleted.length > 0;
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function stationAccessProfiles(
  queries: StationAccessProfileQuery[],
): Promise<StationAccessProfile[]> {
  if (queries.length === 0) return [];

  const payload = queries.map((query, index) => ({
    index,
    station_key: query.stationKey,
    line_key: query.lineKey ?? null,
    hour_bucket: query.hourBucket,
    day_type: query.dayType,
  }));

  const result = await getPool().query<AggregateRow>(
    `
      with q as (
        select *
        from jsonb_to_recordset($1::jsonb) as x(
          index int,
          station_key text,
          line_key text,
          hour_bucket int,
          day_type text
        )
      ), eligible as (
        select
          q.index as query_index,
          o.contributor_hash,
          o.station_traversal_seconds,
          o.created_at as observation_created_at,
          case
            when q.line_key is not null
              and o.line_key = q.line_key
              and o.day_type = q.day_type
              and least(
                abs(o.hour_bucket - q.hour_bucket),
                24 - abs(o.hour_bucket - q.hour_bucket)
              ) <= 1 then 1
            when q.line_key is not null and o.line_key = q.line_key then 2
            else 3
          end as level
        from q
        join mobility_learning_observations o
          on o.station_key = q.station_key
        where o.station_traversal_seconds between 15 and 1800
          and o.confidence_permille >= 800
          and o.caught_train is true
          and o.created_at >= now() - ($2::int * interval '1 day')
      ), capped as (
        select *, row_number() over (
          partition by query_index, contributor_hash, level
          order by observation_created_at desc
        ) as contributor_sample_rank
        from eligible
      ), aggregated as (
        select
          query_index,
          level,
          count(*)::int as sample_count,
          count(distinct contributor_hash)::int as contributor_count,
          percentile_cont(0.50) within group (order by station_traversal_seconds)::float8 as p50_seconds,
          percentile_cont(0.90) within group (order by station_traversal_seconds)::float8 as p90_seconds,
          percentile_cont(0.95) within group (order by station_traversal_seconds)::float8 as p95_seconds
        from capped
        where contributor_sample_rank <= 3
        group by query_index, level
      ), qualified as (
        select *
        from aggregated
        where
          (level = 1 and sample_count >= 12 and contributor_count >= 5)
          or (level = 2 and sample_count >= 20 and contributor_count >= 8)
          or (level = 3 and sample_count >= 40 and contributor_count >= 15)
      )
      select distinct on (query_index)
        query_index,
        level,
        sample_count,
        contributor_count,
        p50_seconds,
        p90_seconds,
        p95_seconds
      from qualified
      order by query_index, level
    `,
    [JSON.stringify(payload), PROFILE_LOOKBACK_DAYS],
  );

  const byIndex = new Map(
    result.rows.map((row) => [Number(row.query_index), row]),
  );
  return queries.map((query, index) => {
    const row = byIndex.get(index);
    if (!row) {
      return {
        stationKey: query.stationKey,
        lineKey: query.lineKey ?? null,
        hourBucket: query.hourBucket,
        dayType: query.dayType,
        sampleCount: 0,
        contributorCount: 0,
        p50Seconds: null,
        p90Seconds: null,
        p95Seconds: null,
        source: "insufficient" as const,
        lookbackDays: PROFILE_LOOKBACK_DAYS,
      };
    }
    const level = Number(row.level);
    return {
      stationKey: query.stationKey,
      lineKey: query.lineKey ?? null,
      hourBucket: query.hourBucket,
      dayType: query.dayType,
      sampleCount: Number(row.sample_count),
      contributorCount: Number(row.contributor_count),
      p50Seconds: numeric(row.p50_seconds),
      p90Seconds: numeric(row.p90_seconds),
      p95Seconds: numeric(row.p95_seconds),
      source:
        level === 1
          ? ("station-line-context" as const)
          : level === 2
            ? ("station-line" as const)
            : ("station" as const),
      lookbackDays: PROFILE_LOOKBACK_DAYS,
    };
  });
}

