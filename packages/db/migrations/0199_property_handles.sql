-- Properties, slice 3 (spec 0065 H7, AC-6592, AC-6593): each business has its own public page at its own handle, in
-- the one shared handle namespace. Numbered 0199, after 0198 (property menus).
--
-- What changes:
-- * `property_handles`: every business handle a workspace holds names the business (property) it belongs to, current
--   or old, so the public lookup finds the right business's page. `auth.public_handles` keeps saying only which
--   workspace holds a handle (crm_handle's definers read nothing else); this tenant table, under the plain workspace
--   policy, says which of its businesses. Every business handle held today is the first business's (backfilled), so
--   the first business keeps the workspace's handle and address. A removed business's rows go with it (cascade): its
--   old handles then find no page, and stay the workspace's, so they can't be anybody else's.
-- * `business_pages.pending_handle`: the address a business other than the first chose before its first Publish. It
--   is only a wish: nothing is held until Publish claims it (AC-6592), so a workspace can't reserve names by the dozen.
-- * `crm_claim_business_handle`: at most 5 new handles a day per workspace (BUSINESS_HANDLE_DAILY, P0001), counted
--   from the handles it made in the last 24 hours; a handle the workspace already holds or held is still its own
--   again, free. The workspace cap rises from 20 to 400 (20 businesses, each at most 20, the app counts per business).
-- * `auth.business_listings` is per business: `property_id`, keyed (workspace_id, property_id). `crm_list_business`
--   takes the business; with none it unlists the whole workspace (apps off, workspace deleted).
--
-- While the deploy rolls out and after a rollback, the old code's business page writes are already refused by 0197;
-- its Publish now also misses the old four argument `crm_list_business`. Public reads are unaffected: the old code
-- reads the first business's page, which these rows still name.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
create table property_handles (
  workspace_id uuid not null,
  handle text not null,
  property_id uuid not null,
  created_at timestamp (6) with time zone not null default now(),
  constraint property_handles_pkey primary key (workspace_id, handle),
  constraint property_handles_shape check (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(handle) between 3 and 40)
);
--> statement-breakpoint
alter table property_handles add constraint property_handles_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) on delete cascade;
--> statement-breakpoint
alter table property_handles add constraint property_handles_workspace foreign key (workspace_id)
  references workspaces (id) on delete cascade;
--> statement-breakpoint
create index property_handles_property on property_handles using btree (workspace_id, property_id, created_at);
--> statement-breakpoint
alter table property_handles enable row level security;
--> statement-breakpoint
alter table property_handles force row level security;
--> statement-breakpoint
create policy property_handles_tenant on property_handles
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
insert into property_handles (workspace_id, handle, property_id, created_at)
  select h.workspace_id, h.handle, p.id, h.created_at
  from auth.public_handles h
  join properties p on p.workspace_id = h.workspace_id and p.position = 0
  where h.owner_kind = 'business';
--> statement-breakpoint
alter table business_pages add column pending_handle text;
--> statement-breakpoint
alter table business_pages add constraint business_pages_pending_handle check (
  pending_handle is null or (pending_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(pending_handle) between 3 and 40)
);
--> statement-breakpoint
alter table auth.business_listings add column property_id uuid;
--> statement-breakpoint
update auth.business_listings l set property_id = p.id
  from properties p where p.workspace_id = l.workspace_id and p.position = 0;
--> statement-breakpoint
delete from auth.business_listings where property_id is null;
--> statement-breakpoint
alter table auth.business_listings alter column property_id set not null;
--> statement-breakpoint
alter table auth.business_listings drop constraint business_listings_pkey;
--> statement-breakpoint
alter table auth.business_listings add constraint business_listings_pkey primary key (workspace_id, property_id);
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Claims `wanted` for a business of `workspace`, which must be the transaction's own (`app.workspace_id`). A handle the
-- workspace already holds or held is its own again (which of its businesses may take it is the app's to say, from
-- `property_handles`); one anybody else holds raises 23505 on public_handles_pkey; a workspace makes at most 5 new
-- handles a day (BUSINESS_HANDLE_DAILY) and holds at most 400 (BUSINESS_HANDLE_LIMIT). The shape is checked here
-- too; reserved words are the app's to refuse, as for a person.
create or replace function crm_claim_business_handle(workspace uuid, wanted text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  holder_kind text;
  holder_workspace uuid;
begin
  if wanted is null or wanted !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(wanted) not between 3 and 40 then
    raise exception using errcode = '22023', message = 'BUSINESS_HANDLE_SHAPE';
  end if;
  if workspace is null
    or workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'BUSINESS_HANDLE_WORKSPACE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_business_handle:' || workspace::text, 0));
  select h.owner_kind, h.workspace_id into holder_kind, holder_workspace
  from auth.public_handles h where h.handle = wanted;
  if found then
    if holder_kind = 'business' and holder_workspace = workspace then
      return wanted;
    end if;
    raise exception using errcode = '23505', constraint = 'public_handles_pkey', message = 'PROFILE_HANDLE_TAKEN';
  end if;
  if (select pg_catalog.count(*) from auth.public_handles h
      where h.workspace_id = workspace and h.owner_kind = 'business'
        and h.created_at > pg_catalog.now() - interval '1 day') >= 5 then
    raise exception using errcode = 'P0001', message = 'BUSINESS_HANDLE_DAILY';
  end if;
  if (select pg_catalog.count(*) from auth.public_handles h
      where h.workspace_id = workspace and h.owner_kind = 'business') >= 400 then
    raise exception using errcode = 'P0001', message = 'BUSINESS_HANDLE_LIMIT';
  end if;
  insert into auth.public_handles (handle, user_id, workspace_id, owner_kind)
  values (wanted, null, workspace, 'business')
  on conflict (handle) do nothing;
  if not found then
    raise exception using errcode = '23505', constraint = 'public_handles_pkey', message = 'PROFILE_HANDLE_TAKEN';
  end if;
  return wanted;
