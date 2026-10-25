-- Bringing a link in bio page across (spec 0055, AC-5524 to AC-5528). One table, `auth.link_imports`, and one
-- definer owned by crm_handle. Any change to these roles or functions goes through security-access-reviewer.
--
-- What the table is for, since the blocks it makes are ordinary blocks: an import has to be idempotent on its own
-- id (a retry of the same import adds nothing twice), it has to be countable (five an hour per account), and the
-- rows it could not map have to be kept so the person can still see them and decide. It holds the ids it made, in
-- the order the page had them, which is what lets the editor show one import as one section without a column on
-- every block and without remaking the three readers that answer a block's shape.
--
-- Every row it makes is hidden: `archived_at` set and `position` null, exactly as archiving a block leaves it. So
-- an import that is never reviewed changes nothing a visitor sees, and a person turns rows on one at a time
-- through the switch that was already there. Nothing here publishes anything.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "auth"."link_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_imports_source" CHECK (char_length("auth"."link_imports"."source") <= 400),
	CONSTRAINT "link_imports_items" CHECK (array_length("auth"."link_imports"."item_ids", 1) is null or array_length("auth"."link_imports"."item_ids", 1) <= 40)
);
--> statement-breakpoint
ALTER TABLE "auth"."link_imports" ADD CONSTRAINT "link_imports_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "link_imports_recent" ON "auth"."link_imports" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
grant select, insert on auth.link_imports to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- One import, in one transaction. `blocks` is a jsonb array of `{ id, data }`, in the order the page had them,
-- each already checked by its schema in core and checked again here by crm_check_profile_item, so a block the
-- editor itself could not have saved cannot arrive this way either.
--
-- It answers whether the import was already made (a retry adds nothing) and how many rows it holds. The limits
-- are the page's own, counted under the same advisory lock every other block write takes: a hidden row still
-- costs a row, so the 200 kept blocks cap holds, and five imports an hour per account bounds what one account can
-- ask us to fetch.
create function crm_import_profile_links(owner uuid, import uuid, source text, blocks jsonb, skipped jsonb)
  returns table (existed boolean, made integer)
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  block jsonb;
  ids uuid[] := '{}';
  kept integer;
  recent integer;
  held auth.link_imports%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  select * into held from auth.link_imports i where i.id = import;
  if found then
    if held.user_id <> owner then
      raise exception using errcode = 'P0002', message = 'LINK_IMPORT_MISSING';
    end if;
    return query select true, coalesce(pg_catalog.array_length(held.item_ids, 1), 0);
    return;
  end if;
  if pg_catalog.jsonb_array_length(blocks) > 40 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'link';
  end if;
  select count(*) into recent from auth.link_imports i
  where i.user_id = owner and i.created_at > pg_catalog.now() - interval '1 hour';
  if recent >= 5 then
    raise exception using errcode = '54000', message = 'LINK_IMPORT_LIMIT', detail = 'imports';
  end if;
  select count(*) into kept from auth.profile_items i where i.user_id = owner;
  if kept + pg_catalog.jsonb_array_length(blocks) > 200 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
  end if;
  for block in select * from pg_catalog.jsonb_array_elements(blocks) loop
    perform public.crm_check_profile_item('link', block -> 'data', null, null, null);
    insert into auth.profile_items (id, user_id, kind, position, data, archived_at)
    values ((block ->> 'id')::uuid, owner, 'link', null, block -> 'data', pg_catalog.now());
    ids := ids || (block ->> 'id')::uuid;
  end loop;
  insert into auth.link_imports (id, user_id, source, item_ids, skipped)
  values (import, owner, source, ids, skipped);
  return query select false, coalesce(pg_catalog.array_length(ids, 1), 0);
end;
$$;
--> statement-breakpoint
-- What one person's imports hold, newest first: the source, the rows it made and the rows it could not.
create function crm_link_imports_of(owner uuid)
  returns table (id uuid, source text, item_ids uuid[], skipped jsonb, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.source, i.item_ids, i.skipped, i.created_at
  from auth.link_imports i
  where i.user_id = crm_link_imports_of.owner
  order by i.created_at desc, i.id
  limit 20;
end;
--> statement-breakpoint
revoke all on function crm_import_profile_links(uuid, uuid, text, jsonb, jsonb) from public;
--> statement-breakpoint
grant execute on function crm_import_profile_links(uuid, uuid, text, jsonb, jsonb) to crm_app;
--> statement-breakpoint
revoke all on function crm_link_imports_of(uuid) from public;
--> statement-breakpoint
grant execute on function crm_link_imports_of(uuid) to crm_app;
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
      where p.oid = 'public.crm_import_profile_links(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) <> 'crm_handle'
    or not (select p.prosecdef from pg_proc p
      where p.oid = 'public.crm_import_profile_links(uuid, uuid, text, jsonb, jsonb)'::regprocedure)
    or not has_function_privilege('crm_app', 'public.crm_import_profile_links(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE')
    or has_function_privilege('crm_identity', 'public.crm_import_profile_links(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE')
    or not has_function_privilege('crm_app', 'public.crm_link_imports_of(uuid)', 'EXECUTE') then
    raise exception 'the link import functions are not granted as they must be';
  end if;
  -- The app reaches an import only through those two: never the table itself.
  if has_table_privilege('crm_app', 'auth.link_imports', 'SELECT')
    or has_table_privilege('crm_app', 'auth.link_imports', 'INSERT')
    or has_table_privilege('crm_app', 'auth.link_imports', 'UPDATE')
    or has_table_privilege('crm_app', 'auth.link_imports', 'DELETE') then
    raise exception 'crm_app must not reach auth.link_imports directly';
  end if;
end
$$;
