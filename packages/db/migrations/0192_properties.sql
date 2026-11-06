-- Properties, slice 1 (spec 0065 H7, AC-6512 to AC-6515), invisible to everyone: `business_profiles` becomes
-- `properties`, gains an id and a position and loses the one per workspace rule, and everything a property owns names
-- it. Numbered 0192, after 0191 (business apps on by default).
--
-- What changes:
-- * `properties`: the old table renamed in place, so its row level security, grants and rows stay. New columns: `id`,
--   `position`, `currency` and `country` (copied from the workspace), and `logo_*` (none yet; none falls back to the
--   brand kit). `name` and `kind` may now be null: a property nobody has set up holds neither, which is what "this
--   workspace has no business yet" reads as from now on.
-- * Every workspace has exactly one property at position 0. A workspace without a profile gets one here, with no name,
--   and every new workspace gets one from a trigger, which also covers one made by the old code while this deploy
--   rolls out. `properties_first` holds it.
-- * `places`, `menus`, `service_categories`, `services`, `business_pages`, `business_photos` and `place_pages` gain
--   `property_id` (not null). `business_pages` is keyed per property.
-- * AC-6514: `menu_places` and `service_places` carry `property_id` too, with composite keys to both sides, so a row
--   that crosses properties cannot exist. A service's category and a place's page hold to their property the same way.
--
-- The foreign keys to `properties` are deferred, not cascading: a property with places can't be deleted (at commit),
-- and deleting a whole workspace still works, whichever order its cascades reach the two tables in.
--
-- While the deploy rolls out (migrate, then build, then promote) and after any rollback, the old code still runs:
-- * The view `business_profiles` keeps every old read and most old writes of the profile working, and answers no row
--   for a property nobody has set up, as the old table had no row. It runs with the reader's rights, so the table's
--   row level security holds.
-- * `crm_first_property_id()` is `property_id`'s default on these tables, so an old insert that doesn't name the column
--   lands on the workspace's first property.
-- * The old code's two `on conflict (workspace_id)` writes (saving Settings > Business, and the first write of a
--   business page: address, slug, draft, publish) and its first install's card are refused during that window, with
--   nothing written. Public reads are unaffected. Slice 2's migration drops the view and the defaults.
--
-- Locks: access exclusive on the hospitality tables above, none of them large, for as long as the transaction runs;
-- share row exclusive on `workspaces` for the trigger, which reads pass and writes wait for. No table is rewritten.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table business_profiles rename to properties;
--> statement-breakpoint
alter policy business_profiles_tenant on properties rename to properties_tenant;
--> statement-breakpoint
alter table properties rename constraint business_profiles_workspace to properties_workspace;
--> statement-breakpoint
alter table properties rename constraint business_profiles_name to properties_name;
--> statement-breakpoint
alter table properties rename constraint business_profiles_kind to properties_kind;
--> statement-breakpoint
alter table properties rename constraint business_profiles_description to properties_description;
--> statement-breakpoint
alter table properties rename constraint business_profiles_phone to properties_phone;
--> statement-breakpoint
alter table properties rename constraint business_profiles_email to properties_email;
--> statement-breakpoint
alter table properties rename constraint business_profiles_website to properties_website;
--> statement-breakpoint
alter table properties rename constraint business_profiles_links to properties_links;
--> statement-breakpoint
alter table properties rename constraint business_profiles_look to properties_look;
--> statement-breakpoint
alter table properties alter column name drop not null;
--> statement-breakpoint
alter table properties alter column kind drop not null;
--> statement-breakpoint
alter table properties
  add column id uuid,
  add column position smallint not null default 0,
  add column currency text,
  add column country text,
  add column logo_path text,
  add column logo_type text,
  add column logo_version text;
--> statement-breakpoint
-- Every step from here to `row_security = on` reads every workspace's rows, as the owner: a role row level security
-- would filter fails here rather than backfilling nothing, like 0172 and 0189.
set local row_security = off;
--> statement-breakpoint
update properties p
  set id = uuidv7(), currency = w.currency, country = w.country
  from workspaces w
  where w.id = p.workspace_id;
--> statement-breakpoint
alter table properties drop constraint business_profiles_pkey;
--> statement-breakpoint
alter table properties alter column id set not null;
--> statement-breakpoint
alter table properties alter column id set default uuidv7();
--> statement-breakpoint
alter table properties add constraint properties_pkey primary key (workspace_id, id);
--> statement-breakpoint
-- Every workspace, deleted ones too, so that a restored workspace has one. No name: nobody has set it up.
insert into properties (workspace_id, id, currency, country)
  select w.id, uuidv7(), w.currency, w.country
  from workspaces w
  where not exists (select 1 from properties p where p.workspace_id = w.id);
