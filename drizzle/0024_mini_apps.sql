CREATE TABLE "board_app_versions" (
	"app_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"html" text NOT NULL,
	"note" text NOT NULL,
	"model" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_app_versions_app_id_version_pk" PRIMARY KEY("app_id","version")
);
--> statement-breakpoint
CREATE TABLE "board_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_tools" ADD COLUMN "mini_apps" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "board_app_versions" ADD CONSTRAINT "board_app_versions_app_id_board_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."board_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_app_versions" ADD CONSTRAINT "board_app_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_apps" ADD CONSTRAINT "board_apps_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_apps" ADD CONSTRAINT "board_apps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_apps_board" ON "board_apps" USING btree ("board_id");