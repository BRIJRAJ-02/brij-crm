-- A Timefix form on the link page (spec 0052, slice 1, AC-5213 to AC-5218): the `form` kind. Like a booking page
-- block, the form it names is two real columns rather than fields in `data`: `workspace_id`, which the table already
-- had, and the new `form_id`. A real pair means a deleted form can't leave a block pointing at nothing, and one form
-- is placed once (profile_items_form_once).
--
-- `data` holds `{ label }` only: the words the row shows, which the owner types and the editor fills with the form's
-- own name. The form's internal name never reaches the public page and neither does its headline, so the public read
-- needs the key and whether it is live, and nothing else. That is why crm_form_owner_forms answers four columns.
--
-- What changes, and why each one has to:
-- * the three readers gain `form_id`, so their return type changes and they are replaced rather than altered;
-- * crm_check_profile_item and crm_save_profile_item take `form`, a new signature, so the old ones are dropped
--   after the new ones exist and crm_app's grants are made again;
-- * crm_archive_profile_item learns the form cap for a restore;
-- * crm_form_lookup, until now allowed three columns of `forms` for the public key lookup, gains the three a form's
--   owner check needs, and owns crm_form_owner_forms, built exactly like crm_booking_owner_pages (0098).
-- Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';

--> statement-breakpoint
alter table "auth"."profile_items" add column "form_id" uuid;

--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_kind";

--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_kind" CHECK ("auth"."profile_items"."kind" in ('link', 'page', 'heading', 'contact', 'text', 'faq', 'form'));

--> statement-breakpoint
-- A form block names a workspace and no page; every other kind that names a workspace names a page.
alter table "auth"."profile_items" drop constraint "profile_items_target";

--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_target" CHECK (("auth"."profile_items"."workspace_id" is null) = ("auth"."profile_items"."page_id" is null and "auth"."profile_items"."form_id" is null));

--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_plain";

--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_plain" CHECK ("auth"."profile_items"."kind" not in ('link', 'heading', 'contact', 'text', 'faq') or ("auth"."profile_items"."page_id" is null and "auth"."profile_items"."form_id" is null));

--> statement-breakpoint
-- Only a form block names a form, and a form block always names one.
alter table "auth"."profile_items" add constraint "profile_items_form" CHECK (("auth"."profile_items"."kind" = 'form') = ("auth"."profile_items"."form_id" is not null));

--> statement-breakpoint
CREATE UNIQUE INDEX "profile_items_form_once" ON "auth"."profile_items" USING btree ("user_id","workspace_id","form_id") WHERE "auth"."profile_items"."kind" = 'form' and "auth"."profile_items"."archived_at" is null;

--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
drop function crm_profile_items(uuid);
--> statement-breakpoint
create function crm_profile_items(owner uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.user_id = crm_profile_items.owner and i.archived_at is null
  order by i.position, i.id
  limit 1000;
end;
--> statement-breakpoint
drop function crm_profile_items_archived(uuid);
--> statement-breakpoint
create function crm_profile_items_archived(owner uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.user_id = crm_profile_items_archived.owner and i.archived_at is not null
  order by i.archived_at desc, i.id
  limit 100;
end;
--> statement-breakpoint
drop function crm_profile_items_public(uuid, smallint, uuid, integer);
--> statement-breakpoint
create function crm_profile_items_public(owner uuid, after_position smallint, after_id uuid, max integer)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id
  from auth.profile_items i
  where i.user_id = crm_profile_items_public.owner and i.archived_at is null
    and (crm_profile_items_public.after_id is null
      or (i.position, i.id) > (crm_profile_items_public.after_position, crm_profile_items_public.after_id))
  order by i.position, i.id
  limit least(greatest(crm_profile_items_public.max, 1), 61);
end;
--> statement-breakpoint
create function crm_check_profile_item(wanted_kind text, given jsonb, workspace uuid, page uuid, form uuid)
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
create function crm_save_profile_item(owner uuid, item uuid, wanted_kind text, given jsonb, workspace uuid, page uuid, form uuid)
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
      else 60 end;
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
        when 'text' then 5 when 'faq' then 2 when 'form' then 3 else 60 end) then
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
-- The old signatures go once the new ones exist: nothing can call them, and crm_app's grant named the old one.
drop function crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid);
--> statement-breakpoint
drop function crm_check_profile_item(text, jsonb, uuid, uuid);
--> statement-breakpoint
-- Made as crm_handle, so they are already its own; only their reach has to be said.
revoke all on function crm_check_profile_item(text, jsonb, uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items(uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_archived(uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_public(uuid, smallint, uuid, integer) from public;
--> statement-breakpoint
grant execute on function crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items(uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_archived(uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_public(uuid, smallint, uuid, integer) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- The three columns a form's owner check needs, beside the three 0040 allowed for the public key lookup. Granted
-- before the function is made, so it never exists with a reach it cannot use.
grant select (status, archived_at, created_by_member_id) on forms to crm_form_lookup;

--> statement-breakpoint
grant select (workspace_id, id, user_id, status) on members to crm_form_lookup;

--> statement-breakpoint
grant select (id, deleted_at) on workspaces to crm_form_lookup;

--> statement-breakpoint
grant crm_form_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_form_lookup;
--> statement-breakpoint
set local role crm_form_lookup;
--> statement-breakpoint
-- The forms a person may place on their link page (AC-5213, AC-5214): their own, made by them as a member who is
-- still active, in a workspace that exists, not archived; only those `forms` names when given. `is_live` says
-- whether a visitor may open it now, so a paused or draft form keeps its block and comes back when it is published
-- again. Ids and the public key only: no name, no headline, no question and no count, which is everything a visitor
-- would otherwise learn from a block. Built exactly like crm_booking_owner_pages (0098).
create function crm_form_owner_forms(owner uuid, forms uuid[])
  returns table (workspace_id uuid, form_id uuid, public_key text, is_live boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select f.workspace_id, f.id, f.public_key, f.status = 'live'
  from public.forms f
  join public.workspaces w on w.id = f.workspace_id
  join public.members m on m.workspace_id = f.workspace_id and m.id = f.created_by_member_id
  where m.user_id = crm_form_owner_forms.owner
    and m.status = 'active'
    and f.archived_at is null
    and w.deleted_at is null
    and (crm_form_owner_forms.forms is null or f.id = any (crm_form_owner_forms.forms))
  order by f.workspace_id, f.id
  limit 200;
end;

--> statement-breakpoint
revoke all on function crm_form_owner_forms(uuid, uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_form_owner_forms(uuid, uuid[]) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_form_lookup;
--> statement-breakpoint
revoke crm_form_lookup from current_user;
--> statement-breakpoint
do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
      where p.oid = 'public.crm_form_owner_forms(uuid, uuid[])'::regprocedure)) <> 'crm_form_lookup'
    or not (select p.prosecdef from pg_proc p
      where p.oid = 'public.crm_form_owner_forms(uuid, uuid[])'::regprocedure)
    or has_function_privilege('crm_app', 'public.crm_check_profile_item(text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
    or not has_function_privilege('crm_app', 'public.crm_form_owner_forms(uuid, uuid[])', 'EXECUTE')
    or not has_function_privilege('crm_app',
      'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'the link page''s form definers are not owned and granted as they must be';
  end if;
  -- crm_app still reaches the table only through the definers, never directly.
  if has_table_privilege('crm_app', 'auth.profile_items', 'SELECT') then
    raise exception 'crm_app must not read auth.profile_items directly';
  end if;
end
$$;
