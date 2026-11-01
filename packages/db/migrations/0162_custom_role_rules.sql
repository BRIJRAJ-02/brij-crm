-- Custom roles in access rules (spec 0037, job J10, AC-1230): `access_rules` and `record_rules` gain
-- `subject_custom_role_id`, so a rule can be about one custom role, and `subject_type` gains `custom_role`. Until
-- now a custom role holder read every rule their base role (Member) had; from here each role has rules of its own,
-- which a new role starts as a copy of what it started from.
--
-- Two nullable columns with no default on two tables that hold at most a few rows per object, so no rewrite and no
-- long lock. The subject check is replaced in place: every existing row names a role or a team, so the new one holds
-- for all of them and is validated here rather than later (both tables are small: rules, not records). The unique
-- index on each is replaced to include the new column, so two roles' rules on one object never collide.
--
-- Then the backfill AC-1230 asks for: every custom role made before this migration takes a copy of the rules its
-- "Start from" has at this moment (`started_from`: a custom role's id, else Member, which `viewer` sits on too, and
-- a role deleted since falls back to Member). A workspace that never had rules copies nothing.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "access_rules" ADD COLUMN "subject_custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "record_rules" ADD COLUMN "subject_custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_custom_role" FOREIGN KEY ("workspace_id","subject_custom_role_id") REFERENCES "public"."workspace_roles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_rules" ADD CONSTRAINT "record_rules_custom_role" FOREIGN KEY ("workspace_id","subject_custom_role_id") REFERENCES "public"."workspace_roles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" DROP CONSTRAINT "access_rules_subject";--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_subject" CHECK (("access_rules"."subject_type" = 'role' and "access_rules"."subject_role" is not null and "access_rules"."subject_custom_role_id" is null and "access_rules"."subject_team_id" is null and "access_rules"."subject_role" in ('member', 'guest'))
        or ("access_rules"."subject_type" = 'custom_role' and "access_rules"."subject_role" is null and "access_rules"."subject_custom_role_id" is not null and "access_rules"."subject_team_id" is null)
        or ("access_rules"."subject_type" = 'team' and "access_rules"."subject_role" is null and "access_rules"."subject_custom_role_id" is null and "access_rules"."subject_team_id" is not null));--> statement-breakpoint
ALTER TABLE "record_rules" DROP CONSTRAINT "record_rules_subject";--> statement-breakpoint
ALTER TABLE "record_rules" ADD CONSTRAINT "record_rules_subject" CHECK (("record_rules"."subject_type" = 'role' and "record_rules"."subject_role" is not null and "record_rules"."subject_custom_role_id" is null and "record_rules"."subject_team_id" is null and "record_rules"."subject_role" in ('member', 'guest'))
        or ("record_rules"."subject_type" = 'custom_role' and "record_rules"."subject_role" is null and "record_rules"."subject_custom_role_id" is not null and "record_rules"."subject_team_id" is null)
        or ("record_rules"."subject_type" = 'team' and "record_rules"."subject_role" is null and "record_rules"."subject_custom_role_id" is null and "record_rules"."subject_team_id" is not null));--> statement-breakpoint
DROP INDEX "access_rules_one";--> statement-breakpoint
DROP INDEX "record_rules_one";--> statement-breakpoint
CREATE UNIQUE INDEX "access_rules_one" ON "access_rules" USING btree ("workspace_id","object_id",coalesce("subject_role", ''),coalesce("subject_custom_role_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("subject_team_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("attribute_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "record_rules_one" ON "record_rules" USING btree ("workspace_id","object_id",coalesce("subject_role", ''),coalesce("subject_custom_role_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("subject_team_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "access_rules_by_custom_role" ON "access_rules" USING btree ("workspace_id","subject_custom_role_id") WHERE "access_rules"."subject_custom_role_id" is not null;--> statement-breakpoint
CREATE INDEX "record_rules_by_custom_role" ON "record_rules" USING btree ("workspace_id","subject_custom_role_id") WHERE "record_rules"."subject_custom_role_id" is not null;--> statement-breakpoint
-- Hand written from here: AC-1230's backfill.
-- Each custom role takes a copy of the object and field rules of what it started from, then of its record rules.
-- `started_from` is a custom role's id where one still exists, else Member (`member`, `viewer`, or a role deleted
-- since). A role that already has rules of its own (none can, on the day this runs) is left alone.
-- Row security off: the owner bypasses it, and a role it would filter fails here rather than backfilling nothing.
set local row_security = off;
--> statement-breakpoint
insert into access_rules (workspace_id, subject_type, subject_custom_role_id, object_id, attribute_id, level,
    created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
select r.workspace_id, 'custom_role', r.id, source.object_id, source.attribute_id, source.level,
    'system', null, null, 'system', null, null
  from workspace_roles r
  join access_rules source on source.workspace_id = r.workspace_id
    and case
      when exists (select 1 from workspace_roles f
        where f.workspace_id = r.workspace_id and f.id::text = r.started_from)
      then source.subject_custom_role_id::text = r.started_from
      else source.subject_type = 'role' and source.subject_role = 'member'
    end
  where not exists (select 1 from access_rules mine
    where mine.workspace_id = r.workspace_id and mine.subject_custom_role_id = r.id);
--> statement-breakpoint
insert into record_rules (workspace_id, subject_type, subject_custom_role_id, object_id, kind, attribute_id,
    created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
select r.workspace_id, 'custom_role', r.id, source.object_id, source.kind, source.attribute_id,
    'system', null, null, 'system', null, null
  from workspace_roles r
  join record_rules source on source.workspace_id = r.workspace_id
    and case
      when exists (select 1 from workspace_roles f
        where f.workspace_id = r.workspace_id and f.id::text = r.started_from)
      then source.subject_custom_role_id::text = r.started_from
      else source.subject_type = 'role' and source.subject_role = 'member'
    end
  where not exists (select 1 from record_rules mine
    where mine.workspace_id = r.workspace_id and mine.subject_custom_role_id = r.id);
