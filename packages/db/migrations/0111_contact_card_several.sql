-- A contact card may carry a second and a third of each way to reach the person (26 October 2026): three emails,
-- three phone numbers and three websites, beside the one name, job title, company and note it already had.
--
-- Several of each is the vCard's own shape, not a second card: EMAIL, TEL and URL all repeat in RFC 6350, so one
-- card still downloads as one person. A page still holds one contact card (`profile_items_contact_once`), because
-- a second card would mean a second "Save contact" and an ambiguous vCard.
--
-- Nothing about the row changes: the data is jsonb, the new keys are strings like every other, and a card written
-- before today is still exactly what it was. So there is no backfill and nothing to expand or contract. What does
-- change is which keys crm_check_profile_item admits, and that it now reads each key's rule off the key's own word
-- (`email%`, `phone%`, `website%`) rather than naming the three one by one: the second and third of each are then
-- held to exactly what the first is, and a fourth can never slip in unchecked, since `allowed` still lists them.
--
-- It also refuses the same address listed twice, however it was typed, as the FAQ block refuses the same question
-- twice: the vCard would otherwise carry two identical lines.
--
-- No signature changes, so this is a replace in place: no grant is remade and no dependent function is dropped.

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
  body text := given ->> 'body';
  label text := given ->> 'label';
  quote text := given ->> 'quote';
  author text := given ->> 'author';
  said_role text := given ->> 'role';
  allowed text[];
begin
  if wanted_kind is null
    or wanted_kind not in ('link', 'page', 'heading', 'contact', 'text', 'faq', 'form', 'testimonial') then
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
    -- A card may carry a second and a third of each way to reach the person (26 October 2026): a vCard's EMAIL,
    -- TEL and URL repeat, so several of each is the format's own shape rather than a second card.
    when 'contact' then array['fullName', 'jobTitle', 'company', 'note',
      'email', 'email2', 'email3', 'phone', 'phone2', 'phone3', 'website', 'website2', 'website3']
    when 'text' then array['title', 'body']
    when 'testimonial' then array['quote', 'author', 'role']
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
    -- Every value one trimmed line with no control characters, a name always, each within its length, and each
    -- email, phone and website in its own shape. The rules are read off the key's own word rather than named one
    -- by one, so the second and third of each are held to exactly what the first is (26 October 2026).
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
    -- The same address twice is one address: a card that lists it again reads as a mistake, and the vCard would
    -- carry two identical lines.
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
    -- The words keep their line breaks and nothing else, as a piece of writing's body does; the name and the role
    -- are one trimmed line each, and the role may be left out but never left empty (AC-5219).
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
-- Still crm_handle here, which is the only role that may call the check at all: crm_app reaches it through
-- crm_save_profile_item and never directly, and the migration's own role not at all.
do $$
declare
  card text;
begin
  -- A card a migration before this one could write is still a card this one accepts, and the new keys are in.
  perform crm_check_profile_item('contact', '{"fullName":"Ada","email":"ada@example.com"}'::jsonb, null, null, null);
  perform crm_check_profile_item('contact',
    '{"fullName":"Ada","email":"a@b.co","email2":"c@d.co","phone":"+44 20 7946 0000","website2":"https://b.co"}'::jsonb,
    null, null, null);
  -- And what it must still refuse: a fourth of a kind, a second email that is not one, and the same twice.
  for card in select unnest(array[
    '{"fullName":"Ada","email4":"a@b.co"}',
    '{"fullName":"Ada","email2":"not-an-email"}',
    '{"fullName":"Ada","phone2":"12"}',
    '{"fullName":"Ada","website3":"mailto:a@b.co"}',
    '{"fullName":"Ada","email":"a@b.co","email2":"A@B.CO"}',
    '{"fullName":"Ada","phone":"+1 555 0100","phone2":"+1 (555) 0100"}'])
  loop
    begin
      perform crm_check_profile_item('contact', card::jsonb, null, null, null);
      raise exception 'crm_check_profile_item accepted a contact card it must refuse: %', card;
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
do $$
begin
  -- Replaces in place keep their grants; this says so rather than trusting it. The check is reached only through
  -- crm_save_profile_item, so crm_app must still hold no execute of its own on it.
  if has_function_privilege('crm_app', 'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
    or not has_function_privilege('crm_app',
      'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'the link page''s block functions are not granted as they must be';
  end if;
end
$$;
