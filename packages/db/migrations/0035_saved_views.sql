-- Saved views (spec 0020, milestone 1): one `views` table holding each view's config as Zod checked JSON, and on
-- each object the view everyone lands on (`default_view_id`). The table, its checks, keys and indexes are
-- drizzle-kit's; the backfill and row level security are hand written at the end.
--
-- The foreign keys and the new objects column briefly lock objects, lists and members against writes (a nullable
-- column with no default: no rewrite). Give up after 5 seconds rather than queue behind traffic, like 0029 and 0033.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."view_kind" AS ENUM('table', 'board');--> statement-breakpoint
CREATE TYPE "public"."view_visibility" AS ENUM('private', 'workspace');--> statement-breakpoint
CREATE TABLE "views" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"object_id" uuid,
	"list_id" uuid,
	"parent_id" uuid GENERATED ALWAYS AS (coalesce(object_id, list_id)) STORED,
	"kind" "view_kind" DEFAULT 'table' NOT NULL,
	"name" text NOT NULL,
	"visibility" "view_visibility" NOT NULL,
	"creator_member_id" uuid,
	"position" integer NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"query_version" integer DEFAULT 1 NOT NULL,
	"query_saved_at" timestamp (6) with time zone,
	"query_saved_by_member_id" uuid,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_by_member_id" uuid,
	"locked_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "views_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "views_parent" CHECK (("views"."object_id" is null) <> ("views"."list_id" is null)),
	CONSTRAINT "views_name" CHECK (char_length("views"."name") between 1 and 100 and "views"."name" = btrim("views"."name")),
	CONSTRAINT "views_position" CHECK ("views"."position" >= 0),
	CONSTRAINT "views_private" CHECK ("views"."visibility" = 'workspace' or ("views"."creator_member_id" is not null and not "views"."is_locked")),
	CONSTRAINT "views_locked" CHECK ("views"."is_locked" = ("views"."locked_at" is not null) and ("views"."locked_by_member_id" is null or "views"."is_locked")),
	CONSTRAINT "views_config" CHECK (jsonb_typeof("views"."config") = 'object' and octet_length("views"."config"::text) <= 65536),
	CONSTRAINT "views_versions" CHECK ("views"."version" >= 1 and "views"."query_version" >= 1),
	CONSTRAINT "views_created_by_actor" CHECK (("views"."created_by_type" is null and "views"."created_by_id" is null and "views"."created_by_member_id" is null)
      or ("views"."created_by_type" = 'system' and "views"."created_by_id" is null and "views"."created_by_member_id" is null)
      or ("views"."created_by_type" = 'member' and "views"."created_by_id" is not null and "views"."created_by_member_id" = "views"."created_by_id")
      or ("views"."created_by_type" in ('api_key', 'automation') and "views"."created_by_id" is not null and "views"."created_by_member_id" is null)),
	CONSTRAINT "views_updated_by_actor" CHECK (("views"."updated_by_type" is null and "views"."updated_by_id" is null and "views"."updated_by_member_id" is null)
      or ("views"."updated_by_type" = 'system' and "views"."updated_by_id" is null and "views"."updated_by_member_id" is null)
      or ("views"."updated_by_type" = 'member' and "views"."updated_by_id" is not null and "views"."updated_by_member_id" = "views"."updated_by_id")
      or ("views"."updated_by_type" in ('api_key', 'automation') and "views"."updated_by_id" is not null and "views"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "default_view_id" uuid;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_list" FOREIGN KEY ("workspace_id","list_id") REFERENCES "public"."lists"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_creator" FOREIGN KEY ("workspace_id","creator_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_query_saved_by" FOREIGN KEY ("workspace_id","query_saved_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_locked_by" FOREIGN KEY ("workspace_id","locked_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "views_shared_name" ON "views" USING btree ("workspace_id","parent_id",lower("name")) WHERE "views"."visibility" = 'workspace';--> statement-breakpoint
CREATE UNIQUE INDEX "views_private_name" ON "views" USING btree ("workspace_id","parent_id","creator_member_id",lower("name")) WHERE "views"."visibility" = 'private';--> statement-breakpoint
CREATE INDEX "views_by_position" ON "views" USING btree ("workspace_id","parent_id","visibility","position");--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_default_view" FOREIGN KEY ("workspace_id","default_view_id") REFERENCES "public"."views"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Hand written from here.
-- The backfill (run as the owner, which bypasses row level security, across every workspace): each object, archived
-- ones too so a restore finds its view, gets its default view: "All <plural name>", shared, seeded by the system,
-- every non system attribute in attribute order then Created at (an empty column list that shows new attributes),
-- one pinned column, newest first. The same shape `seedDefaultView` writes for a new object.
insert into views (workspace_id, object_id, name, visibility, position, config, created_by_type, updated_by_type)
select o.workspace_id, o.id, btrim(left('All ' || o.plural_name, 100)), 'workspace', 0,
  jsonb_build_object(
    'columns', '[]'::jsonb,
    'showNewAttributes', true,
    'pinnedCount', 1,
    'sorts', coalesce(
      (select jsonb_build_array(jsonb_build_object('attributeId', a.id, 'direction', 'descending'))
       from attributes a
       where a.workspace_id = o.workspace_id and a.object_id = o.id and a.system_column = 'created_at'
       limit 1),
      '[]'::jsonb
    )
  ),
  'system', 'system'
from objects o
where o.default_view_id is null;
--> statement-breakpoint
update objects o set default_view_id = v.id
from views v
where v.workspace_id = o.workspace_id and v.object_id = o.id and v.creator_member_id is null and v.position = 0
  and o.default_view_id is null;
--> statement-breakpoint
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table views enable row level security;
--> statement-breakpoint
alter table views force row level security;
--> statement-breakpoint
create policy views_tenant on views
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
