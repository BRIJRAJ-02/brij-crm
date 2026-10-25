-- `crm_place_profile_page` (migration 0098) was the one place in 110 migrations that qualified uuidv7 with
-- pg_catalog. That built in arrived in Postgres 18, and the Timefix production database runs 17.11, so the insert
-- raised 42883 (undefined_function) and every attempt to create a Public booking page there answered 500. The
-- other 43 call sites write `uuidv7()` unqualified, which finds the hand made `public.uuidv7()` on 17 and the
-- built in on 18; this one bypassed both. The function pins `search_path = pg_catalog, pg_temp`, so an unqualified
-- name cannot reach schema public: it has to say `public.uuidv7()`.
--
-- So that the name means the same thing on both servers, this first makes sure `public.uuidv7()` exists. On 17 the
-- hand made one is already there and is left exactly as it is; on 18 a thin wrapper over the built in is created.
-- Only the owner may create in schema public, so nothing a tenant controls can shadow it.
do $$
begin
  if to_regprocedure('public.uuidv7()') is null then
    -- portable:ok — this is the one place allowed to name the built in, and only on a server that has it.
    execute 'create function public.uuidv7() returns uuid language sql volatile parallel safe as $f$select pg_catalog.uuidv7()$f$';
    execute 'comment on function public.uuidv7() is ''uuidv7 under one name on Postgres 17 and 18 (migration 0110).''';
  end if;
end
$$;
--> statement-breakpoint
revoke all on function public.uuidv7() from public;
--> statement-breakpoint
-- crm_handle too: `crm_place_profile_page` is a security definer it owns, so the id is made as crm_handle, not as
-- the login that called it.
grant execute on function public.uuidv7() to crm_app, crm_identity, crm_worker, crm_handle;
--> statement-breakpoint
-- Replaced, not dropped: `create or replace` keeps the grants 0098 wrote. The body is 0098's, with the one call
-- changed. `crm_handle` owns it, and the migrating role is a member with `inherit false`, so only becoming that
-- role may replace it: as the owner it is refused 42501, which is what CI caught.
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
-- As 0098 did when it made the function: crm_handle may create in schema public only while it is replacing its
-- own function, and the right is taken back below.
grant create on schema public to crm_handle;
--> statement-breakpoint
set role crm_handle;
--> statement-breakpoint
create or replace function crm_place_profile_page(owner uuid, workspace uuid, page uuid)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if workspace is null or page is null
    or exists (select 1 from auth.profile_items i where i.user_id = owner and i.page_id = page)
    or (select count(*) from auth.profile_items i where i.user_id = owner and i.archived_at is null) >= 60
    or (select count(*) from auth.profile_items i where i.user_id = owner) >= 200 then
    return;
  end if;
  insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id)
  values (public.uuidv7(), owner, 'page',
    (select coalesce(max(i.position) + 1, 0) from auth.profile_items i where i.user_id = owner and i.archived_at is null),
    '{}'::jsonb, workspace, page);
end;
$$;
--> statement-breakpoint
-- Still as crm_handle, which owns the function: only its owner may say who runs it.
revoke all on function crm_place_profile_page(uuid, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_place_profile_page(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
-- And the membership itself, as 0098 did: nobody may become crm_handle once the migration is over, which
-- `guards.test.ts` holds to by counting its members.
revoke crm_handle from current_user;
--> statement-breakpoint
-- The closing check: the name resolves on this server, and the function no longer names a schema that only one
-- Postgres version has.
do $$
begin
  if to_regprocedure('public.uuidv7()') is null then
    raise exception 'public.uuidv7() is missing, so crm_place_profile_page cannot make an id';
  end if;
  if pg_catalog.pg_get_functiondef('public.crm_place_profile_page(uuid, uuid, uuid)'::regprocedure)
       like '%pg_catalog.uuidv7%' then
    raise exception 'crm_place_profile_page still names pg_catalog.uuidv7, which Postgres 17 does not have';
  end if;
  perform public.uuidv7();
end
$$;
