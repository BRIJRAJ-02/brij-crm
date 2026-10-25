-- The link page's look (spec 0054, AC-5401 to AC-5404): six names on the person's public profile row, and nothing
-- else. `theme` is a jsonb object of exactly six keys, every value a word from a closed set, so the column never
-- holds a colour, a size, a radius, a font stack or a duration. There is nothing to sanitise, nothing to inject
-- into CSS and nothing to review per person; the stylesheet turns each word into token variables and no CSS is ever
-- written at run time.
--
-- The check constraint is the second guard behind the `PageTheme` Zod schema, as crm_check_profile_item is behind
-- ProfileBlock: a caller that skipped the contract still stores only a look the page can draw.
--
-- crm_handle gains update (theme, updated_at) on auth.public_profiles, which it did not need before, and owns
-- crm_save_profile_theme. crm_handle_owner answers the theme beside the person it already answers, so the public
-- read costs no extra statement (AC-5404). Any change to these roles or functions goes through
-- security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "auth"."public_profiles" ADD COLUMN "theme" jsonb DEFAULT '{"ground":"plain","hue":"blue","mode":"light","shape":"soft","fill":"plain","font":"sans"}'::jsonb NOT NULL;
--> statement-breakpoint
-- Exactly the six keys, each one a word from its own set. Said here as well as in Zod, because this is the rule.
-- Exactly the six keys, every value a word from its own set.
--
-- Two things this cannot be written the obvious way. Postgres refuses a subquery in a check constraint, so "no key
-- but these six" is the six taken away leaving an empty object, not a count of keys. And a check whose expression
-- is NULL passes, so "all six present" needs `coalesce`, which in turn makes the whole expression false for a
-- person who has never picked a look: hence the `theme is null or (...)`, which is the common case, not an edge.
ALTER TABLE "auth"."public_profiles" ADD CONSTRAINT "public_profiles_theme" CHECK (
  "auth"."public_profiles"."theme" is null or (
    jsonb_typeof("auth"."public_profiles"."theme") = 'object'
    and "auth"."public_profiles"."theme" - 'ground' - 'hue' - 'mode' - 'shape' - 'fill' - 'font' = '{}'::jsonb
    and coalesce("auth"."public_profiles"."theme" ->> 'ground', '') in ('plain', 'paper', 'tint', 'ink')
    and coalesce("auth"."public_profiles"."theme" ->> 'hue', '') in
      ('gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple')
    and coalesce("auth"."public_profiles"."theme" ->> 'mode', '') in ('light', 'dark')
    and coalesce("auth"."public_profiles"."theme" ->> 'shape', '') in ('soft', 'pill', 'square')
    and coalesce("auth"."public_profiles"."theme" ->> 'fill', '') in ('plain', 'soft', 'outline', 'solid')
    and coalesce("auth"."public_profiles"."theme" ->> 'font', '') in ('sans', 'mono')
  )
);
--> statement-breakpoint
grant update (theme, updated_at) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Replaces one person's look, whole, and answers it back. Whole on purpose: a read never merges a partial theme
-- with a default, so what is stored is always exactly what the page draws. A person with no profile row has no
-- handle either, so there is nothing to theme and nothing is written.
create function crm_save_profile_theme(owner uuid, theme jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  kept jsonb;
begin
  update auth.public_profiles p
  set theme = crm_save_profile_theme.theme, updated_at = pg_catalog.now()
  where p.user_id = crm_save_profile_theme.owner
  returning p.theme into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
-- The editor reads the look with the profile it already reads, so Settings costs no extra statement either. The
-- return type gains a column, so this one is dropped and made again rather than replaced.
drop function crm_public_profiles_of(uuid[]);
--> statement-breakpoint
create function crm_public_profiles_of(owners uuid[])
  returns table (user_id uuid, handle text, bio text, theme jsonb)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id, p.handle, p.bio, p.theme
  from auth.public_profiles p
  where p.user_id = any (crm_public_profiles_of.owners);
end;
--> statement-breakpoint
revoke all on function crm_public_profiles_of(uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_public_profiles_of(uuid[]) to crm_app;
--> statement-breakpoint
-- The public read, now answering the look beside the person. One statement, as before.
create or replace function crm_handle_owner(wanted text)
  returns table (user_id uuid, handle text, bio text, name text, image text, theme jsonb)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.handle, p.bio, u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end,
    p.theme
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_save_profile_theme(uuid, jsonb) from public;
--> statement-breakpoint
grant execute on function crm_save_profile_theme(uuid, jsonb) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
      where p.oid = 'public.crm_save_profile_theme(uuid, jsonb)'::regprocedure)) <> 'crm_handle'
    or not (select p.prosecdef from pg_proc p
      where p.oid = 'public.crm_save_profile_theme(uuid, jsonb)'::regprocedure)
    or not has_function_privilege('crm_app', 'public.crm_save_profile_theme(uuid, jsonb)', 'EXECUTE')
    or has_function_privilege('crm_identity', 'public.crm_save_profile_theme(uuid, jsonb)', 'EXECUTE') then
    raise exception 'crm_save_profile_theme must be crm_handle''s own definer, executable by crm_app alone';
  end if;
  -- The app still reaches the profile row only through the definers.
  if has_any_column_privilege('crm_app', 'auth.public_profiles', 'SELECT, INSERT, UPDATE, REFERENCES') then
    raise exception 'crm_app must hold nothing on auth.public_profiles';
  end if;
end
$$;