--> statement-breakpoint
create unique index properties_first on properties using btree (workspace_id) where position = 0;
--> statement-breakpoint
create index properties_order on properties using btree (workspace_id, position);
--> statement-breakpoint
alter table properties add constraint properties_set_up check ((name is null) = (kind is null));
--> statement-breakpoint
alter table properties add constraint properties_position check (position between 0 and 19);
--> statement-breakpoint
alter table properties add constraint properties_currency check (currency is null or currency ~ '^[A-Z]{3}$');
--> statement-breakpoint
alter table properties add constraint properties_country check (country is null or country ~ '^[A-Z]{2}$');
--> statement-breakpoint
alter table properties add constraint properties_logo check (
  (logo_path is null and logo_type is null and logo_version is null)
  or (logo_path ~ ('^logos/' || workspace_id::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
    and logo_type in ('image/png', 'image/jpeg', 'image/webp')
    and logo_version ~ '^[0-9a-f]{12}$')
);
--> statement-breakpoint
alter table places add column property_id uuid;
--> statement-breakpoint
alter table menus add column property_id uuid;
--> statement-breakpoint
alter table service_categories add column property_id uuid;
--> statement-breakpoint
alter table services add column property_id uuid;
--> statement-breakpoint
alter table business_pages add column property_id uuid;
--> statement-breakpoint
alter table business_photos add column property_id uuid;
--> statement-breakpoint
alter table place_pages add column property_id uuid;
--> statement-breakpoint
alter table menu_places add column property_id uuid;
--> statement-breakpoint
alter table service_places add column property_id uuid;
--> statement-breakpoint
update places t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update menus t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update service_categories t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update services t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update business_pages t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update business_photos t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update place_pages t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update menu_places t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update service_places t set property_id = p.id from properties p where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
set local row_security = on;
--> statement-breakpoint
alter table places alter column property_id set not null;
--> statement-breakpoint
alter table menus alter column property_id set not null;
--> statement-breakpoint
alter table service_categories alter column property_id set not null;
--> statement-breakpoint
alter table services alter column property_id set not null;
--> statement-breakpoint
alter table business_pages alter column property_id set not null;
--> statement-breakpoint
alter table business_photos alter column property_id set not null;
--> statement-breakpoint
alter table place_pages alter column property_id set not null;
--> statement-breakpoint
alter table menu_places alter column property_id set not null;
--> statement-breakpoint
alter table service_places alter column property_id set not null;
--> statement-breakpoint
-- What the composite keys below point at: a row and its property, together.
create unique index places_in_property on places using btree (workspace_id, id, property_id);
--> statement-breakpoint
create unique index menus_in_property on menus using btree (workspace_id, id, property_id);
--> statement-breakpoint
create unique index service_categories_in_property on service_categories using btree (workspace_id, id, property_id);
--> statement-breakpoint
create unique index services_in_property on services using btree (workspace_id, id, property_id);
--> statement-breakpoint
create index places_property on places using btree (workspace_id, property_id, position);
--> statement-breakpoint
create index menus_property on menus using btree (workspace_id, property_id, position);
--> statement-breakpoint
create index service_categories_property on service_categories using btree (workspace_id, property_id, position);
--> statement-breakpoint
create index services_property on services using btree (workspace_id, property_id, position);
--> statement-breakpoint
create index business_photos_property on business_photos using btree (workspace_id, property_id, created_at);
--> statement-breakpoint
create index place_pages_property on place_pages using btree (workspace_id, property_id);
--> statement-breakpoint
create index menu_places_property on menu_places using btree (workspace_id, property_id);
--> statement-breakpoint
create index service_places_property on service_places using btree (workspace_id, property_id);
--> statement-breakpoint
alter table places add constraint places_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table menus add constraint menus_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table service_categories add constraint service_categories_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table services add constraint services_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table business_pages add constraint business_pages_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table business_photos add constraint business_photos_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table business_pages drop constraint business_pages_pkey;
--> statement-breakpoint
alter table business_pages add constraint business_pages_pkey primary key (workspace_id, property_id);
--> statement-breakpoint
-- Deleting a category leaves its services with none, as before; only category_id is set null, never the property.
alter table services drop constraint services_category;
--> statement-breakpoint
alter table services add constraint services_category foreign key (workspace_id, category_id, property_id)
  references service_categories (workspace_id, id, property_id) on delete set null (category_id);
--> statement-breakpoint
alter table place_pages drop constraint place_pages_place;
--> statement-breakpoint
alter table place_pages add constraint place_pages_place foreign key (workspace_id, place_id, property_id)
  references places (workspace_id, id, property_id) on delete cascade;
--> statement-breakpoint
-- AC-6514: one property_id, held to both sides, so a menu or a service can only serve its own property's places.
alter table menu_places drop constraint menu_places_menu;
--> statement-breakpoint
alter table menu_places drop constraint menu_places_place;
--> statement-breakpoint
alter table menu_places add constraint menu_places_menu foreign key (workspace_id, menu_id, property_id)
  references menus (workspace_id, id, property_id) on delete cascade;
--> statement-breakpoint
alter table menu_places add constraint menu_places_place foreign key (workspace_id, place_id, property_id)
  references places (workspace_id, id, property_id) on delete cascade;
--> statement-breakpoint
alter table service_places drop constraint service_places_service;
--> statement-breakpoint
alter table service_places drop constraint service_places_place;
--> statement-breakpoint
alter table service_places add constraint service_places_service foreign key (workspace_id, service_id, property_id)
  references services (workspace_id, id, property_id) on delete cascade;
--> statement-breakpoint
alter table service_places add constraint service_places_place foreign key (workspace_id, place_id, property_id)
  references places (workspace_id, id, property_id) on delete cascade;
--> statement-breakpoint
-- The transaction's workspace's first property, or null with no workspace: for the old code's inserts while this
-- deploy rolls out, and gone with slice 2. The caller's rights, so row level security decides what it can see.
create function crm_first_property_id()
  returns uuid
  language sql
  stable
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.id from public.properties p
  where p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  order by p.position, p.id
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_first_property_id() from public;
--> statement-breakpoint
grant execute on function crm_first_property_id() to crm_app;
--> statement-breakpoint
alter table places alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table menus alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table service_categories alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table services alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table business_pages alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table business_photos alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table place_pages alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table menu_places alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table service_places alter column property_id set default crm_first_property_id();
--> statement-breakpoint
-- A new workspace's first property (AC-6512), in the transaction that makes it, under the caller's rights and its row
-- level security: the same `app.workspace_id` that let the workspace row in lets this one in.
create function crm_make_first_property()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.properties (workspace_id, currency, country) values (new.id, new.currency, new.country);
  return null;
end;
$$;
--> statement-breakpoint
revoke all on function crm_make_first_property() from public;
--> statement-breakpoint
create trigger workspaces_first_property after insert on workspaces
  for each row execute function crm_make_first_property();
--> statement-breakpoint
-- The old name, for the old code, while this deploy rolls out and after a rollback. Slice 2 drops it.
create view business_profiles with (security_invoker = true) as
  select workspace_id, name, kind, description, phone, email, website, links, look,
    created_at, created_by_member_id, updated_at, updated_by_member_id
  from properties
  where position = 0 and name is not null;
--> statement-breakpoint
revoke all on business_profiles from public, crm_app;
--> statement-breakpoint
grant select, insert, update on business_profiles to crm_app;
--> statement-breakpoint
-- Refuse to finish unless it all holds: exactly one first property for every workspace, every owned row on its
-- workspace's own, and the app reaching the table only under row level security.
set local row_security = off;
--> statement-breakpoint
do $$
begin
  if exists (
    select 1 from workspaces w
    where (select count(*) from properties p where p.workspace_id = w.id and p.position = 0) <> 1
  ) then
    raise exception '0192_properties: every workspace must have exactly one first property';
  end if;
  if (select count(*) from properties) <> (select count(*) from workspaces) then
    raise exception '0192_properties: one property per workspace in this slice';
  end if;
  if exists (
    select 1 from pg_class c
    where c.oid = 'public.properties'::regclass and not (c.relrowsecurity and c.relforcerowsecurity)
  ) or not exists (
    select 1 from pg_policy p where p.polrelid = 'public.properties'::regclass and p.polname = 'properties_tenant'
  ) or not has_table_privilege('crm_app', 'public.properties', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('crm_app', 'public.business_profiles', 'DELETE') then
    raise exception '0192_properties: properties keeps its row level security and its grants';
  end if;
end
$$;
--> statement-breakpoint
set local row_security = on;
