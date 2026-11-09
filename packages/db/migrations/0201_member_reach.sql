-- Properties, slice 4 (spec 0065 H7, AC-6594 to AC-6597): who can work where. Numbered 0201, after 0200 (property
-- handles).
--
-- `member_reach`: the businesses (properties) and places a member may reach in the business apps, on top of their
-- role. No rows means every business, so nothing changes for a workspace that never limits anyone, and no backfill.
-- Owners and admins are always every business; the code never reads their rows. Exactly one of `property_id` and
-- `place_id` is set. Neither cascades on delete: a reach that lost its only row would read as every business, so a
-- business or place a reach names can't be removed (the app refuses it first, with a sentence). A removed member's
-- rows stay (`KEPT_ON_REMOVAL`): a removed member reaches nothing anyway.
--
-- Additive only: old code never reads the table, so the rollout and a rollback are safe. Postgres 17 compatible.
set local lock_timeout = '5s';
--> statement-breakpoint
create table member_reach (
  workspace_id uuid not null,
  id uuid not null default uuidv7(),
  member_id uuid not null,
  property_id uuid,
  place_id uuid,
  created_at timestamp (6) with time zone not null default now(),
  created_by_member_id uuid,
  constraint member_reach_pkey primary key (workspace_id, id),
  constraint member_reach_one check (num_nonnulls(property_id, place_id) = 1)
);
--> statement-breakpoint
alter table member_reach add constraint member_reach_workspace foreign key (workspace_id)
  references workspaces (id) on delete cascade;
--> statement-breakpoint
alter table member_reach add constraint member_reach_member foreign key (workspace_id, member_id)
  references members (workspace_id, id);
--> statement-breakpoint
alter table member_reach add constraint member_reach_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id);
--> statement-breakpoint
alter table member_reach add constraint member_reach_place foreign key (workspace_id, place_id)
  references places (workspace_id, id);
--> statement-breakpoint
create unique index member_reach_property_once on member_reach using btree (workspace_id, member_id, property_id);
--> statement-breakpoint
create unique index member_reach_place_once on member_reach using btree (workspace_id, member_id, place_id);
--> statement-breakpoint
create index member_reach_by_property on member_reach using btree (workspace_id, property_id);
--> statement-breakpoint
create index member_reach_by_place on member_reach using btree (workspace_id, place_id);
--> statement-breakpoint
alter table member_reach enable row level security;
--> statement-breakpoint
alter table member_reach force row level security;
--> statement-breakpoint
create policy member_reach_tenant on member_reach
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
