-- Bento cards for link pages (spec 0068, AC-6808; 4 November 2026). Numbered 0180: main and car/pages end at 0173,
-- and land/business holds 0174 to 0179.
--
-- What changes:
-- * `auth.profile_items` takes nine more kinds, each a card the bento grid draws: `profile` (the page's face and
--   name, one line, Book and Share), `status` ("Available for work"), `audio` (a short audio intro), `timeline`
--   (experience), `logos` (clients), `work` (work cards), `steps` (how I work), `location` (address and Directions)
--   and `events` (next events). None names a page or a form.
-- * Every kind but a heading and a banner may carry a span (`size`): `small` is one column of the grid, `wide` two;
--   spec 0061's `large` still reads, as `wide`. Before, only links, booking pages, media, pictures and galleries could.
-- * `auth.profile_images` keeps a page's audio intro beside its pictures (`kind = 'audio'`): MP3, M4A, Ogg or WebM,
--   decided by the bytes on the server, at most 1.5 MB, stored privately under the same server made path, and served
--   only while a published block names it, as a picture is. A sound has no sides, so its row holds them at 1.
-- * `crm_check_profile_item` checks the new kinds' fields, one rule per field and nothing typed left unchecked;
--   `crm_profile_text_ok` is its one line rule (a string, trimmed, no control characters, within its length).
-- * `crm_profile_kind_cap` gains the new kinds' caps; `crm_profile_item_images` also names an audio intro and a work
--   card's pictures, so the ownership check, the public read and the sweep cover them.
-- * `crm_save_profile_item` also refuses an audio intro that names a picture, and a picture slot that names a sound.
-- * `crm_count_item_press` counts a press on an audio intro's Play, a work card's link, a location's Directions, an
--   event's link and a profile card's Book.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = on;
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_kind";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_kind" check ("kind" in ('link', 'page', 'heading',
  'contact', 'text', 'faq', 'form', 'testimonial', 'socials', 'media', 'image', 'gallery', 'times', 'banner',
  'profile', 'status', 'audio', 'timeline', 'logos', 'work', 'steps', 'location', 'events'));
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_plain";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_plain"
  check ("kind" not in ('link', 'heading', 'contact', 'text', 'faq', 'testimonial', 'socials', 'media', 'image',
    'gallery', 'banner', 'profile', 'status', 'audio', 'timeline', 'logos', 'work', 'steps', 'location', 'events')
    or ("page_id" is null and "form_id" is null));
--> statement-breakpoint
alter table "auth"."profile_images" drop constraint "profile_images_kind";
--> statement-breakpoint
alter table "auth"."profile_images" add constraint "profile_images_kind"
  check ("kind" in ('upload', 'thumb', 'poster', 'audio'));
--> statement-breakpoint
alter table "auth"."profile_images" drop constraint "profile_images_shape";
--> statement-breakpoint
alter table "auth"."profile_images" add constraint "profile_images_shape" check (
  "path" ~ ('^link-page/' || "user_id"::text || '/' || "workspace_id"::text || '/' || "id"::text
    || '[.](png|jpg|webp|mp3|m4a|ogg|webm)$')
  and "content_type" in ('image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm')
  -- A sound is an audio intro and nothing else is: one rule, read both ways.
  and ("kind" = 'audio') = ("content_type" like 'audio/%')
  and "bytes" between 1 and 1572864
  and "width" between 1 and 4096 and "height" between 1 and 4096
  and ("kind" <> 'audio' or ("width" = 1 and "height" = 1)));
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- One line of words as every bento field stores it: a JSON string, trimmed, with no control character, between
-- `least` and `most` characters. Immutable and crm_handle's alone: it runs only inside crm_check_profile_item.
create function crm_profile_text_ok(given jsonb, least_chars integer, most_chars integer)
  returns boolean
  language sql
  immutable
  set search_path = pg_catalog, pg_temp
