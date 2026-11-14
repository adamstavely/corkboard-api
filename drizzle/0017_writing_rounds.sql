CREATE TYPE "public"."writing_status" AS ENUM('open', 'revealing', 'closed');--> statement-breakpoint
CREATE TABLE "writing_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"status" "writing_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "writing_rounds" ADD CONSTRAINT "writing_rounds_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "writing_rounds_board_idx" ON "writing_rounds" USING btree ("board_id");