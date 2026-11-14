ALTER TABLE "org_invites" ADD COLUMN "token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "org_invites_token" ON "org_invites" USING btree ("token_hash");