CREATE TYPE "public"."feedback_visibility" AS ENUM('names', 'anonymous', 'own');--> statement-breakpoint
CREATE TABLE "board_feedback_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"token" text NOT NULL,
	"visibility" "feedback_visibility" DEFAULT 'anonymous' NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_feedback_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "board_participants" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pseudonym" integer NOT NULL,
	"link_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone,
	CONSTRAINT "board_participants_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "board_feedback_links" ADD CONSTRAINT "board_feedback_links_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_feedback_links" ADD CONSTRAINT "board_feedback_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_participants" ADD CONSTRAINT "board_participants_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_participants" ADD CONSTRAINT "board_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_participants" ADD CONSTRAINT "board_participants_link_id_board_feedback_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."board_feedback_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_feedback_links_board" ON "board_feedback_links" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_participants_pseudonym" ON "board_participants" USING btree ("board_id","pseudonym");--> statement-breakpoint
CREATE INDEX "board_participants_user" ON "board_participants" USING btree ("user_id");