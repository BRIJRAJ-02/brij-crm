-- Account security, milestone 3 (spec 0033): passkeys (Better Auth's passkey plugin). Public keys only; a credential
-- id signs in one account at most. Schema auth, so the identity login alone reads and writes it (default privileges,
-- 0016). The user's deletion takes their passkeys with it (AC-905).
CREATE TABLE "auth"."passkey" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (6) with time zone,
	CONSTRAINT "passkey_name" CHECK ("auth"."passkey"."name" is null or char_length("auth"."passkey"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "auth"."passkey" ADD CONSTRAINT "passkey_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential" ON "auth"."passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_user" ON "auth"."passkey" USING btree ("user_id","created_at");