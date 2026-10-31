-- Link page blocks and reach (spec 0061, 31 Oct 2026). Number 0137 is a placeholder, renumbered after main's last when
-- the lanes merge, its journal `when` stamped then.
--
-- What changes:
-- * `auth.profile_items` takes six more kinds: `socials`, `media`, `image`, `gallery`, `times` and `banner`. A
--   `times` block names a booking page by `page_id`, as a `page` block does. Up to three contact cards now, so the
--   one card index goes and the cap is the save's, as every kind's is. Every kind but a heading may carry a window
--   (`showFrom`, `hideAfter`, ISO instants in UTC), the sized kinds a tile `size`, and a link a `thumb` (a picture
--   id), a `style` and a `notice`. `crm_check_profile_item` checks all of it, and `crm_save_profile_item` checks that
--   every picture a block names is the owner's own on this page.
-- * `crm_profile_items_public` leaves out a block outside its window, by the database's own clock.
-- * Three new tables, each in schema auth with forced row level security and one policy, for crm_handle, whose
--   definers are the only way in; crm_app holds no grant on any of them, and the identity login's default grant
--   reads nothing through the policy. Each goes with its page (`public_profiles`, so a purged workspace's go with it)
--   and so with its person:
--   * `profile_images`: the page's pictures (an upload, a thumbnail, a poster), each a private object in the file
--     store with its metadata removed. Served only while a live block on that page uses it.
--   * `profile_view_source_days`: views and visitors per day, per fact (referrer, source, country, device) and per
--     value, written in the same call that counts the view; past a day's top 50 values a fact folds into `Other`.
--   * `profile_booking_days`: bookings made from the page, per day.
-- * `auth.public_profiles` gains `qr_style`, the share QR's style, written only by `crm_save_profile_qr_style`.
-- * `crm_count_profile_view` takes the four facts beside the visitor (its old signature is dropped, and the api that
--   calls it ships with this); `crm_sweep_profile_counts` also sweeps the two new day tables after a year.
-- * New definers, every one crm_handle's, executable by crm_app alone: `crm_count_profile_booking`,
--   `crm_profile_insights`, `crm_add_profile_image`, `crm_profile_image_of`, `crm_profile_image_public`,
--   `crm_profile_images_unused`, `crm_drop_profile_images`, `crm_save_profile_qr_style`, `crm_profile_qr_style` and
--   `crm_sitemap_handles`.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_kind";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_kind" check ("kind" in ('link', 'page', 'heading',
  'contact', 'text', 'faq', 'form', 'testimonial', 'socials', 'media', 'image', 'gallery', 'times', 'banner'));
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_target";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_target"
  check (("kind" in ('page', 'times')) = ("page_id" is not null));
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_page";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_page"
  check ("kind" not in ('page', 'times') or "page_id" is not null);
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_plain";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_plain"
  check ("kind" not in ('link', 'heading', 'contact', 'text', 'faq', 'testimonial', 'socials', 'media', 'image',
    'gallery', 'banner') or ("page_id" is null and "form_id" is null));
--> statement-breakpoint
drop index "auth"."profile_items_contact_once";
--> statement-breakpoint
alter table "auth"."public_profiles" add column "qr_style" jsonb;
--> statement-breakpoint
alter table "auth"."public_profiles" add constraint "public_profiles_qr_style"
  check ("qr_style" is null or (jsonb_typeof("qr_style") = 'object' and pg_column_size("qr_style") <= 1024));
--> statement-breakpoint
create table "auth"."profile_images" (
  "id" uuid primary key not null,
  "user_id" uuid not null,
  "workspace_id" uuid not null,
  "kind" text not null,
  "path" text not null,
  "content_type" text not null,
  "bytes" integer not null,
  "width" integer not null,
  "height" integer not null,
  "created_at" timestamp (6) with time zone default now() not null,
  constraint "profile_images_kind" check ("kind" in ('upload', 'thumb', 'poster')),
  constraint "profile_images_shape" check (
    "path" ~ ('^link-page/' || "user_id"::text || '/' || "workspace_id"::text || '/' || "id"::text || '[.](png|jpg|webp)$')
    and "content_type" in ('image/jpeg', 'image/png', 'image/webp')
    and "bytes" between 1 and 1572864
    and "width" between 1 and 4096 and "height" between 1 and 4096),
  constraint "profile_images_user_fk" foreign key ("user_id") references "auth"."user" ("id") on delete cascade,
  constraint "profile_images_page_fk" foreign key ("user_id", "workspace_id")
    references "auth"."public_profiles" ("user_id", "workspace_id") on delete cascade
);
--> statement-breakpoint
create unique index "profile_images_path" on "auth"."profile_images" using btree ("path");
--> statement-breakpoint
create index "profile_images_page" on "auth"."profile_images" using btree ("user_id", "workspace_id");
--> statement-breakpoint
create index "profile_images_created" on "auth"."profile_images" using btree ("created_at");
--> statement-breakpoint
create table "auth"."profile_view_source_days" (
  "user_id" uuid not null,
  "workspace_id" uuid not null,
  "day" date not null,
  "fact" text not null,
  "value" text not null,
  "views" integer default 0 not null,
  "visitors" integer default 0 not null,
  constraint "profile_view_source_days_pkey" primary key ("user_id", "workspace_id", "day", "fact", "value"),
  constraint "profile_view_source_days_fact" check ("fact" in ('referrer', 'source', 'country', 'device')),
  constraint "profile_view_source_days_value"
    check (char_length("value") between 1 and 120 and "value" !~ '[[:cntrl:][:space:]]'),
  constraint "profile_view_source_days_count" check ("views" >= 0 and "visitors" >= 0),
  constraint "profile_view_source_days_page_fk" foreign key ("user_id", "workspace_id")
    references "auth"."public_profiles" ("user_id", "workspace_id") on delete cascade
);
--> statement-breakpoint
create index "profile_view_source_days_day" on "auth"."profile_view_source_days" using btree ("day");
--> statement-breakpoint
create table "auth"."profile_booking_days" (
  "user_id" uuid not null,
  "workspace_id" uuid not null,
  "day" date not null,
  "bookings" integer default 0 not null,
  constraint "profile_booking_days_pkey" primary key ("user_id", "workspace_id", "day"),
  constraint "profile_booking_days_count" check ("bookings" >= 0),
  constraint "profile_booking_days_page_fk" foreign key ("user_id", "workspace_id")
    references "auth"."public_profiles" ("user_id", "workspace_id") on delete cascade
);
--> statement-breakpoint
create index "profile_booking_days_day" on "auth"."profile_booking_days" using btree ("day");
--> statement-breakpoint
-- Forced row level security, one policy each, and only for crm_handle: the grants are the fence, as on every auth
-- table, and the policy is a second one, so the identity login's default grant reads and writes nothing here.
alter table "auth"."profile_images" enable row level security;
--> statement-breakpoint
alter table "auth"."profile_images" force row level security;
--> statement-breakpoint
create policy "profile_images_handle" on "auth"."profile_images" to crm_handle using (true) with check (true);
--> statement-breakpoint
alter table "auth"."profile_view_source_days" enable row level security;
--> statement-breakpoint
alter table "auth"."profile_view_source_days" force row level security;
--> statement-breakpoint
create policy "profile_view_source_days_handle" on "auth"."profile_view_source_days" to crm_handle
  using (true) with check (true);
--> statement-breakpoint
alter table "auth"."profile_booking_days" enable row level security;
--> statement-breakpoint
alter table "auth"."profile_booking_days" force row level security;
--> statement-breakpoint
create policy "profile_booking_days_handle" on "auth"."profile_booking_days" to crm_handle
  using (true) with check (true);
--> statement-breakpoint
grant select, insert, delete on "auth"."profile_images" to crm_handle;
--> statement-breakpoint
grant select, insert, update, delete on "auth"."profile_view_source_days" to crm_handle;
--> statement-breakpoint
grant select, insert, update, delete on "auth"."profile_booking_days" to crm_handle;
--> statement-breakpoint
grant update ("qr_style") on "auth"."public_profiles" to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- The block check, every kind's (spec 0061). The window, the size and a link's picture, style and notice are read
-- and checked first, then taken off, and what is left is checked by its kind exactly as before. Still immutable,
-- still crm_handle's alone to call: crm_app reaches it only through crm_save_profile_item.
create or replace function crm_check_profile_item(wanted_kind text, given jsonb, workspace uuid, page uuid, form uuid)
  returns void
  language plpgsql
  immutable
  set search_path = pg_catalog, pg_temp
as $$
declare
  title text := given ->> 'title';
  link text := given ->> 'url';
  note text := given ->> 'note';
  body text := given ->> 'body';
  label text := given ->> 'label';
  quote text := given ->> 'quote';
  author text := given ->> 'author';
  said_role text := given ->> 'role';
  words text := given ->> 'text';
  alt text := given ->> 'alt';
  caption text := given ->> 'caption';
  shared text[] := array['showFrom', 'hideAfter', 'size', 'thumb', 'style', 'notice'];
  instant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$';
  uuid_shape text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  web text := '^(https?://[^/?#@]+([/?#].*)?|mailto:.+|tel:.+|sms:.+)$';
  allowed text[];
begin
  if wanted_kind is null
    or wanted_kind not in ('link', 'page', 'heading', 'contact', 'text', 'faq', 'form', 'testimonial', 'socials',
      'media', 'image', 'gallery', 'times', 'banner') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_KIND';
  end if;
  if given is null or pg_catalog.jsonb_typeof(given) <> 'object' then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  -- The keys any kind may share: strings each, a heading none of them, a size only on the kinds that take one, and
  -- a picture, a style and a notice only on a link.
  if exists (select 1 from pg_catalog.jsonb_each(given) e
      where e.key = any (shared) and pg_catalog.jsonb_typeof(e.value) <> 'string')
    or (wanted_kind = 'heading' and given ?| shared)
    or (given ? 'size' and (wanted_kind not in ('link', 'page', 'media', 'image', 'gallery')
      or given ->> 'size' not in ('small', 'wide', 'large')))
    or (given ?| array['thumb', 'style', 'notice'] and wanted_kind <> 'link')
    or (given ? 'thumb' and given ->> 'thumb' !~ uuid_shape)
    or (given ? 'style' and given ->> 'style' not in ('row', 'featured'))
    or (given ? 'notice' and given ->> 'notice' not in ('sensitive', '18', '21'))
    or (given ? 'showFrom' and given ->> 'showFrom' !~ instant)
    or (given ? 'hideAfter' and given ->> 'hideAfter' !~ instant)
    -- One spelling, so the text compares as the instant does: the end after the start (AC-6111).
    or (given ? 'showFrom' and given ? 'hideAfter'
      and (given ->> 'hideAfter') collate "C" <= (given ->> 'showFrom') collate "C") then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  -- And a real instant: a month 13 is the shape and no time at all.
  begin
    perform (given ->> 'showFrom')::timestamptz, (given ->> 'hideAfter')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end;
  given := given - shared;
  -- A form block: a workspace and a form, no page, and one line of words for its row.
  if wanted_kind = 'form' then
    if workspace is null or form is null or page is not null
      or exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> 'label'
        or pg_catalog.jsonb_typeof(e.value) <> 'string')
      or label is null or label ~ '[[:cntrl:]]' or label <> pg_catalog.btrim(label) or label = ''
      or pg_catalog.char_length(label) > 60 then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if form is not null then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'faq' then
    if workspace is not null or page is not null then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    if exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> all (array['title', 'items']))
      or pg_catalog.jsonb_typeof(given -> 'items') is distinct from 'array'
      or pg_catalog.jsonb_array_length(given -> 'items') not between 1 and 10
      or (given ? 'title' and (pg_catalog.jsonb_typeof(given -> 'title') <> 'string'
        or title ~ '[[:cntrl:]]' or title <> pg_catalog.btrim(title) or title = ''
        or pg_catalog.char_length(title) > 60)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    if exists (select 1 from pg_catalog.jsonb_array_elements(given -> 'items') q(asked)
        where pg_catalog.jsonb_typeof(q.asked) <> 'object'
          or (select pg_catalog.count(*) from pg_catalog.jsonb_each(q.asked)) <> 2
          or pg_catalog.jsonb_typeof(q.asked -> 'question') is distinct from 'string'
          or pg_catalog.jsonb_typeof(q.asked -> 'answer') is distinct from 'string'
          or (q.asked ->> 'question') ~ '[[:cntrl:]]'
          or (q.asked ->> 'question') <> pg_catalog.btrim(q.asked ->> 'question')
          or pg_catalog.char_length(q.asked ->> 'question') not between 1 and 120
          or (q.asked ->> 'answer') <> pg_catalog.btrim(q.asked ->> 'answer')
          or pg_catalog.char_length(q.asked ->> 'answer') not between 1 and 600
          or pg_catalog.regexp_replace(q.asked ->> 'answer', '[^[:cntrl:]]', '', 'g') ~ '[^\n]'
          or (pg_catalog.char_length(q.asked ->> 'answer')
            - pg_catalog.char_length(pg_catalog.replace(q.asked ->> 'answer', E'\n', ''))) > 10) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    if (select pg_catalog.count(distinct pg_catalog.lower(pg_catalog.btrim(q.asked ->> 'question')))
        from pg_catalog.jsonb_array_elements(given -> 'items') q(asked))
      <> pg_catalog.jsonb_array_length(given -> 'items') then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  -- A gallery (AC-6109): two to twelve pictures, each an id and its alt text and nothing else, none twice, and how
  -- it draws.
  if wanted_kind = 'gallery' then
    if workspace is not null or page is not null
      or exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> all (array['images', 'display']))
      or pg_catalog.jsonb_typeof(given -> 'images') is distinct from 'array'
      or pg_catalog.jsonb_array_length(given -> 'images') not between 2 and 12
      or (given ? 'display' and (pg_catalog.jsonb_typeof(given -> 'display') <> 'string'
        or given ->> 'display' not in ('row', 'grid'))) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    if exists (select 1 from pg_catalog.jsonb_array_elements(given -> 'images') g(pic)
        where pg_catalog.jsonb_typeof(g.pic) <> 'object'
          or (select pg_catalog.count(*) from pg_catalog.jsonb_each(g.pic)) <> 2
          or pg_catalog.jsonb_typeof(g.pic -> 'image') is distinct from 'string'
          or pg_catalog.jsonb_typeof(g.pic -> 'alt') is distinct from 'string'
          or (g.pic ->> 'image') !~ uuid_shape
          or (g.pic ->> 'alt') ~ '[[:cntrl:]]' or (g.pic ->> 'alt') <> pg_catalog.btrim(g.pic ->> 'alt')
          or pg_catalog.char_length(g.pic ->> 'alt') not between 1 and 200)
      or (select pg_catalog.count(distinct g.pic ->> 'image') from pg_catalog.jsonb_array_elements(given -> 'images') g(pic))
        <> pg_catalog.jsonb_array_length(given -> 'images') then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  allowed := case wanted_kind
    when 'link' then array['title', 'url', 'note', 'icon', 'hue']
    when 'heading' then array['title', 'group']
    when 'contact' then array['fullName', 'jobTitle', 'company', 'note',
      'email', 'email2', 'email3', 'phone', 'phone2', 'phone3', 'website', 'website2', 'website3']
    when 'text' then array['title', 'body']
    when 'testimonial' then array['quote', 'author', 'role']
    when 'banner' then array['text', 'url']
    when 'image' then array['image', 'alt', 'caption', 'url']
    when 'media' then array['provider', 'ref', 'title', 'poster']
    else array[]::text[] end;
  if exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> all (allowed)
      or pg_catalog.jsonb_typeof(e.value) <> 'string') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  -- A booking page, and a page's next times (AC-6110): the page by its columns, and no fields of their own.
  if wanted_kind in ('page', 'times') then
    if workspace is null or page is null then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if workspace is not null or page is not null then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  -- The socials row (AC-6104): the person's own links, so no fields at all.
  if wanted_kind = 'socials' then
    return;
  end if;
  -- A banner (AC-6112): one trimmed line of at most 80, and an optional address of a link's shape.
  if wanted_kind = 'banner' then
    if words is null or words ~ '[[:cntrl:]]' or words <> pg_catalog.btrim(words) or words = ''
      or pg_catalog.char_length(words) > 80
      or (link is not null and (pg_catalog.char_length(link) > 2000 or link ~ '[[:cntrl:][:space:]]'
        or link !~* web)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  -- A picture (AC-6108): its id, alt text always, a caption of at most 120, and an optional address.
  if wanted_kind = 'image' then
    if given ->> 'image' is null or given ->> 'image' !~ uuid_shape
      or alt is null or alt ~ '[[:cntrl:]]' or alt <> pg_catalog.btrim(alt) or alt = ''
      or pg_catalog.char_length(alt) > 200
      or (caption is not null and (caption ~ '[[:cntrl:]]' or caption <> pg_catalog.btrim(caption) or caption = ''
        or pg_catalog.char_length(caption) > 120))
      or (link is not null and (pg_catalog.char_length(link) > 2000 or link ~ '[[:cntrl:][:space:]]'
        or link !~* web)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  -- A video or a song (AC-6105): the provider and the id the server parsed, never what was pasted, so the frame
  -- built from them can't leave the provider's path; a title of at most 100, and a poster's id.
  if wanted_kind = 'media' then
    if given ->> 'provider' is null
      or given ->> 'provider' not in ('youtube', 'vimeo', 'spotify', 'soundcloud', 'applemusic')
      or given ->> 'ref' is null or given ->> 'ref' !~ '^[A-Za-z0-9_.:%/-]{1,240}$' or given ->> 'ref' like '%..%'
      or (title is not null and (title ~ '[[:cntrl:]]' or title <> pg_catalog.btrim(title) or title = ''
        or pg_catalog.char_length(title) > 100))
      or (given ? 'poster' and given ->> 'poster' !~ uuid_shape) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if wanted_kind = 'contact' then
    if exists (select 1 from pg_catalog.jsonb_each_text(given) e
        where e.value ~ '[[:cntrl:]]' or e.value <> pg_catalog.btrim(e.value) or e.value = ''
          or pg_catalog.char_length(e.value) > (case when e.key = 'fullName' then 80
            when e.key like 'phone%' then 32 when e.key like 'website%' then 2000 else 120 end)
          or (e.key like 'email%' and e.value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
          or (e.key like 'phone%' and (e.value !~ '^\+?[0-9 ().-]+$'
            or pg_catalog.char_length(pg_catalog.regexp_replace(e.value, '[^0-9]', '', 'g')) not between 3 and 20))
          or (e.key like 'website%' and (e.value ~ '[[:space:]]'
            or e.value !~* '^https?://[^/?#@]+([/?#].*)?$')))
      or given ->> 'fullName' is null then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    if (select pg_catalog.count(distinct pg_catalog.lower(e.value))
        from pg_catalog.jsonb_each_text(given) e where e.key like 'email%')
      <> (select pg_catalog.count(*) from pg_catalog.jsonb_each_text(given) e where e.key like 'email%')
      or (select pg_catalog.count(distinct pg_catalog.regexp_replace(e.value, '[^0-9]', '', 'g'))
        from pg_catalog.jsonb_each_text(given) e where e.key like 'phone%')
        <> (select pg_catalog.count(*) from pg_catalog.jsonb_each_text(given) e where e.key like 'phone%')
      or (select pg_catalog.count(distinct pg_catalog.lower(e.value))
        from pg_catalog.jsonb_each_text(given) e where e.key like 'website%')
        <> (select pg_catalog.count(*) from pg_catalog.jsonb_each_text(given) e where e.key like 'website%') then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if wanted_kind = 'testimonial' then
    if quote is null or quote <> pg_catalog.btrim(quote)
      or pg_catalog.char_length(quote) not between 1 and 400
      or pg_catalog.regexp_replace(quote, '[^[:cntrl:]]', '', 'g') ~ '[^\n]'
      or (pg_catalog.char_length(quote) - pg_catalog.char_length(pg_catalog.replace(quote, E'\n', ''))) > 6
      or author is null or author ~ '[[:cntrl:]]' or author <> pg_catalog.btrim(author) or author = ''
      or pg_catalog.char_length(author) > 80
      or (said_role is not null and (said_role ~ '[[:cntrl:]]' or said_role <> pg_catalog.btrim(said_role)
        or said_role = '' or pg_catalog.char_length(said_role) > 80)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if wanted_kind = 'text' then
    if body is null or body <> pg_catalog.btrim(body) or pg_catalog.char_length(body) < 1
      or pg_catalog.char_length(body) > 1000
      or pg_catalog.regexp_replace(body, '[^[:cntrl:]]', '', 'g') ~ '[^\n]'
      or (pg_catalog.char_length(body) - pg_catalog.char_length(pg_catalog.replace(body, E'\n', ''))) > 20
      or (title is not null and (title ~ '[[:cntrl:]]' or title <> pg_catalog.btrim(title) or title = ''
        or pg_catalog.char_length(title) > 60)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if wanted_kind = 'heading' and given ? 'group' and given ->> 'group' <> all (array['open', 'folder']) then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if title is null or title ~ '[[:cntrl:]]'
    or pg_catalog.char_length(pg_catalog.btrim(title)) < 1
    or pg_catalog.char_length(title) > (case wanted_kind when 'link' then 60 else 40 end) then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'link' then
    if link is null or pg_catalog.char_length(link) > 2000 or link ~ '[[:cntrl:][:space:]]'
      or link !~* web
      or (note is not null and (pg_catalog.char_length(note) > 120 or note ~ '[[:cntrl:]]')) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
  end if;
end;
$$;
--> statement-breakpoint
-- The cap a kind has on one page (AC-5102, AC-6115). Not a definer and immutable: it runs only inside crm_handle's
-- own functions, and nobody else may call it.
create function crm_profile_kind_cap(wanted_kind text)
  returns integer
  language sql
  immutable
  set search_path = pg_catalog, pg_temp
begin atomic
  select case crm_profile_kind_cap.wanted_kind
    when 'link' then 40 when 'heading' then 12 when 'contact' then 3 when 'text' then 5 when 'faq' then 2
    when 'form' then 3 when 'testimonial' then 6 when 'socials' then 1 when 'media' then 10 when 'image' then 10
    when 'gallery' then 3 when 'times' then 3 when 'banner' then 1 else 60 end;
end;
--> statement-breakpoint
-- Every picture a block's data names, as ids: a link's thumbnail, an image block's picture, a media block's poster
-- and a gallery's pictures. Not a definer, crm_handle's own functions only.
create function crm_profile_item_images(given jsonb)
  returns setof uuid
  language sql
  immutable
  set search_path = pg_catalog, pg_temp
begin atomic
  select r.id::uuid from (
    select crm_profile_item_images.given ->> 'thumb' as id
    union all select crm_profile_item_images.given ->> 'image'
    union all select crm_profile_item_images.given ->> 'poster'
    union all select g.pic ->> 'image'
    from pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(crm_profile_item_images.given -> 'images') = 'array'
        then crm_profile_item_images.given -> 'images' else '[]'::jsonb end) g(pic)
  ) r
  where r.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
end;
--> statement-breakpoint
-- Adds or edits one block, as 0114's, with spec 0061's kinds and caps: a times block's page is checked as a page
-- block's is; every picture the block names must be the owner's own on this page (42704 PROFILE_IMAGE_MISSING,
-- so an id from another person's page is never taken); at most 3 featured links (54000, detail `featured`).
create or replace function crm_save_profile_item(owner uuid, workspace uuid, item uuid, wanted_kind text, given jsonb, page uuid, form uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  held auth.profile_items%rowtype;
  live integer;
  live_kind integer;
  kept integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  perform public.crm_check_profile_item(wanted_kind, given,
    case when wanted_kind in ('page', 'form', 'times') then workspace end, page, form);
  if wanted_kind in ('page', 'times') and not exists (
    select 1 from public.crm_booking_owner_pages(owner, workspace, array[page]) o where o.page_id = page
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
  end if;
  if wanted_kind = 'form' and not exists (
    select 1 from public.crm_form_owner_forms(owner, workspace, array[form]) o where o.form_id = form
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
  end if;
  if exists (
    select 1 from public.crm_profile_item_images(given) w(image)
    where not exists (select 1 from auth.profile_images m
      where m.id = w.image and m.user_id = owner and m.workspace_id = workspace)
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_IMAGE_MISSING', detail = 'image';
  end if;
  if wanted_kind = 'link' and given ->> 'style' = 'featured' and (
    select count(*) from auth.profile_items i
    where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null and i.kind = 'link'
      and i.data ->> 'style' = 'featured' and i.id <> item
  ) >= 3 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'featured';
  end if;
  select * into held from auth.profile_items i where i.id = item for update;
  if found then
    if held.user_id <> owner or held.workspace_id <> workspace then
      raise exception using errcode = 'P0002', message = 'PROFILE_ITEM_MISSING';
    end if;
    if held.kind <> wanted_kind then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    update auth.profile_items i
    set data = given, page_id = page, form_id = form, updated_at = pg_catalog.now()
    where i.id = item and (i.data, i.page_id, i.form_id) is distinct from (given, page, form);
  else
    select count(*) filter (where i.archived_at is null),
      count(*) filter (where i.archived_at is null and i.kind = wanted_kind),
      count(*)
    into live, live_kind, kept
    from auth.profile_items i where i.user_id = owner and i.workspace_id = workspace;
    if live >= 60 or kept >= 200 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= public.crm_profile_kind_cap(wanted_kind) then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = wanted_kind;
    end if;
    insert into auth.profile_items (id, user_id, workspace_id, kind, position, data, page_id, form_id)
    values (item, owner, workspace, wanted_kind,
      (select coalesce(max(i.position) + 1, 0) from auth.profile_items i
        where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null),
      given, page, form);
  end if;
  return query
    select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
    from auth.profile_items i where i.id = item;
end;
$$;
--> statement-breakpoint
-- Archives or restores one block, as 0114's, a restore under spec 0061's caps (the featured links' too).
create or replace function crm_archive_profile_item(owner uuid, workspace uuid, item uuid, archived boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  held auth.profile_items%rowtype;
  live integer;
  live_kind integer;
  featured integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  select * into held from auth.profile_items i
  where i.id = item and i.user_id = owner and i.workspace_id = workspace for update;
  if not found then
    return false;
  end if;
  if archived and held.archived_at is null then
    update auth.profile_items i set archived_at = pg_catalog.now(), position = null, updated_at = pg_catalog.now()
    where i.id = item;
    perform public.crm_pack_profile_items(owner, workspace);
  elsif not archived and held.archived_at is not null then
    select count(*), count(*) filter (where i.kind = held.kind),
      count(*) filter (where i.kind = 'link' and i.data ->> 'style' = 'featured')
    into live, live_kind, featured
    from auth.profile_items i where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null;
    if live >= 60 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= public.crm_profile_kind_cap(held.kind) then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = held.kind;
    end if;
    if held.kind = 'link' and held.data ->> 'style' = 'featured' and featured >= 3 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'featured';
    end if;
    update auth.profile_items i
    set archived_at = null, updated_at = pg_catalog.now(),
      position = (select coalesce(max(p.position) + 1, 0) from auth.profile_items p
        where p.user_id = owner and p.workspace_id = workspace and p.archived_at is null)
    where i.id = item;
  end if;
  return true;
end;
$$;
--> statement-breakpoint
-- The public read, as 0114's, leaving out a block outside its window (AC-6111) by the database's own clock. The
-- instants are one spelling (the check's), so they compare as text, and a stored one can never fail a cast here.
create or replace function crm_profile_items_public(owner uuid, workspace uuid, after_position smallint, after_id uuid, max integer)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id
  from auth.profile_items i
  where i.user_id = crm_profile_items_public.owner and i.workspace_id = crm_profile_items_public.workspace
    and i.archived_at is null
    and ((i.data ->> 'showFrom') is null or (i.data ->> 'showFrom') collate "C"
      <= pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
    and ((i.data ->> 'hideAfter') is null or (i.data ->> 'hideAfter') collate "C"
      > pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
    and (crm_profile_items_public.after_id is null
      or (i.position, i.id) > (crm_profile_items_public.after_position, crm_profile_items_public.after_id))
    and public.crm_workspace_member(crm_profile_items_public.owner, crm_profile_items_public.workspace)
  order by i.position, i.id
  limit least(greatest(crm_profile_items_public.max, 1), 61);
end;
--> statement-breakpoint
-- A press on a block a visitor can press: spec 0061 adds Play, a picture's link, a banner's link and a next times
-- chip. Otherwise 0114's.
create or replace function crm_count_item_press(owner uuid, workspace uuid, item uuid, visitor text)
  returns void
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  with press as (
    insert into auth.profile_item_presses (item_id, day, visitor)
    select i.id, (pg_catalog.now() at time zone 'UTC')::date, crm_count_item_press.visitor
    from auth.profile_items i
    where i.id = crm_count_item_press.item and i.user_id = crm_count_item_press.owner
      and i.workspace_id = crm_count_item_press.workspace and i.archived_at is null
      and i.kind = any (array['link', 'page', 'contact', 'media', 'image', 'banner', 'times'])
    on conflict (item_id, day, visitor)
      do update set presses = auth.profile_item_presses.presses + 1, last_at = pg_catalog.now()
    returning auth.profile_item_presses.item_id, auth.profile_item_presses.day
  )
  insert into auth.profile_item_press_days (item_id, day, presses)
  select press.item_id, press.day, 1 from press
  on conflict (item_id, day) do update set presses = auth.profile_item_press_days.presses + 1;
end;
--> statement-breakpoint
drop function crm_count_profile_view(uuid, uuid, text);
--> statement-breakpoint
-- A view of `owner`'s page in `workspace` with its four facts (AC-6116, AC-6117): counted per visitor and day as
-- before, then one more view of each fact's value that day, and one more visitor when this is the visitor's first
-- view of the day. A value new to a day that already holds 50 of that fact folds into `Other`. A value outside the
-- stored shape is left out rather than failing the view. Nothing for a person who is not an active member there, or
-- who has no page there.
create function crm_count_profile_view(owner uuid, workspace uuid, visitor text, referrer text, source text,
  country text, device text)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  today date := (pg_catalog.now() at time zone 'UTC')::date;
  is_new boolean;
  the_fact text;
  the_value text;
  kept text;
begin
  if not public.crm_workspace_member(owner, workspace)
    or not exists (select 1 from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace) then
    return;
  end if;
  -- One page's facts are folded one view at a time, so a day never passes its 50 values under a burst.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm_profile_facts:' || owner::text || ':' || workspace::text, 0));
  insert into auth.profile_views as v (user_id, workspace_id, day, visitor)
  values (owner, workspace, today, crm_count_profile_view.visitor)
  on conflict (user_id, workspace_id, day, visitor)
    do update set views = v.views + 1, last_at = pg_catalog.now()
  returning (v.xmax = 0) into is_new;
  insert into auth.profile_view_days as d (user_id, workspace_id, day, views, visitors)
  values (owner, workspace, today, 1, case when is_new then 1 else 0 end)
  on conflict (user_id, workspace_id, day)
    do update set views = d.views + 1, visitors = d.visitors + excluded.visitors;
  for the_fact, the_value in
    select f.fact, f.value
    from (values ('referrer', referrer), ('source', source), ('country', country), ('device', device)) f(fact, value)
    where f.value is not null and pg_catalog.char_length(f.value) between 1 and 120
      and f.value !~ '[[:cntrl:][:space:]]'
  loop
    kept := the_value;
    if not exists (select 1 from auth.profile_view_source_days s
        where s.user_id = owner and s.workspace_id = workspace and s.day = today
          and s.fact = the_fact and s.value = the_value)
      and (select count(*) from auth.profile_view_source_days s
        where s.user_id = owner and s.workspace_id = workspace and s.day = today
          and s.fact = the_fact and s.value <> 'Other') >= 50 then
      kept := 'Other';
    end if;
    insert into auth.profile_view_source_days as s (user_id, workspace_id, day, fact, value, views, visitors)
    values (owner, workspace, today, the_fact, kept, 1, case when is_new then 1 else 0 end)
    on conflict (user_id, workspace_id, day, fact, value)
      do update set views = s.views + 1, visitors = s.visitors + excluded.visitors;
  end loop;
end;
$$;
--> statement-breakpoint
-- A booking made from a link page (AC-6119): `wanted` names the page by a current or old handle, and the booking
-- page must be a live block on it now (a page block or a next times block, inside its window). One more that day;
-- nothing about it is stored on the booking. Answers whether it counted; a bad `via` counts nothing.
create function crm_count_profile_booking(wanted text, page uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  owner uuid;
  workspace uuid;
  stamp text := pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select h.user_id, h.workspace_id into owner, workspace
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id and p.workspace_id = h.workspace_id
  where h.handle = wanted and h.user_id is not null and p.shown_at is not null;
  if owner is null or page is null or not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  if not exists (
    select 1 from auth.profile_items i
    where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null
      and i.kind in ('page', 'times') and i.page_id = crm_count_profile_booking.page
      and ((i.data ->> 'showFrom') is null or (i.data ->> 'showFrom') collate "C" <= stamp collate "C")
      and ((i.data ->> 'hideAfter') is null or (i.data ->> 'hideAfter') collate "C" > stamp collate "C")
  ) then
    return false;
  end if;
  insert into auth.profile_booking_days as b (user_id, workspace_id, day, bookings)
  values (owner, workspace, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (user_id, workspace_id, day) do update set bookings = b.bookings + 1;
  return true;
end;
$$;
--> statement-breakpoint
-- The editor's Insights and its CSV (AC-6118 to AC-6120): one row per day and metric, between two UTC days at most
-- 400 apart. `traffic` is the day's views and visitors; `referrer`, `source`, `country` and `device` each value's;
-- `bookings` the day's bookings (in `views`); `press` each live block's presses (the block's id as `key`, the count
-- in `views`). Only the owner's own, while an active member.
create function crm_profile_insights(owner uuid, workspace uuid, from_day date, to_day date)
  returns table (day date, metric text, key text, views bigint, visitors bigint)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select v.day, 'traffic', null::text, v.views::bigint, v.visitors::bigint
  from auth.profile_view_days v
  where v.user_id = crm_profile_insights.owner and v.workspace_id = crm_profile_insights.workspace
    and v.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace)
  union all
  select s.day, s.fact, s.value, s.views::bigint, s.visitors::bigint
  from auth.profile_view_source_days s
  where s.user_id = crm_profile_insights.owner and s.workspace_id = crm_profile_insights.workspace
    and s.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace)
  union all
  select b.day, 'bookings', null::text, b.bookings::bigint, null::bigint
  from auth.profile_booking_days b
  where b.user_id = crm_profile_insights.owner and b.workspace_id = crm_profile_insights.workspace
    and b.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace)
  union all
  select p.day, 'press', p.item_id::text, p.presses::bigint, null::bigint
  from auth.profile_item_press_days p
  join auth.profile_items i on i.id = p.item_id
  where i.user_id = crm_profile_insights.owner and i.workspace_id = crm_profile_insights.workspace
    and i.archived_at is null
    and p.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace);
end;
--> statement-breakpoint
-- Keeps one picture of `owner`'s page in `workspace` (AC-6101, AC-6108, AC-6128): the bytes are in the store
-- already, at the path the server made. Inside that workspace's own transaction only, for an active member with a
-- page there; at most 300 kept per page and 60 an hour per person. The id is the server's own.
create function crm_add_profile_image(owner uuid, workspace uuid, image uuid, made text, path text,
  content_type text, bytes integer, width integer, height integer)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  if not exists (select 1 from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace) then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_images:' || owner::text, 0));
  if (select count(*) from auth.profile_images m where m.user_id = owner and m.workspace_id = workspace) >= 300 then
    raise exception using errcode = '54000', message = 'PROFILE_IMAGE_LIMIT', detail = 'kept';
  end if;
  if (select count(*) from auth.profile_images m
      where m.user_id = owner and m.created_at > pg_catalog.now() - interval '1 hour') >= 60 then
    raise exception using errcode = '54000', message = 'PROFILE_IMAGE_LIMIT', detail = 'hour';
  end if;
  insert into auth.profile_images (id, user_id, workspace_id, kind, path, content_type, bytes, width, height)
  values (image, owner, workspace, made, crm_add_profile_image.path, crm_add_profile_image.content_type,
    crm_add_profile_image.bytes, crm_add_profile_image.width, crm_add_profile_image.height);
end;
$$;
--> statement-breakpoint
-- One of the owner's own pictures, for their editor: its store path, type and size, or no row for one that isn't
-- theirs on this page.
create function crm_profile_image_of(owner uuid, workspace uuid, image uuid)
  returns table (path text, content_type text, width integer, height integer)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select m.path, m.content_type, m.width, m.height
  from auth.profile_images m
  where m.id = crm_profile_image_of.image and m.user_id = crm_profile_image_of.owner
    and m.workspace_id = crm_profile_image_of.workspace
    and public.crm_workspace_member(crm_profile_image_of.owner, crm_profile_image_of.workspace);
end;
--> statement-breakpoint
-- A picture a visitor may load (AC-6129): only while a live block of that page, inside its window, names it; or the
-- page's share QR names it as its centre (the QR is drawn from the page's own address, so its picture is public too). Anything else, an id from another person's page included, is no row.
create function crm_profile_image_public(owner uuid, workspace uuid, image uuid)
  returns table (path text, content_type text, width integer, height integer)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select m.path, m.content_type, m.width, m.height
  from auth.profile_images m
  where m.id = crm_profile_image_public.image and m.user_id = crm_profile_image_public.owner
    and m.workspace_id = crm_profile_image_public.workspace
    and public.crm_workspace_member(crm_profile_image_public.owner, crm_profile_image_public.workspace)
    and (exists (
      select 1 from public.crm_profile_items_public(crm_profile_image_public.owner, crm_profile_image_public.workspace,
        0::smallint, null::uuid, 61) i
      where m.id in (select w.image from public.crm_profile_item_images(i.data) w(image))
    ) or exists (
      select 1 from auth.public_profiles p
      where p.user_id = m.user_id and p.workspace_id = m.workspace_id
        and p.qr_style -> 'picture' ->> 'image' = m.id::text
    ));
end;
--> statement-breakpoint
-- Pictures no block of their page uses, live or archived, nor its share QR, made more than a day ago: the daily
-- cleanup removes their bytes from the store, then `crm_drop_profile_images` the rows. At most `max`.
create function crm_profile_images_unused(max integer)
  returns table (id uuid, path text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select m.id, m.path
  from auth.profile_images m
  where m.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1 from auth.profile_items i
      where i.user_id = m.user_id and i.workspace_id = m.workspace_id
        and m.id in (select w.image from public.crm_profile_item_images(i.data) w(image)))
    and not exists (
      select 1 from auth.public_profiles p
      where p.user_id = m.user_id and p.workspace_id = m.workspace_id
        and p.qr_style -> 'picture' ->> 'image' = m.id::text)
  order by m.created_at
  limit least(greatest(crm_profile_images_unused.max, 0), 1000);
end;
--> statement-breakpoint
-- Deletes the rows of pictures whose bytes the cleanup removed, each checked unused again: one a block took up since
-- stays. Answers how many went.
create function crm_drop_profile_images(ids uuid[])
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  gone integer;
begin
  delete from auth.profile_images m
  where m.id = any (ids)
    and m.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1 from auth.profile_items i
      where i.user_id = m.user_id and i.workspace_id = m.workspace_id
        and m.id in (select w.image from public.crm_profile_item_images(i.data) w(image)))
    and not exists (
      select 1 from auth.public_profiles p
      where p.user_id = m.user_id and p.workspace_id = m.workspace_id
        and p.qr_style -> 'picture' ->> 'image' = m.id::text);
  get diagnostics gone = row_count;
  return gone;
end;
$$;
--> statement-breakpoint
-- The share QR's style (AC-6124), whole, or null to clear it: a module colour, a centre picture (the person's own,
-- or one of their pictures on this page), and a frame label of at most 20. The colour's contrast is the server's
-- check, before this; the shape is checked here again.
create function crm_save_profile_qr_style(owner uuid, workspace uuid, style jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  kept jsonb;
begin
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  if style is not null and (
    pg_catalog.jsonb_typeof(style) <> 'object'
    or exists (select 1 from pg_catalog.jsonb_each(style) e where e.key <> all (array['colour', 'picture', 'label']))
    or (style ? 'colour' and (pg_catalog.jsonb_typeof(style -> 'colour') <> 'string'
      or style ->> 'colour' !~ '^#[0-9a-f]{6}$'))
    or (style ? 'label' and (pg_catalog.jsonb_typeof(style -> 'label') <> 'string'
      or style ->> 'label' ~ '[[:cntrl:]]' or style ->> 'label' <> pg_catalog.btrim(style ->> 'label')
      or pg_catalog.char_length(style ->> 'label') not between 1 and 20))
    or (style ? 'picture' and (pg_catalog.jsonb_typeof(style -> 'picture') <> 'object'
      or not (style -> 'picture' = '{"from":"person"}'::jsonb
        or (style -> 'picture' ->> 'from' = 'upload'
          and (select pg_catalog.count(*) from pg_catalog.jsonb_each(style -> 'picture')) = 2
          and exists (select 1 from auth.profile_images m
            where m.id::text = style -> 'picture' ->> 'image' and m.user_id = owner and m.workspace_id = workspace)))))
  ) then
    raise exception using errcode = '22023', message = 'PROFILE_QR_STYLE';
  end if;
  update auth.public_profiles p
  set qr_style = crm_save_profile_qr_style.style, updated_at = pg_catalog.now()
  where p.user_id = owner and p.workspace_id = workspace
  returning p.qr_style into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
create function crm_profile_qr_style(owner uuid, workspace uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.qr_style from auth.public_profiles p
  where p.user_id = crm_profile_qr_style.owner and p.workspace_id = crm_profile_qr_style.workspace
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- The handles search engines may list (AC-6123): public, indexable pages of active members with at least one live
-- block, each with its last change, by handle after `after`, at most `max` (50,000).
create function crm_sitemap_handles(after text, max integer)
  returns table (handle text, changed_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.handle, greatest(p.updated_at, max(i.updated_at))
  from auth.public_profiles p
  join auth.profile_items i on i.user_id = p.user_id and i.workspace_id = p.workspace_id and i.archived_at is null
    and ((i.data ->> 'showFrom') is null or (i.data ->> 'showFrom') collate "C"
      <= pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
    and ((i.data ->> 'hideAfter') is null or (i.data ->> 'hideAfter') collate "C"
      > pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
  where p.shown_at is not null and p.indexable
    and (crm_sitemap_handles.after is null or p.handle collate "C" > crm_sitemap_handles.after collate "C")
    and public.crm_workspace_member(p.user_id, p.workspace_id)
  group by p.user_id, p.workspace_id, p.handle, p.updated_at
  order by p.handle collate "C"
  limit least(greatest(crm_sitemap_handles.max, 1), 50000);
end;
--> statement-breakpoint
-- The year's sweep, as 0114's, and the two new day tables with it.
create or replace function crm_sweep_profile_counts(max integer)
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  cutoff date := (pg_catalog.now() at time zone 'UTC')::date - 365;
  batch integer := greatest(least(max, 10000), 0);
  gone integer;
  most integer := 0;
begin
  delete from auth.profile_views v where (v.user_id, v.workspace_id, v.day, v.visitor) in (
    select o.user_id, o.workspace_id, o.day, o.visitor from auth.profile_views o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_presses p where (p.item_id, p.day, p.visitor) in (
    select o.item_id, o.day, o.visitor from auth.profile_item_presses o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_view_days v where (v.user_id, v.workspace_id, v.day) in (
    select o.user_id, o.workspace_id, o.day from auth.profile_view_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_press_days p where (p.item_id, p.day) in (
    select o.item_id, o.day from auth.profile_item_press_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_view_source_days s where (s.user_id, s.workspace_id, s.day, s.fact, s.value) in (
    select o.user_id, o.workspace_id, o.day, o.fact, o.value from auth.profile_view_source_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_booking_days b where (b.user_id, b.workspace_id, b.day) in (
    select o.user_id, o.workspace_id, o.day from auth.profile_booking_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  return greatest(most, gone);
end;
$$;
--> statement-breakpoint
-- The two helpers run only inside crm_handle's own functions: nobody else may call them.
revoke all on function crm_profile_kind_cap(text) from public;
--> statement-breakpoint
revoke all on function crm_profile_item_images(jsonb) from public;
--> statement-breakpoint
revoke all on function crm_count_profile_view(uuid, uuid, text, text, text, text, text) from public;
--> statement-breakpoint
revoke all on function crm_count_profile_booking(text, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_insights(uuid, uuid, date, date) from public;
--> statement-breakpoint
revoke all on function crm_add_profile_image(uuid, uuid, uuid, text, text, text, integer, integer, integer) from public;
--> statement-breakpoint
revoke all on function crm_profile_image_of(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_image_public(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_images_unused(integer) from public;
--> statement-breakpoint
revoke all on function crm_drop_profile_images(uuid[]) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_qr_style(uuid, uuid, jsonb) from public;
--> statement-breakpoint
revoke all on function crm_profile_qr_style(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_sitemap_handles(text, integer) from public;
--> statement-breakpoint
grant execute on function crm_count_profile_view(uuid, uuid, text, text, text, text, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_count_profile_booking(text, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_insights(uuid, uuid, date, date) to crm_app;
--> statement-breakpoint
grant execute on function crm_add_profile_image(uuid, uuid, uuid, text, text, text, integer, integer, integer) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_image_of(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_image_public(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_images_unused(integer) to crm_app;
--> statement-breakpoint
grant execute on function crm_drop_profile_images(uuid[]) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_qr_style(uuid, uuid, jsonb) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_qr_style(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_sitemap_handles(text, integer) to crm_app;
--> statement-breakpoint
-- What the new check must accept and refuse, said here so a migration that breaks it never lands.
do $$
declare
  block text;
begin
  perform crm_check_profile_item('link',
    '{"title":"Shop","url":"https://a.co","thumb":"0190a0a0-0000-7000-8000-000000000001","style":"featured","notice":"18","size":"wide","showFrom":"2026-11-03T09:00:00.000Z","hideAfter":"2026-11-10T09:00:00.000Z"}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('media', '{"provider":"youtube","ref":"dQw4w9WgXcQ","title":"A song"}'::jsonb, null, null, null);
  perform crm_check_profile_item('image', '{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"A view"}'::jsonb, null, null, null);
  perform crm_check_profile_item('gallery',
    '{"images":[{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"One"},{"image":"0190a0a0-0000-7000-8000-000000000002","alt":"Two"}],"display":"grid"}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('banner', '{"text":"Sale ends Friday","url":"https://a.co/sale"}'::jsonb, null, null, null);
  perform crm_check_profile_item('socials', '{}'::jsonb, null, null, null);
  perform crm_check_profile_item('times', '{}'::jsonb, '0190a0a0-0000-7000-8000-000000000001',
    '0190a0a0-0000-7000-8000-000000000002', null);
  perform crm_check_profile_item('contact', '{"fullName":"Ada","showFrom":"2026-11-03T09:00:00.000Z"}'::jsonb, null, null, null);
  for block in select unnest(array[
    '{"kind":"heading","data":{"title":"A","showFrom":"2026-11-03T09:00:00.000Z"}}',
    '{"kind":"link","data":{"title":"A","url":"https://a.co","showFrom":"2026-11-10T09:00:00.000Z","hideAfter":"2026-11-03T09:00:00.000Z"}}',
    '{"kind":"link","data":{"title":"A","url":"https://a.co","showFrom":"2026-13-03T09:00:00.000Z"}}',
    '{"kind":"text","data":{"body":"A","size":"wide"}}',
    '{"kind":"image","data":{"image":"0190a0a0-0000-7000-8000-000000000001","alt":""}}',
    '{"kind":"media","data":{"provider":"youtube","ref":"../../evil"}}',
    '{"kind":"media","data":{"provider":"elsewhere","ref":"abc"}}',
    '{"kind":"gallery","data":{"images":[{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"One"}]}}',
    '{"kind":"banner","data":{"text":"A","url":"javascript:alert(1)"}}',
    '{"kind":"socials","data":{"links":"x"}}',
    '{"kind":"image","data":{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"A","thumb":"0190a0a0-0000-7000-8000-000000000001"}}'])
  loop
    begin
      perform crm_check_profile_item(block::jsonb ->> 'kind', block::jsonb -> 'data', null, null, null);
      raise exception 'crm_check_profile_item accepted a block it must refuse: %', block;
    exception when sqlstate '22023' then
      null;
    end;
  end loop;
end
$$;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless every function is as narrow as it reads, and crm_app holds nothing on the new tables.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid)'::regprocedure,
    'public.crm_archive_profile_item(uuid, uuid, uuid, boolean)'::regprocedure,
    'public.crm_profile_items_public(uuid, uuid, smallint, uuid, integer)'::regprocedure,
    'public.crm_count_item_press(uuid, uuid, uuid, text)'::regprocedure,
    'public.crm_count_profile_view(uuid, uuid, text, text, text, text, text)'::regprocedure,
    'public.crm_count_profile_booking(text, uuid)'::regprocedure,
    'public.crm_profile_insights(uuid, uuid, date, date)'::regprocedure,
    'public.crm_add_profile_image(uuid, uuid, uuid, text, text, text, integer, integer, integer)'::regprocedure,
    'public.crm_profile_image_of(uuid, uuid, uuid)'::regprocedure,
    'public.crm_profile_image_public(uuid, uuid, uuid)'::regprocedure,
    'public.crm_profile_images_unused(integer)'::regprocedure,
    'public.crm_drop_profile_images(uuid[])'::regprocedure,
    'public.crm_save_profile_qr_style(uuid, uuid, jsonb)'::regprocedure,
    'public.crm_profile_qr_style(uuid, uuid)'::regprocedure,
    'public.crm_sitemap_handles(text, integer)'::regprocedure,
    'public.crm_sweep_profile_counts(integer)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = fn)
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE')
      or not has_function_privilege('crm_app', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_handle and executable by crm_app alone', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)'::regprocedure,
    'public.crm_profile_kind_cap(text)'::regprocedure,
    'public.crm_profile_item_images(jsonb)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or has_function_privilege('crm_app', fn, 'EXECUTE')
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be crm_handle''s and reachable only from its own functions', fn;
    end if;
  end loop;
  if exists (
    select 1 from unnest(array['auth.profile_images', 'auth.profile_view_source_days', 'auth.profile_booking_days']) t(name)
    where has_table_privilege('crm_app', t.name, 'SELECT') or has_table_privilege('crm_app', t.name, 'INSERT')
      or has_table_privilege('crm_app', t.name, 'UPDATE') or has_table_privilege('crm_app', t.name, 'DELETE')
      or not (select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = t.name::regclass)
      or not exists (select 1 from pg_policy p where p.polrelid = t.name::regclass)
  ) then
    raise exception 'the link page''s new tables are reached only through crm_handle''s functions, under forced row level security';
  end if;
end
$$;
