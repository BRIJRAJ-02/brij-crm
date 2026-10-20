-- Availability schedules (spec 0035, milestone 1, the expand half): a member's named sets of hours, and the schedule
-- each booking page books by. drizzle-kit's enum value, table, column, keys and indexes; the header, the lock timeout,
-- the page's foreign key, row level security and the data move at the end are hand written.
--
-- `outbox_kind` gains `schedules`. Enum values are only ever added, and nothing in this migration uses it.
--
-- The data move (AC-973), run as the owner (BYPASSRLS) across every workspace, so every page offers exactly the same
-- slots after it as before (AC-974):
-- - each `booking_member_hours` row becomes its member's default schedule, "Working hours", with the same hours;
-- - each page not deleted with `hours_mode = 'own'` gets a schedule of its owner, "<title> hours" (a clash with another
--   of the owner's schedule names, or with "Working hours", gets " 2", " 3" …), with the page's hours, and names it;
-- - pages with `hours_mode = 'mine'` name none, so they follow the owner's default: their "Working hours", or, for an
--   owner who never saved hours, the virtual default in the page's zone, exactly as before.
-- `hours_mode`, `booking_pages.availability` and `booking_member_hours` stay readable for one release; the contract
-- migration drops them (AC-975).
--
-- The new column takes booking_pages' strongest lock until the migration commits, so public slot reads wait out the
-- data move too (a few statements), and the foreign keys lock members against writes. Give up after 5 seconds rather
-- than queue behind traffic, like 0020, 0023, 0026, 0029, 0033, 0037 and 0039.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'schedules';--> statement-breakpoint
CREATE TABLE "availability_schedules" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"availability" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "availability_schedules_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "availability_schedules_name_length" CHECK (char_length("availability_schedules"."name") between 1 and 60),
	CONSTRAINT "availability_schedules_created_by_actor" CHECK (("availability_schedules"."created_by_type" is null and "availability_schedules"."created_by_id" is null and "availability_schedules"."created_by_member_id" is null)
      or ("availability_schedules"."created_by_type" = 'system' and "availability_schedules"."created_by_id" is null and "availability_schedules"."created_by_member_id" is null)
      or ("availability_schedules"."created_by_type" = 'member' and "availability_schedules"."created_by_id" is not null and "availability_schedules"."created_by_member_id" = "availability_schedules"."created_by_id")
      or ("availability_schedules"."created_by_type"::text not in ('member', 'system', 'calendar') and "availability_schedules"."created_by_id" is not null and "availability_schedules"."created_by_member_id" is null)),
	CONSTRAINT "availability_schedules_updated_by_actor" CHECK (("availability_schedules"."updated_by_type" is null and "availability_schedules"."updated_by_id" is null and "availability_schedules"."updated_by_member_id" is null)
      or ("availability_schedules"."updated_by_type" = 'system' and "availability_schedules"."updated_by_id" is null and "availability_schedules"."updated_by_member_id" is null)
      or ("availability_schedules"."updated_by_type" = 'member' and "availability_schedules"."updated_by_id" is not null and "availability_schedules"."updated_by_member_id" = "availability_schedules"."updated_by_id")
      or ("availability_schedules"."updated_by_type"::text not in ('member', 'system', 'calendar') and "availability_schedules"."updated_by_id" is not null and "availability_schedules"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_schedules_by_member" ON "availability_schedules" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_schedules_name" ON "availability_schedules" USING btree ("workspace_id","member_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "availability_schedules_default" ON "availability_schedules" USING btree ("workspace_id","member_id") WHERE "availability_schedules"."is_default";--> statement-breakpoint
CREATE INDEX "booking_pages_by_schedule" ON "booking_pages" USING btree ("workspace_id","schedule_id") WHERE "booking_pages"."schedule_id" is not null;
--> statement-breakpoint
-- Hand written from here.
-- A page's schedule, in its workspace; deleting the schedule sets only `schedule_id` to null (the page then follows
-- the default), never `workspace_id`. Core repoints the pages in the delete's own transaction first anyway.
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_schedule" FOREIGN KEY ("workspace_id","schedule_id") REFERENCES "public"."availability_schedules"("workspace_id","id") ON DELETE SET NULL ("schedule_id") ON UPDATE no action;
--> statement-breakpoint
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table availability_schedules enable row level security;
--> statement-breakpoint
alter table availability_schedules force row level security;
--> statement-breakpoint
create policy availability_schedules_tenant on availability_schedules
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Each member's own hours: their default "Working hours", as made and last changed.
insert into availability_schedules (
  workspace_id, member_id, name, is_default, availability,
  created_at, created_by_type, created_by_id, created_by_member_id,
  updated_at, updated_by_type, updated_by_id, updated_by_member_id
)
select
  h.workspace_id, h.member_id, 'Working hours', true, h.availability,
  h.created_at, h.created_by_type, h.created_by_id, h.created_by_member_id,
  h.updated_at, h.updated_by_type, h.updated_by_id, h.updated_by_member_id
from booking_member_hours h
-- Run again (the slot equality test does), a member who already has a default keeps it.
where not exists (
  select 1 from availability_schedules s
  where s.workspace_id = h.workspace_id and s.member_id = h.member_id and s.is_default
);
--> statement-breakpoint
-- Each page keeping its own hours: a schedule of its owner named after it, oldest page first, and the page names it.
do $$
declare
  page record;
  suffix text;
  wanted text;
  n integer;
  made uuid;
begin
  for page in
    select p.workspace_id, p.id, p.owner_member_id, p.title, p.availability
    from booking_pages p
    where p.deleted_at is null and p.hours_mode = 'own' and p.schedule_id is null
    order by p.workspace_id, p.owner_member_id, p.created_at, p.id
  loop
    -- At most 60 characters: the title cut to leave room for " hours" and whatever suffix the clash needs.
    n := 1;
    loop
      suffix := case when n = 1 then '' else ' ' || n::text end;
      wanted := rtrim(left(btrim(page.title), 54 - length(suffix))) || ' hours' || suffix;
      exit when lower(wanted) <> 'working hours' and not exists (
        select 1 from availability_schedules s
        where s.workspace_id = page.workspace_id and s.member_id = page.owner_member_id and lower(s.name) = lower(wanted)
      );
      n := n + 1;
    end loop;
    insert into availability_schedules (workspace_id, member_id, name, is_default, availability, created_by_type, updated_by_type)
    values (page.workspace_id, page.owner_member_id, wanted, false, page.availability, 'system', 'system')
    returning id into made;
    update booking_pages set schedule_id = made where workspace_id = page.workspace_id and id = page.id;
  end loop;
end
$$;
