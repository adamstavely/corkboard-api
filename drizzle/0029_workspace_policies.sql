CREATE TYPE "public"."policy_who" AS ENUM('workspace_owners', 'board_owners', 'editors', 'everyone');--> statement-breakpoint
CREATE TABLE "workspace_policies" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"share_with_people" "policy_who" DEFAULT 'board_owners' NOT NULL,
	"share_links" "policy_who" DEFAULT 'board_owners' NOT NULL,
	"editable_links" boolean DEFAULT true NOT NULL,
	"link_password" boolean DEFAULT false NOT NULL,
	"link_max_days" integer,
	"exports" "policy_who" DEFAULT 'everyone' NOT NULL,
	"feedback" "policy_who" DEFAULT 'board_owners' NOT NULL,
	"retention_days" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_share_links" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;