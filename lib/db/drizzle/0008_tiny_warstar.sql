CREATE TABLE "mobility_learning_contributors" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"consent_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobility_learning_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_observation_id" text NOT NULL,
	"contributor_hash" text NOT NULL,
	"kind" text NOT NULL,
	"station_key" text,
	"line_key" text,
	"hour_bucket" integer NOT NULL,
	"day_type" text NOT NULL,
	"packup_seconds" integer,
	"walking_distance_meters" integer,
	"provider_walking_seconds" integer,
	"actual_walking_seconds" integer,
	"elevation_gain_meters" integer,
	"elevation_loss_meters" integer,
	"station_traversal_seconds" integer,
	"caught_train" boolean,
	"confidence_permille" integer NOT NULL,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobility_learning_observations" ADD CONSTRAINT "mobility_learning_observations_contributor_hash_mobility_learning_contributors_token_hash_fk" FOREIGN KEY ("contributor_hash") REFERENCES "public"."mobility_learning_contributors"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobility_learning_client_observation_uidx" ON "mobility_learning_observations" USING btree ("contributor_hash","client_observation_id");--> statement-breakpoint
CREATE INDEX "mobility_learning_station_idx" ON "mobility_learning_observations" USING btree ("station_key","line_key","created_at");--> statement-breakpoint
CREATE INDEX "mobility_learning_contributor_idx" ON "mobility_learning_observations" USING btree ("contributor_hash","created_at");--> statement-breakpoint
CREATE INDEX "mobility_learning_created_idx" ON "mobility_learning_observations" USING btree ("created_at");