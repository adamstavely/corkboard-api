CREATE TYPE "public"."board_access" AS ENUM('none', 'reader', 'commenter', 'updater', 'owner');--> statement-breakpoint
CREATE TABLE "board_members" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "board_access" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_members_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "org_invites" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "org_invites" ALTER COLUMN "role" SET DEFAULT 'updater'::text;--> statement-breakpoint
ALTER TABLE "org_members" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "org_members" ALTER COLUMN "role" SET DEFAULT 'updater'::text;--> statement-breakpoint
-- Written by hand: the two old roles become two of the four (admin → owner, member → updater) before the new type.
UPDATE "org_members" SET "role" = CASE "role" WHEN 'admin' THEN 'owner' ELSE 'updater' END;--> statement-breakpoint
UPDATE "org_invites" SET "role" = CASE "role" WHEN 'admin' THEN 'owner' ELSE 'updater' END;--> statement-breakpoint
-- Each board's creator owns it, as new boards' creators will.
INSERT INTO "board_members" ("board_id", "user_id", "role") SELECT "id", "created_by", 'owner' FROM "boards" WHERE "created_by" IS NOT NULL;--> statement-breakpoint
DROP TYPE "public"."org_role";--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('reader', 'commenter', 'updater', 'owner');--> statement-breakpoint
ALTER TABLE "org_invites" ALTER COLUMN "role" SET DEFAULT 'updater'::"public"."org_role";--> statement-breakpoint
ALTER TABLE "org_invites" ALTER COLUMN "role" SET DATA TYPE "public"."org_role" USING "role"::"public"."org_role";--> statement-breakpoint
ALTER TABLE "org_members" ALTER COLUMN "role" SET DEFAULT 'updater'::"public"."org_role";--> statement-breakpoint
ALTER TABLE "org_members" ALTER COLUMN "role" SET DATA TYPE "public"."org_role" USING "role"::"public"."org_role";--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_members_user" ON "board_members" USING btree ("user_id");