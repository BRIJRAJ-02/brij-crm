-- Hand written: row level security, storage and the first rows for sort_keys (spec 0004, stored sort keys).
alter table sort_keys enable row level security;
--> statement-breakpoint
alter table sort_keys force row level security;
--> statement-breakpoint
create policy sort_keys_tenant on sort_keys
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Live flips and key changes touch indexed columns, so no update is in place: keep the default fillfactor,
-- and vacuum often so index only scans keep a current visibility map.
alter table sort_keys set (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02);
--> statement-breakpoint

-- What sort_keys should hold, computed from the current values: the one place each key's expression lives.
-- The save path upserts from it for one owner and attribute, the backfill copies it whole, and the tests
-- compare sort_keys with it. security_invoker, so the reader's own row level security applies. The record
-- is joined twice (as the owner, or as the entry's record) because under row level security a coalesce in
-- a join condition can't use an index.
create view sort_key_sources with (security_invoker = true) as
  select
    v.workspace_id,
    v.owner_id,
    v.attribute_id,
    coalesce(rr.id, er.id) as record_id,
    v.entry_id,
    (coalesce(rr.deleted_at, er.deleted_at) is null and (e.id is null or e.deleted_at is null)) as live,
    case when a.type in ('text', 'email', 'domain', 'url', 'phone', 'personal_name', 'file')
      then lower(left(v.text_value, 256)) end collate "und-x-icu" as text_key,
    null::bigint as number_key,
    null::text collate "C" as code_key,
    null::date as date_key,
    null::timestamptz as time_key,
    null::uuid as option_id,
    null::boolean as bool_key
  from "values" v
  join attributes a on a.workspace_id = v.workspace_id and a.id = v.attribute_id
  left join list_entries e on e.workspace_id = v.workspace_id and e.id = v.entry_id
  left join records rr on rr.workspace_id = v.workspace_id and rr.id = v.record_id
  left join records er on er.workspace_id = e.workspace_id and er.id = e.record_id
  where v.position = 0 and v.active_until is null and not v.is_cleared
    and a.type in ('text', 'email', 'domain', 'url', 'phone', 'personal_name', 'file')
    and v.text_value is not null
    and coalesce(rr.id, er.id) is not null;
--> statement-breakpoint
-- A view is read only; the default privileges would grant writes too.
revoke all on sort_key_sources from crm_app;
--> statement-breakpoint
grant select on sort_key_sources to crm_app;
--> statement-breakpoint

-- The first rows, for every workspace at once. The owner is subject to forced row level security like
-- everyone, so FORCE comes off the tables this reads and writes for the copy, and back on, in one block:
-- it takes every lock first (or gives up after 5 seconds rather than queue behind traffic), and if
-- anything fails, the whole block and the migration roll back with FORCE still on.
set local lock_timeout = '5s';
--> statement-breakpoint
do $$
begin
  lock table records, list_entries, attributes, "values", sort_keys in access exclusive mode;
  alter table "values" no force row level security;
  alter table attributes no force row level security;
  alter table list_entries no force row level security;
  alter table records no force row level security;
  alter table sort_keys no force row level security;
  insert into sort_keys (workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key, time_key, option_id, bool_key)
    select workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key, time_key, option_id, bool_key
    from sort_key_sources;
  alter table "values" force row level security;
  alter table attributes force row level security;
  alter table list_entries force row level security;
  alter table records force row level security;
  alter table sort_keys force row level security;
end
$$;
