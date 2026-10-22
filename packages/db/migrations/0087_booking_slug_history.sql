-- Slug history (22 Oct 2026, lane slug-history): when a Public page's slug changes, the old `/<handle>/<old-slug>`
-- keeps finding the page, and the public page moves the address in place to the current one, the way an old handle
-- already does (0086).
--
-- `booking_page_slugs` holds every slug a page holds or held at its owner's address: its current one and up to 20
-- old ones (the one left longest ago goes first). A standard tenant table, row level security forced, written only
-- by the trigger crm_booking_page_slugs_keep on `booking_pages` (an invoker's function, so the writer's own row level
-- security applies, with an explicit workspace filter beside it): each new current slug is added, a page that is
-- deleted or changes hands loses every row (its old links then find nothing, and its slugs are free again), and a
-- purged page takes its rows with it by the foreign key's cascade. The trigger crm_booking_page_slugs_check refuses
-- any row that isn't its page's current slug under its owner, and the app may update `updated_at` alone.
-- `booking_page_slugs_owner_slug`, unique on (owner identity, slug) across every workspace, is what refuses a slug
-- one page of a person holds or held for any other page of theirs, while it still redirects; the same page may take
-- it back. Being an index, it holds against a concurrent rename in another workspace too, with no read across them.
--
-- Reads come through crm_booking_lookup (0041's), ids only: crm_booking_page_by_address now also answers by an old
-- slug (a current slug first), and crm_booking_owner_slugs also lists old slugs, so a new page's default slug is
-- one the person never used. Both are replaced as crm_booking_lookup, their owner, so their grants stay as 0086 left
-- them. Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "booking_page_slugs" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_page_slugs_pkey" PRIMARY KEY("workspace_id","page_id","slug"),
	CONSTRAINT "booking_page_slugs_slug_shape" CHECK ("booking_page_slugs"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("booking_page_slugs"."slug") <= 60)
);
--> statement-breakpoint
ALTER TABLE "booking_page_slugs" ADD CONSTRAINT "booking_page_slugs_page" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_page_slugs_owner_slug" ON "booking_page_slugs" USING btree ("owner_user_id","slug");
--> statement-breakpoint
alter table booking_page_slugs enable row level security;
--> statement-breakpoint
alter table booking_page_slugs force row level security;
--> statement-breakpoint
create policy booking_page_slugs_tenant on booking_page_slugs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Only the trigger below writes rows, and only these: a row is its page's current slug under its current owner when
-- it is added (so no write can hold a slug in a person's name for a page that isn't theirs), and after that only
-- `updated_at` changes. Deletes stay the app's: the trigger's, and the purge's own pass.
revoke update on booking_page_slugs from crm_app;
--> statement-breakpoint
grant update (updated_at) on booking_page_slugs to crm_app;
--> statement-breakpoint
create function crm_booking_page_slugs_check()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  if not exists (
    select 1 from public.booking_pages p
    where p.workspace_id = new.workspace_id and p.id = new.page_id and p.deleted_at is null
      and p.owner_user_id = new.owner_user_id and p.slug = new.slug
  ) then
    raise exception using errcode = '23514', constraint = 'booking_page_slugs_current',
      message = 'A page''s slug history takes only the page''s current slug, under its owner.';
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_booking_page_slugs_check() from public;
--> statement-breakpoint
create trigger booking_page_slugs_current
  before insert on booking_page_slugs
  for each row execute function crm_booking_page_slugs_check();
--> statement-breakpoint
-- Keeps a page's slugs: a page deleted or changing hands loses them all; else its current slug is added (or touched,
-- when it takes back an old one), the slug it leaves is stamped with when, and past 20 old ones the oldest go. A
-- slug another page of the owner's holds or held fails on booking_page_slugs_owner_slug (23505), which the service
-- refuses as SLUG_TAKEN. The explicit workspace filters keep workspaces apart even where a policy wouldn't.
create function crm_booking_page_slugs_keep()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.owner_user_id is distinct from new.owner_user_id or new.deleted_at is not null then
      delete from public.booking_page_slugs s where s.workspace_id = new.workspace_id and s.page_id = new.id;
    elsif old.slug <> new.slug then
      update public.booking_page_slugs s set updated_at = pg_catalog.now()
      where s.workspace_id = new.workspace_id and s.page_id = new.id and s.slug = old.slug;
    end if;
  end if;
  if new.deleted_at is not null or new.owner_user_id is null then
    return null;
  end if;
  insert into public.booking_page_slugs (workspace_id, page_id, owner_user_id, slug)
  values (new.workspace_id, new.id, new.owner_user_id, new.slug)
  on conflict (workspace_id, page_id, slug) do update set updated_at = pg_catalog.now();
  delete from public.booking_page_slugs s
  where s.workspace_id = new.workspace_id and s.page_id = new.id and s.slug <> new.slug
    and s.slug not in (
      select k.slug from public.booking_page_slugs k
      where k.workspace_id = new.workspace_id and k.page_id = new.id and k.slug <> new.slug
      order by k.updated_at desc, k.slug
      limit 20
    );
  return null;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_booking_page_slugs_keep() from public;
--> statement-breakpoint
create trigger booking_pages_slugs_made
  after insert on booking_pages
  for each row execute function crm_booking_page_slugs_keep();
