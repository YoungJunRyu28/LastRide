import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import {
  getDb,
  getPool,
  mobilityLearningContributorsTable,
  mobilityLearningObservationsTable,
} from "@workspace/db";
import {
  CURRENT_LEARNING_CONSENT_VERSION,
  deleteContributorLearningData,
  hashLearningToken,
  recordMobilityObservations,
  purgeExpiredMobilityLearningObservations,
  stationAccessProfiles,
  validLearningToken,
} from "../src/lib/mobilityLearning";

const STATION = "station-v1:渋谷:35.6580:139.7010";
const LINE = "line-v1:jr山手線";

function token(index: number): string {
  return index.toString(16).padStart(64, "0");
}

async function clearLearningData() {
  await getDb().delete(mobilityLearningContributorsTable);
}

beforeEach(clearLearningData);
afterAll(clearLearningData);

describe("mobility learning identity", () => {
  it("accepts only 256-bit hex installation tokens and stores a one-way hash", () => {
    const value = token(1);
    expect(validLearningToken(value)).toBe(true);
    expect(validLearningToken("short")).toBe(false);
    expect(hashLearningToken(value)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashLearningToken(value)).not.toBe(value);
  });

  it("deduplicates a retried client observation", async () => {
    const value = token(2);
    const observation = {
      clientObservationId: "trip-1",
      kind: "station_traversal" as const,
      stationKey: STATION,
      lineKey: LINE,
      hourBucket: 23,
      dayType: "weekday" as const,
      stationTraversalSeconds: 360,
      caughtTrain: true,
      confidencePermille: 1000,
      modelVersion: "mobility-v1",
    };

    expect(
      await recordMobilityObservations(
        value,
        CURRENT_LEARNING_CONSENT_VERSION,
        [observation],
      ),
    ).toEqual({ accepted: 1 });
    expect(
      await recordMobilityObservations(
        value,
        CURRENT_LEARNING_CONSENT_VERSION,
        [observation],
      ),
    ).toEqual({ accepted: 0 });

    const [row] = await getDb()
      .select({ total: count() })
      .from(mobilityLearningObservationsTable);
    expect(Number(row.total)).toBe(1);
  });

  it("purges observations older than the retention limit without requiring new uploads", async () => {
    const value = token(10);
    await recordMobilityObservations(
      value,
      CURRENT_LEARNING_CONSENT_VERSION,
      [{
        clientObservationId: "old-record",
        kind: "trip_timing",
        hourBucket: 22,
        dayType: "weekday",
        confidencePermille: 850,
        modelVersion: "mobility-v1",
      }],
    );
    const past = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    await getPool().query(
      "update mobility_learning_observations set created_at = $1 where client_observation_id = $2",
      [past, "old-record"],
    );
    expect(await purgeExpiredMobilityLearningObservations()).toBe(1);
    const [row] = await getDb()
      .select({ total: count() })
      .from(mobilityLearningObservationsTable);
    expect(Number(row.total)).toBe(0);
  });

  it("deletes every observation for the installation through the contributor cascade", async () => {
    const value = token(3);
    await recordMobilityObservations(
      value,
      CURRENT_LEARNING_CONSENT_VERSION,
      [
        {
          clientObservationId: "trip-delete",
          kind: "station_traversal",
          stationKey: STATION,
          lineKey: LINE,
          hourBucket: 23,
          dayType: "weekday",
          stationTraversalSeconds: 420,
          caughtTrain: true,
          confidencePermille: 1000,
          modelVersion: "mobility-v1",
        },
      ],
    );

    expect(await deleteContributorLearningData(value)).toBe(true);
    const rows = await getDb()
      .select()
      .from(mobilityLearningObservationsTable)
      .where(
        eq(
          mobilityLearningObservationsTable.contributorHash,
          hashLearningToken(value),
        ),
      );
    expect(rows).toEqual([]);
  });
});

describe("aggregate station access profiles", () => {
  it("uses contextual cohorts first, then safe broader fallbacks", async () => {
    // 15 independent contributors, three high-confidence catches each.
    // This is enough for every privacy threshold while ensuring no single user
    // can create an aggregate station profile alone.
    for (let contributor = 1; contributor <= 15; contributor += 1) {
      await recordMobilityObservations(
        token(100 + contributor),
        CURRENT_LEARNING_CONSENT_VERSION,
        Array.from({ length: 3 }, (_, sample) => ({
          clientObservationId: `c${contributor}-s${sample}`,
          kind: "station_traversal" as const,
          stationKey: STATION,
          lineKey: LINE,
          hourBucket: 23,
          dayType: "weekday" as const,
          stationTraversalSeconds: 300 + contributor * 5 + sample,
          caughtTrain: true,
          confidencePermille: 950,
          modelVersion: "mobility-v1",
        })),
      );
    }

    const [contextual, differentContext, stationOnly] =
      await stationAccessProfiles([
        {
          stationKey: STATION,
          lineKey: LINE,
          hourBucket: 23,
          dayType: "weekday",
        },
        {
          stationKey: STATION,
          lineKey: LINE,
          hourBucket: 12,
          dayType: "weekend",
        },
        {
          stationKey: STATION,
          hourBucket: 12,
          dayType: "weekend",
        },
      ]);

    expect(contextual.source).toBe("station-line-context");
    expect(contextual.sampleCount).toBe(45);
    expect(contextual.contributorCount).toBe(15);
    expect(contextual.p90Seconds).toBeGreaterThan(300);

    expect(differentContext.source).toBe("station-line");
    expect(differentContext.contributorCount).toBe(15);

    expect(stationOnly.source).toBe("station");
    expect(stationOnly.contributorCount).toBe(15);
  });

  it("caps a contributor to three samples per profile cohort", async () => {
    for (let contributor = 1; contributor <= 15; contributor += 1) {
      await recordMobilityObservations(
        token(700 + contributor),
        CURRENT_LEARNING_CONSENT_VERSION,
        Array.from({ length: 8 }, (_, sample) => ({
          clientObservationId: `cap-${contributor}-${sample}`,
          kind: "station_traversal" as const,
          stationKey: STATION,
          lineKey: LINE,
          hourBucket: 23,
          dayType: "weekday" as const,
          stationTraversalSeconds: 240 + contributor * 10 + sample,
          caughtTrain: true,
          confidencePermille: 950,
          modelVersion: "mobility-v1",
        })),
      );
    }
    const [profile] = await stationAccessProfiles([
      { stationKey: STATION, lineKey: LINE, hourBucket: 23, dayType: "weekday" },
    ]);
    expect(profile.source).toBe("station-line-context");
    expect(profile.contributorCount).toBe(15);
    expect(profile.sampleCount).toBe(45);
  });

  it("returns insufficient instead of exposing a tiny cohort", async () => {
    await recordMobilityObservations(
      token(500),
      CURRENT_LEARNING_CONSENT_VERSION,
      [
        {
          clientObservationId: "only-sample",
          kind: "station_traversal",
          stationKey: STATION,
          lineKey: LINE,
          hourBucket: 23,
          dayType: "weekday",
          stationTraversalSeconds: 999,
          caughtTrain: true,
          confidencePermille: 1000,
          modelVersion: "mobility-v1",
        },
      ],
    );

    const [profile] = await stationAccessProfiles([
      {
        stationKey: STATION,
        lineKey: LINE,
        hourBucket: 23,
        dayType: "weekday",
      },
    ]);

    expect(profile.source).toBe("insufficient");
    expect(profile.sampleCount).toBe(0);
    expect(profile.contributorCount).toBe(0);
    expect(profile.p90Seconds).toBeNull();
  });
});
