CREATE TYPE "public"."group_language" AS ENUM('ja', 'en');--> statement-breakpoint
CREATE TYPE "public"."group_member_role" AS ENUM('host', 'member');--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"display_name" varchar(40) NOT NULL,
	"role" "group_member_role" DEFAULT 'member' NOT NULL,
	"member_token_hash" varchar(64) NOT NULL,
	"expo_push_token" varchar(255),
	"language" "group_language" DEFAULT 'ja' NOT NULL,
	"notifications" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_night_participants" (
	"night_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"leave_by" timestamp with time zone,
	"missed_at" timestamp with time zone,
	"leave_alert_sent_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_night_participants_night_id_member_id_pk" PRIMARY KEY("night_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "group_nights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"invite_token_hash" varchar(64) NOT NULL,
	"join_code_hash" varchar(64) NOT NULL,
	"invite_ciphertext" text,
	"invite_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_night_participants" ADD CONSTRAINT "group_night_participants_night_id_group_nights_id_fk" FOREIGN KEY ("night_id") REFERENCES "public"."group_nights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_night_participants" ADD CONSTRAINT "group_night_participants_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_nights" ADD CONSTRAINT "group_nights_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_token_hash_idx" ON "group_members" USING btree ("member_token_hash");--> statement-breakpoint
CREATE INDEX "group_members_group_idx" ON "group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_one_host_idx" ON "group_members" USING btree ("group_id") WHERE "group_members"."role" = 'host';--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_push_token_idx" ON "group_members" USING btree ("group_id","expo_push_token");--> statement-breakpoint
CREATE INDEX "group_night_participants_member_idx" ON "group_night_participants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "group_night_participants_leave_by_idx" ON "group_night_participants" USING btree ("leave_by");--> statement-breakpoint
CREATE UNIQUE INDEX "group_nights_group_idx" ON "group_nights" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_nights_ends_at_idx" ON "group_nights" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_invite_token_hash_idx" ON "groups" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_join_code_hash_idx" ON "groups" USING btree ("join_code_hash");