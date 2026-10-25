-- The questions people ask, answered on the link page (spec 0052, slice 1, AC-5209): the `faq` kind. A set of
-- questions is an optional title and one to ten `{ question, answer }` entries, the question one trimmed line of
-- 1 to 120 characters, the answer 1 to 600 with at most 10 line breaks and no other control character, and no
-- question asked twice once case and surrounding spaces are set aside: the same rule the Zod schema and the
-- browser's checker keep.
-- It is the first kind whose `data` holds something that is not a string, so the check that every value is a
-- string now runs for the other kinds only and a set of questions checks its own two keys and their types itself.
-- `crm_check_profile_item` is replaced as its owner, `crm_handle`, so it keeps its owner and its grants.
alter table "auth"."profile_items" drop constraint "profile_items_plain";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_plain" CHECK ("auth"."profile_items"."kind" not in ('link', 'heading', 'contact', 'text', 'faq') or "auth"."profile_items"."page_id" is null);
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_kind";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_kind" CHECK ("auth"."profile_items"."kind" in ('link', 'page', 'heading', 'contact', 'text', 'faq'));
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
  if wanted_kind is null or wanted_kind not in ('link', 'page', 'heading', 'contact', 'text', 'faq') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_KIND';
  end if;
  if given is null or pg_catalog.jsonb_typeof(given) <> 'object' then
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
