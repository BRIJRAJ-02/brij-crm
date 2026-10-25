-- Folders on the link page (spec 0054, AC-5415): a heading's `data` gains one word, `group`, which is `open` (the
-- small heading the page draws today) or `folder` (one row a visitor presses to open the blocks under it).
--
-- It is not a new kind, not a new column and not a level above the list. The blocks under a heading are still the
-- blocks after it until the next heading (spec 0051, AC-5137), the order stays one flat sequence, and spec 0051's
-- limits, reorder statement, hide rule and backfill are untouched. So this migration changes one function and
-- nothing else: crm_check_profile_item lets a heading carry `group` and refuses any word but those two, the same
-- way every other block field is checked (spec 0051 amendment 1).
--
-- `open` is never stored. The service writes the key only for a folder, so every heading written before this
-- migration and every open heading written after it hold the same `{"title": ...}` they always did, and a read
-- that meets no key, or a word a later build adds, draws the heading open.
--
-- The signature does not change and the function still returns void, so this is a replace in place: no grant is
-- remade, no dependent function is dropped, and crm_save_profile_item calls the same function it always called.

-- The definers are owned by crm_handle, so a replace has to run as that role: the migration's own role is not
-- the owner and Postgres refuses it ("must be owner of function"). Same block 0104 uses, entered and left here.
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
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
  email text := given ->> 'email';
  phone text := given ->> 'phone';
  website text := given ->> 'website';
  body text := given ->> 'body';
  label text := given ->> 'label';
  allowed text[];
begin
  if wanted_kind is null
    or wanted_kind not in ('link', 'page', 'heading', 'contact', 'text', 'faq', 'form') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_KIND';
  end if;
  if given is null or pg_catalog.jsonb_typeof(given) <> 'object' then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
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
    -- Two keys and no others: an optional title, and one to ten questions in an array.
    if exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> all (array['title', 'items']))
      or pg_catalog.jsonb_typeof(given -> 'items') is distinct from 'array'
      or pg_catalog.jsonb_array_length(given -> 'items') not between 1 and 10
      or (given ? 'title' and (pg_catalog.jsonb_typeof(given -> 'title') <> 'string'
        or title ~ '[[:cntrl:]]' or title <> pg_catalog.btrim(title) or title = ''
        or pg_catalog.char_length(title) > 60)) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    -- Each entry: a question and an answer, both strings, within their own rules. The answer keeps its line
    -- breaks and nothing else, as a piece of writing's body does.
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
    -- The same question twice, however it was typed, is one question asked twice.
    if (select pg_catalog.count(distinct pg_catalog.lower(pg_catalog.btrim(q.asked ->> 'question')))
        from pg_catalog.jsonb_array_elements(given -> 'items') q(asked))
      <> pg_catalog.jsonb_array_length(given -> 'items') then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  allowed := case wanted_kind
    when 'link' then array['title', 'url', 'note', 'icon', 'hue']
    when 'heading' then array['title', 'group']
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
  -- A heading's group: the small heading the page draws today, or a folder a visitor opens (AC-5415). It is
  -- written only when it is 'folder', so a heading stored before folders stays exactly the row it was.
  if wanted_kind = 'heading' and given ? 'group' and given ->> 'group' <> all (array['open', 'folder']) then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
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
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;

--> statement-breakpoint
do $$
begin
  -- A replace in place keeps the function's grants; this says so out loud rather than trusting it. The check is
  -- reached only through crm_save_profile_item, so crm_app must still have no execute of its own on it.
  if has_function_privilege('crm_app', 'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
    or not has_function_privilege('crm_app',
      'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'the link page''s block check is not granted as it must be';
  end if;
  if (select p.proconfig from pg_proc p
      where p.oid = 'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)'::regprocedure)
    is distinct from array['search_path=pg_catalog, pg_temp'] then
    raise exception 'the link page''s block check lost its fixed search_path';
  end if;
end
$$;
