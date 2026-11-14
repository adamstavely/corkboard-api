CREATE TABLE "issue_exports" (
	"board_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"integration_id" uuid,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"issue_key" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_exports_board_id_task_id_pk" PRIMARY KEY("board_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "issue_exports" ADD CONSTRAINT "issue_exports_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_exports" ADD CONSTRAINT "issue_exports_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;