-- Account security, milestone 1 (spec 0033): where and on what each session signed in, when it last proved
-- who it is (for a step up), and a per account history of security events, kept a year. Schema auth, so the
-- identity login alone reads and writes it (default privileges, 0016).
CREATE TABLE "auth"."security_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"session_id" uuid,
	"ip" "inet",
	"country" text,
	"device_label" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "security_event_kind" CHECK (kind in ('sign_in', 'sign_out', 'session_revoked', 'sessions_revoked', 'two_factor_on', 'two_factor_off', 'backup_codes_made', 'backup_code_used', 'passkey_added', 'passkey_removed', 'alert_sent'))
);
--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "device_label" text;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "verified_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."security_event" ADD CONSTRAINT "security_event_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_event_user_at" ON "auth"."security_event" USING btree ("user_id","at" DESC NULLS LAST);