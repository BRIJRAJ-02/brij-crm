-- Hide my photo on booking pages (owner ask A124, 23 Oct 2026): a person may keep their account picture off their
-- public pages. Booking pages, team or personal, and the `/<handle>` profile then show initials, and the picture
-- routes answer exactly as for a person with no picture. Off by default: the picture shows.
--
-- The choice is the person's, not a member's: the picture is the account's (`auth.user.image`), one per person, and
-- the profile spans every workspace, so it lives with their other preferences that follow them everywhere,
-- `auth.user_prefs` (no row reads as shown). Not `auth.public_profiles`: its rows need a handle, and a person with
-- none still has `/b/<key>` pages.
--
-- crm_handle (0086's role for a person's public facts) is the only way there from the app, inside the workspace
-- transaction, so the change commits with its audit row:
-- * crm_save_picture_hidden(user, hidden) keeps the picture off, or shows it again (nothing written when already so);
-- * crm_pictures_hidden(users) answers which of the people named keep it off (a booking page asks it for its owner
--   before any read of the picture);
-- * crm_handle_owner(handle) answers no picture for one who keeps it off, so the profile and its picture route never
--   see it. Replaced as crm_handle, its owner, so its grants stay as 0086 left them.
-- crm_handle gains only these columns of auth.user_prefs: user_id and picture_hidden to read and insert,
-- picture_hidden and updated_at to update; never last_workspace_id. Any change to these roles or functions goes
-- through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "auth"."user_prefs" ADD COLUMN "picture_hidden" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
grant select (user_id, picture_hidden), insert (user_id, picture_hidden), update (picture_hidden, updated_at)
  on auth.user_prefs to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Keeps `owner`'s account picture off their public pages (`hidden`), or shows it again. No change, no write.
create function crm_save_picture_hidden(owner uuid, hidden boolean)
  returns void
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  insert into auth.user_prefs as p (user_id, picture_hidden)
  values (crm_save_picture_hidden.owner, crm_save_picture_hidden.hidden)
  on conflict (user_id) do update set picture_hidden = excluded.picture_hidden, updated_at = pg_catalog.now()
  where p.picture_hidden is distinct from excluded.picture_hidden;
end;
--> statement-breakpoint
-- Of the people named, those who keep their account picture off their public pages. Ids only.
create function crm_pictures_hidden(owners uuid[])
  returns table (user_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id
  from auth.user_prefs p
  where p.user_id = any (crm_pictures_hidden.owners) and p.picture_hidden;
end;
--> statement-breakpoint
-- The person a handle names, by their current or an old one: their id, current handle, bio, name and picture; no
-- picture when they keep it off their public pages.
create or replace function crm_handle_owner(wanted text)
  returns table (user_id uuid, handle text, bio text, name text, image text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.handle, p.bio, u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_save_picture_hidden(uuid, boolean) from public;
--> statement-breakpoint
revoke all on function crm_pictures_hidden(uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_save_picture_hidden(uuid, boolean) to crm_app;
--> statement-breakpoint
grant execute on function crm_pictures_hidden(uuid[]) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless crm_handle is as narrow as it reads: owning its five functions, each a definer executable
-- by crm_app alone, out of the identity login's reach; a plain role in no role, that nothing but the owner can
-- become, holding exactly 0086's privileges and the auth.user_prefs columns granted above.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_save_public_profile(uuid, text, text)'::regprocedure,
    'public.crm_public_profiles_of(uuid[])'::regprocedure,
    'public.crm_handle_owner(text)'::regprocedure,
    'public.crm_save_picture_hidden(uuid, boolean)'::regprocedure,
    'public.crm_pictures_hidden(uuid[])'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = fn)
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_handle and executable by crm_app alone', fn;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'crm_handle' and (rolcanlogin or rolsuper or rolbypassrls))
    or exists (select 1 from pg_auth_members m where m.member = 'crm_handle'::regrole)
    or exists (
      select 1 from pg_auth_members m
      where m.roleid = 'crm_handle'::regrole and (m.set_option or m.inherit_option)
        and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
    )
    or pg_has_role('crm_app', 'crm_handle', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_handle', 'MEMBER')
    or exists (
      select 1 from information_schema.role_table_grants g
      where g.grantee = 'crm_handle'
        and (g.table_schema, g.table_name, g.privilege_type) not in (
          ('auth', 'public_handles', 'SELECT'), ('auth', 'public_handles', 'INSERT'),
          ('auth', 'public_profiles', 'SELECT'), ('auth', 'public_profiles', 'INSERT'))
    )
    or exists (
      select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_handle'::regrole
        and (att.attrelid, att.attname, a.privilege_type) not in (
          ('auth.public_profiles'::regclass, 'handle', 'UPDATE'),
          ('auth.public_profiles'::regclass, 'bio', 'UPDATE'),
          ('auth.public_profiles'::regclass, 'updated_at', 'UPDATE'),
          ('auth."user"'::regclass, 'id', 'SELECT'),
          ('auth."user"'::regclass, 'name', 'SELECT'),
          ('auth."user"'::regclass, 'image', 'SELECT'),
          ('auth.user_prefs'::regclass, 'user_id', 'SELECT'),
          ('auth.user_prefs'::regclass, 'user_id', 'INSERT'),
          ('auth.user_prefs'::regclass, 'picture_hidden', 'SELECT'),
          ('auth.user_prefs'::regclass, 'picture_hidden', 'INSERT'),
          ('auth.user_prefs'::regclass, 'picture_hidden', 'UPDATE'),
          ('auth.user_prefs'::regclass, 'updated_at', 'UPDATE'))
    ) then
    raise exception 'crm_handle must be a plain role, out of every login''s reach, holding only its functions'' grants';
  end if;
end
$$;
