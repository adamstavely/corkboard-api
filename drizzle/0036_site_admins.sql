CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"search_provider" "search_provider",
	"search_key_encrypted" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_models" (
	"org_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_models_org_id_provider_id_pk" PRIMARY KEY("org_id","provider_id")
);
--> statement-breakpoint
ALTER TABLE "model_providers" DROP CONSTRAINT "model_providers_org_id_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "logo_packs" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_models" ADD CONSTRAINT "workspace_models_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_models" ADD CONSTRAINT "workspace_models_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "logo_packs_site_name" ON "logo_packs" USING btree ("name") WHERE "logo_packs"."org_id" is null;--> statement-breakpoint
-- Every workspace's own connection moves to the site, staying switched on for the workspace that made it.
INSERT INTO "workspace_models" ("org_id", "provider_id") SELECT "org_id", "id" FROM "model_providers" WHERE "org_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "model_providers" DROP COLUMN "org_id";--> statement-breakpoint
-- The search key set most recently by any workspace becomes the site's.
INSERT INTO "site_settings" ("id", "search_provider", "search_key_encrypted") SELECT 'site', "search_provider", "search_key_encrypted" FROM "workspace_tools" WHERE "search_provider" IS NOT NULL AND "search_key_encrypted" IS NOT NULL ORDER BY "updated_at" DESC LIMIT 1;--> statement-breakpoint
ALTER TABLE "workspace_tools" DROP COLUMN "search_provider";--> statement-breakpoint
ALTER TABLE "workspace_tools" DROP COLUMN "search_key_encrypted";