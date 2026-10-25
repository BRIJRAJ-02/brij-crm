-- The per kind limits the new kinds brought (spec 0052, AC-5208, AC-5212). crm_save_profile_item has capped links
-- at 40 and headings at 12 since migration 0098; `text` and `faq` arrived in 0101 and 0102 with their words, their
-- Zod schemas and the editor's disabled cards, but fell through that function's `else 60`, so the server took a
-- sixth piece of writing or a third set of questions from any caller that skipped the editor. The caps are the only
-- thing that changes here; the functions are otherwise the ones 0098 wrote, replaced in place so they keep their
-- owners, their grants and their signatures.
-- crm_archive_profile_item carries the same list, for a restore: it had the gap too, so an archived sixth piece of
-- writing could be put back on the page although a new one was refused.
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
create or replace function crm_save_profile_item(owner uuid, item uuid, wanted_kind text, given jsonb, workspace uuid, page uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid,
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
  perform public.crm_check_profile_item(wanted_kind, given, workspace, page);
  select * into held from auth.profile_items i where i.id = item for update;
  if found then
    if held.user_id <> owner then
      raise exception using errcode = 'P0002', message = 'PROFILE_ITEM_MISSING';
    end if;
    if held.kind <> wanted_kind then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    update auth.profile_items i
    set data = given, workspace_id = workspace, page_id = page, updated_at = pg_catalog.now()
    where i.id = item and (i.data, i.workspace_id, i.page_id) is distinct from (given, workspace, page);
  else
    select count(*) filter (where i.archived_at is null),
      count(*) filter (where i.archived_at is null and i.kind = wanted_kind),
      count(*)
    into live, live_kind, kept
    from auth.profile_items i where i.user_id = owner;
    -- PROFILE_LIMITS in @crm/contracts, said again here because SQL can't read it: the editor disables a full
    -- kind with the same sentence, and this is what refuses a caller that went around the editor. A contact card
    -- is capped by profile_items_contact_once instead, since one is a uniqueness rule, not a count.
    cap := case wanted_kind
      when 'link' then 40 when 'heading' then 12 when 'text' then 5 when 'faq' then 2 else 60 end;
    if live >= 60 or kept >= 200 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= cap then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = wanted_kind;
    end if;
    insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id)
    values (item, owner, wanted_kind,
      (select coalesce(max(i.position) + 1, 0) from auth.profile_items i where i.user_id = owner and i.archived_at is null),
      given, workspace, page);
  end if;
  return query
    select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.archived_at, i.updated_at
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
        when 'text' then 5 when 'faq' then 2 else 60 end) then
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
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
      where p.oid = 'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid)'::regprocedure)) <> 'crm_handle'
    or not (select p.prosecdef from pg_proc p
      where p.oid = 'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid)'::regprocedure)
    or not has_function_privilege('crm_app', 'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid)', 'EXECUTE') then
    raise exception 'crm_save_profile_item must stay crm_handle''s own definer, reachable by crm_app';
  end if;
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
      where p.oid = 'public.crm_archive_profile_item(uuid, uuid, boolean)'::regprocedure)) <> 'crm_handle'
    or not (select p.prosecdef from pg_proc p
      where p.oid = 'public.crm_archive_profile_item(uuid, uuid, boolean)'::regprocedure)
    or not has_function_privilege('crm_app', 'public.crm_archive_profile_item(uuid, uuid, boolean)', 'EXECUTE') then
    raise exception 'crm_archive_profile_item must stay crm_handle''s own definer, reachable by crm_app';
  end if;
end
$$;
