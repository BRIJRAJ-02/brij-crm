-- Lists and pipelines (spec 0048, milestone 1). A list gains its look (`icon`, `hue`, the same names and hue tokens
-- objects use) and the view everyone lands on (`default_view_id`, as objects have since 0035). A list's name is
-- unique in its workspace ignoring case, archived lists included (`lists_name`, AC-4803): before the index, any
-- duplicate (only seed scripts made lists until now) is renamed with " 2", " 3" and a notice says so, so a deploy
-- never stops on it. The list page's default sort (Added, newest first) and its cursor read `list_entries_created`,
-- as `records_created` serves an object. Every existing list gains the read only fields "Added" and "Added by"
-- (the entry's own `created_at` and `created_by`), and a default table view "All entries" sorted by Added.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "icon" text DEFAULT 'list' NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "hue" text DEFAULT 'gray' NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "default_view_id" uuid;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_hue" CHECK ("lists"."hue" in ('gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple'));--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_default_view" FOREIGN KEY ("workspace_id","default_view_id") REFERENCES "public"."views"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
do $rename$
declare
  clash record;
  n integer;
  candidate text;
begin
  for clash in
    select l.workspace_id, l.id, l.name,
      row_number() over (partition by l.workspace_id, lower(l.name) order by l.id) as nth
    from lists l
  loop
    continue when clash.nth = 1;
    n := clash.nth;
    loop
      candidate := left(clash.name, 96) || ' ' || n::text;
      exit when not exists (
        select 1 from lists o where o.workspace_id = clash.workspace_id and lower(o.name) = lower(candidate)
      );
      n := n + 1;
    end loop;
    update lists set name = candidate where workspace_id = clash.workspace_id and id = clash.id;
    raise notice 'lists_name: renamed list % in workspace % from "%" to "%"', clash.id, clash.workspace_id, clash.name, candidate;
  end loop;
end
$rename$;
--> statement-breakpoint
CREATE UNIQUE INDEX "lists_name" ON "lists" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "list_entries_created" ON "list_entries" USING btree ("workspace_id","list_id","created_at","id") WHERE "list_entries"."deleted_at" is null;--> statement-breakpoint
insert into attributes (workspace_id, list_id, api_slug, title, type, is_system, system_column, position, created_by_type, updated_by_type)
select l.workspace_id, l.id, s.api_slug, s.title, s.type::attribute_type, true, s.system_column::system_column,
  coalesce((select max(a.position) + 1 from attributes a where a.workspace_id = l.workspace_id and a.list_id = l.id), 0) + s.nth,
  'system', 'system'
from lists l
cross join (values
  ('added', 'Added', 'timestamp', 'created_at', 0),
  ('added_by', 'Added by', 'actor_reference', 'created_by', 1)
) as s(api_slug, title, type, system_column, nth)
where not exists (
  select 1 from attributes a
  where a.workspace_id = l.workspace_id and a.list_id = l.id and a.system_column = s.system_column::system_column
)
  and not exists (
    select 1 from attributes a where a.workspace_id = l.workspace_id and a.list_id = l.id and a.api_slug = s.api_slug
  );
--> statement-breakpoint
insert into views (workspace_id, list_id, name, visibility, position, config, created_by_type, updated_by_type)
select l.workspace_id, l.id, 'All entries', 'workspace',
  coalesce((select max(v.position) + 1 from views v where v.workspace_id = l.workspace_id and v.list_id = l.id and v.visibility = 'workspace'), 0),
  jsonb_build_object(
    'columns', '[]'::jsonb,
    'showNewAttributes', true,
    'pinnedCount', 1,
    'sorts', coalesce(
      (select jsonb_build_array(jsonb_build_object('attributeId', a.id, 'direction', 'descending'))
       from attributes a
       where a.workspace_id = l.workspace_id and a.list_id = l.id and a.system_column = 'created_at'
       limit 1),
      '[]'::jsonb
    )
  ),
  'system', 'system'
from lists l
where l.default_view_id is null
  and not exists (
    select 1 from views v
    where v.workspace_id = l.workspace_id and v.list_id = l.id and v.visibility = 'workspace' and lower(v.name) = 'all entries'
  );
--> statement-breakpoint
update lists l set default_view_id = v.id
from views v
where v.workspace_id = l.workspace_id and v.list_id = l.id and v.creator_member_id is null and v.name = 'All entries'
  and l.default_view_id is null;
