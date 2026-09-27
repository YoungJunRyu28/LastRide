CREATE TYPE "public"."organization_member_role" AS ENUM('owner', 'organizer');--> statement-breakpoint
CREATE TYPE "public"."enterprise_event_status" AS ENUM('draft', 'active', 'closed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."event_participant_status" AS ENUM('active', 'left');--> statement-breakpoint
CREATE TYPE "public"."host_device_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."enterprise_notification_kind" AS ENUM('leaving_soon', 'leave_now');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"auth_user_id" text NOT NULL,
	"role" "organization_member_role" DEFAULT 'organizer' NOT NULL,
	"display_name" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "enterprise_event_status" DEFAULT 'draft' NOT NULL,
	"alert_lead_minutes" integer DEFAULT 10 NOT NULL,
	"participant_limit" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_events_alert_lead_minutes_check" CHECK ("enterprise_events"."alert_lead_minutes" between 1 and 120),
	CONSTRAINT "enterprise_events_participant_limit_check" CHECK ("enterprise_events"."participant_limit" between 1 and 500),
	CONSTRAINT "enterprise_events_expiry_after_start_check" CHECK ("enterprise_events"."expires_at" > "enterprise_events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "event_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"invite_token_hash" varchar(64) NOT NULL,
	"join_code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"leave_by" timestamp with time zone,
	"participant_token_hash" varchar(64) NOT NULL,
	"status" "event_participant_status" DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_member_id" uuid NOT NULL,
	"expo_push_token" varchar(255) NOT NULL,
	"platform" "host_device_platform" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"host_device_id" uuid NOT NULL,
	"kind" "enterprise_notification_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"expo_ticket_id" varchar(128),
	"receipt_checked_at" timestamp with time zone,
	"receipt_error" varchar(64)
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_events" ADD CONSTRAINT "enterprise_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_events" ADD CONSTRAINT "enterprise_events_created_by_member_id_organization_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_event_id_enterprise_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."enterprise_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_enterprise_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."enterprise_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_devices" ADD CONSTRAINT "host_devices_organization_member_id_organization_members_id_fk" FOREIGN KEY ("organization_member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_participant_id_event_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."event_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_host_device_id_host_devices_id_fk" FOREIGN KEY ("host_device_id") REFERENCES "public"."host_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_auth_user_idx" ON "organization_members" USING btree ("organization_id","auth_user_id");--> statement-breakpoint
CREATE INDEX "organization_members_auth_user_idx" ON "organization_members" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "enterprise_events_org_starts_at_idx" ON "enterprise_events" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "enterprise_events_status_expires_at_idx" ON "enterprise_events" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_invites_token_hash_idx" ON "event_invites" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "event_invites_join_code_hash_idx" ON "event_invites" USING btree ("join_code_hash");--> statement-breakpoint
CREATE INDEX "event_invites_event_idx" ON "event_invites" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_invites_expires_at_idx" ON "event_invites" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_participants_token_hash_idx" ON "event_participants" USING btree ("participant_token_hash");--> statement-breakpoint
CREATE INDEX "event_participants_event_leave_by_idx" ON "event_participants" USING btree ("event_id","leave_by");--> statement-breakpoint
CREATE INDEX "event_participants_event_status_idx" ON "event_participants" USING btree ("event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "host_devices_expo_push_token_idx" ON "host_devices" USING btree ("expo_push_token");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once_idx" ON "notification_deliveries" USING btree ("participant_id","host_device_id","kind");--> statement-breakpoint
CREATE INDEX "notification_deliveries_receipt_pending_idx" ON "notification_deliveries" USING btree ("receipt_checked_at","created_at");