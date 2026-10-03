DROP INDEX "notification_deliveries_receipt_pending_idx";--> statement-breakpoint
CREATE INDEX "event_participants_status_leave_by_idx" ON "event_participants" USING btree ("status","leave_by");--> statement-breakpoint
CREATE INDEX "notification_deliveries_receipt_pending_idx" ON "notification_deliveries" USING btree ("receipt_checked_at","sent_at");