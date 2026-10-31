-- Brand kit and link page themes (spec 0060, 31 Oct 2026). Numbered 0146, after the Live switch's 0145.
--
--
-- What changes:
-- * `workspace_brands`, a new tenant table: one row per workspace, made the first time an owner or admin saves the
--   kit. The accent pair (checked hexes, the one free value that reaches CSS) and the logo's private store path,
--   type and version, all three or none. Forced row level security and the plain workspace policy; the app reads and
--   writes it only inside withWorkspace(), and grants reach crm_app through default privileges.
-- * `auth.public_profiles` gains the link page's own accent pair, and a cover photo and a photo ground (path, type
--   and version each, all three or none, the path in the person's own folder for that workspace). crm_handle may
--   update the new columns, through two new definers only: `crm_save_profile_accent` and `crm_save_profile_image`.
--   `crm_profile_look` reads them for the editor and the public look stylesheet. All three are crm_handle's,
--   executable by crm_app alone, and refuse a person who isn't an active member of the workspace.
-- * The look (`theme`) widens from six keys to ten. Every stored look first gains the four new keys at the values
--   that draw what it drew before (centred header, circle avatar; the gradient and pattern are unused until picked),
--   then the check is replaced by the wider one. The old check refuses any key beyond six, so it is dropped before
--   the backfill and the new one added after it, all in this one transaction, so no reader ever sees a row without
--   all ten keys. The new values only widen the sets, so no stored row can fail it.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "workspace_brands" (
	"workspace_id" uuid NOT NULL,
	"accent" text,
	"accent_dark" text,
	"logo_path" text,
	"logo_type" text,
	"logo_version" text,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "workspace_brands_pkey" PRIMARY KEY("workspace_id"),
	CONSTRAINT "workspace_brands_accent" CHECK (("workspace_brands"."accent" is null or "workspace_brands"."accent" ~ '^#[0-9a-f]{6}$')
        and ("workspace_brands"."accent_dark" is null or ("workspace_brands"."accent_dark" ~ '^#[0-9a-f]{6}$' and "workspace_brands"."accent" is not null))),
	CONSTRAINT "workspace_brands_logo" CHECK (("workspace_brands"."logo_path" is null and "workspace_brands"."logo_type" is null and "workspace_brands"."logo_version" is null)
        or ("workspace_brands"."logo_path" ~ ('^logos/' || "workspace_brands"."workspace_id"::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
          and "workspace_brands"."logo_type" in ('image/png', 'image/jpeg', 'image/webp')
          and "workspace_brands"."logo_version" ~ '^[0-9a-f]{12}$'))
);
--> statement-breakpoint
ALTER TABLE "workspace_brands" ADD CONSTRAINT "workspace_brands_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_brands" ADD CONSTRAINT "workspace_brands_updated_by" FOREIGN KEY ("workspace_id","updated_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
alter table workspace_brands enable row level security;
--> statement-breakpoint
alter table workspace_brands force row level security;
--> statement-breakpoint
create policy workspace_brands_tenant on workspace_brands
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- The member a save names, from its own index so a member's purge never scans for it.
create index workspace_brands_updated_by_idx on workspace_brands using btree (workspace_id, updated_by);
--> statement-breakpoint
alter table auth.public_profiles
  add column accent text,
  add column accent_dark text,
  add column cover_path text,
  add column cover_type text,
  add column cover_version text,
  add column ground_path text,
  add column ground_type text,
  add column ground_version text;
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_accent check (
  (accent is null or accent ~ '^#[0-9a-f]{6}$')
  and (accent_dark is null or (accent_dark ~ '^#[0-9a-f]{6}$' and accent is not null))
);
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_cover check (
  (cover_path is null and cover_type is null and cover_version is null)
  or (cover_path ~ ('^profile-images/' || user_id::text || '/' || workspace_id::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
    and cover_type in ('image/png', 'image/jpeg', 'image/webp')
    and cover_version ~ '^[0-9a-f]{12}$')
);
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_ground check (
  (ground_path is null and ground_type is null and ground_version is null)
  or (ground_path ~ ('^profile-images/' || user_id::text || '/' || workspace_id::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
    and ground_type in ('image/png', 'image/jpeg', 'image/webp')
    and ground_version ~ '^[0-9a-f]{12}$')
);
--> statement-breakpoint
-- The look widens: the old check goes, every row gains the four new keys (its own values kept where it has them),
-- the default and the check become the ten key ones.
alter table auth.public_profiles drop constraint public_profiles_theme;
--> statement-breakpoint
update auth.public_profiles
set theme = '{"gradient":"dawn","pattern":"dots","header":"centred","avatar":"circle"}'::jsonb || theme
where not (theme ? 'gradient' and theme ? 'pattern' and theme ? 'header' and theme ? 'avatar');
--> statement-breakpoint
alter table auth.public_profiles alter column theme set default
  '{"ground":"plain","hue":"blue","mode":"light","shape":"soft","fill":"plain","font":"sans","gradient":"dawn","pattern":"dots","header":"centred","avatar":"circle"}'::jsonb;
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_theme check (
  theme is null or (
    jsonb_typeof(theme) = 'object'
    and theme - 'ground' - 'hue' - 'mode' - 'shape' - 'fill' - 'font' - 'gradient' - 'pattern' - 'header' - 'avatar'
      = '{}'::jsonb
    and coalesce(theme ->> 'ground', '') in ('plain', 'paper', 'tint', 'ink', 'gradient', 'pattern', 'image')
    and coalesce(theme ->> 'hue', '') in
      ('gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple')
    and coalesce(theme ->> 'mode', '') in ('light', 'dark', 'system')
    and coalesce(theme ->> 'shape', '') in ('soft', 'pill', 'square')
    and coalesce(theme ->> 'fill', '') in ('plain', 'soft', 'outline', 'solid')
    and coalesce(theme ->> 'font', '') in
      ('sans', 'mono', 'grotesk', 'editorial', 'classic', 'friendly', 'geometric', 'display')
    and coalesce(theme ->> 'gradient', '') in ('dawn', 'dusk', 'mint', 'ocean', 'peach', 'grape', 'sand', 'graphite')
    and coalesce(theme ->> 'pattern', '') in ('dots', 'grid', 'lines', 'waves')
    and coalesce(theme ->> 'header', '') in ('centred', 'cover', 'left')
    and coalesce(theme ->> 'avatar', '') in ('circle', 'rounded', 'none')
  )
);
--> statement-breakpoint
-- Written only by the two definers below.
grant update (accent, accent_dark, cover_path, cover_type, cover_version, ground_path, ground_type, ground_version)
  on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- One membership's link page accent and photos: for its owner's Design panel, its public look stylesheet and its
-- image routes, and its personal booking pages' accent. No row unless that person is an active member of that
-- workspace, and none outside the transaction's own workspace (`app.workspace_id`). The paths are the server's own;
-- nothing here is a member's email or anything typed but a checked hex.
create function crm_profile_look(owner uuid, workspace uuid)
  returns table (accent text, accent_dark text, cover_path text, cover_type text, cover_version text,
    ground_path text, ground_type text, ground_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.accent, p.accent_dark, p.cover_path, p.cover_type, p.cover_version,
    p.ground_path, p.ground_type, p.ground_version
  from auth.public_profiles p
  where p.user_id = crm_profile_look.owner
    and p.workspace_id = crm_profile_look.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- Sets `owner`'s link page accent pair in `workspace`, whole (null clears one), and answers it. Refused (42501) unless
-- `workspace` is the transaction's own (`app.workspace_id`) and they are an active member there; P0002 when they
-- have no page there. The column check refuses anything but a lowercase six digit hex (23514).
create function crm_save_profile_accent(owner uuid, workspace uuid, wanted text, wanted_dark text)
  returns table (accent text, accent_dark text)
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  return query
  update auth.public_profiles p
  set accent = wanted,
      accent_dark = wanted_dark,
      updated_at = pg_catalog.now()
  where p.user_id = owner and p.workspace_id = workspace
  returning p.accent, p.accent_dark;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
end;
$$;
--> statement-breakpoint
-- Sets or clears (`path` null) `owner`'s cover photo or photo ground (`slot`) in `workspace`, and answers the path it
-- replaced, so the caller can delete that file once this commits. The same refusals as crm_save_profile_accent; the
-- column checks hold the path to the person's own folder for that workspace and the type to the three taken.
create function crm_save_profile_image(owner uuid, workspace uuid, slot text, path text, kind text, version text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  previous text;
begin
  if slot is null or slot not in ('cover', 'ground') then
    raise exception using errcode = '22023', message = 'PROFILE_IMAGE_SLOT';
  end if;
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  select case when slot = 'cover' then p.cover_path else p.ground_path end into previous
  from auth.public_profiles p
  where p.user_id = owner and p.workspace_id = workspace
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  if slot = 'cover' then
    update auth.public_profiles p
    set cover_path = path,
        cover_type = case when path is null then null else kind end,
        cover_version = case when path is null then null else version end,
        updated_at = pg_catalog.now()
    where p.user_id = owner and p.workspace_id = workspace;
  else
    update auth.public_profiles p
    set ground_path = path,
        ground_type = case when path is null then null else kind end,
        ground_version = case when path is null then null else version end,
        updated_at = pg_catalog.now()
    where p.user_id = owner and p.workspace_id = workspace;
  end if;
  return previous;
end;
$$;
--> statement-breakpoint
revoke all on function crm_profile_look(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_profile_look(uuid, uuid) to crm_app;
--> statement-breakpoint
revoke all on function crm_save_profile_accent(uuid, uuid, text, text) from public;
--> statement-breakpoint
grant execute on function crm_save_profile_accent(uuid, uuid, text, text) to crm_app;
--> statement-breakpoint
revoke all on function crm_save_profile_image(uuid, uuid, text, text, text, text) from public;
--> statement-breakpoint
grant execute on function crm_save_profile_image(uuid, uuid, text, text, text, text) to crm_app;
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
    'public.crm_profile_look(uuid, uuid)',
    'public.crm_save_profile_accent(uuid, uuid, text, text)',
    'public.crm_save_profile_image(uuid, uuid, text, text, text, text)'
  ] loop
    if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p where p.oid = one::regprocedure)) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = one::regprocedure)
      or not has_function_privilege('crm_app', one, 'EXECUTE')
      or has_function_privilege('crm_identity', one, 'EXECUTE')
      or has_function_privilege('public', one, 'EXECUTE') then
      raise exception '0136_brand_kit: % is not crm_handle''s definer for crm_app alone', one;
    end if;
  end loop;
  -- The app still reaches the profile row only through the definers.
  if has_any_column_privilege('crm_app', 'auth.public_profiles', 'SELECT, INSERT, UPDATE, REFERENCES') then
    raise exception '0136_brand_kit: crm_app must hold nothing on auth.public_profiles';
  end if;
end
$$;
