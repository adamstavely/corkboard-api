ALTER TABLE "board_share_links" ADD COLUMN "embed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_policies" ADD COLUMN "embeds" boolean DEFAULT true NOT NULL;