-- Likely duplicates (spec 0049, AC-4901 to AC-4903, AC-4908), after 0147_record_merged_into; renumbered at landing if main
-- moves on first. It never touches `records.merged_into_record_id`.
--
-- crm_match_key(kind, value) is AC-4902's one normalisation, the only place it is written: names fold case, drop
-- punctuation and join runs of spaces; company names also drop one trailing legal suffix; emails are the whole
-- lowercased address and domains the lowercased host. crm_match_kind(attribute) says which kind an attribute's values
-- are keyed by: an email or domain attribute by its type, an object's name (primary) attribute as `company_name` on the
-- standard Companies and `name` elsewhere, anything else not at all.
--
-- The key is stored, not indexed as an expression: under forced row level security only leakproof operators reach an
-- index (0012, 0043), and crm_match_key can't be marked leakproof without a superuser. `values.match_key` is written
-- with the row by the engine (through these two functions), so a lookup is a plain `match_key = $1` (texteq, leakproof)
-- on `values_match`, a partial index over current name, email and domain values only.
--
-- record_duplicate_dismissals keeps "Not a duplicate" once per pair (low id < high id), for the whole workspace.
set local lock_timeout = '5s';
--> statement-breakpoint
create function crm_match_key(kind text, value text)
  returns text
  language sql
  immutable
  parallel safe
  set search_path = pg_catalog, pg_temp
begin atomic
  select case
    when crm_match_key.value is null then null
    when crm_match_key.kind = 'email' then nullif(lower(btrim(crm_match_key.value)), '')
    when crm_match_key.kind = 'domain' then nullif(lower(regexp_replace(
      regexp_replace(btrim(crm_match_key.value), '^[A-Za-z][A-Za-z0-9+.-]*://', ''), '[/:?#].*$', '')), '')
    when crm_match_key.kind = 'name' then nullif(btrim(regexp_replace(
      regexp_replace(lower(left(crm_match_key.value, 512)), '[[:punct:]]+', '', 'g'), '[[:space:]]+', ' ', 'g')), '')
    when crm_match_key.kind = 'company_name' then nullif(regexp_replace(btrim(regexp_replace(
      regexp_replace(lower(left(crm_match_key.value, 512)), '[[:punct:]]+', '', 'g'), '[[:space:]]+', ' ', 'g')),
      ' (inc|llc|ltd|limited|plc|gmbh|corp|co|pvt|pte|sa|ag|bv)$', ''), '')
  end;
end;
--> statement-breakpoint
create function crm_match_kind(attribute uuid)
  returns text
  language sql
  stable
  set search_path = pg_catalog, pg_temp
begin atomic
  select case
    when a.object_id is null then null
    when a.type::text in ('email', 'domain') then a.type::text
    when o.primary_attribute_id = a.id then case when o.standard_key = 'companies' then 'company_name' else 'name' end
  end
  from public.attributes a
  left join public.objects o on o.workspace_id = a.workspace_id and o.id = a.object_id
  where a.id = crm_match_kind.attribute;
end;
--> statement-breakpoint
ALTER TABLE "values" ADD COLUMN "match_key" text;
--> statement-breakpoint
-- Every current name, email and domain value a record holds now, for every workspace at once. The owner is subject
-- to forced row level security like everyone (0009), so FORCE comes off the three tables this reads and writes for the
-- copy and back on, in one block that takes every lock first; if anything fails, the migration rolls back with FORCE
-- still on. At today's sizes this is one statement; a workspace near a million records wants a batched job instead
-- (spec 0049 drift, in the lane's report).
do $$
begin
  lock table "values", attributes, objects in access exclusive mode;
  alter table "values" no force row level security;
  alter table attributes no force row level security;
  alter table objects no force row level security;
  update "values" v set match_key = crm_match_key(k.kind, v.text_value)
  from (
    select a.workspace_id, a.id, case
      when a.type::text in ('email', 'domain') then a.type::text
      when o.primary_attribute_id = a.id then case when o.standard_key = 'companies' then 'company_name' else 'name' end
    end as kind
    from attributes a join objects o on o.workspace_id = a.workspace_id and o.id = a.object_id
  ) k
  where k.kind is not null and v.workspace_id = k.workspace_id and v.attribute_id = k.id
    and v.active_until is null and v.text_value is not null and v.record_id is not null;
  alter table "values" force row level security;
  alter table attributes force row level security;
  alter table objects force row level security;
end
$$;
--> statement-breakpoint
CREATE INDEX "values_match" ON "values" USING btree ("workspace_id","attribute_id","match_key","owner_id") WHERE "values"."active_until" is null and "values"."match_key" is not null;
--> statement-breakpoint
CREATE TABLE "record_duplicate_dismissals" (
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"low_record_id" uuid NOT NULL,
	"high_record_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_duplicate_dismissals_pkey" PRIMARY KEY("workspace_id","low_record_id","high_record_id"),
	CONSTRAINT "record_duplicate_dismissals_order" CHECK ("record_duplicate_dismissals"."low_record_id" < "record_duplicate_dismissals"."high_record_id")
);
--> statement-breakpoint
ALTER TABLE "record_duplicate_dismissals" ADD CONSTRAINT "record_duplicate_dismissals_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_duplicate_dismissals" ADD CONSTRAINT "record_duplicate_dismissals_low" FOREIGN KEY ("workspace_id","low_record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_duplicate_dismissals" ADD CONSTRAINT "record_duplicate_dismissals_high" FOREIGN KEY ("workspace_id","high_record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_duplicate_dismissals" ADD CONSTRAINT "record_duplicate_dismissals_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_duplicate_dismissals_high" ON "record_duplicate_dismissals" USING btree ("workspace_id","high_record_id","low_record_id");
--> statement-breakpoint
alter table record_duplicate_dismissals enable row level security;
--> statement-breakpoint
alter table record_duplicate_dismissals force row level security;
--> statement-breakpoint
create policy record_duplicate_dismissals_tenant on record_duplicate_dismissals
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
