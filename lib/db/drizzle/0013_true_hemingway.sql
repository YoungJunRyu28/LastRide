ALTER TABLE "groups" ADD COLUMN "creation_key_hash" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "groups_creation_key_hash_idx" ON "groups" USING btree ("creation_key_hash");