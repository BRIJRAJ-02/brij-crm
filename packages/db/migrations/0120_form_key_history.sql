-- Form address history (late trap #54, 29 Oct 2026): when a form's public address changes, the old `/f/<old>` and
-- every embed or link already pasted with it keep finding the form, the way a booking page's old slug does (0087).
--
-- `form_public_keys` holds every address a form holds or held: its current one and up to 5 old ones (the one left
-- longest ago goes first, and one left more than 180 days ago goes at the form's next change), so one form can't
-- hold many short addresses away from every other workspace. A standard tenant table, row level security forced, written only by the trigger
-- crm_form_public_keys_keep on `forms` (an invoker's function, so the writer's own row level security applies, with
-- an explicit workspace filter beside it): each new current address is added, and a deleted form takes its rows
-- with it by the foreign key's cascade. The trigger crm_form_public_keys_check refuses any row that isn't its form's
-- current address, and the app may update `updated_at` alone. `form_public_keys_key`, unique across every workspace,
-- is what keeps an address one form holds or held from any other form while it still finds the first; the same form
-- may take it back. Being an index, it holds against a concurrent change in another workspace too.
--
-- Reads come through crm_form_by_key (0040's, owned by crm_form_lookup, ids only), which now also answers by an old
-- address after the current ones: the public endpoints, and the settings check that an address is free, read it.
-- Replaced as crm_form_lookup, its owner, so its grants stay as 0040 left them. Postgres 17 compatible. Any change
-- to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "form_public_keys" (
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_public_keys_pkey" PRIMARY KEY("workspace_id","form_id","public_key")
);
--> statement-breakpoint
ALTER TABLE "form_public_keys" ADD CONSTRAINT "form_public_keys_form" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."forms"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_public_keys_key" ON "form_public_keys" USING btree ("public_key");
--> statement-breakpoint
alter table form_public_keys enable row level security;
--> statement-breakpoint
alter table form_public_keys force row level security;
--> statement-breakpoint
create policy form_public_keys_tenant on form_public_keys
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Only the trigger below writes rows, and only these: a row is its form's current address when it is added (so no
-- write can hold an address for a form that never had it), and after that only `updated_at` changes.
revoke update on form_public_keys from crm_app;
--> statement-breakpoint
grant update (updated_at) on form_public_keys to crm_app;
--> statement-breakpoint
create function crm_form_public_keys_check()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  if not exists (
    select 1 from public.forms f
    where f.workspace_id = new.workspace_id and f.id = new.form_id and f.public_key = new.public_key
  ) then
    raise exception using errcode = '23514', constraint = 'form_public_keys_current',
      message = 'A form''s address history takes only the form''s current address.';
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_form_public_keys_check() from public;
--> statement-breakpoint
create trigger form_public_keys_current
  before insert on form_public_keys
  for each row execute function crm_form_public_keys_check();
--> statement-breakpoint
-- Keeps a form's addresses: its current one is added (or touched, when it takes back an old one), the one it leaves
-- is stamped with when, and past 5 old ones, or 180 days after one was left, the oldest go. An address another form holds or held fails on
-- form_public_keys_key (23505), which the service refuses as SLUG_TAKEN.
create function crm_form_public_keys_keep()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' then
    update public.form_public_keys k set updated_at = pg_catalog.now()
    where k.workspace_id = new.workspace_id and k.form_id = new.id and k.public_key = old.public_key;
  end if;
  insert into public.form_public_keys (workspace_id, form_id, public_key)
  values (new.workspace_id, new.id, new.public_key)
  on conflict (workspace_id, form_id, public_key) do update set updated_at = pg_catalog.now();
  delete from public.form_public_keys k
  where k.workspace_id = new.workspace_id and k.form_id = new.id and k.public_key <> new.public_key
    and (k.updated_at < pg_catalog.now() - interval '180 days'
      or k.public_key not in (
        select o.public_key from public.form_public_keys o
        where o.workspace_id = new.workspace_id and o.form_id = new.id and o.public_key <> new.public_key
        order by o.updated_at desc, o.public_key
        limit 5
      ));
  return null;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_form_public_keys_keep() from public;
--> statement-breakpoint
create trigger forms_public_keys_made
  after insert on forms
  for each row execute function crm_form_public_keys_keep();
--> statement-breakpoint
create trigger forms_public_keys_changed
  after update on forms
  for each row
  when (old.public_key is distinct from new.public_key)
  execute function crm_form_public_keys_keep();
--> statement-breakpoint
-- The backfill: each form's current address (unique by forms_public_key). Row security off: the owner bypasses it,
-- and a role it would filter fails here rather than backfilling nothing.
set local row_security = off;
--> statement-breakpoint
insert into form_public_keys (workspace_id, form_id, public_key)
select f.workspace_id, f.id, f.public_key from forms f;
--> statement-breakpoint
grant select (workspace_id, form_id, public_key) on form_public_keys to crm_form_lookup;
--> statement-breakpoint
grant crm_form_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_form_lookup;
--> statement-breakpoint
set local role crm_form_lookup;
--> statement-breakpoint
-- The workspace and form a public address names, or no row: the form holding it now, else the form that held it.
-- Ids only, as before; the caller reads the rest inside withWorkspace() under row level security.
create or replace function crm_form_by_key(key text)
  returns table (workspace_id uuid, form_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select found.workspace_id, found.form_id
  from (
    select f.workspace_id, f.id as form_id, 0 as rank
    from public.forms f
    where f.public_key = crm_form_by_key.key
    union all
    select k.workspace_id, k.form_id, 1 as rank
    from public.form_public_keys k
    where k.public_key = crm_form_by_key.key
  ) found
  order by found.rank
  limit 1;
end;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_form_lookup;
--> statement-breakpoint
revoke crm_form_lookup from current_user;
--> statement-breakpoint
-- Refuse to finish unless the lookup is as narrow as it reads, as 0040 and 0087 check theirs: owned by
-- crm_form_lookup, a definer, executable by it and crm_app alone and out of the identity login's reach;
-- crm_form_lookup reading the history's three columns and nothing else; crm_app updating `updated_at` alone.
do $$
declare
  lookup constant regprocedure := 'public.crm_form_by_key(text)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = lookup) <> 'crm_form_lookup'
    or not (select p.prosecdef from pg_proc p where p.oid = lookup)
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = lookup and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_form_lookup'::regrole, 'crm_app'::regrole)
    )
    or not has_function_privilege('crm_app', lookup, 'EXECUTE')
    or has_function_privilege('crm_identity', lookup, 'EXECUTE') then
    raise exception 'crm_form_by_key must be owned by crm_form_lookup and executable by crm_app alone';
  end if;
  if has_table_privilege('crm_form_lookup', 'public.form_public_keys', 'INSERT, UPDATE, DELETE, TRUNCATE')
    or exists (
      select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where att.attrelid = 'public.form_public_keys'::regclass and a.grantee = 'crm_form_lookup'::regrole
        and (att.attname not in ('workspace_id', 'form_id', 'public_key') or a.privilege_type <> 'SELECT')
    ) then
    raise exception 'crm_form_lookup must only read form_public_keys''s three columns';
  end if;
  if has_table_privilege('crm_app', 'public.form_public_keys', 'UPDATE')
    or not has_column_privilege('crm_app', 'public.form_public_keys', 'updated_at', 'UPDATE')
    or exists (
      select 1 from pg_attribute att
      where att.attrelid = 'public.form_public_keys'::regclass and att.attnum > 0 and not att.attisdropped
        and att.attname <> 'updated_at' and has_column_privilege('crm_app', att.attrelid, att.attnum, 'UPDATE')
    ) then
    raise exception 'crm_app may update form_public_keys.updated_at alone';
  end if;
end
$$;
