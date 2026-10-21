-- Account security, milestone 2 (spec 0033): the authenticator app and backup codes (Better Auth's twoFactor
-- plugin; secret and codes encrypted with BETTER_AUTH_SECRET, AC-886), the user's two factor switch, and how a
-- session last proved who it is (an email code alone, or a second factor: turning two factor off needs the latter).
-- Schema auth, so the identity login alone reads and writes it (default privileges, 0016).
CREATE TABLE "auth"."two_factor" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp (6) with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "verified_with" text;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD CONSTRAINT "two_factor_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user" ON "auth"."two_factor" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_verified_with" CHECK ("auth"."session"."verified_with" in ('email', 'second_factor'));