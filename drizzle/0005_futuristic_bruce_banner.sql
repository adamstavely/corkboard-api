-- Email becomes how people tell each other apart in the picker: lower-cased, required and unique.
UPDATE "users" SET "email" = lower(trim(coalesce("email", "id"::text || '@corkboard.local')));--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_oidc_subject_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "oidc_subject";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email_verified";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");