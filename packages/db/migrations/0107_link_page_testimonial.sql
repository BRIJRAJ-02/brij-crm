-- Something a customer said (spec 0052, AC-5219, AC-5220): a `testimonial` block of three plain strings, the words,
-- who said them and what they do. No photo and no logo — the page loads no picture from another origin, and a face
-- would need the file storage that is not built yet — so there is nothing here to fetch, store or sanitise.
--
-- It is a kind like every other: one word in `profile_items_kind`, one line in the plain check (it names no
-- workspace, no page and no form), one branch in crm_check_profile_item, and its cap in the two functions that
-- count. Six live on one page, which is enough to be persuasive and few enough to stay read.
--
-- The cap goes in both places on purpose. crm_save_profile_item counts on an add, and crm_archive_profile_item
-- counts on a restore, because a restore is an add: migration 0103 closed exactly that gap for writing and
-- questions, and a kind added without touching both would open it again.
--
-- No signature changes here, so all three are replaces in place: no grant is remade and no dependent function is
-- dropped.

alter table "auth"."profile_items" drop constraint "profile_items_kind";

--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_kind" CHECK ("auth"."profile_items"."kind" in ('link', 'page', 'heading', 'contact', 'text', 'faq', 'form', 'testimonial'));

--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_plain";

--> statement-breakpoint
-- A testimonial is words and nothing else: it names no workspace, no booking page and no form.
alter table "auth"."profile_items" add constraint "profile_items_plain" CHECK ("auth"."profile_items"."kind" not in ('link', 'heading', 'contact', 'text', 'faq', 'testimonial') or ("auth"."profile_items"."page_id" is null and "auth"."profile_items"."form_id" is null));

--> statement-breakpoint
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
    when 'contact' then array['fullName', 'jobTitle', 'company', 'email', 'phone', 'website', 'note']
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
create or replace function crm_save_profile_item(owner uuid, item uuid, wanted_kind text, given jsonb, workspace uuid, page uuid, form uuid)
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
  cap integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  perform public.crm_check_profile_item(wanted_kind, given, workspace, page, form);
  select * into held from auth.profile_items i where i.id = item for update;
  if found then
    if held.user_id <> owner then
      raise exception using errcode = 'P0002', message = 'PROFILE_ITEM_MISSING';
    end if;
    if held.kind <> wanted_kind then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    update auth.profile_items i
    set data = given, workspace_id = workspace, page_id = page, form_id = form, updated_at = pg_catalog.now()
    where i.id = item and (i.data, i.workspace_id, i.page_id, i.form_id) is distinct from (given, workspace, page, form);
  else
    select count(*) filter (where i.archived_at is null),
      count(*) filter (where i.archived_at is null and i.kind = wanted_kind),
      count(*)
    into live, live_kind, kept
    from auth.profile_items i where i.user_id = owner;
    cap := case wanted_kind
      when 'link' then 40 when 'heading' then 12 when 'text' then 5 when 'faq' then 2 when 'form' then 3
      when 'testimonial' then 6 else 60 end;
    if live >= 60 or kept >= 200 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= cap then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = wanted_kind;
    end if;
    insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id, form_id)
    values (item, owner, wanted_kind,
      (select coalesce(max(i.position) + 1, 0) from auth.profile_items i where i.user_id = owner and i.archived_at is null),
      given, workspace, page, form);
  end if;
  return query
    select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
    from auth.profile_items i where i.id = item;
end;
$$;

--> statement-breakpoint
create or replace function crm_archive_profile_item(owner uuid, item uuid, archived boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  held auth.profile_items%rowtype;
  live integer;
  live_kind integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  select * into held from auth.profile_items i where i.id = item and i.user_id = owner for update;
  if not found then
    return false;
  end if;
  if archived and held.archived_at is null then
    update auth.profile_items i set archived_at = pg_catalog.now(), position = null, updated_at = pg_catalog.now()
    where i.id = item;
    perform public.crm_pack_profile_items(owner);
  elsif not archived and held.archived_at is not null then
    select count(*), count(*) filter (where i.kind = held.kind) into live, live_kind
    from auth.profile_items i where i.user_id = owner and i.archived_at is null;
    if live >= 60 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= (case held.kind when 'link' then 40 when 'heading' then 12 when 'contact' then 1
        when 'text' then 5 when 'faq' then 2 when 'form' then 3 when 'testimonial' then 6 else 60 end) then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = held.kind;
    end if;
    update auth.profile_items i
    set archived_at = null, updated_at = pg_catalog.now(),
      position = (select coalesce(max(p.position) + 1, 0) from auth.profile_items p
        where p.user_id = owner and p.archived_at is null)
    where i.id = item;
  end if;
  return true;
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
  -- Replaces in place keep their grants; this says so rather than trusting it. The check is reached only through
  -- crm_save_profile_item, so crm_app must still hold no execute of its own on it.
  if has_function_privilege('crm_app', 'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
    or not has_function_privilege('crm_app',
      'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
    or not has_function_privilege('crm_app', 'public.crm_archive_profile_item(uuid, uuid, boolean)', 'EXECUTE') then
    raise exception 'the link page''s block functions are not granted as they must be';
  end if;
  if has_table_privilege('crm_app', 'auth.profile_items', 'SELECT') then
    raise exception 'crm_app must not read auth.profile_items directly';
  end if;
end
$$;