end;
$$;
--> statement-breakpoint
drop function crm_list_business(uuid, text, text[], boolean);
--> statement-breakpoint
-- Lists (`listed`) or unlists one business (`property`) of `workspace` for search engines: its current `handle` and
-- the slugs of the places that may be listed. Only the transaction's own workspace, and only a business handle it
-- holds; with no `property`, unlists every business of the workspace. Answers whether the business is listed after.
create function crm_list_business(workspace uuid, property uuid, wanted text, place_slugs text[], listed boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  if workspace is null
    or workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return false;
  end if;
  if property is null then
    delete from auth.business_listings l where l.workspace_id = workspace;
    return false;
  end if;
  if not coalesce(listed, false) or wanted is null then
    delete from auth.business_listings l where l.workspace_id = workspace and l.property_id = property;
    return false;
  end if;
  if not exists (select 1 from auth.public_handles h
      where h.handle = wanted and h.owner_kind = 'business' and h.workspace_id = workspace) then
    delete from auth.business_listings l where l.workspace_id = workspace and l.property_id = property;
    return false;
  end if;
  if place_slugs is null or pg_catalog.cardinality(place_slugs) > 20 or exists (
      select 1 from pg_catalog.unnest(place_slugs) s(slug)
      where s.slug is null or s.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(s.slug) > 60) then
    raise exception using errcode = '22023', message = 'BUSINESS_LISTING_PLACES';
  end if;
  -- A handle is listed once: another business of the workspace that listed it (it can't, the app keeps each
  -- business's handles its own) gives way.
  delete from auth.business_listings l
  where l.workspace_id = workspace and l.handle = wanted and l.property_id <> property;
  insert into auth.business_listings (workspace_id, property_id, handle, places, changed_at)
  values (workspace, property, wanted, place_slugs, pg_catalog.now())
  on conflict (workspace_id, property_id) do update
    set handle = excluded.handle, places = excluded.places, changed_at = excluded.changed_at;
  return true;
end;
$$;
--> statement-breakpoint
revoke all on function crm_claim_business_handle(uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_list_business(uuid, uuid, text, text[], boolean) from public;
--> statement-breakpoint
grant execute on function crm_claim_business_handle(uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_list_business(uuid, uuid, text, text[], boolean) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless it all holds: the two definers owned by crm_handle and executable by crm_app alone, the
-- listings out of the app's reach, the new table under forced row level security, and every business handle naming a
-- business.
set local row_security = off;
--> statement-breakpoint
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_claim_business_handle(uuid, text)'::regprocedure,
    'public.crm_list_business(uuid, uuid, text, text[], boolean)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = fn)
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE')
      or not has_function_privilege('crm_app', fn, 'EXECUTE') then
      raise exception '0199_property_handles: % must be owned by crm_handle and executable by crm_app alone', fn;
    end if;
  end loop;
  if has_table_privilege('crm_app', 'auth.business_listings', 'SELECT')
    or has_table_privilege('crm_app', 'auth.business_listings', 'INSERT') then
    raise exception '0199_property_handles: crm_app must reach auth.business_listings only through its definers';
  end if;
  if not exists (
    select 1 from pg_class c
    where c.oid = 'public.property_handles'::regclass and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception '0199_property_handles: property_handles must force row level security';
  end if;
  if exists (
    select 1 from auth.public_handles h
    where h.owner_kind = 'business'
      and not exists (select 1 from property_handles t where t.workspace_id = h.workspace_id and t.handle = h.handle)
  ) then
    raise exception '0199_property_handles: every business handle must name a business';
  end if;
end
$$;
--> statement-breakpoint
set local row_security = on;
