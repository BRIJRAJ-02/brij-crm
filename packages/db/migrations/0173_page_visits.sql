-- Analytics across products (spec 0067, AC-6701 to AC-6703, AC-6720, AC-6730): one visit model for every public
-- page, its daily rollup, and the numbers only share links. 4 November 2026.
--
-- `page_visits` generalises 0163's `form_visits`: one row per page kind, page, UTC day and visitor, where the visitor
-- is still spec 0047's daily keyed hash and nothing else (`page_visits_visitor`), so no cookie, no address and no
-- lasting id can be put there. `source`, `medium` and `campaign` are short words the server normalised (a UTM tag, a
-- referrer's group, or Google or Meta ads read from a click id), `referrer_host` is a host only, and `landing` keeps
-- the landing address's UTM tags and whether a click id was there (never the id itself). `furthest_step` is the
-- kind's furthest step reached short of the finish (`step_rank` its place, so a Back never moves it backwards),
-- `furthest_detail` a form's furthest question, and `outcome_id` the submission or booking the finish made.
--
-- `page_visit_days` is the rollup the Insights screen reads: per page, day, source, medium, campaign, the Other
-- group's host and the step a visit got to, the visits, finishes and time to finish. Every insert or update of a
-- visit marks its day in `page_visit_stale_days` (a trigger), the rollup job recomputes those days from the raw rows
-- and clears the mark, and a read takes any day still marked (and today) from the raw rows, so a figure is never
-- older than the visits. Raw rows go after thirteen months; the rollup stays.
--
-- `insight_shares` is a share link: only the SHA-256 of its secret is kept, it names the pages it shows (fixed when
-- it was made, so a page made later never joins it), and it can expire or be revoked.
--
-- `form_visits` is copied in once and no longer written (expand now, drop later). Every table here is a tenant
-- table: forced row level security and the standard workspace policy. The rollup job lists the workspaces with a
-- stale day through crm_page_rollup_workspaces (owned by crm_sweep, ids only, the worker's alone), then rolls each
-- up inside withWorkspace() as the system.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "page_visits" (
	"workspace_id" uuid NOT NULL,
	"page_kind" text NOT NULL,
	"page_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"medium" text,
	"campaign" text,
	"referrer_host" text,
	"landing" jsonb,
	"started_at" timestamp (6) with time zone,
	"finished_at" timestamp (6) with time zone,
	"furthest_step" text DEFAULT 'view' NOT NULL,
	"step_rank" smallint DEFAULT 0 NOT NULL,
	"furthest_detail" text,
	"duration_ms" integer,
	"outcome_id" uuid,
	"first_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_visits_pkey" PRIMARY KEY("workspace_id","page_kind","page_id","day","visitor"),
	CONSTRAINT "page_visits_visitor" CHECK ("page_visits"."visitor" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "page_visits_kind" CHECK ("page_visits"."page_kind" in ('form', 'booking', 'business_booking', 'reservation', 'event', 'link', 'menu', 'qr')),
	CONSTRAINT "page_visits_source" CHECK (char_length("page_visits"."source") between 1 and 60),
	CONSTRAINT "page_visits_medium" CHECK ("page_visits"."medium" is null or char_length("page_visits"."medium") between 1 and 60),
	CONSTRAINT "page_visits_campaign" CHECK ("page_visits"."campaign" is null or char_length("page_visits"."campaign") between 1 and 60),
	CONSTRAINT "page_visits_referrer" CHECK ("page_visits"."referrer_host" is null or "page_visits"."referrer_host" ~ '^[a-z0-9.-]{1,120}$'),
	CONSTRAINT "page_visits_landing" CHECK ("page_visits"."landing" is null or (jsonb_typeof("page_visits"."landing") = 'object' and octet_length("page_visits"."landing"::text) <= 1024)),
	CONSTRAINT "page_visits_step" CHECK ("page_visits"."furthest_step" ~ '^[a-z_]{1,20}$' and "page_visits"."step_rank" between 0 and 20),
	CONSTRAINT "page_visits_detail" CHECK ("page_visits"."furthest_detail" is null or char_length("page_visits"."furthest_detail") <= 40),
	CONSTRAINT "page_visits_duration" CHECK ("page_visits"."duration_ms" is null or "page_visits"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "page_visit_days" (
	"workspace_id" uuid NOT NULL,
	"page_kind" text NOT NULL,
	"page_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"medium" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"referrer_host" text DEFAULT '' NOT NULL,
	"step" text NOT NULL,
	"visits" integer NOT NULL,
	"finishes" integer NOT NULL,
	"duration_sum_ms" bigint DEFAULT 0 NOT NULL,
	"duration_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_visit_days_pkey" PRIMARY KEY("workspace_id","page_kind","page_id","day","source","medium","campaign","referrer_host","step"),
	CONSTRAINT "page_visit_days_counts" CHECK ("page_visit_days"."visits" >= 0 and "page_visit_days"."finishes" >= 0 and "page_visit_days"."duration_sum_ms" >= 0 and "page_visit_days"."duration_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "page_visit_stale_days" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"marked_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_visit_stale_days_pkey" PRIMARY KEY("workspace_id","day")
);
--> statement-breakpoint
CREATE TABLE "insight_shares" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"page_kind" text,
	"page_id" uuid,
	"pages" jsonb NOT NULL,
	"range" text NOT NULL,
	"expires_at" timestamp (6) with time zone,
	"revoked_at" timestamp (6) with time zone,
	"created_by_member_id" uuid NOT NULL,
	"revoked_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_shares_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "insight_shares_token_hash" CHECK ("insight_shares"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "insight_shares_label" CHECK (char_length("insight_shares"."label") between 1 and 80),
	CONSTRAINT "insight_shares_pages" CHECK (jsonb_typeof("insight_shares"."pages") = 'array' and jsonb_array_length("insight_shares"."pages") <= 500),
	CONSTRAINT "insight_shares_range" CHECK ("insight_shares"."range" in ('7', '30', '90', '365', 'all'))
);
--> statement-breakpoint
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_visit_days" ADD CONSTRAINT "page_visit_days_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_visit_stale_days" ADD CONSTRAINT "page_visit_stale_days_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_shares" ADD CONSTRAINT "insight_shares_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_shares" ADD CONSTRAINT "insight_shares_creator" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A page's own range read (its Insights tab, a form's question drop off), and the cleanup's oldest days first.
CREATE INDEX "page_visits_by_page_day" ON "page_visits" USING btree ("workspace_id","page_kind","page_id","day");--> statement-breakpoint
CREATE INDEX "page_visits_day" ON "page_visits" USING btree ("workspace_id","day");--> statement-breakpoint
-- The Sessions table: the newest visits first, a page of 50 at a time.
CREATE INDEX "page_visits_recent" ON "page_visits" USING btree ("workspace_id","first_at","page_kind","page_id","visitor");--> statement-breakpoint
-- The screen's range read over every page it may show.
CREATE INDEX "page_visit_days_day" ON "page_visit_days" USING btree ("workspace_id","day");--> statement-breakpoint
-- A share link is found by its secret's hash, inside the workspace its token names.
CREATE UNIQUE INDEX "insight_shares_token" ON "insight_shares" USING btree ("workspace_id","token_hash");--> statement-breakpoint
CREATE INDEX "insight_shares_by_creator" ON "insight_shares" USING btree ("workspace_id","created_by_member_id");--> statement-breakpoint

alter table page_visits enable row level security;
--> statement-breakpoint
alter table page_visits force row level security;
--> statement-breakpoint
create policy page_visits_tenant on page_visits
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table page_visit_days enable row level security;
--> statement-breakpoint
alter table page_visit_days force row level security;
--> statement-breakpoint
create policy page_visit_days_tenant on page_visit_days
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table page_visit_stale_days enable row level security;
--> statement-breakpoint
alter table page_visit_stale_days force row level security;
--> statement-breakpoint
create policy page_visit_stale_days_tenant on page_visit_stale_days
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table insight_shares enable row level security;
--> statement-breakpoint
alter table insight_shares force row level security;
--> statement-breakpoint
create policy insight_shares_tenant on insight_shares
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- A visit made or moved on marks its day stale, in the visit's own statement and under its own row level security:
-- an invoker trigger, so the mark can only ever be the visit's own workspace's. A day already marked costs one
-- index probe.
create function crm_page_visit_mark_stale()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.page_visit_stale_days (workspace_id, day)
  values (new.workspace_id, new.day)
  on conflict (workspace_id, day) do nothing;
  return null;
end;
$$;
--> statement-breakpoint
create trigger page_visits_mark_stale
  after insert or update on page_visits
  for each row execute function crm_page_visit_mark_stale();
--> statement-breakpoint
-- The backfill (AC-6701): every form visit once, as a `form` page visit. A UTM source stays a source; a referring
-- host goes into its group (Google, Instagram, Facebook, TikTok, LinkedIn, else Other with the host kept); `direct`
-- stays. The furthest step is `start` once an answer was given, else `view`; the furthest question carries over as
-- the detail. Row security off: the owner bypasses it, and a role it would filter fails here rather than copying
-- nothing.
set local row_security = off;
--> statement-breakpoint
insert into page_visits (
  workspace_id, page_kind, page_id, day, visitor, source, medium, referrer_host, started_at, finished_at,
  furthest_step, step_rank, furthest_detail, duration_ms, first_at, last_at
)
select v.workspace_id, 'form', v.form_id, v.day, v.visitor,
  case
    when v.source like 'utm:%' then left(substr(v.source, 5), 60)
    when v.source like 'ref:%' then
      case
        when substr(v.source, 5) ~ '(^|\.)google\.' then 'google'
        when substr(v.source, 5) ~ '(^|\.)(instagram\.com|l\.instagram\.com)$' then 'instagram'
        when substr(v.source, 5) ~ '(^|\.)(facebook\.com|fb\.com|fb\.me)$' then 'facebook'
        when substr(v.source, 5) ~ '(^|\.)tiktok\.com$' then 'tiktok'
        when substr(v.source, 5) ~ '(^|\.)(linkedin\.com|lnkd\.in)$' then 'linkedin'
        else 'other'
      end
    else 'direct'
  end,
  case when v.source like 'ref:%' then 'referral' else null end,
  case
    when v.source like 'ref:%' and substr(v.source, 5) ~ '^[a-z0-9.-]{1,120}$'
      and not substr(v.source, 5) ~ '(^|\.)(google\.|instagram\.com$|facebook\.com$|fb\.com$|fb\.me$|tiktok\.com$|linkedin\.com$|lnkd\.in$)'
      then substr(v.source, 5)
    else null
  end,
  v.started_at, v.completed_at,
  case when v.started_at is not null or v.furthest_question_id is not null then 'start' else 'view' end,
  case when v.started_at is not null or v.furthest_question_id is not null then 1 else 0 end,
  left(v.furthest_question_id, 40), v.duration_ms, v.first_at, v.last_at
from form_visits v
on conflict do nothing;
--> statement-breakpoint
reset row_security;
--> statement-breakpoint
-- The rollup job's listing (AC-6730): the workspaces holding a stale day, oldest mark first, ids only, at most `max`
-- (1 to 500). Across every workspace, so the worker's alone (crm_worker), owned by crm_sweep, which reads two columns
-- of `page_visit_stale_days` for it and nothing else.
grant select (workspace_id, marked_at) on page_visit_stale_days to crm_sweep;
--> statement-breakpoint
create function crm_page_rollup_workspaces(max integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 500
begin atomic
  select s.workspace_id
  from public.page_visit_stale_days s
  group by s.workspace_id
  order by pg_catalog.min(s.marked_at), s.workspace_id
  limit least(greatest(crm_page_rollup_workspaces.max, 1), 500);
end;
--> statement-breakpoint
revoke all on function crm_page_rollup_workspaces(integer) from public;
--> statement-breakpoint
grant execute on function crm_page_rollup_workspaces(integer) to crm_worker;
--> statement-breakpoint
grant crm_sweep to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_sweep;
--> statement-breakpoint
alter function crm_page_rollup_workspaces(integer) owner to crm_sweep;
--> statement-breakpoint
revoke create on schema public from crm_sweep;
--> statement-breakpoint
revoke crm_sweep from current_user;
