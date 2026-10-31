-- Teams and access rules (spec 0031 slice 8, AC-824 to AC-827; spec 0032 milestones 1 to 3, AC-841): `teams` and
-- `team_members` (a member may be in any number of teams, flat, no nesting), then `access_rules` (object and field
-- levels) and `record_rules` (own or team records), each naming a role or a team as its subject. Levels, kinds and
-- the role are text with no value check beyond the subject's shape, so a value a newer deploy wrote fails closed in
-- the code after a rollback instead of being refused here.
--
-- Four new, empty tables: no lock on anything that holds rows. The standard tenant policy, forced (the guard tests).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "teams" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "teams_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "teams_name_length" CHECK (char_length("teams"."name") between 1 and 64),
	CONSTRAINT "teams_created_by_actor" CHECK (("teams"."created_by_type" is null and "teams"."created_by_id" is null and "teams"."created_by_member_id" is null)
      or ("teams"."created_by_type" = 'system' and "teams"."created_by_id" is null and "teams"."created_by_member_id" is null)
      or ("teams"."created_by_type" = 'member' and "teams"."created_by_id" is not null and "teams"."created_by_member_id" = "teams"."created_by_id")
      or ("teams"."created_by_type"::text not in ('member', 'system', 'calendar') and "teams"."created_by_id" is not null and "teams"."created_by_member_id" is null)),
	CONSTRAINT "teams_updated_by_actor" CHECK (("teams"."updated_by_type" is null and "teams"."updated_by_id" is null and "teams"."updated_by_member_id" is null)
      or ("teams"."updated_by_type" = 'system' and "teams"."updated_by_id" is null and "teams"."updated_by_member_id" is null)
      or ("teams"."updated_by_type" = 'member' and "teams"."updated_by_id" is not null and "teams"."updated_by_member_id" = "teams"."updated_by_id")
      or ("teams"."updated_by_type"::text not in ('member', 'system', 'calendar') and "teams"."updated_by_id" is not null and "teams"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"workspace_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	CONSTRAINT "team_members_pkey" PRIMARY KEY("workspace_id","team_id","member_id"),
	CONSTRAINT "team_members_created_by_actor" CHECK (("team_members"."created_by_type" is null and "team_members"."created_by_id" is null and "team_members"."created_by_member_id" is null)
      or ("team_members"."created_by_type" = 'system' and "team_members"."created_by_id" is null and "team_members"."created_by_member_id" is null)
      or ("team_members"."created_by_type" = 'member' and "team_members"."created_by_id" is not null and "team_members"."created_by_member_id" = "team_members"."created_by_id")
      or ("team_members"."created_by_type"::text not in ('member', 'system', 'calendar') and "team_members"."created_by_id" is not null and "team_members"."created_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "access_rules" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_role" text,
	"subject_team_id" uuid,
	"object_id" uuid NOT NULL,
	"attribute_id" uuid,
	"level" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "access_rules_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "access_rules_subject" CHECK (("access_rules"."subject_type" = 'role' and "access_rules"."subject_role" is not null and "access_rules"."subject_team_id" is null and "access_rules"."subject_role" in ('member', 'guest'))
        or ("access_rules"."subject_type" = 'team' and "access_rules"."subject_role" is null and "access_rules"."subject_team_id" is not null)),
	CONSTRAINT "access_rules_created_by_actor" CHECK (("access_rules"."created_by_type" is null and "access_rules"."created_by_id" is null and "access_rules"."created_by_member_id" is null)
      or ("access_rules"."created_by_type" = 'system' and "access_rules"."created_by_id" is null and "access_rules"."created_by_member_id" is null)
      or ("access_rules"."created_by_type" = 'member' and "access_rules"."created_by_id" is not null and "access_rules"."created_by_member_id" = "access_rules"."created_by_id")
      or ("access_rules"."created_by_type"::text not in ('member', 'system', 'calendar') and "access_rules"."created_by_id" is not null and "access_rules"."created_by_member_id" is null)),
	CONSTRAINT "access_rules_updated_by_actor" CHECK (("access_rules"."updated_by_type" is null and "access_rules"."updated_by_id" is null and "access_rules"."updated_by_member_id" is null)
      or ("access_rules"."updated_by_type" = 'system' and "access_rules"."updated_by_id" is null and "access_rules"."updated_by_member_id" is null)
      or ("access_rules"."updated_by_type" = 'member' and "access_rules"."updated_by_id" is not null and "access_rules"."updated_by_member_id" = "access_rules"."updated_by_id")
      or ("access_rules"."updated_by_type"::text not in ('member', 'system', 'calendar') and "access_rules"."updated_by_id" is not null and "access_rules"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "record_rules" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_role" text,
	"subject_team_id" uuid,
	"object_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"attribute_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "record_rules_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "record_rules_subject" CHECK (("record_rules"."subject_type" = 'role' and "record_rules"."subject_role" is not null and "record_rules"."subject_team_id" is null and "record_rules"."subject_role" in ('member', 'guest'))
        or ("record_rules"."subject_type" = 'team' and "record_rules"."subject_role" is null and "record_rules"."subject_team_id" is not null)),
	CONSTRAINT "record_rules_created_by_actor" CHECK (("record_rules"."created_by_type" is null and "record_rules"."created_by_id" is null and "record_rules"."created_by_member_id" is null)
      or ("record_rules"."created_by_type" = 'system' and "record_rules"."created_by_id" is null and "record_rules"."created_by_member_id" is null)
      or ("record_rules"."created_by_type" = 'member' and "record_rules"."created_by_id" is not null and "record_rules"."created_by_member_id" = "record_rules"."created_by_id")
      or ("record_rules"."created_by_type"::text not in ('member', 'system', 'calendar') and "record_rules"."created_by_id" is not null and "record_rules"."created_by_member_id" is null)),
	CONSTRAINT "record_rules_updated_by_actor" CHECK (("record_rules"."updated_by_type" is null and "record_rules"."updated_by_id" is null and "record_rules"."updated_by_member_id" is null)
      or ("record_rules"."updated_by_type" = 'system' and "record_rules"."updated_by_id" is null and "record_rules"."updated_by_member_id" is null)
      or ("record_rules"."updated_by_type" = 'member' and "record_rules"."updated_by_id" is not null and "record_rules"."updated_by_member_id" = "record_rules"."updated_by_id")
      or ("record_rules"."updated_by_type"::text not in ('member', 'system', 'calendar') and "record_rules"."updated_by_id" is not null and "record_rules"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team" FOREIGN KEY ("workspace_id","team_id") REFERENCES "public"."teams"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_team" FOREIGN KEY ("workspace_id","subject_team_id") REFERENCES "public"."teams"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_attribute" FOREIGN KEY ("workspace_id","attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_rules" ADD CONSTRAINT "record_rules_team" FOREIGN KEY ("workspace_id","subject_team_id") REFERENCES "public"."teams"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_rules" ADD CONSTRAINT "record_rules_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_rules" ADD CONSTRAINT "record_rules_attribute" FOREIGN KEY ("workspace_id","attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_rules" ADD CONSTRAINT "record_rules_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_rules" ADD CONSTRAINT "record_rules_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name" ON "teams" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "team_members_by_member" ON "team_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_rules_one" ON "access_rules" USING btree ("workspace_id","object_id",coalesce("subject_role", ''),coalesce("subject_team_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("attribute_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "access_rules_by_role" ON "access_rules" USING btree ("workspace_id","subject_role") WHERE "access_rules"."subject_role" is not null;--> statement-breakpoint
CREATE INDEX "access_rules_by_team" ON "access_rules" USING btree ("workspace_id","subject_team_id") WHERE "access_rules"."subject_team_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_rules_one" ON "record_rules" USING btree ("workspace_id","object_id",coalesce("subject_role", ''),coalesce("subject_team_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "record_rules_by_role" ON "record_rules" USING btree ("workspace_id","subject_role") WHERE "record_rules"."subject_role" is not null;--> statement-breakpoint
CREATE INDEX "record_rules_by_team" ON "record_rules" USING btree ("workspace_id","subject_team_id") WHERE "record_rules"."subject_team_id" is not null;--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table teams enable row level security;
--> statement-breakpoint
alter table teams force row level security;
--> statement-breakpoint
create policy teams_tenant on teams
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table team_members enable row level security;
--> statement-breakpoint
alter table team_members force row level security;
--> statement-breakpoint
create policy team_members_tenant on team_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table access_rules enable row level security;
--> statement-breakpoint
alter table access_rules force row level security;
--> statement-breakpoint
create policy access_rules_tenant on access_rules
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table record_rules enable row level security;
--> statement-breakpoint
alter table record_rules force row level security;
--> statement-breakpoint
create policy record_rules_tenant on record_rules
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
