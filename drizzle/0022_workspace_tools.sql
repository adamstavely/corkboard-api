CREATE TYPE "public"."search_provider" AS ENUM('brave', 'tavily');--> statement-breakpoint
CREATE TABLE "workspace_tools" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"web_search" boolean DEFAULT false NOT NULL,
	"search_provider" "search_provider",
	"search_key_encrypted" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_tools" ADD CONSTRAINT "workspace_tools_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_tools" ADD CONSTRAINT "workspace_tools_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;