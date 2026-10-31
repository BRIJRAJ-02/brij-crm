-- Custom roles (spec 0037, job J9, AC-1228 to AC-1238): `workspace_roles`, a workspace's own roles built from the
-- permission catalog, and the custom role a member holds or an invitation gives (`custom_role_id`, with `role` then
-- `member`). Permissions and the data access level are text the code checks when it reads them, so a value a newer
-- deploy wrote, or one stored by hand, fails closed after a rollback instead of being refused here.
--
-- One new, empty table, and two nullable columns with no default on `members` and `invitations` (a catalog change,
-- no rewrite). Their foreign keys and checks hold on columns that are null in every row, so validating them reads
-- the tables once without blocking writes for long; both tables are small (people, not records).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "workspace_roles" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" smallint NOT NULL,
	"default_object_level" text DEFAULT 'write' NOT NULL,
	"started_from" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "workspace_roles_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "workspace_roles_name_length" CHECK (char_length("workspace_roles"."name") between 1 and 40),
	CONSTRAINT "workspace_roles_name_reserved" CHECK (lower("workspace_roles"."name") not in ('owner', 'admin', 'member', 'guest')),
	CONSTRAINT "workspace_roles_description" CHECK (char_length("workspace_roles"."description") <= 200),
	CONSTRAINT "workspace_roles_permissions" CHECK (cardinality("workspace_roles"."permissions") <= 64),
	CONSTRAINT "workspace_roles_position" CHECK ("workspace_roles"."position" between 0 and 19),
	CONSTRAINT "workspace_roles_created_by_actor" CHECK (("workspace_roles"."created_by_type" is null and "workspace_roles"."created_by_id" is null and "workspace_roles"."created_by_member_id" is null)
      or ("workspace_roles"."created_by_type" = 'system' and "workspace_roles"."created_by_id" is null and "workspace_roles"."created_by_member_id" is null)
      or ("workspace_roles"."created_by_type" = 'member' and "workspace_roles"."created_by_id" is not null and "workspace_roles"."created_by_member_id" = "workspace_roles"."created_by_id")
      or ("workspace_roles"."created_by_type"::text not in ('member', 'system', 'calendar') and "workspace_roles"."created_by_id" is not null and "workspace_roles"."created_by_member_id" is null)),
	CONSTRAINT "workspace_roles_updated_by_actor" CHECK (("workspace_roles"."updated_by_type" is null and "workspace_roles"."updated_by_id" is null and "workspace_roles"."updated_by_member_id" is null)
      or ("workspace_roles"."updated_by_type" = 'system' and "workspace_roles"."updated_by_id" is null and "workspace_roles"."updated_by_member_id" is null)
      or ("workspace_roles"."updated_by_type" = 'member' and "workspace_roles"."updated_by_id" is not null and "workspace_roles"."updated_by_member_id" = "workspace_roles"."updated_by_id")
      or ("workspace_roles"."updated_by_type"::text not in ('member', 'system', 'calendar') and "workspace_roles"."updated_by_id" is not null and "workspace_roles"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "workspace_roles" ADD CONSTRAINT "workspace_roles_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_roles" ADD CONSTRAINT "workspace_roles_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_roles_name" ON "workspace_roles" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_roles_default" ON "workspace_roles" USING btree ("workspace_id") WHERE "workspace_roles"."is_default";--> statement-breakpoint
CREATE INDEX "workspace_roles_order" ON "workspace_roles" USING btree ("workspace_id","position");--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
-- `on delete restrict`: deleting a role moves its holders and open invitations first, in the same transaction (AC-1238).
ALTER TABLE "members" ADD CONSTRAINT "members_custom_role_fk" FOREIGN KEY ("workspace_id","custom_role_id") REFERENCES "public"."workspace_roles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_custom_role_fk" FOREIGN KEY ("workspace_id","custom_role_id") REFERENCES "public"."workspace_roles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_custom_role" CHECK ("members"."custom_role_id" is null or "members"."role" = 'member');--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_custom_role" CHECK ("invitations"."custom_role_id" is null or "invitations"."role" = 'member');--> statement-breakpoint
CREATE INDEX "members_custom_role" ON "members" USING btree ("workspace_id","custom_role_id") WHERE "members"."custom_role_id" is not null;--> statement-breakpoint
CREATE INDEX "invitations_custom_role" ON "invitations" USING btree ("workspace_id","custom_role_id") WHERE "invitations"."custom_role_id" is not null;--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table workspace_roles enable row level security;
--> statement-breakpoint
alter table workspace_roles force row level security;
--> statement-breakpoint
create policy workspace_roles_tenant on workspace_roles
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
