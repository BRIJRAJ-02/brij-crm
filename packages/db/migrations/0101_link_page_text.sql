-- Writing on the link page (spec 0052, slice 1, AC-5205): the `text` kind. A piece of writing is a body of 1 to
-- 1,000 characters with at most 20 line breaks and no other control character, and, only when given, a title of up
-- to 60 characters on one line: the same rule the Zod schema and the browser's checker keep. Line breaks are the one
-- control character a body may hold, which is why it is checked apart from every other kind's one line fields.
-- `profile_items_kind` takes the word, and `crm_check_profile_item` is replaced as its owner, `crm_handle`, so it
-- keeps its owner and its grants.
-- AC-5203: a block's data may hold 16 KB, up from 4 KB. A thousand characters of writing can be four thousand
-- bytes on its own, and a FAQ's ten questions and answers will need the room. Each kind's own field limits, not
-- this one, are what a person meets.
alter table "auth"."profile_items" drop constraint "profile_items_data";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_data" CHECK (jsonb_typeof("auth"."profile_items"."data") = 'object' and pg_column_size("auth"."profile_items"."data") <= 16384);
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_plain";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_plain" CHECK ("auth"."profile_items"."kind" not in ('link', 'heading', 'contact', 'text') or "auth"."profile_items"."page_id" is null);
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_kind";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_kind" CHECK ("auth"."profile_items"."kind" in ('link', 'page', 'heading', 'contact', 'text'));
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
create or replace function crm_check_profile_item(wanted_kind text, given jsonb, workspace uuid, page uuid)
  returns void
  language plpgsql
  immutable
  set search_path = pg_catalog, pg_temp
as $$
declare
  title text := given ->> 'title';
  link text := given ->> 'url';
  note text := given ->> 'note';
  email text := given ->> 'email';
  phone text := given ->> 'phone';
  website text := given ->> 'website';
  body text := given ->> 'body';
  allowed text[];
begin
  if wanted_kind is null or wanted_kind not in ('link', 'page', 'heading', 'contact', 'text') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_KIND';
  end if;
  if given is null or pg_catalog.jsonb_typeof(given) <> 'object' then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  allowed := case wanted_kind
    when 'link' then array['title', 'url', 'note', 'icon', 'hue']
    when 'heading' then array['title']
    when 'contact' then array['fullName', 'jobTitle', 'company', 'email', 'phone', 'website', 'note']
    when 'text' then array['title', 'body']
    else array[]::text[] end;
  if exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> all (allowed)
      or pg_catalog.jsonb_typeof(e.value) <> 'string') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'page' then
    if workspace is null or page is null then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if workspace is not null or page is not null then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'contact' then
    -- Every value one trimmed line with no control characters, a name always, each within its length.
    if exists (select 1 from pg_catalog.jsonb_each_text(given) e
        where e.value ~ '[[:cntrl:]]' or e.value <> pg_catalog.btrim(e.value) or e.value = ''
          or pg_catalog.char_length(e.value) > (case e.key when 'fullName' then 80 when 'phone' then 32
            when 'website' then 2000 else 120 end))
      or given ->> 'fullName' is null
      or (email is not null and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
      or (phone is not null and (phone !~ '^\+?[0-9 ().-]+$'
        or pg_catalog.char_length(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g')) not between 3 and 20))
      or (website is not null and (website ~ '[[:space:]]'
        or website !~* '^https?://[^/?#@]+([/?#].*)?$')) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if wanted_kind = 'text' then
    -- The body keeps its line breaks and nothing else: trimmed, 1 to 1,000 characters, at most 20 breaks. The
    -- title, when there is one, is one trimmed line of at most 60.
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
  if title is null or title ~ '[[:cntrl:]]'
    or pg_catalog.char_length(pg_catalog.btrim(title)) < 1
    or pg_catalog.char_length(title) > (case wanted_kind when 'link' then 60 else 40 end) then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'link' then
    -- The schemes AC-5103 allows, no credentials, no control characters or spaces, at most 2,000 characters.
    if link is null or pg_catalog.char_length(link) > 2000 or link ~ '[[:cntrl:][:space:]]'
      or link !~* '^(https?://[^/?#@]+([/?#].*)?|mailto:.+|tel:.+|sms:.+)$'
      or (note is not null and (pg_catalog.char_length(note) > 120 or note ~ '[[:cntrl:]]')) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
  end if;
end;
$$;
--> statement-breakpoint
revoke all on function crm_check_profile_item(text, jsonb, uuid, uuid) from public;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
      where p.oid = 'public.crm_check_profile_item(text, jsonb, uuid, uuid)'::regprocedure)) <> 'crm_handle'
    or (select p.prosecdef from pg_proc p
      where p.oid = 'public.crm_check_profile_item(text, jsonb, uuid, uuid)'::regprocedure)
    or has_function_privilege('crm_app', 'public.crm_check_profile_item(text, jsonb, uuid, uuid)', 'EXECUTE') then
    raise exception 'crm_check_profile_item must stay crm_handle''s own, not a definer, and out of crm_app''s reach';
  end if;
end
$$;
