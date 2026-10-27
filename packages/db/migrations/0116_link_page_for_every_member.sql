-- A link page for every membership, made for them (26 Oct 2026, the owner: "we need to create link page
-- automatically as soon as someone signs up"). Spec 0056 made a handle belong to a membership and left a person to
-- claim one; now each membership gets its handle and an empty link page the moment it exists, with no claim step,
-- and Settings › Profile still changes it.
--
-- What changes:
-- * `crm_ensure_public_profile(owner, workspace, base)`, a crm_handle definer executable by crm_app: answers the
--   handle the membership already holds, or claims the first free one of `base`, `base-2` … `base-30`, then
--   `base-` and four random digits (30 tries), and makes the empty page behind it, hidden from search engines until
--   its owner says otherwise (an address nobody chose shouldn't be found by searching their name). It answers NULL,
--   writing nothing, for someone who isn't an active member of the workspace, who already holds 20 handles, or when
--   every try was taken: a membership is never refused because of its link page. `base` must already be a handle's
--   shape (the caller makes it, `handleBaseFor` in @crm/contracts, which also keeps reserved words out); anything
--   else is 22023 PROFILE_HANDLE_BASE. It answers NULL too unless `workspace` is the transaction's own
--   (`app.workspace_id`, as withWorkspace() sets it), so code running in one workspace can never make a page in
--   another. One person's claims queue on the advisory lock `crm_save_public_profile` takes, so the two never race.
-- * No backfill here (27 Oct 2026, the security review): pages made in this migration would be served by the code
--   still running until this deploy replaces it, which shows every page, private or not, and the edge would keep
--   what it fetched. The daily cleanup's `link_pages` phase makes the missing ones once the gate is live.
-- * Private until its owner acts (the owner, 27 Oct 2026: "private until edited or shared"). A page made for someone
--   who never asked for one must not publish their name and Google photo at an address made from their name.
--   `auth.public_profiles.shown_at` is when the page first went public, null while it hasn't. Every page that exists
--   before this migration was claimed by its person and is already public, so each gets `shown_at` now; pages
--   `crm_ensure_public_profile` makes start with none. `crm_handle_owner` and `crm_public_profiles_of`
--   answer `shown` (the readers decide what a private page answers: its link page and its extras nothing, its
--   booking pages exactly as before, since those the person made themself), and `crm_show_public_profile(owner,
--   workspace)`, a crm_handle definer for crm_app, sets `shown_at` once, for an active member's own page in the
--   transaction's own workspace only. The app calls it when the owner edits their page or shares its link.
-- Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table auth.public_profiles add column if not exists shown_at timestamptz;
--> statement-breakpoint
-- Every page before this one was claimed by its own person: public already, and staying so.
update auth.public_profiles set shown_at = pg_catalog.now() where shown_at is null;
--> statement-breakpoint
-- Only `crm_show_public_profile` writes it, and only from null to now: crm_handle gets the one column, like 0108's.
grant update (shown_at) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
create function crm_ensure_public_profile(owner uuid, workspace uuid, base text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  held text;
  suffix text;
  candidate text;
  try integer;
  made integer;
begin
  if base is null or base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(base) not between 3 and 40 then
    raise exception using errcode = '22023', message = 'PROFILE_HANDLE_BASE';
  end if;
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    return null;
  end if;
  select p.handle into held from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace;
  if held is not null then
    return held;
  end if;
  if (select pg_catalog.count(*) from auth.public_handles h where h.user_id = owner) >= 20 then
    return null;
  end if;
  for try in 1..60 loop
    suffix := case
      when try = 1 then ''
      when try <= 30 then '-' || try::text
      else '-' || (1000 + pg_catalog.floor(pg_catalog.random() * 9000))::integer::text
    end;
    candidate := pg_catalog.rtrim(pg_catalog.left(base, 40 - pg_catalog.char_length(suffix)), '-') || suffix;
    insert into auth.public_handles (handle, user_id, workspace_id) values (candidate, owner, workspace)
    on conflict (handle) do nothing;
    get diagnostics made = row_count;
    if made = 1 then
      -- Private (shown_at null) and unlisted until its owner edits it or shares its link.
      insert into auth.public_profiles (user_id, workspace_id, handle, indexable, shown_at)
      values (owner, workspace, candidate, false, null);
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;
--> statement-breakpoint
-- Whether the page is public now joins what each reader answers; their bodies are 0114's otherwise unchanged.
drop function crm_public_profiles_of(uuid[], uuid);
--> statement-breakpoint
drop function crm_handle_owner(text);
--> statement-breakpoint
-- The current handle, bio and look of each person named in ONE workspace, and whether their page is public yet, or
-- no row for one with no handle there or who is no longer an active member of it (their pages then fall back to
-- /b/<key>).
create function crm_public_profiles_of(owners uuid[], workspace uuid)
  returns table (user_id uuid, handle text, bio text, theme jsonb, indexable boolean, share_image_version text,
    shown boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id, p.handle, p.bio, p.theme, p.indexable, p.share_image_version, p.shown_at is not null
  from auth.public_profiles p
  where p.user_id = any (crm_public_profiles_of.owners)
    and p.workspace_id = crm_public_profiles_of.workspace
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- The membership a handle names, by its current or an old handle: the person and workspace, current handle, bio,
-- name, picture (unless hidden), look, whether search engines may list it and whether the page is public yet, never
-- an email. No row unless that person is still an active member of that workspace (AC-5603). A private page still
-- answers its row: the handle names the person's booking pages too, and those stay up; the reader that draws the
-- link page itself is what answers nothing for a page that isn't shown.
create function crm_handle_owner(wanted text)
  returns table (user_id uuid, workspace_id uuid, handle text, bio text, name text, image text, theme jsonb,
    indexable boolean, share_image_version text, shown boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.workspace_id, p.handle, p.bio, u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end,
    p.theme, p.indexable, p.share_image_version, p.shown_at is not null
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id and p.workspace_id = h.workspace_id
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted
    and public.crm_workspace_member(h.user_id, h.workspace_id)
  limit 1;
end;
--> statement-breakpoint
-- Makes `owner`'s page in `workspace` public, once: the first time they edit it or share its link. True when it is
-- public after the call (now or already), false when there is no page to show, they aren't an active member there,
-- or `workspace` isn't the transaction's own (`app.workspace_id`), so code in one workspace can never publish a page
-- in another. Never makes a page private again: nothing here unpublishes.
create function crm_show_public_profile(owner uuid, workspace uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  found_it boolean;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return false;
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  update auth.public_profiles p set shown_at = pg_catalog.now()
  where p.user_id = owner and p.workspace_id = workspace and p.shown_at is null;
  select true into found_it from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace;
  return coalesce(found_it, false);
end;
$$;
--> statement-breakpoint
revoke all on function crm_public_profiles_of(uuid[], uuid) from public;
--> statement-breakpoint
grant execute on function crm_public_profiles_of(uuid[], uuid) to crm_app;
--> statement-breakpoint
revoke all on function crm_handle_owner(text) from public;
--> statement-breakpoint
grant execute on function crm_handle_owner(text) to crm_app;
--> statement-breakpoint
revoke all on function crm_show_public_profile(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_show_public_profile(uuid, uuid) to crm_app;
--> statement-breakpoint
revoke all on function crm_ensure_public_profile(uuid, uuid, text) from public;
--> statement-breakpoint
grant execute on function crm_ensure_public_profile(uuid, uuid, text) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
declare
  one text;
begin
  foreach one in array array[
    'public.crm_public_profiles_of(uuid[], uuid)',
    'public.crm_handle_owner(text)',
    'public.crm_show_public_profile(uuid, uuid)',
    'public.crm_ensure_public_profile(uuid, uuid, text)'
  ] loop
    if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p where p.oid = one::regprocedure)) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = one::regprocedure)
      or not has_function_privilege('crm_app', one, 'EXECUTE')
      or has_function_privilege('crm_identity', one, 'EXECUTE')
      or has_function_privilege('public', one, 'EXECUTE') then
      raise exception '0116_link_page_for_every_member: % is not crm_handle''s definer for crm_app alone', one;
    end if;
  end loop;
end
$$;
