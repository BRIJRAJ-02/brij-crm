-- Hand written: the search function behind contains (spec 0004, stored sort keys, AC-24). Runs as the
-- owner role, which needs BYPASSRLS to create crm_search: Neon's owner has it, and the local and test
-- owners mirror Neon.
--
-- Row level security stops Postgres using the trigram index for LIKE, because LIKE isn't leakproof. So
-- one function reads `values` as crm_search, a role that bypasses row level security, and filters by the
-- session's workspace itself. It is the only security definer function and crm_search the only role
-- besides the owner that bypasses row level security; the guard tests list both. Any change here goes
-- through security-access-reviewer.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_search') then
    create role crm_search nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
-- Roles are shared by the whole cluster: one made earlier (by hand, or by a draft) gets exactly these attributes.
-- SUPERUSER, REPLICATION and CREATEDB need the same attribute to change, so the check at the end refuses them.
alter role crm_search nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_search;
--> statement-breakpoint
grant select on "values" to crm_search;
--> statement-breakpoint

-- Owner ids (never values) whose current text for one attribute contains `search_pattern`, in the
-- session's workspace, at most `search_limit` rows (clamped to 1 to 5,000). Fewer rows than the limit means
-- every match came back. An unset or empty workspace matches nothing. The match is the trigram index's own
-- expression and predicate, with LIKE's wildcards in the pattern escaped, so they match literally. Trashed
-- records' ids come back too: the caller's own liveness checks decide what shows. No DISTINCT, so a common
-- match stops at the limit instead of reading every row (an owner whose multi valued attribute matches on
-- several items comes back once per item; the caller drops the repeats).
--
-- A standard SQL body (begin atomic) is parsed once, here, and binds its table and functions by OID, so no
-- session setting (search_path, standard_conforming_strings) can change what it reads or how its literals
-- parse. Parameters are qualified with the function's name, so no column can shadow one.
create function crm_search_text(search_attribute uuid, search_pattern text, search_limit integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 5000
begin atomic
  select v.owner_id
  from public."values" v
  where v.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and v.attribute_id = crm_search_text.search_attribute
    and v.active_until is null
    and not v.is_cleared
    and v.text_value is not null
    and lower(left(v.text_value, 2048)) like
      '%' || replace(replace(replace(lower(crm_search_text.search_pattern), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  limit least(greatest(crm_search_text.search_limit, 1), 5000);
end;
--> statement-breakpoint
revoke all on function crm_search_text(uuid, text, integer) from public;
--> statement-breakpoint
grant execute on function crm_search_text(uuid, text, integer) to crm_app;
--> statement-breakpoint

-- Hand the function to crm_search. Postgres 16 and later don't give the creator SET on a role it creates,
-- and a new owner needs CREATE on the schema, so both are granted for the change, then taken back.
grant crm_search to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_search;
--> statement-breakpoint
alter function crm_search_text(uuid, text, integer) owner to crm_search;
--> statement-breakpoint
revoke create on schema public from crm_search;
--> statement-breakpoint
revoke crm_search from current_user;
--> statement-breakpoint

-- Refuse to finish if anything but the database owner can reach crm_search, or if the app can.
do $$
begin
  if exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_search'::regrole
      and m.member <> (select datdba from pg_database where datname = current_database())
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_search'::regrole and (m.set_option or m.inherit_option)
  ) or pg_has_role('crm_app', 'crm_search', 'USAGE') or pg_has_role('crm_app', 'crm_search', 'SET')
    or exists (select 1 from pg_roles where rolname = 'crm_search' and (rolsuper or rolreplication or rolcreatedb)) then
    raise exception 'crm_search must be a plain role with no member but the database owner, with ADMIN only';
  end if;
end
$$;
