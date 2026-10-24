-- Social links for booking hosts (owner ask, 25 Oct 2026): a person adds their LinkedIn, X, website and the rest
-- once, and visitors see the marks on their booking pages and their `/<handle>` profile.
--
-- The links are the person's, not a member's, like their handle, bio and photo: one set covers every personal booking
-- page they own, in every workspace, and leaving a workspace never takes them along. So they live in schema auth, in
-- a small table of their own rather than a column: the database then holds the rules itself, one link per network
-- per person (the primary key), at most ten (position 0 to 9), the network set, and an http or https link of at most
-- 2,048 characters (checks), with no JSON shape to check in SQL. Deleting the account deletes them (the cascade). The
-- default privileges give the table to crm_identity alone, as 0016 set them; crm_app gets no grant on it.
--
-- crm_handle (0086's role for a person's public facts) is the only way there from the app, inside the workspace
-- transaction, so a change commits with its audit row:
-- * crm_save_social_links(user, networks, hrefs) replaces the person's set with the one given, in order: rows that
--   changed are deleted and the new ones inserted; nothing is written when the set is the same;
-- * crm_social_links_of(users) answers the links of the people named, in each person's order (a booking page asks
--   it for its owner, the profile for the handle's person).
-- crm_handle gains select, insert and delete on auth.social_links, nothing else. Any change to these roles or
-- functions goes through security-access-reviewer.
--
-- And `booking_pages.show_socials`: whether a personal page shows its owner's links under their name, on by default.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "auth"."social_links" (
	"user_id" uuid NOT NULL,
	"network" text NOT NULL,
	"href" text NOT NULL,
	"position" smallint NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_links_pkey" PRIMARY KEY("user_id","network"),
	CONSTRAINT "social_links_network" CHECK (network in ('linkedin', 'x', 'instagram', 'github', 'facebook', 'youtube', 'tiktok', 'threads', 'angellist', 'website')),
	CONSTRAINT "social_links_href" CHECK (char_length("auth"."social_links"."href") <= 2048 and "auth"."social_links"."href" ~ '^https?://'),
	CONSTRAINT "social_links_position" CHECK ("auth"."social_links"."position" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "show_socials" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "auth"."social_links" ADD CONSTRAINT "social_links_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
grant select, insert, delete on auth.social_links to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Replaces `owner`'s social links with `networks` and `hrefs`, paired in order, the first at position 0. A row that
-- is already as given stays as it is; the set the same, nothing is written. More than ten breaks the position check,
-- a network twice the primary key, and lists of different lengths a not null column.
create function crm_save_social_links(owner uuid, networks text[], hrefs text[])
  returns void
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  delete from auth.social_links s
  where s.user_id = crm_save_social_links.owner
    and not exists (
      select 1
      from unnest(crm_save_social_links.networks, crm_save_social_links.hrefs) with ordinality as t(network, href, n)
      where t.network = s.network and t.href = s.href and t.n - 1 = s.position
    );
  insert into auth.social_links (user_id, network, href, position)
  select crm_save_social_links.owner, t.network, t.href, (t.n - 1)::smallint
  from unnest(crm_save_social_links.networks, crm_save_social_links.hrefs) with ordinality as t(network, href, n)
  where not exists (
    select 1 from auth.social_links s
    where s.user_id = crm_save_social_links.owner and s.network = t.network
  );
end;
--> statement-breakpoint
-- The social links of the people named, each person's in their order. Their links only: no name, no email.
create function crm_social_links_of(owners uuid[])
  returns table (user_id uuid, network text, href text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select s.user_id, s.network, s.href
  from auth.social_links s
  where s.user_id = any (crm_social_links_of.owners)
  order by s.user_id, s.position;
end;
--> statement-breakpoint
revoke all on function crm_save_social_links(uuid, text[], text[]) from public;
--> statement-breakpoint
revoke all on function crm_social_links_of(uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_save_social_links(uuid, text[], text[]) to crm_app;
--> statement-breakpoint
grant execute on function crm_social_links_of(uuid[]) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless crm_handle is as narrow as it reads: owning its seven functions, each a definer executable
-- by crm_app alone, out of the identity login's reach; a plain role in no role, that nothing but the owner can
-- become, holding exactly 0094's privileges and the auth.social_links grants above. And crm_app holds nothing on
-- auth.social_links itself.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_save_public_profile(uuid, text, text)'::regprocedure,
    'public.crm_public_profiles_of(uuid[])'::regprocedure,
    'public.crm_handle_owner(text)'::regprocedure,
    'public.crm_save_picture_hidden(uuid, boolean)'::regprocedure,
    'public.crm_pictures_hidden(uuid[])'::regprocedure,
    'public.crm_save_social_links(uuid, text[], text[])'::regprocedure,
    'public.crm_social_links_of(uuid[])'::regprocedure
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
  if has_table_privilege('crm_app', 'auth.social_links', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_any_column_privilege('crm_app', 'auth.social_links', 'SELECT, INSERT, UPDATE, REFERENCES') then
    raise exception 'crm_app must hold nothing on auth.social_links';
  end if;
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
          ('auth', 'public_profiles', 'SELECT'), ('auth', 'public_profiles', 'INSERT'),
          ('auth', 'social_links', 'SELECT'), ('auth', 'social_links', 'INSERT'), ('auth', 'social_links', 'DELETE'))
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
