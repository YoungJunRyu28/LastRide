CREATE TABLE "group_push_receipt_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid,
	"recipient_member_id" uuid,
	"expo_ticket_id" varchar(128) NOT NULL,
	"push_token_digest" varchar(64) NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_push_receipt_checks" ADD CONSTRAINT "group_push_receipt_checks_delivery_id_group_alert_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."group_alert_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_push_receipt_checks" ADD CONSTRAINT "group_push_receipt_checks_recipient_member_id_group_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."group_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_push_receipt_ticket_unique_idx" ON "group_push_receipt_checks" USING btree ("expo_ticket_id");--> statement-breakpoint
CREATE INDEX "group_push_receipt_sent_idx" ON "group_push_receipt_checks" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "group_push_receipt_expires_idx" ON "group_push_receipt_checks" USING btree ("expires_at");
--> statement-breakpoint
-- Backfill outstanding Expo tickets sent by earlier server binaries. These
-- were stored only under group_nights and would otherwise never be checked
-- once the new receipt processor stops reading group_alert_deliveries.
-- PostgreSQL built-in sha256(bytea) is available on supported server versions.
-- Only still-relevant (<2h) tickets are copied, never private trip times.
INSERT INTO "group_push_receipt_checks" (
  "delivery_id", "recipient_member_id", "expo_ticket_id",
  "push_token_digest", "sent_at", "expires_at"
)
SELECT d."id", d."recipient_member_id", d."expo_ticket_id",
  encode(sha256(convert_to(d."push_token_used", 'UTF8')), 'hex'),
  d."sent_at", d."sent_at" + interval '2 hours'
FROM "group_alert_deliveries" d
WHERE d."sent_at" IS NOT NULL
  AND d."expo_ticket_id" IS NOT NULL
  AND d."push_token_used" IS NOT NULL
  AND d."receipt_checked_at" IS NULL
  AND d."sent_at" >= now() - interval '2 hours'
ON CONFLICT ("expo_ticket_id") DO NOTHING;
