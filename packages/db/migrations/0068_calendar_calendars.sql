-- Calendars (spec 0024 milestone 5, the amendment of 20 October 2026), the expand step: every calendar of each
-- connected account as a row of `calendar_calendars`, with its own switches, colour, sync token and push channel,
-- and one destination per member; a booking page's own destination; and a meeting's sources and a member's busy times
-- kept per calendar. The type, table, keys, checks and indexes are drizzle-kit's; the header, the lock timeout, the
-- order around the backfill, row level security, the booking page's foreign key and the backfill are hand written.
--
-- The backfill gives every connection its main calendar with milestone 5's defaults (checks for conflicts, shows on
-- the week, syncs meetings: AC-992), Google's real id for it (the account's address; the first refresh re keys a row
-- whose id turns out different), the connection's sync token and channel copied, and as each member's destination
-- the main calendar of their default connection (else their oldest), so nothing a member sees or a page offers
-- changes on the day it ships (AC-992, AC-996). Today's literal `primary` on sources and busy times becomes that id.
-- `calendar_connections.sync_state`, `.channel` and `.is_default` stay, unread, for the contract migration a release
-- later.
--
-- The new keys on meeting_sources and calendar_busy_times add the calendar: an old worker still running in the
-- deploy's overlap fails its upsert against them, and Graphile runs that sync again on the new one; nothing is lost.
--
-- The foreign keys briefly lock calendar_connections, members and booking_pages against writes. Give up after 5
-- seconds rather than queue behind traffic, like 0039 and 0044.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."calendar_access_role" AS ENUM('owner', 'writer', 'reader', 'free_busy');--> statement-breakpoint
CREATE TABLE "calendar_calendars" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"provider_calendar_id" text NOT NULL,
	"name" text NOT NULL,
	"provider_colour" text,
	"colour_override" text,
	"access_role" "calendar_access_role" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"check_conflicts" boolean DEFAULT false NOT NULL,
	"show_in_week" boolean DEFAULT false NOT NULL,
	"sync" boolean DEFAULT false NOT NULL,
	"time_zone" text,
	"is_destination" boolean DEFAULT false NOT NULL,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" jsonb,
	"last_error" jsonb,
	"failing_since" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "calendar_calendars_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "calendar_calendars_destination_writable" CHECK (not "calendar_calendars"."is_destination" or "calendar_calendars"."access_role" in ('owner', 'writer')),
	CONSTRAINT "calendar_calendars_name" CHECK (char_length("calendar_calendars"."name") between 1 and 255),
	CONSTRAINT "calendar_calendars_provider_id" CHECK (char_length("calendar_calendars"."provider_calendar_id") between 1 and 1024),
	CONSTRAINT "calendar_calendars_colour" CHECK ("calendar_calendars"."provider_colour" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "calendar_calendars_hue" CHECK (char_length("calendar_calendars"."colour_override") between 1 and 32),
	CONSTRAINT "calendar_calendars_zone" CHECK (char_length("calendar_calendars"."time_zone") <= 64),
	CONSTRAINT "calendar_calendars_created_by_actor" CHECK (("calendar_calendars"."created_by_type" is null and "calendar_calendars"."created_by_id" is null and "calendar_calendars"."created_by_member_id" is null)
      or ("calendar_calendars"."created_by_type"::text in ('system', 'calendar') and "calendar_calendars"."created_by_id" is null and "calendar_calendars"."created_by_member_id" is null)
      or ("calendar_calendars"."created_by_type" = 'member' and "calendar_calendars"."created_by_id" is not null and "calendar_calendars"."created_by_member_id" = "calendar_calendars"."created_by_id")
      or ("calendar_calendars"."created_by_type"::text not in ('member', 'system', 'calendar') and "calendar_calendars"."created_by_id" is not null and "calendar_calendars"."created_by_member_id" is null)),
	CONSTRAINT "calendar_calendars_updated_by_actor" CHECK (("calendar_calendars"."updated_by_type" is null and "calendar_calendars"."updated_by_id" is null and "calendar_calendars"."updated_by_member_id" is null)
      or ("calendar_calendars"."updated_by_type"::text in ('system', 'calendar') and "calendar_calendars"."updated_by_id" is null and "calendar_calendars"."updated_by_member_id" is null)
      or ("calendar_calendars"."updated_by_type" = 'member' and "calendar_calendars"."updated_by_id" is not null and "calendar_calendars"."updated_by_member_id" = "calendar_calendars"."updated_by_id")
      or ("calendar_calendars"."updated_by_type"::text not in ('member', 'system', 'calendar') and "calendar_calendars"."updated_by_id" is not null and "calendar_calendars"."updated_by_member_id" is null))
);
--> statement-breakpoint
DROP INDEX "calendar_busy_times_by_end";--> statement-breakpoint
DROP INDEX "meeting_sources_event";--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "destination_calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_busy_times" ADD COLUMN "calendar_id" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "calendars_listed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "meeting_sources" ADD COLUMN "created_by_crm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_with_member" ON "calendar_connections" USING btree ("workspace_id","id","member_id");--> statement-breakpoint
ALTER TABLE "calendar_calendars" ADD CONSTRAINT "calendar_calendars_connection" FOREIGN KEY ("workspace_id","connection_id","member_id") REFERENCES "public"."calendar_connections"("workspace_id","id","member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_calendars" ADD CONSTRAINT "calendar_calendars_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_calendars" ADD CONSTRAINT "calendar_calendars_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_calendars" ADD CONSTRAINT "calendar_calendars_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_calendars_account" ON "calendar_calendars" USING btree ("workspace_id","connection_id","provider_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_calendars_destination" ON "calendar_calendars" USING btree ("workspace_id","member_id") WHERE "calendar_calendars"."is_destination";--> statement-breakpoint
CREATE INDEX "calendar_calendars_by_member" ON "calendar_calendars" USING btree ("workspace_id","member_id");--> statement-breakpoint
--> statement-breakpoint

ALTER TABLE "calendar_calendars" ADD COLUMN "fell_back_from" text;--> statement-breakpoint
ALTER TABLE "calendar_calendars" ADD CONSTRAINT "calendar_calendars_fell_back" CHECK (char_length("calendar_calendars"."fell_back_from") between 1 and 255);--> statement-breakpoint


-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table calendar_calendars enable row level security;
--> statement-breakpoint
alter table calendar_calendars force row level security;
--> statement-breakpoint
create policy calendar_calendars_tenant on calendar_calendars
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- A page's destination, in its workspace; the calendar going sets only `destination_calendar_id` to null (the page's
-- bookings then go to the owner's own destination, AC-997).
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_destination" FOREIGN KEY ("workspace_id","destination_calendar_id") REFERENCES "public"."calendar_calendars"("workspace_id","id") ON DELETE SET NULL ("destination_calendar_id") ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "booking_pages_by_destination" ON "booking_pages" USING btree ("workspace_id","destination_calendar_id") WHERE "booking_pages"."destination_calendar_id" is not null;
--> statement-breakpoint
-- The backfill: each connection's main calendar, as the header says. Google's main calendar's id is the account's
-- address; Outlook had no connections before this release.
insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name, access_role,
  is_primary, check_conflicts, show_in_week, sync, is_destination, sync_state, channel, created_by_type, updated_by_type)
select c.workspace_id, c.id, c.member_id, c.account_email, c.account_email, 'owner', true, true, true, true,
  c.id = (
    select d.id from calendar_connections d
    where d.workspace_id = c.workspace_id and d.member_id = c.member_id
    order by d.is_default desc, d.created_at, d.id limit 1
  ),
  coalesce(c.sync_state -> 'primary', '{}'::jsonb), c.channel, 'system', 'system'
from calendar_connections c;
--> statement-breakpoint
update meeting_sources s set calendar_id = c.account_email
from calendar_connections c
where c.workspace_id = s.workspace_id and c.id = s.connection_id and s.calendar_id = 'primary';
--> statement-breakpoint
update calendar_busy_times b set calendar_id = c.account_email
from calendar_connections c
where c.workspace_id = b.workspace_id and c.id = b.connection_id;
--> statement-breakpoint
ALTER TABLE "calendar_busy_times" ALTER COLUMN "calendar_id" SET NOT NULL;
--> statement-breakpoint
-- The copy createEvent made of each booking's meeting: the host's (else the oldest) source, where moves and cancels
-- act (AC-998).
update meeting_sources s set created_by_crm = true
where (s.workspace_id, s.meeting_id, s.connection_id, s.calendar_id) in (
  select distinct on (m.workspace_id, m.id) x.workspace_id, x.meeting_id, x.connection_id, x.calendar_id
  from meetings m
  join meeting_sources x on x.workspace_id = m.workspace_id and x.meeting_id = m.id
  join calendar_connections c on c.workspace_id = x.workspace_id and c.id = x.connection_id
  left join bookings b on b.workspace_id = m.workspace_id and b.id = m.booking_id
  where m.created_by_crm
  order by m.workspace_id, m.id, (c.member_id = b.host_member_id) desc nulls last, c.created_at, c.id
);
--> statement-breakpoint
-- The new keys, with the calendar in them.
CREATE INDEX "calendar_busy_times_by_end" ON "calendar_busy_times" USING btree ("workspace_id","connection_id","calendar_id","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_sources_event" ON "meeting_sources" USING btree ("workspace_id","connection_id","calendar_id","provider_event_id");--> statement-breakpoint
ALTER TABLE "calendar_busy_times" DROP CONSTRAINT "calendar_busy_times_pkey";
--> statement-breakpoint
ALTER TABLE "calendar_busy_times" ADD CONSTRAINT "calendar_busy_times_pkey" PRIMARY KEY("workspace_id","connection_id","calendar_id","provider_event_id");--> statement-breakpoint
ALTER TABLE "meeting_sources" DROP CONSTRAINT "meeting_sources_pkey";
--> statement-breakpoint
ALTER TABLE "meeting_sources" ADD CONSTRAINT "meeting_sources_pkey" PRIMARY KEY("workspace_id","meeting_id","connection_id","calendar_id");
