-- The operator console, slice 1 (spec 0047): the super admin's read only analytics.
--
-- Three global tables in schema auth, which the identity login alone reads and writes (the default privileges, 0016):
-- activity_day (the days each person used the app), site_visit (the marketing site's own beacon) and operator_event
-- (one row per console read, written before the read). One tenant table, booking_page_views (one row per page, UTC
-- day and daily visitor id), with forced row level security and the standard policy. And bookings_created, so the
-- bookings made in a range are an index range per workspace.
--
-- The console reads across workspaces only through six security definer functions owned by crm_operator, a role
-- that can't log in, bypasses row level security only inside them, and holds select on the few columns it counts,
-- never a value, a note body, a task's text, a form answer or a booking's visitor: Postgres refuses any other column
-- whatever a function body says. They answer counts, ids, workspace names and addresses, member roles and states,
-- and booking page titles, kinds and states. crm_app may execute them (as it does the public lookups); the api calls
-- them only from its operator module, behind OPERATOR_EMAILS, two factor and a recent sign in.
--
-- Every function takes UTC days (from inclusive, to exclusive, at most 400 apart) and reads each workspace's rows
-- through indexes that lead with its id (a lateral read per workspace), so no read scans a table across tenants.
-- The records counts lean on Postgres 18's skip scan over records_created's object_id (Neon runs 18). The users
-- list reads auth.user newest first by user_created. Any change to the role or its functions goes through
-- security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "booking_page_views" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_page_views_pkey" PRIMARY KEY("workspace_id","page_id","day","visitor"),
	CONSTRAINT "booking_page_views_visitor" CHECK ("booking_page_views"."visitor" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "booking_page_views_count" CHECK ("booking_page_views"."views" >= 1)
);
--> statement-breakpoint
CREATE TABLE "auth"."activity_day" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"first_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_day_pkey" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "auth"."operator_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" uuid,
	"period" text,
	"q" text,
	"request_id" text NOT NULL,
	CONSTRAINT "operator_event_action" CHECK ("auth"."operator_event"."action" ~ '^operator\.[a-zA-Z]{1,40}$'),
	CONSTRAINT "operator_event_period" CHECK ("auth"."operator_event"."period" in ('7d', '30d', '90d')),
	CONSTRAINT "operator_event_request" CHECK (char_length("auth"."operator_event"."request_id") between 1 and 100),
	CONSTRAINT "operator_event_q" CHECK (char_length("auth"."operator_event"."q") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "auth"."site_visit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"site" text NOT NULL,
	"path" text NOT NULL,
	"referrer" text,
	"source" text,
	"country" text,
	"device" text NOT NULL,
	"visitor" text NOT NULL,
	CONSTRAINT "site_visit_path" CHECK (char_length("auth"."site_visit"."path") between 1 and 200 and left("auth"."site_visit"."path", 1) = '/'),
	CONSTRAINT "site_visit_site" CHECK (char_length("auth"."site_visit"."site") between 1 and 120),
	CONSTRAINT "site_visit_referrer" CHECK (char_length("auth"."site_visit"."referrer") between 1 and 120),
	CONSTRAINT "site_visit_source" CHECK (char_length("auth"."site_visit"."source") between 1 and 60),
	CONSTRAINT "site_visit_country" CHECK ("auth"."site_visit"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "site_visit_device" CHECK ("auth"."site_visit"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "site_visit_visitor" CHECK ("auth"."site_visit"."visitor" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
ALTER TABLE "booking_page_views" ADD CONSTRAINT "booking_page_views_page" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."activity_day" ADD CONSTRAINT "activity_day_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_page_views_day" ON "booking_page_views" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE INDEX "activity_day_day" ON "auth"."activity_day" USING btree ("day","user_id");--> statement-breakpoint
CREATE INDEX "operator_event_at" ON "auth"."operator_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "site_visit_at" ON "auth"."site_visit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "bookings_created" ON "bookings" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_host_created" ON "bookings" USING btree ("workspace_id","host_member_id","created_at");--> statement-breakpoint
CREATE INDEX "records_created_by" ON "records" USING btree ("workspace_id","created_by_member_id","created_at") WHERE "records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "user_created" ON "auth"."user" USING btree ("created_at","id");
--> statement-breakpoint
alter table booking_page_views enable row level security;
--> statement-breakpoint
alter table booking_page_views force row level security;
--> statement-breakpoint
create policy booking_page_views_tenant on booking_page_views
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_operator') then
    create role crm_operator nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
-- Roles are shared by the whole cluster: one made earlier gets exactly these attributes (the ones only a superuser
-- may change are checked at the end).
alter role crm_operator nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_operator;
--> statement-breakpoint
grant select (id, name, slug, created_at, deleted_at) on workspaces to crm_operator;
--> statement-breakpoint
grant select (workspace_id, id, user_id, role, status) on members to crm_operator;
--> statement-breakpoint
grant select (workspace_id, object_id, created_at, created_by_member_id, deleted_at) on records to crm_operator;
--> statement-breakpoint
grant select (workspace_id, id) on forms to crm_operator;
--> statement-breakpoint
grant select (workspace_id, form_id, received_at) on form_submissions to crm_operator;
--> statement-breakpoint
grant select (workspace_id, id, title, kind, status, owner_member_id, owner_user_id, created_at, deleted_at)
  on booking_pages to crm_operator;
--> statement-breakpoint
grant select (workspace_id, page_id, host_member_id, created_at, cancelled_at) on bookings to crm_operator;
--> statement-breakpoint
grant select (workspace_id, page_id, day, views) on booking_page_views to crm_operator;
--> statement-breakpoint

-- Per workspace (at most 200 ids): its name, address, when it was made and deleted, its active members, and its live
-- records, counted to 100,001 at most (the console shows "100,000+"), so a large workspace costs a bounded read.
create function crm_operator_workspaces(ids uuid[])
  returns table (
    workspace_id uuid, name text, slug text, created_at timestamptz, deleted_at timestamptz,
    members integer, records integer
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 200
begin atomic
  select w.id, w.name, w.slug, w.created_at, w.deleted_at,
    (select count(*)::integer from public.members m where m.workspace_id = w.id and m.status = 'active'),
    (select count(*)::integer from (
      select 1 from public.records r where r.workspace_id = w.id and r.deleted_at is null limit 100001
    ) c)
  from public.workspaces w
  where w.id = any(crm_operator_workspaces.ids[1:200]);
end;
--> statement-breakpoint

-- Per member row of these people, named by (workspace, person) pairs from the directory (at most 400; the
-- members_user index finds each): the workspace, the role and state, the live records they made and the bookings
-- they were given that were made in [from, to), each an index only count (records_created_by,
-- bookings_host_created) stopped at 100,001, and the live booking pages they own.
create function crm_operator_members(workspaces uuid[], users uuid[], from_day date, to_day date)
  returns table (
    user_id uuid, workspace_id uuid, member_id uuid, role text, status text,
    records_made integer, bookings_hosted integer, pages_owned integer
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 200
begin atomic
  select mm.user_id, mm.workspace_id, mm.id, mm.role::text, mm.status::text,
    (select count(*)::integer from (
      select 1 from public.records r
      where r.workspace_id = mm.workspace_id and r.created_by_member_id = mm.id and r.deleted_at is null
        and r.created_at >= crm_operator_members.from_day::timestamp at time zone 'UTC'
        and r.created_at < crm_operator_members.to_day::timestamp at time zone 'UTC'
      limit 100001
    ) made),
    (select count(*)::integer from (
      select 1 from public.bookings k
      where k.workspace_id = mm.workspace_id and k.host_member_id = mm.id
        and k.created_at >= crm_operator_members.from_day::timestamp at time zone 'UTC'
        and k.created_at < crm_operator_members.to_day::timestamp at time zone 'UTC'
      limit 100001
    ) hosted),
    (select count(*)::integer from public.booking_pages p
      where p.workspace_id = mm.workspace_id and p.owner_member_id = mm.id and p.deleted_at is null)
  from unnest(crm_operator_members.workspaces[1:400], crm_operator_members.users[1:400]) as pair(workspace_id, user_id)
  join public.members mm on mm.workspace_id = pair.workspace_id and mm.user_id = pair.user_id
  where crm_operator_members.to_day - crm_operator_members.from_day between 1 and 400;
end;
--> statement-breakpoint

-- The workspaces live now, and those made in [from, to). One row.
create function crm_operator_totals(from_day date, to_day date)
  returns table (workspaces integer, workspaces_made integer)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select
    (count(*) filter (where w.deleted_at is null))::integer,
    (count(*) filter (where w.created_at >= crm_operator_totals.from_day::timestamp at time zone 'UTC'
      and w.created_at < crm_operator_totals.to_day::timestamp at time zone 'UTC'))::integer
  from public.workspaces w
  where crm_operator_totals.to_day - crm_operator_totals.from_day between 1 and 400;
end;
--> statement-breakpoint

-- Per UTC day in [from, to), every day present: workspaces made, live records made (an index only count on
-- records_created), bookings made and form submissions received.
create function crm_operator_daily(from_day date, to_day date)
  returns table (day date, workspaces_made integer, records_made integer, bookings_made integer, submissions integer)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 90
begin atomic
  select d.day,
    coalesce(sum(e.workspaces), 0)::integer,
    coalesce(sum(e.records), 0)::integer,
    coalesce(sum(e.bookings), 0)::integer,
    coalesce(sum(e.submissions), 0)::integer
  from (
    select g::date as day
    from generate_series(
      crm_operator_daily.from_day::timestamp, crm_operator_daily.to_day::timestamp - interval '1 day', interval '1 day'
    ) g
    where crm_operator_daily.to_day - crm_operator_daily.from_day between 1 and 400
  ) d
  left join (
    select (w.created_at at time zone 'UTC')::date as day, 1 as workspaces, 0 as records, 0 as bookings,
      0 as submissions
    from public.workspaces w
    where w.created_at >= crm_operator_daily.from_day::timestamp at time zone 'UTC'
      and w.created_at < crm_operator_daily.to_day::timestamp at time zone 'UTC'
    union all
    select x.day, 0, x.records, x.bookings, x.submissions
    from public.workspaces w
    cross join lateral (
      select (r.created_at at time zone 'UTC')::date as day, count(*)::integer as records, 0 as bookings,
        0 as submissions
      from public.records r
      where r.workspace_id = w.id and r.deleted_at is null
        and r.created_at >= crm_operator_daily.from_day::timestamp at time zone 'UTC'
        and r.created_at < crm_operator_daily.to_day::timestamp at time zone 'UTC'
      group by 1
      union all
      select (b.created_at at time zone 'UTC')::date, 0, count(*)::integer, 0
      from public.bookings b
      where b.workspace_id = w.id
        and b.created_at >= crm_operator_daily.from_day::timestamp at time zone 'UTC'
        and b.created_at < crm_operator_daily.to_day::timestamp at time zone 'UTC'
      group by 1
      union all
      select (s.received_at at time zone 'UTC')::date, 0, 0, count(*)::integer
      from public.forms f
      join public.form_submissions s on s.workspace_id = f.workspace_id and s.form_id = f.id
      where f.workspace_id = w.id
        and s.received_at >= crm_operator_daily.from_day::timestamp at time zone 'UTC'
        and s.received_at < crm_operator_daily.to_day::timestamp at time zone 'UTC'
      group by 1
    ) x
  ) e on e.day = d.day
  group by d.day
  order by d.day;
end;
--> statement-breakpoint

-- Booking pages not deleted (one page when `workspace` and `page` are both set, found by its key; at most 500,
-- most viewed first): the workspace and its name, title, kind, state, owner's identity and when it was made, with
-- its views, visitors (daily ids, summed over days), and the bookings made in [from, to) and those since
-- cancelled. Each workspace's bookings are read once over bookings_created and grouped by page.
create function crm_operator_pages(from_day date, to_day date, workspace uuid, page uuid)
  returns table (
    workspace_id uuid, workspace_name text, page_id uuid, title text, kind text, status text, owner_user_id uuid,
    created_at timestamptz, views integer, visitors integer, bookings integer, cancelled integer
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 100
begin atomic
  with ws as (
    select w.id, w.name from public.workspaces w
    where (crm_operator_pages.workspace is null or w.id = crm_operator_pages.workspace)
      and (crm_operator_pages.workspace is null) = (crm_operator_pages.page is null)
      and crm_operator_pages.to_day - crm_operator_pages.from_day between 1 and 400
  ),
  made as (
    select x.workspace_id, x.page_id, count(*)::integer as bookings,
      (count(*) filter (where x.cancelled_at is not null))::integer as cancelled
    from ws
    cross join lateral (
      select k.workspace_id, k.page_id, k.cancelled_at from public.bookings k
      where k.workspace_id = ws.id
        and (crm_operator_pages.page is null or k.page_id = crm_operator_pages.page)
        and k.created_at >= crm_operator_pages.from_day::timestamp at time zone 'UTC'
        and k.created_at < crm_operator_pages.to_day::timestamp at time zone 'UTC'
    ) x
    group by x.workspace_id, x.page_id
  )
  select p.workspace_id, ws.name, p.id, p.title, p.kind, p.status, p.owner_user_id, p.created_at,
    coalesce(v.views, 0), coalesce(v.visitors, 0), coalesce(made.bookings, 0), coalesce(made.cancelled, 0)
  from ws
  join public.booking_pages p on p.workspace_id = ws.id and p.deleted_at is null
    and (crm_operator_pages.page is null or p.id = crm_operator_pages.page)
  left join lateral (
    select sum(x.views)::integer as views, count(*)::integer as visitors
    from public.booking_page_views x
    where x.workspace_id = p.workspace_id and x.page_id = p.id
      and x.day >= crm_operator_pages.from_day and x.day < crm_operator_pages.to_day
  ) v on true
  left join made on made.workspace_id = p.workspace_id and made.page_id = p.id
  order by coalesce(v.views, 0) desc, coalesce(made.bookings, 0) desc, p.id
  limit 500;
end;
--> statement-breakpoint

-- Per UTC day in [from, to), every day present: views, visitors, bookings made and those since cancelled, for one
-- page (`workspace` and `page` both set) or every page (both null).
create function crm_operator_page_days(from_day date, to_day date, workspace uuid, page uuid)
  returns table (day date, views integer, visitors integer, bookings integer, cancelled integer)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 90
begin atomic
  select d.day,
    coalesce(sum(e.views), 0)::integer,
    coalesce(sum(e.visitors), 0)::integer,
    coalesce(sum(e.bookings), 0)::integer,
    coalesce(sum(e.cancelled), 0)::integer
  from (
    select g::date as day
    from generate_series(
      crm_operator_page_days.from_day::timestamp, crm_operator_page_days.to_day::timestamp - interval '1 day',
      interval '1 day'
    ) g
    where crm_operator_page_days.to_day - crm_operator_page_days.from_day between 1 and 400
      and (crm_operator_page_days.workspace is null) = (crm_operator_page_days.page is null)
  ) d
  left join (
    select x.day, x.views, x.visitors, x.bookings, x.cancelled
    from public.workspaces w
    cross join lateral (
      select v.day, sum(v.views)::integer as views, count(*)::integer as visitors, 0 as bookings, 0 as cancelled
      from public.booking_page_views v
      where v.workspace_id = w.id
        and (crm_operator_page_days.page is null or v.page_id = crm_operator_page_days.page)
        and v.day >= crm_operator_page_days.from_day and v.day < crm_operator_page_days.to_day
      group by v.day
      union all
      select (k.created_at at time zone 'UTC')::date, 0, 0, count(*)::integer,
        (count(*) filter (where k.cancelled_at is not null))::integer
      from public.bookings k
      where k.workspace_id = w.id
        and (crm_operator_page_days.page is null or k.page_id = crm_operator_page_days.page)
        and k.created_at >= crm_operator_page_days.from_day::timestamp at time zone 'UTC'
        and k.created_at < crm_operator_page_days.to_day::timestamp at time zone 'UTC'
      group by 1
    ) x
    where crm_operator_page_days.workspace is null or w.id = crm_operator_page_days.workspace
  ) e on e.day = d.day
  group by d.day
  order by d.day;
end;
--> statement-breakpoint
revoke all on function crm_operator_workspaces(uuid[]) from public;
--> statement-breakpoint
revoke all on function crm_operator_members(uuid[], uuid[], date, date) from public;
--> statement-breakpoint
revoke all on function crm_operator_totals(date, date) from public;
--> statement-breakpoint
revoke all on function crm_operator_daily(date, date) from public;
--> statement-breakpoint
revoke all on function crm_operator_pages(date, date, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_operator_page_days(date, date, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_operator_workspaces(uuid[]) to crm_app;
--> statement-breakpoint
grant execute on function crm_operator_members(uuid[], uuid[], date, date) to crm_app;
--> statement-breakpoint
grant execute on function crm_operator_totals(date, date) to crm_app;
--> statement-breakpoint
grant execute on function crm_operator_daily(date, date) to crm_app;
--> statement-breakpoint
grant execute on function crm_operator_pages(date, date, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_operator_page_days(date, date, uuid, uuid) to crm_app;
--> statement-breakpoint

-- Hand the functions to crm_operator. Postgres 16 and later don't give the creator SET on a role it creates, and a
-- new owner needs CREATE on the schema, so both are granted for the change, then taken back.
grant crm_operator to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_operator;
--> statement-breakpoint
alter function crm_operator_workspaces(uuid[]) owner to crm_operator;
--> statement-breakpoint
alter function crm_operator_members(uuid[], uuid[], date, date) owner to crm_operator;
--> statement-breakpoint
alter function crm_operator_totals(date, date) owner to crm_operator;
--> statement-breakpoint
alter function crm_operator_daily(date, date) owner to crm_operator;
--> statement-breakpoint
alter function crm_operator_pages(date, date, uuid, uuid) owner to crm_operator;
--> statement-breakpoint
alter function crm_operator_page_days(date, date, uuid, uuid) owner to crm_operator;
--> statement-breakpoint
revoke create on schema public from crm_operator;
--> statement-breakpoint
revoke crm_operator from current_user;
--> statement-breakpoint

-- Refuse to finish unless crm_operator is as narrow as it reads: the six functions its own and executable, by a
-- grant of their own, only by crm_app (PUBLIC included); a plain role (no login, no power but bypassing row level
-- security) that nothing but the database owner can reach (Neon's platform roles skipped by name, as in 0034), in no
-- role itself, owning nothing else, and holding no table privilege but the column reads granted above.
do $$
declare
  owned integer;
begin
  select count(*) into owned from pg_proc p where pg_get_userbyid(p.proowner) = 'crm_operator';
  if owned <> 6 or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where pg_get_userbyid(p.proowner) = 'crm_operator' and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_operator'::regrole, 'crm_app'::regrole)
  ) or exists (
    select 1 from pg_proc p
    where pg_get_userbyid(p.proowner) = 'crm_operator'
      and (not p.prosecdef or p.prosqlbody is null or p.proconfig <> array['search_path=pg_catalog, pg_temp'])
  ) or exists (
    select 1 from pg_class c where pg_get_userbyid(c.relowner) = 'crm_operator'
  ) or exists (
    select 1 from information_schema.role_table_grants g where g.grantee = 'crm_operator'
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_operator'::regrole
      and m.member <> (select datdba from pg_database where datname = current_database())
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_operator'::regrole and (m.set_option or m.inherit_option)
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m where m.member = 'crm_operator'::regrole
  ) or pg_has_role('crm_app', 'crm_operator', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_operator', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_operator' and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin
        or not rolbypassrls)
    ) then
    raise exception 'crm_operator must be a narrow role owning exactly its six read only functions';
  end if;
end
$$;