begin atomic
  select coalesce(
    pg_catalog.jsonb_typeof(crm_profile_text_ok.given) = 'string'
      and (crm_profile_text_ok.given #>> '{}') !~ '[[:cntrl:]]'
      and (crm_profile_text_ok.given #>> '{}') = pg_catalog.btrim(crm_profile_text_ok.given #>> '{}')
      and pg_catalog.char_length(crm_profile_text_ok.given #>> '{}')
        between crm_profile_text_ok.least_chars and crm_profile_text_ok.most_chars,
    false);
end;
--> statement-breakpoint
-- 0156's check, with spec 0068's kinds and spans. The shared keys are read first, as before; then each new kind is
-- checked field by field, and every other kind exactly as 0156 checked it.
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
      'media', 'image', 'gallery', 'times', 'banner', 'profile', 'status', 'audio', 'timeline', 'logos', 'work',
      'steps', 'location', 'events') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_KIND';
  end if;
  if given is null or pg_catalog.jsonb_typeof(given) <> 'object' then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  -- The keys any kind may share: strings each, a heading none of them, a span on every kind but a heading and a
  -- banner, and a picture, a style and a notice only on a link.
  if exists (select 1 from pg_catalog.jsonb_each(given) e
      where e.key = any (shared) and pg_catalog.jsonb_typeof(e.value) <> 'string')
    or (wanted_kind = 'heading' and given ?| shared)
    or (given ? 'size' and (wanted_kind in ('heading', 'banner')
      or given ->> 'size' not in ('small', 'wide', 'large')))
    or (given ?| array['thumb', 'style', 'notice'] and wanted_kind <> 'link')
    or (given ? 'thumb' and given ->> 'thumb' !~ uuid_shape)
    or (given ? 'style' and given ->> 'style' not in ('row', 'featured'))
    or (given ? 'notice' and given ->> 'notice' not in ('sensitive', '18', '21'))
    or (given ? 'showFrom' and given ->> 'showFrom' !~ instant)
    or (given ? 'hideAfter' and given ->> 'hideAfter' !~ instant)
    or (given ? 'showFrom' and given ? 'hideAfter'
      and (given ->> 'hideAfter') collate "C" <= (given ->> 'showFrom') collate "C") then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  begin
    perform (given ->> 'showFrom')::timestamptz, (given ->> 'hideAfter')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end;
  given := given - shared;
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
  -- Spec 0068's cards (AC-6808): none names a page or a form, every field is one this rule reads, and a card's own
  -- title is one line of at most 40.
  if wanted_kind in ('profile', 'status', 'audio', 'timeline', 'logos', 'work', 'steps', 'location', 'events') then
    if workspace is not null or page is not null
      or exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> all (case wanted_kind
        when 'profile' then array['line']
        when 'status' then array['text', 'state']
        when 'audio' then array['audio', 'title', 'wave']
        when 'location' then array['title', 'address']
        else array['title', case when wanted_kind = 'logos' then 'images' else 'items' end] end))
      or (wanted_kind in ('timeline', 'logos', 'work', 'steps', 'events') and given ? 'title'
        and not public.crm_profile_text_ok(given -> 'title', 1, 40)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    if wanted_kind = 'profile' then
      if given ? 'line' and not public.crm_profile_text_ok(given -> 'line', 1, 80) then
        raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
      end if;
    elsif wanted_kind = 'status' then
      if not public.crm_profile_text_ok(given -> 'text', 1, 40)
        or (given ? 'state' and (pg_catalog.jsonb_typeof(given -> 'state') <> 'string'
          or given ->> 'state' not in ('open', 'away'))) then
        raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
      end if;
    elsif wanted_kind = 'audio' then
      if pg_catalog.jsonb_typeof(given -> 'audio') is distinct from 'string' or given ->> 'audio' !~ uuid_shape
        or (given ? 'title' and not public.crm_profile_text_ok(given -> 'title', 1, 60))
        or (given ? 'wave' and (pg_catalog.jsonb_typeof(given -> 'wave') <> 'string'
          or given ->> 'wave' !~ '^[0-9a-v]{48}$')) then
        raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
      end if;
    elsif wanted_kind = 'location' then
      if not public.crm_profile_text_ok(given -> 'address', 1, 200)
        or (given ? 'title' and not public.crm_profile_text_ok(given -> 'title', 1, 60)) then
        raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
      end if;
    elsif wanted_kind = 'logos' then
      -- Two to twelve logos, each a picture's id and the client's name and nothing else, none twice.
      if pg_catalog.jsonb_typeof(given -> 'images') is distinct from 'array'
        or pg_catalog.jsonb_array_length(given -> 'images') not between 2 and 12
        or exists (select 1 from pg_catalog.jsonb_array_elements(given -> 'images') g(pic)
          where pg_catalog.jsonb_typeof(g.pic) <> 'object'
            or exists (select 1 from pg_catalog.jsonb_each(g.pic) f where f.key <> all (array['image', 'alt']))
            or pg_catalog.jsonb_typeof(g.pic -> 'image') is distinct from 'string'
            or (g.pic ->> 'image') !~ uuid_shape
            or not public.crm_profile_text_ok(g.pic -> 'alt', 1, 80))
        or (select pg_catalog.count(distinct g.pic ->> 'image')
          from pg_catalog.jsonb_array_elements(given -> 'images') g(pic))
          <> pg_catalog.jsonb_array_length(given -> 'images') then
        raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
      end if;
    else
      -- The kinds made of rows: each row an object of its kind's fields only, within its kind's count.
      if pg_catalog.jsonb_typeof(given -> 'items') is distinct from 'array'
        or pg_catalog.jsonb_array_length(given -> 'items') not between
          (case wanted_kind when 'steps' then 2 else 1 end)
          and (case wanted_kind when 'timeline' then 12 when 'work' then 6 when 'steps' then 6 else 8 end)
        or exists (select 1 from pg_catalog.jsonb_array_elements(given -> 'items') r(entry)
          where pg_catalog.jsonb_typeof(r.entry) <> 'object'
            or exists (select 1 from pg_catalog.jsonb_each(r.entry) f where f.key <> all (case wanted_kind
              when 'timeline' then array['when', 'title', 'place']
              when 'work' then array['image', 'title', 'body', 'url']
              when 'steps' then array['title', 'body']
              else array['title', 'at', 'place', 'url'] end))
            or not public.crm_profile_text_ok(r.entry -> 'title', 1, 60)
            or (wanted_kind = 'timeline' and not public.crm_profile_text_ok(r.entry -> 'when', 1, 20))
            or (wanted_kind = 'steps' and not public.crm_profile_text_ok(r.entry -> 'body', 1, 240))
            or (wanted_kind = 'work' and r.entry ? 'body' and not public.crm_profile_text_ok(r.entry -> 'body', 1, 160))
            or (wanted_kind = 'work' and r.entry ? 'image' and (pg_catalog.jsonb_typeof(r.entry -> 'image') <> 'string'
              or (r.entry ->> 'image') !~ uuid_shape))
            or (wanted_kind in ('timeline', 'events') and r.entry ? 'place'
              and not public.crm_profile_text_ok(r.entry -> 'place', 1, 60))
            or (wanted_kind = 'events' and (pg_catalog.jsonb_typeof(r.entry -> 'at') is distinct from 'string'
              or (r.entry ->> 'at') !~ instant))
            or (r.entry ? 'url' and (pg_catalog.jsonb_typeof(r.entry -> 'url') <> 'string'
              or pg_catalog.char_length(r.entry ->> 'url') > 2000 or (r.entry ->> 'url') ~ '[[:cntrl:][:space:]]'
              or (r.entry ->> 'url') !~* web))) then
        raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
      end if;
      -- And a real instant: a month 13 is the shape and no time at all.
      if wanted_kind = 'events' then
        begin
          perform (r.entry ->> 'at')::timestamptz from pg_catalog.jsonb_array_elements(given -> 'items') r(entry);
        exception when others then
          raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
        end;
      end if;
    end if;
    return;
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
  if wanted_kind in ('page', 'times') then
    if workspace is null or page is null then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if workspace is not null or page is not null then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'socials' then
    return;
  end if;
  if wanted_kind = 'banner' then
    if words is null or words ~ '[[:cntrl:]]' or words <> pg_catalog.btrim(words) or words = ''
      or pg_catalog.char_length(words) > 80
      or (link is not null and (pg_catalog.char_length(link) > 2000 or link ~ '[[:cntrl:][:space:]]'
        or link !~* web)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
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
-- 0156's caps, with spec 0068's kinds (the contracts' PROFILE_LIMITS alike).
create or replace function crm_profile_kind_cap(wanted_kind text)
  returns integer
  language sql
  immutable
  set search_path = pg_catalog, pg_temp
begin atomic
  select case crm_profile_kind_cap.wanted_kind
    when 'link' then 40 when 'heading' then 12 when 'contact' then 3 when 'text' then 5 when 'faq' then 2
    when 'form' then 3 when 'testimonial' then 6 when 'socials' then 1 when 'media' then 10 when 'image' then 10
    when 'gallery' then 3 when 'times' then 3 when 'banner' then 1
    when 'profile' then 1 when 'status' then 1 when 'audio' then 1 when 'timeline' then 2 when 'logos' then 2
    when 'work' then 3 when 'steps' then 2 when 'location' then 3 when 'events' then 2 else 60 end;
end;
--> statement-breakpoint
-- Every stored file a block's data names: 0156's (a link's thumbnail, a picture, a poster, a gallery's or a row of
-- logos' pictures), and now an audio intro's recording and a work card's picture.
create or replace function crm_profile_item_images(given jsonb)
  returns setof uuid
  language sql
  immutable
  set search_path = pg_catalog, pg_temp
begin atomic
  select r.id::uuid from (
    select crm_profile_item_images.given ->> 'thumb' as id
    union all select crm_profile_item_images.given ->> 'image'
    union all select crm_profile_item_images.given ->> 'poster'
    union all select crm_profile_item_images.given ->> 'audio'
    union all select g.pic ->> 'image'
    from pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(crm_profile_item_images.given -> 'images') = 'array'
        then crm_profile_item_images.given -> 'images' else '[]'::jsonb end) g(pic)
    union all select w.entry ->> 'image'
    from pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(crm_profile_item_images.given -> 'items') = 'array'
        then crm_profile_item_images.given -> 'items' else '[]'::jsonb end) w(entry)
    where pg_catalog.jsonb_typeof(w.entry) = 'object'
  ) r
  where r.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
end;
--> statement-breakpoint
-- 0156's save, and one rule more (AC-6808): an audio intro names one of the owner's recordings, and every picture
-- slot one of their pictures, never the other, so a sound is never drawn as a picture nor a picture played.
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
  if (wanted_kind = 'audio' and not exists (select 1 from auth.profile_images m
      where m.id = (given ->> 'audio')::uuid and m.user_id = owner and m.workspace_id = workspace
        and m.kind = 'audio'))
    or exists (select 1 from public.crm_profile_item_images(given - 'audio') w(image)
      join auth.profile_images m on m.id = w.image
      where m.kind = 'audio') then
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
-- 0172's, with the presses spec 0068's cards carry: an audio intro's Play, a work card's or an event's link, a
-- location's Directions and a profile card's Book.
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
    join auth.public_profiles p on p.user_id = i.user_id and p.workspace_id = i.workspace_id
    where i.id = crm_count_item_press.item and i.user_id = crm_count_item_press.owner
      and i.workspace_id = crm_count_item_press.workspace
      and exists (select 1 from pg_catalog.jsonb_array_elements(p.published -> 'items') e
        where e ->> 'id' = i.id::text)
      and i.kind = any (array['link', 'page', 'contact', 'media', 'image', 'banner', 'times',
        'profile', 'audio', 'work', 'location', 'events'])
    on conflict (item_id, day, visitor)
      do update set presses = auth.profile_item_presses.presses + 1, last_at = pg_catalog.now()
    returning auth.profile_item_presses.item_id, auth.profile_item_presses.day
  )
  insert into auth.profile_item_press_days (item_id, day, presses)
  select press.item_id, press.day, 1 from press
  on conflict (item_id, day) do update set presses = auth.profile_item_press_days.presses + 1;
end;
--> statement-breakpoint
revoke all on function crm_profile_text_ok(jsonb, integer, integer) from public;
--> statement-breakpoint
-- What the new check must accept and refuse, said here so a migration that breaks it never lands.
do $$
declare
  block text;
begin
  perform crm_check_profile_item('profile', '{"line":"Product designer in Lisbon","size":"wide"}'::jsonb, null, null, null);
  perform crm_check_profile_item('profile', '{}'::jsonb, null, null, null);
  perform crm_check_profile_item('status', '{"text":"Available for work","state":"open"}'::jsonb, null, null, null);
  perform crm_check_profile_item('audio',
    '{"audio":"0190a0a0-0000-7000-8000-000000000001","title":"Hi, I’m Ada","wave":"0123456789abcdefghijklmnopqrstuv0123456789abcdef"}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('timeline',
    '{"title":"Experience","items":[{"when":"2021","title":"Designer","place":"Webflow"},{"when":"2019","title":"Intern"}]}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('logos',
    '{"images":[{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"Acme"},{"image":"0190a0a0-0000-7000-8000-000000000002","alt":"Globex"}]}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('work',
    '{"items":[{"image":"0190a0a0-0000-7000-8000-000000000001","title":"Effy","body":"A social app","url":"https://a.co"},{"title":"Trade"}]}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('steps',
    '{"title":"How I work","items":[{"title":"Discovery call","body":"Thirty minutes, free."},{"title":"Plan","body":"A written plan."}]}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('location', '{"title":"Studio","address":"1 Main St, Lisbon"}'::jsonb, null, null, null);
  perform crm_check_profile_item('events',
    '{"items":[{"title":"Open studio","at":"2026-12-01T18:00:00.000Z","place":"Lisbon","url":"https://a.co/e"}]}'::jsonb,
    null, null, null);
  perform crm_check_profile_item('text', '{"body":"A","size":"wide"}'::jsonb, null, null, null);
  for block in select unnest(array[
    '{"kind":"heading","data":{"title":"A","size":"wide"}}',
    '{"kind":"banner","data":{"text":"A","size":"wide"}}',
    '{"kind":"profile","data":{"line":" padded "}}',
    '{"kind":"profile","data":{"name":"Someone else"}}',
    '{"kind":"status","data":{}}',
    '{"kind":"status","data":{"text":"Open","state":"busy"}}',
    '{"kind":"audio","data":{"audio":"not-a-uuid"}}',
    '{"kind":"audio","data":{"audio":"0190a0a0-0000-7000-8000-000000000001","wave":"<script>"}}',
    '{"kind":"audio","data":{"audio":"0190a0a0-0000-7000-8000-000000000001","src":"https://evil.example/a.mp3"}}',
    '{"kind":"timeline","data":{"items":[]}}',
    '{"kind":"timeline","data":{"items":[{"when":"2021"}]}}',
    '{"kind":"timeline","data":{"items":[{"when":"2021","title":"A","extra":"x"}]}}',
    '{"kind":"logos","data":{"images":[{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"A"}]}}',
    '{"kind":"logos","data":{"images":[{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"A"},{"image":"0190a0a0-0000-7000-8000-000000000001","alt":"B"}]}}',
    '{"kind":"work","data":{"items":[{"title":"A","url":"javascript:alert(1)"}]}}',
    '{"kind":"work","data":{"items":[{"title":"A","image":"x"}]}}',
    '{"kind":"steps","data":{"items":[{"title":"Only one","body":"A"}]}}',
    '{"kind":"location","data":{"title":"Studio"}}',
    '{"kind":"events","data":{"items":[{"title":"A","at":"tomorrow"}]}}',
    '{"kind":"events","data":{"items":[{"title":"A","at":"2026-13-01T18:00:00.000Z"}]}}'])
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
-- Refuse to finish unless the save and the press are still crm_handle's definers for crm_app alone, and the check
-- and its helpers reachable only from crm_handle's own functions.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid)'::regprocedure,
    'public.crm_count_item_press(uuid, uuid, uuid, text)'::regprocedure
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
    'public.crm_profile_item_images(jsonb)'::regprocedure,
    'public.crm_profile_text_ok(jsonb, integer, integer)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or has_function_privilege('crm_app', fn, 'EXECUTE')
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be crm_handle''s and reachable only from its own functions', fn;
    end if;
  end loop;
end
$$;
