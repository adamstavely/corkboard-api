CREATE TABLE "poker_estimates" (
	"board_id" uuid NOT NULL,
	"round" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poker_estimates_board_id_round_user_id_pk" PRIMARY KEY("board_id","round","user_id")
);
--> statement-breakpoint
ALTER TABLE "poker_estimates" ADD CONSTRAINT "poker_estimates_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poker_estimates" ADD CONSTRAINT "poker_estimates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;