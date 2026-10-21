-- Round robin (spec 0029 with spec 0037's "Amends 0029", job J11, made before this first migration): rotations
-- (Fair, Priority or Even, a window, where returning guests go), their members (weight, priority, daily and weekly
-- caps, on or off, calibration), the assignment ledger in units, the up to 3 rotations a round robin page books from
-- (`booking_page_rotations`, never a column on the page; its fixed hosts are `booking_page_members`), and
-- `booking_hosts`, one row per member a booking occupies. drizzle-kit's tables, keys and indexes; the rest hand
-- written at the end. `rotations.team_id` (rotations that follow a team) waits for spec 0031's teams table.
--
-- `booking_hosts` is kept by the trigger crm_booking_hosts_mirror on bookings: a new booking inserts its host's row,
-- a change of host, range or status is mirrored onto the booking's rows, and a confirmed booking that is cancelled
-- (by its guest, its host or calendar sync) voids its live ledger rows, so it stops counting toward fairness
-- (AC-747) whichever path cancelled it. A collective page's other required members are inserted by the booking
-- itself. `booking_hosts_no_overlap` refuses two confirmed rows of one member whose ranges overlap: a member is
-- never double booked across every page they are on (AC-745). `bookings_no_overlap` stays as it is.
--
-- The backfill copies every booking's host, and adds a collective page's other required members where that member
-- has no overlapping confirmed booking (a double booking made before this fix is left as it was rather than refused).
--
-- The foreign keys briefly lock the tables they touch. Give up after 5 seconds rather than queue behind traffic, like
-- 0041 and 0042.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "booking_hosts" (
	"workspace_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"during" "tstzrange" NOT NULL,
	"starts_at" timestamp (6) with time zone GENERATED ALWAYS AS (lower(during)) STORED,
	"ends_at" timestamp (6) with time zone GENERATED ALWAYS AS (upper(during)) STORED,
	"status" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_hosts_pkey" PRIMARY KEY("workspace_id","booking_id","member_id"),
	CONSTRAINT "booking_hosts_status" CHECK ("booking_hosts"."status" in ('confirmed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "booking_page_rotations" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"rotation_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "booking_page_rotations_pkey" PRIMARY KEY("workspace_id","page_id","rotation_id"),
	CONSTRAINT "booking_page_rotations_position_range" CHECK ("booking_page_rotations"."position" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "rotation_assignments" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"rotation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"source" text NOT NULL,
	"booking_id" uuid,
	"record_id" uuid,
	"reason" text NOT NULL,
	"units" smallint DEFAULT 1 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "rotation_assignments_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "rotation_assignments_source" CHECK ("rotation_assignments"."source" in ('booking', 'form', 'adjustment')),
	CONSTRAINT "rotation_assignments_subject" CHECK (("rotation_assignments"."source" = 'booking' and "rotation_assignments"."booking_id" is not null and "rotation_assignments"."reason" <> 'adjustment')
        or ("rotation_assignments"."source" = 'form' and "rotation_assignments"."record_id" is not null and "rotation_assignments"."reason" <> 'adjustment')
        or ("rotation_assignments"."source" = 'adjustment' and "rotation_assignments"."reason" = 'adjustment' and "rotation_assignments"."booking_id" is null and "rotation_assignments"."record_id" is null)),
	CONSTRAINT "rotation_assignments_reason" CHECK ("rotation_assignments"."reason" in ('fair', 'priority', 'even', 'owner', 'last_host', 'standin', 'only_free', 'routed', 'manual', 'reassigned', 'adjustment')),
	CONSTRAINT "rotation_assignments_units" CHECK (("rotation_assignments"."reason" = 'adjustment' and "rotation_assignments"."units" between -20 and 20 and "rotation_assignments"."units" <> 0) or "rotation_assignments"."units" = 1),
	CONSTRAINT "rotation_assignments_voided" CHECK ("rotation_assignments"."voided_at" is null or "rotation_assignments"."voided_at" >= "rotation_assignments"."assigned_at"),
	CONSTRAINT "rotation_assignments_created_by_actor" CHECK (("rotation_assignments"."created_by_type" is null and "rotation_assignments"."created_by_id" is null and "rotation_assignments"."created_by_member_id" is null)
      or ("rotation_assignments"."created_by_type" = 'system' and "rotation_assignments"."created_by_id" is null and "rotation_assignments"."created_by_member_id" is null)
      or ("rotation_assignments"."created_by_type" = 'member' and "rotation_assignments"."created_by_id" is not null and "rotation_assignments"."created_by_member_id" = "rotation_assignments"."created_by_id")
      or ("rotation_assignments"."created_by_type"::text not in ('member', 'system', 'calendar') and "rotation_assignments"."created_by_id" is not null and "rotation_assignments"."created_by_member_id" is null)),
	CONSTRAINT "rotation_assignments_updated_by_actor" CHECK (("rotation_assignments"."updated_by_type" is null and "rotation_assignments"."updated_by_id" is null and "rotation_assignments"."updated_by_member_id" is null)
      or ("rotation_assignments"."updated_by_type" = 'system' and "rotation_assignments"."updated_by_id" is null and "rotation_assignments"."updated_by_member_id" is null)
      or ("rotation_assignments"."updated_by_type" = 'member' and "rotation_assignments"."updated_by_id" is not null and "rotation_assignments"."updated_by_member_id" = "rotation_assignments"."updated_by_id")
      or ("rotation_assignments"."updated_by_type"::text not in ('member', 'system', 'calendar') and "rotation_assignments"."updated_by_id" is not null and "rotation_assignments"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "rotation_members" (
	"workspace_id" uuid NOT NULL,
	"rotation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"weight" smallint DEFAULT 100 NOT NULL,
	"priority" smallint DEFAULT 2 NOT NULL,
	"daily_cap" smallint,
	"weekly_cap" smallint,
	"is_on" boolean DEFAULT true NOT NULL,
	"calibration" numeric(10, 2) DEFAULT 0 NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "rotation_members_pkey" PRIMARY KEY("workspace_id","rotation_id","member_id"),
	CONSTRAINT "rotation_members_weight" CHECK ("rotation_members"."weight" between 1 and 100),
	CONSTRAINT "rotation_members_priority" CHECK ("rotation_members"."priority" between 0 and 4),
	CONSTRAINT "rotation_members_daily_cap" CHECK ("rotation_members"."daily_cap" is null or "rotation_members"."daily_cap" between 1 and 50),
	CONSTRAINT "rotation_members_weekly_cap" CHECK ("rotation_members"."weekly_cap" is null or "rotation_members"."weekly_cap" between 1 and 200),
	CONSTRAINT "rotation_members_calibration" CHECK ("rotation_members"."calibration" >= 0),
	CONSTRAINT "rotation_members_position" CHECK ("rotation_members"."position" between 0 and 19),
	CONSTRAINT "rotation_members_created_by_actor" CHECK (("rotation_members"."created_by_type" is null and "rotation_members"."created_by_id" is null and "rotation_members"."created_by_member_id" is null)
      or ("rotation_members"."created_by_type" = 'system' and "rotation_members"."created_by_id" is null and "rotation_members"."created_by_member_id" is null)
      or ("rotation_members"."created_by_type" = 'member' and "rotation_members"."created_by_id" is not null and "rotation_members"."created_by_member_id" = "rotation_members"."created_by_id")
      or ("rotation_members"."created_by_type"::text not in ('member', 'system', 'calendar') and "rotation_members"."created_by_id" is not null and "rotation_members"."created_by_member_id" is null)),
	CONSTRAINT "rotation_members_updated_by_actor" CHECK (("rotation_members"."updated_by_type" is null and "rotation_members"."updated_by_id" is null and "rotation_members"."updated_by_member_id" is null)
      or ("rotation_members"."updated_by_type" = 'system' and "rotation_members"."updated_by_id" is null and "rotation_members"."updated_by_member_id" is null)
      or ("rotation_members"."updated_by_type" = 'member' and "rotation_members"."updated_by_id" is not null and "rotation_members"."updated_by_member_id" = "rotation_members"."updated_by_id")
      or ("rotation_members"."updated_by_type"::text not in ('member', 'system', 'calendar') and "rotation_members"."updated_by_id" is not null and "rotation_members"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "rotations" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"strategy" text DEFAULT 'fair' NOT NULL,
	"even_gap" smallint DEFAULT 3 NOT NULL,
	"window_days" smallint DEFAULT 30 NOT NULL,
	"returning" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	"deleted_at" timestamp (6) with time zone,
	CONSTRAINT "rotations_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "rotations_name" CHECK (char_length("rotations"."name") between 1 and 80),
	CONSTRAINT "rotations_strategy" CHECK ("rotations"."strategy" in ('fair', 'priority', 'even')),
	CONSTRAINT "rotations_even_gap" CHECK ("rotations"."even_gap" between 1 and 10),
	CONSTRAINT "rotations_returning" CHECK ("rotations"."returning" in ('owner', 'last_host', 'none')),
	CONSTRAINT "rotations_window" CHECK ("rotations"."window_days" in (7, 30, 90)),
	CONSTRAINT "rotations_created_by_actor" CHECK (("rotations"."created_by_type" is null and "rotations"."created_by_id" is null and "rotations"."created_by_member_id" is null)
      or ("rotations"."created_by_type" = 'system' and "rotations"."created_by_id" is null and "rotations"."created_by_member_id" is null)
      or ("rotations"."created_by_type" = 'member' and "rotations"."created_by_id" is not null and "rotations"."created_by_member_id" = "rotations"."created_by_id")
      or ("rotations"."created_by_type"::text not in ('member', 'system', 'calendar') and "rotations"."created_by_id" is not null and "rotations"."created_by_member_id" is null)),
	CONSTRAINT "rotations_updated_by_actor" CHECK (("rotations"."updated_by_type" is null and "rotations"."updated_by_id" is null and "rotations"."updated_by_member_id" is null)
      or ("rotations"."updated_by_type" = 'system' and "rotations"."updated_by_id" is null and "rotations"."updated_by_member_id" is null)
      or ("rotations"."updated_by_type" = 'member' and "rotations"."updated_by_id" is not null and "rotations"."updated_by_member_id" = "rotations"."updated_by_id")
      or ("rotations"."updated_by_type"::text not in ('member', 'system', 'calendar') and "rotations"."updated_by_id" is not null and "rotations"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "reschedule_host" text DEFAULT 'same' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "needs_host_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_booking" FOREIGN KEY ("workspace_id","booking_id") REFERENCES "public"."bookings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_page_rotations" ADD CONSTRAINT "booking_page_rotations_page" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_page_rotations" ADD CONSTRAINT "booking_page_rotations_rotation" FOREIGN KEY ("workspace_id","rotation_id") REFERENCES "public"."rotations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_assignments" ADD CONSTRAINT "rotation_assignments_rotation" FOREIGN KEY ("workspace_id","rotation_id") REFERENCES "public"."rotations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_assignments" ADD CONSTRAINT "rotation_assignments_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_assignments" ADD CONSTRAINT "rotation_assignments_booking" FOREIGN KEY ("workspace_id","booking_id") REFERENCES "public"."bookings"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_assignments" ADD CONSTRAINT "rotation_assignments_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_assignments" ADD CONSTRAINT "rotation_assignments_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_members" ADD CONSTRAINT "rotation_members_rotation" FOREIGN KEY ("workspace_id","rotation_id") REFERENCES "public"."rotations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_members" ADD CONSTRAINT "rotation_members_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_members" ADD CONSTRAINT "rotation_members_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_members" ADD CONSTRAINT "rotation_members_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotations" ADD CONSTRAINT "rotations_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotations" ADD CONSTRAINT "rotations_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_hosts_by_member" ON "booking_hosts" USING btree ("workspace_id","member_id","starts_at") WHERE "booking_hosts"."status" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "booking_page_rotations_position" ON "booking_page_rotations" USING btree ("workspace_id","page_id","position");--> statement-breakpoint
CREATE INDEX "booking_page_rotations_by_rotation" ON "booking_page_rotations" USING btree ("workspace_id","rotation_id");--> statement-breakpoint
CREATE INDEX "rotation_assignments_window" ON "rotation_assignments" USING btree ("workspace_id","rotation_id","assigned_at") WHERE "rotation_assignments"."voided_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rotation_assignments_booking_live" ON "rotation_assignments" USING btree ("workspace_id","booking_id","rotation_id") WHERE "rotation_assignments"."voided_at" is null and "rotation_assignments"."booking_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "rotation_assignments_record_live" ON "rotation_assignments" USING btree ("workspace_id","record_id","rotation_id") WHERE "rotation_assignments"."voided_at" is null and "rotation_assignments"."record_id" is not null;--> statement-breakpoint
CREATE INDEX "rotation_assignments_by_booking" ON "rotation_assignments" USING btree ("workspace_id","booking_id") WHERE "rotation_assignments"."booking_id" is not null;--> statement-breakpoint
CREATE INDEX "rotation_assignments_by_member" ON "rotation_assignments" USING btree ("workspace_id","member_id","assigned_at");--> statement-breakpoint
CREATE INDEX "rotation_members_by_member" ON "rotation_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE INDEX "rotations_live" ON "rotations" USING btree ("workspace_id","created_at") WHERE "rotations"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_reschedule_host" CHECK ("booking_pages"."reschedule_host" in ('same', 'rotation'));--> statement-breakpoint
-- Hand written from here.
-- The standard policy on each new table: an unset workspace matches nothing, even for the owner.
alter table rotations enable row level security;
--> statement-breakpoint
alter table rotations force row level security;
--> statement-breakpoint
create policy rotations_tenant on rotations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table rotation_members enable row level security;
--> statement-breakpoint
alter table rotation_members force row level security;
--> statement-breakpoint
create policy rotation_members_tenant on rotation_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table rotation_assignments enable row level security;
--> statement-breakpoint
alter table rotation_assignments force row level security;
--> statement-breakpoint
create policy rotation_assignments_tenant on rotation_assignments
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table booking_page_rotations enable row level security;
--> statement-breakpoint
alter table booking_page_rotations force row level security;
--> statement-breakpoint
create policy booking_page_rotations_tenant on booking_page_rotations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table booking_hosts enable row level security;
--> statement-breakpoint
alter table booking_hosts force row level security;
--> statement-breakpoint
create policy booking_hosts_tenant on booking_hosts
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- No member double booked on any page they are on (AC-745). btree_gist came with 0041.
alter table booking_hosts
  add constraint booking_hosts_no_overlap
  exclude using gist (workspace_id with =, member_id with =, during with &&)
  where (status = 'confirmed');
--> statement-breakpoint

-- Keeps booking_hosts in step with bookings, and voids a cancelled booking's ledger rows (see the header). It runs as
-- the role that wrote the booking, under row level security, so it reaches only that booking's workspace.
create function crm_booking_hosts_mirror()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_hosts (workspace_id, booking_id, member_id, during, status)
    values (new.workspace_id, new.id, new.host_member_id, new.during, new.status);
    return null;
  end if;
  if new.host_member_id is distinct from old.host_member_id then
    -- A co-host made organiser already has a row: drop it first, so the rename can't collide (the reseat that changed
    -- the organiser then writes every host's row again).
    delete from public.booking_hosts
    where workspace_id = new.workspace_id and booking_id = new.id and member_id = new.host_member_id;
    update public.booking_hosts set member_id = new.host_member_id, updated_at = pg_catalog.now()
    where workspace_id = new.workspace_id and booking_id = new.id and member_id = old.host_member_id;
  end if;
  if new.during is distinct from old.during or new.status is distinct from old.status then
    update public.booking_hosts set during = new.during, status = new.status, updated_at = pg_catalog.now()
    where workspace_id = new.workspace_id and booking_id = new.id;
  end if;
  if new.status = 'cancelled' and old.status = 'confirmed' then
    update public.rotation_assignments
    set voided_at = pg_catalog.now(), updated_at = pg_catalog.now(), updated_by_type = new.updated_by_type,
      updated_by_id = new.updated_by_id, updated_by_member_id = new.updated_by_member_id
    where workspace_id = new.workspace_id and booking_id = new.id and voided_at is null;
  end if;
  return null;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_booking_hosts_mirror() from public;
--> statement-breakpoint
create trigger bookings_hosts_mirror
  after insert or update of host_member_id, during, status on bookings
  for each row execute function crm_booking_hosts_mirror();
--> statement-breakpoint

-- Every booking's host, then a collective page's other required members where they are free (see the header).
insert into booking_hosts (workspace_id, booking_id, member_id, during, status)
select b.workspace_id, b.id, b.host_member_id, b.during, b.status from bookings b;
--> statement-breakpoint
insert into booking_hosts (workspace_id, booking_id, member_id, during, status)
select b.workspace_id, b.id, m.member_id, b.during, b.status
from bookings b
join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id and p.kind = 'collective'
join booking_page_members m on m.workspace_id = b.workspace_id and m.page_id = b.page_id
where m.member_id <> b.host_member_id
on conflict do nothing;
--> statement-breakpoint

-- The Distribution tab's adjustments, live and undone, newest first: only adjustment rows, so it stays small however
-- long the ledger grows (the window index covers live rows only).
create index rotation_assignments_adjustments on rotation_assignments (workspace_id, rotation_id, assigned_at desc)
  where source = 'adjustment';
--> statement-breakpoint

-- A round robin booking that gets new hosts (a move through its rotation, a reassign, a member who left) tells its
-- guest and both hosts: `reassigned` joins the kinds crm_enqueue_booking_mail queues, run now like `moved`; and
-- `needs_host`, a booking whose host left the workspace, which the worker reseats through its rotations or, when
-- nobody is free, tells the admins about; and `host_changed`, a booking whose organiser changed, whose old event the
-- worker cancels and whose new organiser's calendar it writes, so a slow calendar never holds the change itself. The
-- function is crm_queue's (0048): the migration's role holds crm_queue's rights just long enough to replace it (it
-- stays crm_queue's, with its grants), then gives them back.
grant crm_queue to current_user with inherit true, set false;
--> statement-breakpoint
create or replace function crm_enqueue_booking_mail(booking_id uuid, kind text)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with booking as (
    select b.workspace_id, b.id,
      case crm_enqueue_booking_mail.kind
        when 'reminder_24h' then b.starts_at - interval '24 hours'
        when 'reminder_1h' then b.starts_at - interval '1 hour'
        else pg_catalog.now()
      end as run_at
    from public.bookings b
    where b.id = crm_enqueue_booking_mail.booking_id
      and b.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and crm_enqueue_booking_mail.kind in ('confirmed', 'cancelled', 'moved', 'guests', 'reassigned', 'needs_host', 'host_changed', 'reminder_24h', 'reminder_1h')
      and (b.status = 'confirmed' or crm_enqueue_booking_mail.kind = 'cancelled')
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_booking_mail',
      payload => pg_catalog.json_build_object(
        'workspaceId', booking.workspace_id, 'bookingId', booking.id, 'kind', crm_enqueue_booking_mail.kind
      ),
      run_at => booking.run_at,
      max_attempts => 5,
      job_key => case when crm_enqueue_booking_mail.kind like 'reminder_%'
        then 'crm-booking:' || booking.workspace_id::text || ':' || booking.id::text || ':' || crm_enqueue_booking_mail.kind
      end,
      job_key_mode => 'replace'
    ) as queued
    from booking
    where crm_enqueue_booking_mail.kind not like 'reminder_%' or booking.run_at > pg_catalog.now()
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke crm_queue from current_user;
