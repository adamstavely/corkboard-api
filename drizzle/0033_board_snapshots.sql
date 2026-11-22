CREATE TABLE "board_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"state" "bytea" NOT NULL,
	"vector" "bytea" NOT NULL,
	"depth" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_snapshots" ADD CONSTRAINT "board_snapshots_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_snapshots_board" ON "board_snapshots" USING btree ("board_id","created_at");