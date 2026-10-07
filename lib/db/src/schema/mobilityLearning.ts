import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * Anonymous contributors to LastRide's opt-in mobility-learning pool.
 *
 * The device keeps the random bearer token in SecureStore. The server persists
 * only SHA-256(token), so a database leak does not reveal the credential used
 * for upload/deletion. No account, home address, raw GPS coordinate, or route
 * trace is stored here.
 */
export const mobilityLearningContributorsTable = pgTable(
  "mobility_learning_contributors",
  {
    tokenHash: text("token_hash").primaryKey(),
    consentVersion: integer("consent_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * Derived, privacy-minimal timing outcomes used to improve aggregate and
 * personalized departure predictions.
 *
 * stationKey/lineKey identify public transport infrastructure, not a user's
 * origin or destination. All time measurements are durations or coarse buckets.
 */
export const mobilityLearningObservationsTable = pgTable(
  "mobility_learning_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientObservationId: text("client_observation_id").notNull(),
    contributorHash: text("contributor_hash")
      .notNull()
      .references(() => mobilityLearningContributorsTable.tokenHash, {
        onDelete: "cascade",
      }),
    kind: text("kind").notNull(),
    stationKey: text("station_key"),
    lineKey: text("line_key"),
    hourBucket: integer("hour_bucket").notNull(),
    dayType: text("day_type").notNull(),
    packupSeconds: integer("packup_seconds"),
    walkingDistanceMeters: integer("walking_distance_meters"),
    providerWalkingSeconds: integer("provider_walking_seconds"),
    actualWalkingSeconds: integer("actual_walking_seconds"),
    elevationGainMeters: integer("elevation_gain_meters"),
    elevationLossMeters: integer("elevation_loss_meters"),
    stationTraversalSeconds: integer("station_traversal_seconds"),
    caughtTrain: boolean("caught_train"),
    confidencePermille: integer("confidence_permille").notNull(),
    modelVersion: text("model_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mobility_learning_client_observation_uidx").on(
      table.contributorHash,
      table.clientObservationId,
    ),
    index("mobility_learning_station_idx").on(
      table.stationKey,
      table.lineKey,
      table.createdAt,
    ),
    index("mobility_learning_contributor_idx").on(
      table.contributorHash,
      table.createdAt,
    ),
    index("mobility_learning_created_idx").on(table.createdAt),
  ],
);

export const insertMobilityLearningContributorSchema = createInsertSchema(
  mobilityLearningContributorsTable,
);
export const insertMobilityLearningObservationSchema = createInsertSchema(
  mobilityLearningObservationsTable,
);

export type MobilityLearningContributor =
  typeof mobilityLearningContributorsTable.$inferSelect;
export type MobilityLearningObservation =
  typeof mobilityLearningObservationsTable.$inferSelect;
