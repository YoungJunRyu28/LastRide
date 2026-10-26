CREATE TABLE "group_alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"night_id" uuid NOT NULL,
	"sender_member_id" uuid NOT NULL,
	"recipient_member_id" uuid NOT NULL,
	"leave_by" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"expo_ticket_id" varchar(128),
	"push_token_used" varchar(255),
	"receipt_checked_at" timestamp with time zone,
	"receipt_error" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_alert_deliveries" ADD CONSTRAINT "group_alert_deliveries_night_id_group_nights_id_fk" FOREIGN KEY ("night_id") REFERENCES "public"."group_nights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_alert_deliveries" ADD CONSTRAINT "group_alert_deliveries_sender_member_id_group_members_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "public"."group_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_alert_deliveries" ADD CONSTRAINT "group_alert_deliveries_recipient_member_id_group_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."group_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_alert_deliveries_once_idx" ON "group_alert_deliveries" USING btree ("night_id","sender_member_id","recipient_member_id","leave_by");--> statement-breakpoint
CREATE INDEX "group_alert_deliveries_retry_idx" ON "group_alert_deliveries" USING btree ("sent_at","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "group_alert_deliveries_receipt_idx" ON "group_alert_deliveries" USING btree ("receipt_checked_at","sent_at");