-- Hand written: stored sort keys for every scalar sortable kind (spec 0004, stored sort keys, milestone 6).
-- The view that defines each key grows from text to every kind; then the new kinds' first rows.
drop view sort_key_sources;
--> statement-breakpoint
-- One row per current, set, position 0 value of a sortable attribute, with its keys:
--   text, email, domain, url, phone, personal name, file: text_key, lower(left(text, 256))
--   number, rating: number_key, the value times 10,000 (the contract caps numbers at 14 integer digits;
--     anything older and larger is clamped, so it still sorts at the end, never fails)
--   currency: code_key (the code) and number_key (the amount)
--   location: code_key (the country) and text_key (the locality, lowercased)
--   date: date_key; timestamp and interaction: time_key; select and status: option_id; checkbox: bool_key
-- security_invoker, so the reader's own row level security applies. The record is joined twice (as the
-- owner, or as the entry's record) because under row level security a coalesce in a join condition can't
-- use an index.
create view sort_key_sources with (security_invoker = true) as
  select * from (
    select
      v.workspace_id,
      v.owner_id,
      v.attribute_id,
      coalesce(rr.id, er.id) as record_id,
      v.entry_id,
      (coalesce(rr.deleted_at, er.deleted_at) is null and (e.id is null or e.deleted_at is null)) as live,
      (case
        when a.type in ('text', 'email', 'domain', 'url', 'phone', 'personal_name', 'file') then lower(left(v.text_value, 256))
        when a.type = 'location' then lower(left(v.json_value->>'locality', 256))
      end) collate "und-x-icu" as text_key,
      case when a.type in ('number', 'rating', 'currency')
        then (least(greatest(v.number_value, -99999999999999.9999), 99999999999999.9999) * 10000)::bigint
      end as number_key,
      (case when a.type in ('currency', 'location') then v.text_value end) collate "C" as code_key,
      case when a.type = 'date' then v.date_value end as date_key,
      (case when a.type in ('timestamp', 'interaction') then v.timestamp_value end)::timestamptz(3) as time_key,
      case when a.type in ('select', 'status') then v.option_id end as option_id,
      case when a.type = 'checkbox' then v.bool_value end as bool_key
    from "values" v
    join attributes a on a.workspace_id = v.workspace_id and a.id = v.attribute_id
    left join list_entries e on e.workspace_id = v.workspace_id and e.id = v.entry_id
    left join records rr on rr.workspace_id = v.workspace_id and rr.id = v.record_id
    left join records er on er.workspace_id = e.workspace_id and er.id = e.record_id
    where v.position = 0 and v.active_until is null and not v.is_cleared
      and a.type in ('text', 'email', 'domain', 'url', 'phone', 'personal_name', 'file', 'number', 'rating',
        'currency', 'location', 'date', 'timestamp', 'interaction', 'select', 'status', 'checkbox')
      and coalesce(rr.id, er.id) is not null
  ) k
  where num_nonnulls(k.text_key, k.number_key, k.code_key, k.date_key, k.time_key, k.option_id, k.bool_key) > 0;
--> statement-breakpoint
revoke all on sort_key_sources from crm_app;
--> statement-breakpoint
grant select on sort_key_sources to crm_app;
--> statement-breakpoint

-- The new kinds' first rows, for every workspace at once, the same way 0009 filled the text keys: every lock
-- first (or give up after 5 seconds), FORCE off for the copy and back on, in one block.
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
    from sort_key_sources
  on conflict (workspace_id, owner_id, attribute_id) do nothing;
  alter table "values" force row level security;
  alter table attributes force row level security;
  alter table list_entries force row level security;
  alter table records force row level security;
  alter table sort_keys force row level security;
end
$$;
