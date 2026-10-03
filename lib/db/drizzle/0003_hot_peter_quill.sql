CREATE TABLE "api_rate_limits" (
	"key_hash" varchar(64) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_rate_limits_key_hash_window_start_pk" PRIMARY KEY("key_hash","window_start")
);
--> statement-breakpoint
CREATE INDEX "api_rate_limits_expires_at_idx" ON "api_rate_limits" USING btree ("expires_at");