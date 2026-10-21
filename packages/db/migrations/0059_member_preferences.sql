-- Settings › Account › Preferences: each member's own time zone, date format, week start and landing page in one
-- workspace. First drizzle-kit's `member_preferences` (one row per member, made on their first change, no outbox
-- row, like member_view_state), then, hand written, its row level security. Renumber after main's last on landing.
--
-- The foreign key briefly locks members against writes. Give up after 5 seconds rather than queue behind traffic,
-- like 0058.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "member_preferences" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"time_zone" text,
	"date_format" text DEFAULT 'auto' NOT NULL,
	"week_start" text DEFAULT 'auto' NOT NULL,
	"landing" text DEFAULT 'home' NOT NULL,
	"landing_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_preferences_pkey" PRIMARY KEY("workspace_id","member_id"),
	CONSTRAINT "member_preferences_time_zone" CHECK (char_length("member_preferences"."time_zone") between 1 and 64),
	CONSTRAINT "member_preferences_date_format" CHECK ("member_preferences"."date_format" in ('auto', 'dmy', 'mdy', 'ymd')),
	CONSTRAINT "member_preferences_week_start" CHECK ("member_preferences"."week_start" in ('auto', 'monday', 'sunday', 'saturday')),
	CONSTRAINT "member_preferences_landing" CHECK (("member_preferences"."landing" in ('home', 'tasks') and "member_preferences"."landing_id" is null) or ("member_preferences"."landing" = 'object' and "member_preferences"."landing_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "member_preferences" ADD CONSTRAINT "member_preferences_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table member_preferences enable row level security;
--> statement-breakpoint
alter table member_preferences force row level security;
--> statement-breakpoint
create policy member_preferences_tenant on member_preferences
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
