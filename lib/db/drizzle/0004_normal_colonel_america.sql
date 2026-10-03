DROP INDEX "organization_members_auth_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_auth_user_idx" ON "organization_members" USING btree ("auth_user_id");