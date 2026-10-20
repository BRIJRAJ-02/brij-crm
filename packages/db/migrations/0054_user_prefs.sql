-- The workspace a person last opened (spec 0031, AC-802), so `/` and sign in take them back to it on any device.
-- Global identity in schema auth: the default privileges give it to crm_identity alone, as 0016 set them.

CREATE TABLE "auth"."user_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_workspace_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."user_prefs" ADD CONSTRAINT "user_prefs_user" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."user_prefs" ADD CONSTRAINT "user_prefs_last_workspace" FOREIGN KEY ("last_workspace_id") REFERENCES "auth"."workspace_directory"("workspace_id") ON DELETE no action ON UPDATE no action;