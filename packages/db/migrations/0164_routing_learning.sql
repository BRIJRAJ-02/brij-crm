-- Outcomes and learning (spec 0037, lane L9).
--
-- `routing_decisions` (AC-1389, AC-1370): `holdout` records the draw that made a decision pick plain fair, so the
-- comparison has an honest control arm; `segment_key` stamps the cell the nightly run counts the decision in (`*`
-- with no segment attributes, `?` when the lead was missing a value, else `attribute=option;attribute=option`).
-- Both nullable with no default, so no table rewrite and no scan under the lock (AC-1446).
--
-- `routing_decisions_ranked` (AC-1381) is the partial index the nightly run reads through: a workspace's ranked
-- decisions by time, which on this table is a small slice of the rows. Created without CONCURRENTLY, as every other
-- migration here does, because a partial index over `snapshot is not null` is tiny while L8 is this young; a later
-- deploy on a large table would build it outside the transaction instead.
--
-- `routing_settings` (AC-1386, AC-1389, AC-1370, AC-1381): the holdout share, the segment attributes, Learn from,
-- and the model the ranking reads. `model_version` is not null with a default, which is safe here: `routing_settings`
-- holds one small row a workspace, so its rewrite and its checks are validated at once.
--
-- `routing_stats` (AC-1369) is new and empty, so nothing is locked: one row per member per cell, machine written and
-- replaced nightly, with no audit columns. The standard tenant policy, forced.
--
-- `booking_pages.routing_objective` (AC-1354) is nullable with no default and reads as Deals created when unset.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD COLUMN "holdout" boolean;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD COLUMN "segment_key" text;--> statement-breakpoint
CREATE INDEX "routing_decisions_ranked" ON "routing_decisions" USING btree ("workspace_id","decided_at") WHERE "routing_decisions"."snapshot" is not null;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "holdout_percent" smallint;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "segment_attribute_ids" uuid[];--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "learn_since" date;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "model_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "model_trained_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_holdout" CHECK ("routing_settings"."holdout_percent" is null or "routing_settings"."holdout_percent" between 0 and 20);--> statement-breakpoint
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_segments" CHECK ("routing_settings"."segment_attribute_ids" is null or cardinality("routing_settings"."segment_attribute_ids") between 0 and 2);--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "routing_objective" text;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_objective" CHECK ("booking_pages"."routing_objective" is null or "booking_pages"."routing_objective" in ('deal', 'won', 'held')) NOT VALID;--> statement-breakpoint
CREATE TABLE "routing_stats" (
	"workspace_id" uuid NOT NULL,
	"model_version" integer NOT NULL,
	"page_id" uuid NOT NULL,
	"rotation_id" uuid NOT NULL,
	"segment_key" text NOT NULL,
	"objective" text NOT NULL,
	"member_id" uuid NOT NULL,
	"trials" integer DEFAULT 0 NOT NULL,
	"successes" integer DEFAULT 0 NOT NULL,
	"waiting" integer DEFAULT 0 NOT NULL,
	"trained_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_stats_pkey" PRIMARY KEY("workspace_id","model_version","page_id","rotation_id","segment_key","objective","member_id"),
	CONSTRAINT "routing_stats_objective" CHECK ("routing_stats"."objective" in ('held', 'deal', 'won')),
	CONSTRAINT "routing_stats_counts" CHECK ("routing_stats"."trials" >= 0 and "routing_stats"."successes" >= 0 and "routing_stats"."successes" <= "routing_stats"."trials")
);
--> statement-breakpoint
CREATE INDEX "routing_stats_by_version" ON "routing_stats" USING btree ("workspace_id","model_version");--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table routing_stats enable row level security;
--> statement-breakpoint
alter table routing_stats force row level security;
--> statement-breakpoint
create policy routing_stats_tenant on routing_stats
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- The hourly fan out's read (the worker's `crm_cron_routing_learn`, AC-1381): the live workspaces that have a ranked
-- decision the last run didn't count. Ids only. It reaches across workspaces, so it is the worker's alone
-- (crm_worker), owned by crm_sweep like crm_workspace_ids, with select on just the columns it reads.
--
-- It deliberately does **not** read `workspaces.time_zone`: migration 0034's closing check holds crm_sweep to
-- `workspaces.id` and `workspaces.deleted_at`, and widening that for one feature would widen the one role that
-- reaches every workspace. The 03:00 hour is decided per workspace afterwards, inside that workspace's own
-- transaction under row level security (`queueRoutingLearn`), which is one small read for each candidate and only
-- for the few that have anything new to count.
grant select (workspace_id, model_trained_at) on routing_settings to crm_sweep;
--> statement-breakpoint
grant select (workspace_id, decided_at, snapshot) on routing_decisions to crm_sweep;
--> statement-breakpoint
create function crm_routing_learn_workspaces(max integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 500
begin atomic
  select w.id
  from public.workspaces w
  where w.deleted_at is null
    and exists (
      select 1 from public.routing_decisions d
      where d.workspace_id = w.id and d.snapshot is not null
        and d.decided_at > coalesce(
          (select s.model_trained_at from public.routing_settings s where s.workspace_id = w.id),
          '-infinity'::timestamptz
        )
    )
  order by w.id
  limit least(greatest(crm_routing_learn_workspaces.max, 1), 500);
end;
--> statement-breakpoint
revoke all on function crm_routing_learn_workspaces(integer) from public;
--> statement-breakpoint
grant execute on function crm_routing_learn_workspaces(integer) to crm_worker;
--> statement-breakpoint
grant crm_sweep to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_sweep;
--> statement-breakpoint
alter function crm_routing_learn_workspaces(integer) owner to crm_sweep;
--> statement-breakpoint
revoke create on schema public from crm_sweep;
--> statement-breakpoint
revoke crm_sweep from current_user;
