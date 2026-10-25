-- A link page's views and presses (spec 0051, slice 5, AC-5124 to AC-5128): auth.profile_views (owner, UTC day,
-- visitor) and auth.profile_item_presses (block, UTC day, visitor), each with a count, and beside them one row a day
-- (auth.profile_view_days: views and visitors; auth.profile_item_press_days: presses), written by the same statement,
-- so the editor's figures read at most 60 rows a period however many people looked. The visitor is spec 0047's
-- daily HMAC (32 hex digits): no address, no user agent, and no way to follow anyone from one day to the next. Both
-- tables are reached only through crm_handle's definers below; crm_app holds no grant on them (AC-5132), and the
-- identity login has them as it has every auth table (the schema's default grants). A press is
-- written only for a live block of the owner named (link, booking page or contact card), so a made up or archived id
-- writes nothing; both counters, and the editor's read, filter by the owner the caller passes, which the api takes
-- from a handle or the session, never from input. Rows older than a year go with the daily cleanup (AC-5128).
CREATE TABLE "auth"."profile_item_press_days" (
	"item_id" uuid NOT NULL,
	"day" date NOT NULL,
	"presses" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "profile_item_press_days_pkey" PRIMARY KEY("item_id","day"),
	CONSTRAINT "profile_item_press_days_count" CHECK ("auth"."profile_item_press_days"."presses" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth"."profile_item_presses" (
	"item_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"presses" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_item_presses_pkey" PRIMARY KEY("item_id","day","visitor"),
	CONSTRAINT "profile_item_presses_visitor" CHECK ("auth"."profile_item_presses"."visitor" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "profile_item_presses_count" CHECK ("auth"."profile_item_presses"."presses" >= 1)
);
--> statement-breakpoint
CREATE TABLE "auth"."profile_view_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "profile_view_days_pkey" PRIMARY KEY("user_id","day"),
	CONSTRAINT "profile_view_days_count" CHECK ("auth"."profile_view_days"."views" >= 0 and "auth"."profile_view_days"."visitors" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth"."profile_views" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_views_pkey" PRIMARY KEY("user_id","day","visitor"),
	CONSTRAINT "profile_views_visitor" CHECK ("auth"."profile_views"."visitor" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "profile_views_count" CHECK ("auth"."profile_views"."views" >= 1)
);
--> statement-breakpoint
ALTER TABLE "auth"."profile_item_press_days" ADD CONSTRAINT "profile_item_press_days_item_fk" FOREIGN KEY ("item_id") REFERENCES "auth"."profile_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."profile_item_presses" ADD CONSTRAINT "profile_item_presses_item_fk" FOREIGN KEY ("item_id") REFERENCES "auth"."profile_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."profile_view_days" ADD CONSTRAINT "profile_view_days_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."profile_views" ADD CONSTRAINT "profile_views_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_item_press_days_day" ON "auth"."profile_item_press_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "profile_item_presses_day" ON "auth"."profile_item_presses" USING btree ("day");--> statement-breakpoint
CREATE INDEX "profile_view_days_day" ON "auth"."profile_view_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "profile_views_day" ON "auth"."profile_views" USING btree ("day");
--> statement-breakpoint
grant select, insert, update, delete on auth.profile_views to crm_handle;
--> statement-breakpoint
grant select, insert, update, delete on auth.profile_item_presses to crm_handle;
--> statement-breakpoint
grant select, insert, update, delete on auth.profile_view_days to crm_handle;
--> statement-breakpoint
grant select, insert, update, delete on auth.profile_item_press_days to crm_handle;
--> statement-breakpoint
-- Counts one view of `owner`'s link page today (UTC) by `visitor`: the visitor's row makes or adds to itself, and the
-- day's row adds the view, and a visitor when it was their first that day. An owner with no account writes nothing.
create function crm_count_profile_view(owner uuid, visitor text)
  returns void
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  with visit as (
    insert into auth.profile_views (user_id, day, visitor)
    select u.id, (pg_catalog.now() at time zone 'UTC')::date, crm_count_profile_view.visitor
    from auth."user" u
    where u.id = crm_count_profile_view.owner
    on conflict (user_id, day, visitor)
      do update set views = profile_views.views + 1, last_at = pg_catalog.now()
    returning user_id, day, (xmax = 0) as is_new
  )
  insert into auth.profile_view_days (user_id, day, views, visitors)
  select visit.user_id, visit.day, 1, case when visit.is_new then 1 else 0 end from visit
  on conflict (user_id, day)
    do update set views = profile_view_days.views + 1, visitors = profile_view_days.visitors + excluded.visitors;
end;
--> statement-breakpoint
-- Counts one press of `item` today (UTC) by `visitor`, only when it is one of `owner`'s live blocks a visitor can
-- press (a link, a booking page or the contact card); anything else writes nothing, and says nothing. The day's row
-- adds the press too.
create function crm_count_item_press(owner uuid, item uuid, visitor text)
  returns void
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  with press as (
    insert into auth.profile_item_presses (item_id, day, visitor)
    select i.id, (pg_catalog.now() at time zone 'UTC')::date, crm_count_item_press.visitor
    from auth.profile_items i
    where i.id = crm_count_item_press.item and i.user_id = crm_count_item_press.owner
      and i.archived_at is null and i.kind in ('link', 'page', 'contact')
    on conflict (item_id, day, visitor)
      do update set presses = profile_item_presses.presses + 1, last_at = pg_catalog.now()
    returning item_id, day
  )
  insert into auth.profile_item_press_days (item_id, day, presses)
  select press.item_id, press.day, 1 from press
  on conflict (item_id, day) do update set presses = profile_item_press_days.presses + 1;
end;
--> statement-breakpoint
-- `owner`'s figures for the UTC days `from_day` to `to_day` (at most 400 days): one row per block pressed, with its
-- presses, and one row with no block, with the page's views and its visitors (a visitor is one a day), read from the
-- day rows. The editor's figures (AC-5127); archived blocks' presses are left out.
create function crm_profile_counts(owner uuid, from_day date, to_day date)
  returns table (item_id uuid, presses bigint, views bigint, visitors bigint)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.item_id, sum(p.presses)::bigint, null::bigint, null::bigint
  from auth.profile_item_press_days p
  join auth.profile_items i on i.id = p.item_id
  where i.user_id = crm_profile_counts.owner and i.archived_at is null
    and p.day between crm_profile_counts.from_day and crm_profile_counts.to_day
    and crm_profile_counts.to_day - crm_profile_counts.from_day between 0 and 400
  group by p.item_id
  union all
  select null::uuid, null::bigint, coalesce(sum(v.views), 0)::bigint, coalesce(sum(v.visitors), 0)::bigint
  from auth.profile_view_days v
  where v.user_id = crm_profile_counts.owner
    and v.day between crm_profile_counts.from_day and crm_profile_counts.to_day
    and crm_profile_counts.to_day - crm_profile_counts.from_day between 0 and 400;
end;
--> statement-breakpoint
-- The daily cleanup's sweep (AC-5128): views and presses older than a year, and their day rows, at most `max` rows of
-- each table, oldest days first. Answers the most any one table lost, so a caller goes on while that is a full batch.
-- Safe for any caller: it only ever removes rows past the year.
create function crm_sweep_profile_counts(max integer)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  cutoff date := (pg_catalog.now() at time zone 'UTC')::date - 365;
  batch integer := greatest(least(max, 10000), 0);
  gone integer;
  most integer := 0;
begin
  -- Each workspace's cleanup calls it, at about the same time: rows another one holds are left to it.
  delete from auth.profile_views v where (v.user_id, v.day, v.visitor) in (
    select o.user_id, o.day, o.visitor from auth.profile_views o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_presses p where (p.item_id, p.day, p.visitor) in (
    select o.item_id, o.day, o.visitor from auth.profile_item_presses o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_view_days v where (v.user_id, v.day) in (
    select o.user_id, o.day from auth.profile_view_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_press_days p where (p.item_id, p.day) in (
    select o.item_id, o.day from auth.profile_item_press_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  return greatest(most, gone);
end;
$$;
--> statement-breakpoint
revoke all on function crm_count_profile_view(uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_count_item_press(uuid, uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_profile_counts(uuid, date, date) from public;
--> statement-breakpoint
revoke all on function crm_sweep_profile_counts(integer) from public;
--> statement-breakpoint
grant execute on function crm_count_profile_view(uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_count_item_press(uuid, uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_counts(uuid, date, date) to crm_app;
--> statement-breakpoint
grant execute on function crm_sweep_profile_counts(integer) to crm_app;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
alter function crm_count_profile_view(uuid, text) owner to crm_handle;
--> statement-breakpoint
alter function crm_count_item_press(uuid, uuid, text) owner to crm_handle;
--> statement-breakpoint
alter function crm_profile_counts(uuid, date, date) owner to crm_handle;
--> statement-breakpoint
alter function crm_sweep_profile_counts(integer) owner to crm_handle;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants g
    where g.grantee in ('crm_app', 'crm_worker') and g.table_schema = 'auth'
      and g.table_name in ('profile_views', 'profile_item_presses', 'profile_view_days', 'profile_item_press_days')
  ) then
    raise exception 'crm_app and crm_worker must hold nothing on the link page counters';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.proname in ('crm_count_profile_view', 'crm_count_item_press', 'crm_profile_counts', 'crm_sweep_profile_counts')
      and (pg_catalog.pg_get_userbyid(p.proowner) <> 'crm_handle' or not p.prosecdef
        or not ('search_path=pg_catalog, pg_temp' = any (coalesce(p.proconfig, array[]::text[]))))
  ) then
    raise exception 'the link page counters must be crm_handle''s definers with a fixed search_path';
  end if;
end
$$;