--> statement-breakpoint
create trigger booking_pages_slugs_changed
  after update on booking_pages
  for each row
  when (old.slug is distinct from new.slug or old.owner_user_id is distinct from new.owner_user_id
    or old.deleted_at is distinct from new.deleted_at)
  execute function crm_booking_page_slugs_keep();
--> statement-breakpoint
-- The backfill: each live page's current slug, for an owner with an identity (unique by booking_pages_owner_slug).
-- Row security off: the owner bypasses it, and a role it would filter fails here rather than backfilling nothing.
set local row_security = off;
--> statement-breakpoint
insert into booking_page_slugs (workspace_id, page_id, owner_user_id, slug)
select p.workspace_id, p.id, p.owner_user_id, p.slug
from booking_pages p
where p.deleted_at is null and p.owner_user_id is not null;
--> statement-breakpoint
grant select (workspace_id, page_id, owner_user_id, slug) on booking_page_slugs to crm_booking_lookup;
--> statement-breakpoint
grant crm_booking_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_booking_lookup;
--> statement-breakpoint
set local role crm_booking_lookup;
--> statement-breakpoint
-- The workspace and page `/<handle>/<slug>` names (by the handle's person), or no row: the page holding that slug
-- now, else the page that held it (the public page then moves to its current address). Ids only. Only a page whose
-- owner is still an active member there, with this very identity, in a workspace that exists; never a Link only page.
create or replace function crm_booking_page_by_address(owner uuid, wanted text)
  returns table (workspace_id uuid, page_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id
  from (
    select c.workspace_id, c.id as page_id, 0 as rank
    from public.booking_pages c
    where c.owner_user_id = crm_booking_page_by_address.owner
      and c.slug = crm_booking_page_by_address.wanted
      and c.deleted_at is null
    union all
    select s.workspace_id, s.page_id, 1 as rank
    from public.booking_page_slugs s
    where s.owner_user_id = crm_booking_page_by_address.owner
      and s.slug = crm_booking_page_by_address.wanted
  ) f
  join public.booking_pages p on p.workspace_id = f.workspace_id and p.id = f.page_id
  join public.workspaces w on w.id = p.workspace_id
  join public.members m on m.workspace_id = p.workspace_id and m.id = p.owner_member_id
  where p.owner_user_id = crm_booking_page_by_address.owner
    and m.user_id = crm_booking_page_by_address.owner
    and m.status = 'active'
    and p.is_private = false
    and p.deleted_at is null
    and w.deleted_at is null
  order by f.rank
  limit 1;
end;
--> statement-breakpoint
-- The slugs a person's live pages hold, in any workspace that exists, and every slug their pages held before
-- (in any workspace: the unique index holds them all), that start with `prefix`: at most 1,000.
create or replace function crm_booking_owner_slugs(owner uuid, prefix text)
  returns table (slug text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.slug
  from public.booking_pages p
  join public.workspaces w on w.id = p.workspace_id
  where p.owner_user_id = crm_booking_owner_slugs.owner
    and w.deleted_at is null
    and p.deleted_at is null
    and pg_catalog.left(p.slug, pg_catalog.length(crm_booking_owner_slugs.prefix)) = crm_booking_owner_slugs.prefix
  union
  select s.slug
  from public.booking_page_slugs s
  where s.owner_user_id = crm_booking_owner_slugs.owner
    and pg_catalog.left(s.slug, pg_catalog.length(crm_booking_owner_slugs.prefix)) = crm_booking_owner_slugs.prefix
  limit 1000;
end;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_booking_lookup;
--> statement-breakpoint
revoke crm_booking_lookup from current_user;
--> statement-breakpoint
-- Refuse to finish unless both functions are still crm_booking_lookup's, executable by crm_app alone, and
-- crm_booking_lookup reaches booking_page_slugs only to read its four columns.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_booking_page_by_address(uuid, text)'::regprocedure,
    'public.crm_booking_owner_slugs(uuid, text)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_booking_lookup'
      or not (select p.prosecdef from pg_proc p where p.oid = fn)
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_booking_lookup'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_booking_lookup and executable by crm_app alone', fn;
    end if;
  end loop;
  if has_table_privilege('crm_booking_lookup', 'public.booking_page_slugs', 'INSERT, UPDATE, DELETE, TRUNCATE')
    or exists (
      select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where att.attrelid = 'public.booking_page_slugs'::regclass and a.grantee = 'crm_booking_lookup'::regrole
        and (att.attname not in ('workspace_id', 'page_id', 'owner_user_id', 'slug') or a.privilege_type <> 'SELECT')
    ) then
    raise exception 'crm_booking_lookup must only read booking_page_slugs''s four columns';
  end if;
  if has_table_privilege('crm_app', 'public.booking_page_slugs', 'UPDATE')
    or not has_column_privilege('crm_app', 'public.booking_page_slugs', 'updated_at', 'UPDATE')
    or exists (
      select 1 from pg_attribute att
      where att.attrelid = 'public.booking_page_slugs'::regclass and att.attnum > 0 and not att.attisdropped
        and att.attname <> 'updated_at' and has_column_privilege('crm_app', att.attrelid, att.attnum, 'UPDATE')
    ) then
    raise exception 'crm_app may update booking_page_slugs.updated_at alone';
  end if;
end
$$;
