-- Account security, milestone 4 (spec 0033, AC-897, AC-898): the devices each account signed in from, by the
-- SHA-256 of browser family, system and country only, for the new device alert; and an index for the identity
-- sweep that deletes year old security events and devices. Schema auth, so the identity login alone reads and
-- writes it (default privileges, 0016).
CREATE TABLE "auth"."known_device" (
	"user_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"first_seen" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_device_pkey" PRIMARY KEY("user_id","device_key"),
	CONSTRAINT "known_device_key" CHECK ("auth"."known_device"."device_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "auth"."known_device" ADD CONSTRAINT "known_device_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "known_device_last_seen" ON "auth"."known_device" USING btree ("last_seen");--> statement-breakpoint

CREATE INDEX "security_event_at" ON "auth"."security_event" USING btree ("at");
