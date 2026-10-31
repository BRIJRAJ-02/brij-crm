-- Skills, Won means and members with skills (spec 0037, lane L7).
--
-- `routing_settings` (AC-1351, AC-1385): one row per workspace, what every routed surface shares; a workspace without
-- it reads the defaults. L7 stores Won means (`won_stage`, `{ attributeId, optionIds[] }`); L8 and L9 add columns.
--
-- `routing_skills` and `member_skills` (AC-1382): up to 100 skills a workspace (core), each in a group, its name
-- unique in its group ignoring case; a member holds any of them. A skill's deletion takes its member rows (cascade);
-- a member's removal deletes theirs (core's removal hook, AC-1440).
--
-- `routing_decisions_hosts` widens from 8 to 200: a route requiring skills narrows to every member holding them
-- (AC-1356), up to a whole roster. A looser check every stored row already meets, so it is added NOT VALID: no scan
-- of the table under the lock its drop takes, and new rows are checked as ever.
--
-- New, empty tables: no lock on anything that holds rows. The standard tenant policy, forced (AC-1446 for the
-- timeout; the guard tests for the policy).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "routing_settings" (
	"workspace_id" uuid NOT NULL,
	"won_stage" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "routing_settings_pkey" PRIMARY KEY("workspace_id"),
	CONSTRAINT "routing_settings_created_by_actor" CHECK (("routing_settings"."created_by_type" is null and "routing_settings"."created_by_id" is null and "routing_settings"."created_by_member_id" is null)
      or ("routing_settings"."created_by_type" = 'system' and "routing_settings"."created_by_id" is null and "routing_settings"."created_by_member_id" is null)
      or ("routing_settings"."created_by_type" = 'member' and "routing_settings"."created_by_id" is not null and "routing_settings"."created_by_member_id" = "routing_settings"."created_by_id")
      or ("routing_settings"."created_by_type"::text not in ('member', 'system', 'calendar') and "routing_settings"."created_by_id" is not null and "routing_settings"."created_by_member_id" is null)),
	CONSTRAINT "routing_settings_updated_by_actor" CHECK (("routing_settings"."updated_by_type" is null and "routing_settings"."updated_by_id" is null and "routing_settings"."updated_by_member_id" is null)
      or ("routing_settings"."updated_by_type" = 'system' and "routing_settings"."updated_by_id" is null and "routing_settings"."updated_by_member_id" is null)
      or ("routing_settings"."updated_by_type" = 'member' and "routing_settings"."updated_by_id" is not null and "routing_settings"."updated_by_member_id" = "routing_settings"."updated_by_id")
      or ("routing_settings"."updated_by_type"::text not in ('member', 'system', 'calendar') and "routing_settings"."updated_by_id" is not null and "routing_settings"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "routing_skills" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"skill_group" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "routing_skills_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "routing_skills_group" CHECK ("routing_skills"."skill_group" in ('language', 'region', 'segment', 'product', 'other')),
	CONSTRAINT "routing_skills_name_length" CHECK (char_length("routing_skills"."name") between 1 and 40),
	CONSTRAINT "routing_skills_created_by_actor" CHECK (("routing_skills"."created_by_type" is null and "routing_skills"."created_by_id" is null and "routing_skills"."created_by_member_id" is null)
      or ("routing_skills"."created_by_type" = 'system' and "routing_skills"."created_by_id" is null and "routing_skills"."created_by_member_id" is null)
      or ("routing_skills"."created_by_type" = 'member' and "routing_skills"."created_by_id" is not null and "routing_skills"."created_by_member_id" = "routing_skills"."created_by_id")
      or ("routing_skills"."created_by_type"::text not in ('member', 'system', 'calendar') and "routing_skills"."created_by_id" is not null and "routing_skills"."created_by_member_id" is null)),
	CONSTRAINT "routing_skills_updated_by_actor" CHECK (("routing_skills"."updated_by_type" is null and "routing_skills"."updated_by_id" is null and "routing_skills"."updated_by_member_id" is null)
      or ("routing_skills"."updated_by_type" = 'system' and "routing_skills"."updated_by_id" is null and "routing_skills"."updated_by_member_id" is null)
      or ("routing_skills"."updated_by_type" = 'member' and "routing_skills"."updated_by_id" is not null and "routing_skills"."updated_by_member_id" = "routing_skills"."updated_by_id")
      or ("routing_skills"."updated_by_type"::text not in ('member', 'system', 'calendar') and "routing_skills"."updated_by_id" is not null and "routing_skills"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "member_skills" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_skills_pkey" PRIMARY KEY("workspace_id","member_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "member_skills" ADD CONSTRAINT "member_skills_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_skills" ADD CONSTRAINT "member_skills_skill" FOREIGN KEY ("workspace_id","skill_id") REFERENCES "public"."routing_skills"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_skills" ADD CONSTRAINT "routing_skills_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_skills" ADD CONSTRAINT "routing_skills_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_skills_by_skill" ON "member_skills" USING btree ("workspace_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_skills_name" ON "routing_skills" USING btree ("workspace_id","skill_group",lower("name"));--> statement-breakpoint
ALTER TABLE "routing_decisions" DROP CONSTRAINT "routing_decisions_hosts";--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_hosts" CHECK ("routing_decisions"."hosts" is null or cardinality("routing_decisions"."hosts") between 1 and 200) NOT VALID;--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table routing_settings enable row level security;
--> statement-breakpoint
alter table routing_settings force row level security;
--> statement-breakpoint
create policy routing_settings_tenant on routing_settings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table routing_skills enable row level security;
--> statement-breakpoint
alter table routing_skills force row level security;
--> statement-breakpoint
create policy routing_skills_tenant on routing_skills
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table member_skills enable row level security;
--> statement-breakpoint
alter table member_skills force row level security;
--> statement-breakpoint
create policy member_skills_tenant on member_skills
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
