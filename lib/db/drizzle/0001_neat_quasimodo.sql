CREATE TABLE "kv_cache" (
	"cache_name" text NOT NULL,
	"cache_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "kv_cache_cache_name_cache_key_pk" PRIMARY KEY("cache_name","cache_key")
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"provider" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_provider_day_pk" PRIMARY KEY("provider","day")
);
