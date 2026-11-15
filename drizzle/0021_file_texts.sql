CREATE TABLE "board_file_texts" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"text" text NOT NULL,
	"chunks" integer NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_file_texts" ADD CONSTRAINT "board_file_texts_file_id_board_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."board_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_file_texts" ADD CONSTRAINT "board_file_texts_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_file_texts_board" ON "board_file_texts" USING btree ("board_id");