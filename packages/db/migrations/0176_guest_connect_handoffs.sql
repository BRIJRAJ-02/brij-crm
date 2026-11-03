-- A guest calendar connect's hand off (4 Nov 2026). Google's callback is on the app's host, but a visitor on a
-- public host (timefix.com/<handle>/<slug>) has to get the guest cookie on that host. The callback exchanges the code
-- itself, seals the grant, and keeps it here for at most two minutes under the digest of a random id; the hop to the
-- public host carries only the id and a signed ticket, and the landing there takes the row, once.
--
-- Global, not tenant data: no workspace is known yet, so it sits in schema auth. Two ways in, hand written, owned by
-- crm_guest_handoff (a role that can't log in and holds only this table) and executable by crm_app alone:
-- crm_put_guest_handoff (drops the expired rows, then keeps one) and crm_take_guest_handoff (drops the expired rows,
-- then delete … returning, so a second landing finds nothing). Unlike every other auth table, no login holds a grant
-- here: the default privileges (migration 0016) that hand each new auth table to crm_identity are revoked, so only
-- crm_guest_handoff, through the two functions, touches it. Forced row level security with one policy, for
-- crm_guest_handoff only, is a second fence. Any change to the role or the functions goes through
-- security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
create table "auth"."guest_connect_handoffs" (
  "id_digest" text not null,
  "sealed" text not null,
  "max_age" integer not null,
  "expires_at" timestamp (6) with time zone not null,
  constraint "guest_connect_handoffs_pkey" primary key ("id_digest"),
  constraint "guest_connect_handoffs_digest" check ("id_digest" ~ '^[A-Za-z0-9_-]{43}$'),
  constraint "guest_connect_handoffs_sealed" check (char_length("sealed") between 1 and 4096),
  constraint "guest_connect_handoffs_max_age" check ("max_age" between 0 and 86400)
);
--> statement-breakpoint
create index "guest_connect_handoffs_expires" on "auth"."guest_connect_handoffs" using btree ("expires_at");
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_guest_handoff') then
    create role crm_guest_handoff nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_guest_handoff nologin nobypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema auth to crm_guest_handoff;
--> statement-breakpoint
-- Whatever the schema's default privileges gave (crm_identity's, from migration 0016), no login holds this table.
revoke all on "auth"."guest_connect_handoffs" from public, crm_identity, crm_app;
--> statement-breakpoint
grant select, insert, delete on "auth"."guest_connect_handoffs" to crm_guest_handoff;
--> statement-breakpoint
alter table "auth"."guest_connect_handoffs" enable row level security;
--> statement-breakpoint
alter table "auth"."guest_connect_handoffs" force row level security;
--> statement-breakpoint
create policy "guest_connect_handoffs_handoff" on "auth"."guest_connect_handoffs" to crm_guest_handoff
  using (true) with check (true);
--> statement-breakpoint
-- Keeps a sealed grant for `seconds` (at most two minutes), dropping every expired row first.
create function crm_put_guest_handoff(digest text, sealed text, max_age integer, seconds integer)
  returns void
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  delete from auth.guest_connect_handoffs h where h.expires_at <= pg_catalog.now();
  insert into auth.guest_connect_handoffs (id_digest, sealed, max_age, expires_at)
  values (
    crm_put_guest_handoff.digest,
    crm_put_guest_handoff.sealed,
    crm_put_guest_handoff.max_age,
    pg_catalog.now() + pg_catalog.make_interval(secs => least(greatest(crm_put_guest_handoff.seconds, 1), 120))
  );
end;
--> statement-breakpoint
-- Takes the hand off kept under `digest`, once, dropping every expired row first: the row goes whether it is still
-- fresh or not, and only a fresh one answers.
create function crm_take_guest_handoff(digest text)
  returns table (sealed text, max_age integer, fresh boolean)
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  delete from auth.guest_connect_handoffs h
  where h.expires_at <= pg_catalog.now() and h.id_digest <> crm_take_guest_handoff.digest;
  delete from auth.guest_connect_handoffs h
  where h.id_digest = crm_take_guest_handoff.digest
  returning h.sealed, h.max_age, h.expires_at > pg_catalog.now();
end;
--> statement-breakpoint
revoke all on function crm_put_guest_handoff(text, text, integer, integer) from public;
--> statement-breakpoint
revoke all on function crm_take_guest_handoff(text) from public;
--> statement-breakpoint
grant execute on function crm_put_guest_handoff(text, text, integer, integer) to crm_app;
--> statement-breakpoint
grant execute on function crm_take_guest_handoff(text) to crm_app;
--> statement-breakpoint
grant crm_guest_handoff to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_guest_handoff;
--> statement-breakpoint
alter function crm_put_guest_handoff(text, text, integer, integer) owner to crm_guest_handoff;
--> statement-breakpoint
alter function crm_take_guest_handoff(text) owner to crm_guest_handoff;
--> statement-breakpoint
revoke create on schema public from crm_guest_handoff;
--> statement-breakpoint
revoke crm_guest_handoff from current_user;
--> statement-breakpoint
-- Refuse to finish unless both are as narrow as they read: owned by crm_guest_handoff and executable by crm_app
-- alone, out of the identity login's reach; crm_guest_handoff a plain role in no role that nothing but the owner can
-- become, holding exactly the table grants above; and the table granted to no other role at all (its owner aside).
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_put_guest_handoff(text, text, integer, integer)'::regprocedure,
    'public.crm_take_guest_handoff(text)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_guest_handoff'
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_guest_handoff'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_guest_handoff and executable by crm_app alone', fn;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'crm_guest_handoff' and (rolcanlogin or rolsuper or rolbypassrls))
    or exists (select 1 from pg_auth_members m where m.member = 'crm_guest_handoff'::regrole)
    or exists (
      select 1 from pg_auth_members m
      where m.roleid = 'crm_guest_handoff'::regrole and (m.set_option or m.inherit_option)
        and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
    )
    or pg_has_role('crm_app', 'crm_guest_handoff', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_guest_handoff', 'MEMBER')
    or exists (
      select 1 from information_schema.role_table_grants g
      where g.grantee = 'crm_guest_handoff'
        and (g.table_schema, g.table_name, g.privilege_type) not in (
          ('auth', 'guest_connect_handoffs', 'SELECT'),
          ('auth', 'guest_connect_handoffs', 'INSERT'),
          ('auth', 'guest_connect_handoffs', 'DELETE'))
    )
    or exists (
      select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_guest_handoff'::regrole
    ) then
    raise exception 'crm_guest_handoff must be a plain role, out of every login''s reach, holding only the hand off''s grants';
  end if;
  if exists (
      select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid = 'auth.guest_connect_handoffs'::regclass
        and a.grantee not in ('crm_guest_handoff'::regrole, c.relowner)
    )
    or exists (
      select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where att.attrelid = 'auth.guest_connect_handoffs'::regclass
    ) then
    raise exception 'auth.guest_connect_handoffs must be granted to crm_guest_handoff alone';
  end if;
end
$$;
