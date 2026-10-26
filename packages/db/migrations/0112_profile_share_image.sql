-- A link page's own share image (spec 0055, AC-5511): the picture a pasted link shows instead of the card we draw.
-- The owner took the call on 26 October 2026 that this does not wait for R2 (#32). One picture per page, at most
-- 500 kB, is a column, not a bucket: the card function already reads the profile, and the bytes are served from our
-- own origin on a versioned path behind a day of cache, exactly as an account picture is. Files proper (#32) is
-- record attachments, where the count and the sizes are unbounded; that is still a bucket's job.
--
-- Three columns, set together or all null. The app never reads or writes them itself: crm_save_profile_share_image
-- writes them and crm_profile_share_image reads them, both owned by crm_handle. The two profile readers gain only
-- the version, never the bytes, so a page read never drags half a megabyte it will not draw. Any change to these
-- roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "auth"."public_profiles" ADD COLUMN "share_image" bytea;
--> statement-breakpoint
ALTER TABLE "auth"."public_profiles" ADD COLUMN "share_image_type" text;
--> statement-breakpoint
ALTER TABLE "auth"."public_profiles" ADD COLUMN "share_image_version" text;
--> statement-breakpoint
-- All three or none, a type we can draw, and a size a card is worth. The cap is also what keeps an upload inside
-- the API's 1 MB body limit once it is base64 (500 kB becomes about 667 kB).
ALTER TABLE "auth"."public_profiles" ADD CONSTRAINT "public_profiles_share_image" CHECK (
  (share_image is null and share_image_type is null and share_image_version is null)
  or (
    share_image is not null
    and share_image_type in ('image/png', 'image/jpeg')
    and share_image_version is not null
    and octet_length(share_image) between 1 and 500000
  )
);
--> statement-breakpoint
grant update (share_image, share_image_type, share_image_version) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Writes one person's picture, or clears it when `bytes` is null, and answers the version its path will carry.
-- The version is this function's own: twelve hex of the bytes, so a new picture is a new path and nothing cached
-- under the old one is ever shown for it. A caller cannot choose it. A person with no profile row has no handle
-- either, so there is no page for anyone to share and nothing is written.
create function crm_save_profile_share_image(owner uuid, bytes bytea, kind text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  kept text;
begin
  update auth.public_profiles p
  set share_image = crm_save_profile_share_image.bytes,
      share_image_type = case when crm_save_profile_share_image.bytes is null then null
        else crm_save_profile_share_image.kind end,
      share_image_version = case when crm_save_profile_share_image.bytes is null then null
        else substr(md5(crm_save_profile_share_image.bytes), 1, 12) end,
      updated_at = pg_catalog.now()
  where p.user_id = crm_save_profile_share_image.owner
  returning p.share_image_version into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
-- The bytes themselves, for the one route that answers them. Separate from the profile readers on purpose: a page
-- read names the version and nothing more, so nobody pays for a picture they are not drawing.
create function crm_profile_share_image(owner uuid)
  returns table (bytes bytea, kind text, version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.share_image, p.share_image_type, p.share_image_version
  from auth.public_profiles p
  where p.user_id = crm_profile_share_image.owner and p.share_image is not null;
end;
--> statement-breakpoint
-- Both profile readers gain the version. Dropped and made again rather than replaced: `create or replace` cannot
-- change a `returns table` row type, which is why 0104, 0105 and 0108 do the same.
drop function crm_public_profiles_of(uuid[]);
--> statement-breakpoint
create function crm_public_profiles_of(owners uuid[])
  returns table (user_id uuid, handle text, bio text, theme jsonb, indexable boolean, share_image_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id, p.handle, p.bio, p.theme, p.indexable, p.share_image_version
  from auth.public_profiles p
  where p.user_id = any (crm_public_profiles_of.owners);
end;
--> statement-breakpoint
revoke all on function crm_public_profiles_of(uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_public_profiles_of(uuid[]) to crm_app;
--> statement-breakpoint
drop function crm_handle_owner(text);
--> statement-breakpoint
create function crm_handle_owner(wanted text)
  returns table (user_id uuid, handle text, bio text, name text, image text, theme jsonb, indexable boolean,
    share_image_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.handle, p.bio, u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end,
    p.theme, p.indexable, p.share_image_version
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_handle_owner(text) from public;
--> statement-breakpoint
grant execute on function crm_handle_owner(text) to crm_app;
--> statement-breakpoint
revoke all on function crm_save_profile_share_image(uuid, bytea, text) from public;
--> statement-breakpoint
grant execute on function crm_save_profile_share_image(uuid, bytea, text) to crm_app;
--> statement-breakpoint
revoke all on function crm_profile_share_image(uuid) from public;
--> statement-breakpoint
grant execute on function crm_profile_share_image(uuid) to crm_app;
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
    'public.crm_save_profile_share_image(uuid, bytea, text)',
    'public.crm_profile_share_image(uuid)'
  ] loop
    if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p where p.oid = one::regprocedure)) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = one::regprocedure)
      or not has_function_privilege('crm_app', one, 'EXECUTE')
      or has_function_privilege('crm_identity', one, 'EXECUTE') then
      raise exception '% must be crm_handle''s own definer, executable by crm_app alone', one;
    end if;
  end loop;
  -- The app reaches the picture only through those two: never the table itself.
  if has_table_privilege('crm_app', 'auth.public_profiles', 'UPDATE')
    or has_column_privilege('crm_app', 'auth.public_profiles', 'share_image', 'UPDATE')
    or has_column_privilege('crm_app', 'auth.public_profiles', 'share_image', 'SELECT') then
    raise exception 'crm_app must not read or write auth.public_profiles.share_image directly';
  end if;
end
$$;
