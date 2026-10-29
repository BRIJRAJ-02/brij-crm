-- Scheduling access (spec 0037, job J1, AC-1254): `schedule_delegations`, one row per delegation of See or Manage
-- over one member, one team or everyone, given to one member (the delegate). timefix's "Sees all calendars" switch
-- is an everyone delegation; a member choosing their own assistant is a member delegation they granted themself
-- (`granted_by_self`, AC-1255).
--
-- `target_type` and `level` are text with no value check, as spec 0032 keeps `access_rules.level`: a value a newer
-- deploy wrote fails closed after a rollback, since core reads one it doesn't know as nothing (AC-1223) and checks
-- both on write. `target_team_id` gets no foreign key here: there is no `teams` table yet, so spec 0031 slice 8's
-- migration adds `schedule_delegations_target_team` (on delete cascade, AC-1443), and core refuses a team target
-- until then (422 `DELEGATE_INVALID`).
--
-- A new, empty table: no lock on anything that holds rows. The standard tenant policy, forced (AC-1446 for the
-- timeout; the guard tests for the policy).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "schedule_delegations" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"delegate_member_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_member_id" uuid,
	"target_team_id" uuid,
	"level" text NOT NULL,
	"granted_by_self" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "schedule_delegations_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "schedule_delegations_one_target" CHECK (num_nonnulls("schedule_delegations"."target_member_id", "schedule_delegations"."target_team_id") <= 1),
	CONSTRAINT "schedule_delegations_not_self" CHECK ("schedule_delegations"."delegate_member_id" <> "schedule_delegations"."target_member_id"),
	CONSTRAINT "schedule_delegations_created_by_actor" CHECK (("schedule_delegations"."created_by_type" is null and "schedule_delegations"."created_by_id" is null and "schedule_delegations"."created_by_member_id" is null)
      or ("schedule_delegations"."created_by_type" = 'system' and "schedule_delegations"."created_by_id" is null and "schedule_delegations"."created_by_member_id" is null)
      or ("schedule_delegations"."created_by_type" = 'member' and "schedule_delegations"."created_by_id" is not null and "schedule_delegations"."created_by_member_id" = "schedule_delegations"."created_by_id")
      or ("schedule_delegations"."created_by_type"::text not in ('member', 'system', 'calendar') and "schedule_delegations"."created_by_id" is not null and "schedule_delegations"."created_by_member_id" is null)),
	CONSTRAINT "schedule_delegations_updated_by_actor" CHECK (("schedule_delegations"."updated_by_type" is null and "schedule_delegations"."updated_by_id" is null and "schedule_delegations"."updated_by_member_id" is null)
      or ("schedule_delegations"."updated_by_type" = 'system' and "schedule_delegations"."updated_by_id" is null and "schedule_delegations"."updated_by_member_id" is null)
      or ("schedule_delegations"."updated_by_type" = 'member' and "schedule_delegations"."updated_by_id" is not null and "schedule_delegations"."updated_by_member_id" = "schedule_delegations"."updated_by_id")
      or ("schedule_delegations"."updated_by_type"::text not in ('member', 'system', 'calendar') and "schedule_delegations"."updated_by_id" is not null and "schedule_delegations"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "schedule_delegations" ADD CONSTRAINT "schedule_delegations_delegate" FOREIGN KEY ("workspace_id","delegate_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_delegations" ADD CONSTRAINT "schedule_delegations_target_member" FOREIGN KEY ("workspace_id","target_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_delegations" ADD CONSTRAINT "schedule_delegations_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_delegations" ADD CONSTRAINT "schedule_delegations_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_delegations_one" ON "schedule_delegations" USING btree ("workspace_id","delegate_member_id","target_type",coalesce("target_member_id", "target_team_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "schedule_delegations_by_delegate" ON "schedule_delegations" USING btree ("workspace_id","delegate_member_id");--> statement-breakpoint
CREATE INDEX "schedule_delegations_by_target_member" ON "schedule_delegations" USING btree ("workspace_id","target_member_id") WHERE "schedule_delegations"."target_member_id" is not null;--> statement-breakpoint
CREATE INDEX "schedule_delegations_by_target_team" ON "schedule_delegations" USING btree ("workspace_id","target_team_id") WHERE "schedule_delegations"."target_team_id" is not null;--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table schedule_delegations enable row level security;
--> statement-breakpoint
alter table schedule_delegations force row level security;
--> statement-breakpoint
create policy schedule_delegations_tenant on schedule_delegations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
