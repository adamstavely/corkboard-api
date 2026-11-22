ALTER TABLE "integrations" ADD COLUMN "webhook_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "sync_error" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "sync_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "sync_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "sync_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_exports" ADD COLUMN "synced" jsonb;--> statement-breakpoint
ALTER TABLE "issue_exports" ADD COLUMN "synced_at" timestamp with time zone;