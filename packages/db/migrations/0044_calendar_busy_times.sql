-- Busy times (spec 0024, the owner's call on 20 October 2026): a member's own events that hold nobody else show as
-- Busy on the Bookings week. Such an event is no meeting (AC-605), so the sync keeps only its start and end, under the
-- connection that holds it, and they go with the connection. The table, key, checks and index are drizzle-kit's; the
-- header, the lock timeout and row level security are hand written.
--
-- The foreign key briefly locks calendar_connections against writes. Give up after 5 seconds rather than queue behind
-- traffic, like 0039 and 0042.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "calendar_busy_times" (
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_busy_times_pkey" PRIMARY KEY("workspace_id","connection_id","provider_event_id"),
	CONSTRAINT "calendar_busy_times_times" CHECK ("calendar_busy_times"."ends_at" > "calendar_busy_times"."starts_at"),
	CONSTRAINT "calendar_busy_times_event" CHECK (char_length("calendar_busy_times"."provider_event_id") between 1 and 1024)
);
--> statement-breakpoint
ALTER TABLE "calendar_busy_times" ADD CONSTRAINT "calendar_busy_times_connection" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."calendar_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_busy_times_by_end" ON "calendar_busy_times" USING btree ("workspace_id","connection_id","ends_at");

--> statement-breakpoint
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table calendar_busy_times enable row level security;
--> statement-breakpoint
alter table calendar_busy_times force row level security;
--> statement-breakpoint
create policy calendar_busy_times_tenant on calendar_busy_times
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
