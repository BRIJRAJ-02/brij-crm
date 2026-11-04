-- Menu QR per table (spec 0065, H2) and the link page's Menu and Reserve blocks (spec 0065, AC-6528). Numbered 0180,
-- after 0179's business page (written as 0181, renumbered when it joined the hospitality car). 4 November 2026.
--
-- What changes:
-- * `resources.table_code`: every resource gets its own code, which its printed QR carries as `/m/<menu key>?t=<code>`.
--   22 characters of base64url from a v4 uuid's bytes, so 122 random bits: never guessable, never counted up, never
--   derived from the label. Unique in its workspace (`resources_table_code`, led by the workspace as every index is):
--   a guest reaches a code only after the menu key named the workspace. Regenerating a code is an update to a fresh
--   default; the old print stops working. A guest's read of the code goes through the menu door first
--   (`crm_menu_by_key`), and only then reads the resource inside that workspace, under its row level security: no
--   new definer.
-- * The link page's two new kinds, `menu` and `reserve` (AC-6528): a block names one of its own workspace's places by
--   `placeId` in its data, with an optional label. `profile_items_kind` and `crm_check_profile_item` learn them (no
--   workspace, page or form column: the place is the block's own workspace's, read under that workspace's row level
--   security when the page is shown, so an id from elsewhere shows nothing), `crm_profile_kind_cap` holds each to 3 a page, and
--   `crm_count_item_press` counts a press on either. Drafts, Publish, versions and Restore take them as every kind:
--   those definers call the check and the cap, and carry the data as it is.
--
-- Postgres 17 compatible (gen_random_uuid and uuid_send are core since 13). Any change to crm_handle's functions
-- goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table resources
  add column table_code text not null
  default rtrim(translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/', '-_'), '=');
--> statement-breakpoint
alter table resources add constraint resources_table_code_shape check (table_code ~ '^[A-Za-z0-9_-]{22}$');
--> statement-breakpoint
create unique index resources_table_code on resources using btree (workspace_id, table_code);
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_kind";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_kind" check ("kind" in ('link', 'page', 'heading',
  'contact', 'text', 'faq', 'form', 'testimonial', 'socials', 'media', 'image', 'gallery', 'times', 'banner', 'menu',
  'reserve'));
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- 0156's block check, with spec 0065's Menu and Reserve blocks.
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
      'media', 'image', 'gallery', 'times', 'banner', 'menu', 'reserve') then
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
    when 'menu' then array['placeId', 'label']
    when 'reserve' then array['placeId', 'label']
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
  -- A place's guest menu or its reservation page (spec 0065, AC-6528): the place by its id, in the block's own
  -- workspace (the page's), and an optional line of the owner's words for the row. The place is read under that
  -- workspace's row level security when the page is shown, so an id from another workspace shows nothing.
  if wanted_kind in ('menu', 'reserve') then
    if given ->> 'placeId' is null or given ->> 'placeId' !~ uuid_shape
      or (label is not null and (label ~ '[[:cntrl:]]' or label <> pg_catalog.btrim(label) or label = ''
        or pg_catalog.char_length(label) > 60)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
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
-- 0156's caps, with Menu and Reserve at 3 a page each (a business with up to three places).
create or replace function crm_profile_kind_cap(wanted_kind text)
  returns integer
  language sql
  immutable
  set search_path = pg_catalog, pg_temp
begin atomic
  select case crm_profile_kind_cap.wanted_kind
    when 'link' then 40 when 'heading' then 12 when 'contact' then 3 when 'text' then 5 when 'faq' then 2
    when 'form' then 3 when 'testimonial' then 6 when 'socials' then 1 when 'media' then 10 when 'image' then 10
    when 'gallery' then 3 when 'times' then 3 when 'banner' then 1 when 'menu' then 3 when 'reserve' then 3
    else 60 end;
end;
--> statement-breakpoint
-- 0172's press count, on a published Menu or Reserve block too.
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
      and i.kind = any (array['link', 'page', 'contact', 'media', 'image', 'banner', 'times', 'menu', 'reserve'])
    on conflict (item_id, day, visitor)
      do update set presses = auth.profile_item_presses.presses + 1, last_at = pg_catalog.now()
    returning auth.profile_item_presses.item_id, auth.profile_item_presses.day
  )
  insert into auth.profile_item_press_days (item_id, day, presses)
  select press.item_id, press.day, 1 from press
  on conflict (item_id, day) do update set presses = auth.profile_item_press_days.presses + 1;
end;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless the three are still crm_handle's own and no one new may run them.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)'::regprocedure,
    'public.crm_profile_kind_cap(text)'::regprocedure,
    'public.crm_count_item_press(uuid, uuid, uuid, text)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or has_function_privilege('crm_identity', fn, 'EXECUTE')
      or has_function_privilege('public', fn, 'EXECUTE') then
      raise exception '% must stay crm_handle''s, out of other roles'' reach', fn;
    end if;
  end loop;
  if has_function_privilege('crm_app', 'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
    or has_function_privilege('crm_app', 'public.crm_profile_kind_cap(text)', 'EXECUTE') then
    raise exception 'the block check and the caps are crm_handle''s functions alone';
  end if;
end
$$;
