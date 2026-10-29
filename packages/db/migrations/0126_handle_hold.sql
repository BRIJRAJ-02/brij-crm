-- A deleted account's handles are held, not freed (late trap #73, 29 Oct 2026). `auth.public_handles` cascaded from
-- `auth."user"`, so deleting an account freed every handle its person held at once, and the next person with the
-- same name was given it: old links, QR codes in wallet passes, saved contact cards, signatures and shared
-- `/<handle>/<slug>` booking links then opened a stranger's page, or booked a stranger. The schema already said
-- "none is freed while its person exists"; now none is freed for 90 days after, as GitHub and X hold a deleted
-- account's name.
--
-- * The row stays with `user_id` cleared and `released_at` stamped: the foreign key sets the person null (no name,
--   no picture, nothing of theirs is kept), and the trigger crm_public_handles_release stamps the time. A held handle
--   names nobody, so crm_handle_owner answers nothing for it, and crm_handle_taken still answers true, so neither a
--   claim (crm_save_public_profile) nor a suggestion (crm_ensure_public_profile) can take it, as both already refuse a
--   handle anyone holds.
-- * crm_sweep_released_handles(max) (crm_handle's definer, executable by crm_app, the daily cleanup's caller) deletes
--   held handles past 90 days, `max` at a time; they are free from then.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table "auth"."public_handles" alter column "user_id" drop not null;
--> statement-breakpoint
alter table "auth"."public_handles" add column "released_at" timestamp (6) with time zone;
--> statement-breakpoint
alter table "auth"."public_handles" add constraint "public_handles_released"
  check (("user_id" is null) = ("released_at" is not null));
--> statement-breakpoint
create index "public_handles_released" on "auth"."public_handles" using btree ("released_at")
  where "released_at" is not null;
--> statement-breakpoint
-- Stamps the time a handle's person went (the foreign key's action clears `user_id`). An invoker's trigger: it runs
-- as whoever's statement cleared it, the table's owner for the foreign key's action.
create function crm_public_handles_release()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.user_id is null and old.user_id is not null then
    new.released_at := pg_catalog.now();
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger crm_public_handles_release before update of user_id on "auth"."public_handles"
  for each row execute function crm_public_handles_release();
--> statement-breakpoint
revoke all on function crm_public_handles_release() from public;
--> statement-breakpoint
alter table "auth"."public_handles" drop constraint "public_handles_user_fk";
--> statement-breakpoint
alter table "auth"."public_handles" add constraint "public_handles_user_fk" foreign key ("user_id")
  references "auth"."user" ("id") on delete set null;
--> statement-breakpoint
-- The daily cleanup's sweep: handles held more than 90 days after their person's account went, at most `max`
-- (10,000 at most). Answers how many went. Safe for any caller: it only ever removes handles that name nobody.
create function crm_sweep_released_handles(max integer)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  gone integer;
begin
  -- Each workspace's cleanup calls it, at about the same time; a row another one deleted first is simply gone. No
  -- FOR UPDATE: it needs the update privilege, which crm_handle holds on no column of this table.
  delete from auth.public_handles h
  where h.user_id is null and h.released_at < pg_catalog.now() - interval '90 days'
    and h.handle in (
      select o.handle from auth.public_handles o
      where o.user_id is null and o.released_at < pg_catalog.now() - interval '90 days'
      order by o.released_at limit greatest(least(max, 10000), 0));
  get diagnostics gone = row_count;
  return gone;
end;
$$;
--> statement-breakpoint
revoke all on function crm_sweep_released_handles(integer) from public;
--> statement-breakpoint
grant execute on function crm_sweep_released_handles(integer) to crm_app;
--> statement-breakpoint
grant delete on auth.public_handles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
alter function crm_sweep_released_handles(integer) owner to crm_handle;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.proname = 'crm_sweep_released_handles'
      and (pg_catalog.pg_get_userbyid(p.proowner) <> 'crm_handle' or not p.prosecdef
        or not ('search_path=pg_catalog, pg_temp' = any (coalesce(p.proconfig, array[]::text[]))))
  ) then
    raise exception 'the handle sweep must be crm_handle''s definer with a fixed search_path';
  end if;
end
$$;
