# 0004. The data model: one engine for every object

**Date**: 2026-10-02
**Status**: In Progress

## Summary

Every record in the CRM, whether a person, a company, a deal or something a customer invents, lives in the same few tables. Values are typed rows that keep their whole history, so you can ask what a field said on any date and how long a deal sat in each stage. Relationships are stored once and read from both ends, lists hold entries with values of their own, and the database itself keeps each workspace's data apart. This spec also builds the query engine that turns a saved filter and sort into SQL, and proves it on a million records before any screen depends on it.

## Structure

- [0004-stored-sort-keys.md](0004-stored-sort-keys.md): stored sort keys with a live flag, capped counts and a workspace scoped contains search, the answer to the AC-15 misses milestone 4 measured (AC-20 to AC-26).

## Requirements

**User stories**:
- As a workspace member, I want People, Companies and Deals to behave exactly like any object I create, so every feature works everywhere.
- As a member, I want every change kept with who made it and when, so I can see what a field said last month and how long a deal sat in a stage.
- As an admin, I want to rename or recolour an option, or add attributes, without touching a single record.
- As a member, I want to filter and sort any attribute, including through a relationship, and get the first page fast even with a million records.
- As a member, I want a deleted record back, with its links and list entries, for 30 days.
- As the business, I want no query, ever, to return another workspace's data, even one that forgets to filter.

**Acceptance criteria**:
- **AC-1**: Creating a workspace seeds People, Companies and Deals as ordinary object, attribute and option rows marked standard, from a versioned template. A custom object created afterwards gets values, history, relationships, lists, queries, delete and restore through the same tables and services. No table or code path exists for one object only.
- **AC-2**: Each of the 20 attribute types in `@crm/contracts/values` stores and reads back its value exactly as its schema parses it (numbers in canonical form, `1.5` not `1.5000`), multi valued types keeping their order. A value its schema refuses is refused with `ATTRIBUTE_VALUE_INVALID` naming the attribute, and nothing is written.
- **AC-3**: Every change to a value ends the current version and starts a new one, both carrying who and when; clearing a value is a version too. At most one current version exists per value item, even under concurrent saves, and version times never run backwards. The service returns a record's values as of any timestamp (a version covers `active_from` up to but not including `active_until`), the full version list of an attribute (links included), and every visit a record made to each stage of a status attribute. A save that changes nothing writes nothing.
- **AC-4**: Renaming, recolouring, reordering or archiving a select or status option changes one option row and rewrites no value row. An archived option stays on the values that hold it, keeps its sort position, and is refused for new writes with `OPTION_ARCHIVED`. Labels always show as they are now, in history too.
- **AC-5**: One relationship definition gives each of its two objects (or one object, twice, with each end named) a paired attribute. Each link is one `record_links` row, read from both ends, keeping its item order. Setting a single value side replaces the old link and ends it in history. Linking to a one to one partner that already has a link is refused with `RELATIONSHIP_TAKEN`, naming that record, and two concurrent links can't both break a single side. A one way reference names the objects it may point to and has no attribute on the other side.
- **AC-6**: A list collects records of one object. Each entry has its own id, values and history, separate from the record's, and list views filter and sort entries as fast as object views. The same record can hold several entries in one list unless the list allows it once, which is then refused with `ENTRY_EXISTS`.
- **AC-7**: Every definition, record, entry and link row carries `workspace_id`, `created_at`, `created_by`, `updated_at` and `updated_by`; a value row carries `workspace_id` and its `set_by` and `active_from` instead. The actor is a member, an API key, an automation or the system. Every value write also moves its record's `updated_at` and `updated_by`. A link write moves only the record it was written from; the far record's paired attribute changes without touching its row (the link row keeps its own who and when), so two links from opposite ends never lock each other (decided 3 October 2026 after the spec 0005 reviews).
- **AC-8**: Deleting a record hides it, its links and its list entries at once, without touching the records on the other side. Restoring within 30 days brings all three back. A restore whose unique values now collide is refused with `UNIQUE_CONFLICT`, listing the values. The purge function removes, in batches, records deleted more than 30 days ago, with their values, links and entries, and returns the counts.
- **AC-9**: No query returns a row from another workspace, even with its workspace filter removed: every table forces row level security with the plain comparison policy, every primary key is `(workspace_id, id)`, and every foreign key includes `workspace_id`, so a write that names another workspace's attribute, option, record or member is refused by the database, and a client chosen id reveals nothing about other workspaces. The two guard tests cover every new table.
- **AC-10**: For a unique attribute, two concurrent writes of the same value to different records leave one written and the other refused with `UNIQUE_CONFLICT`. Turning Unique on while duplicates exist is refused with the duplicated values and how many records share each. Archiving the attribute or turning Unique off frees its keys.
- **AC-11**: A required attribute refuses a create without it, and refuses clearing it, with `VALUE_REQUIRED`. Existing records that are already empty stay as they are.
- **AC-12**: Two saves to the same attribute from the same starting version both land, the later one current. The later save's result and its change hook name the version and actor it replaced.
- **AC-13**: A write that sets several values on one record lands all of them or none, and a refusal lists every bad attribute. A batch across records returns each record's result separately, and the hooks see only the records that landed.
- **AC-14**: Every `FilterCondition` and `FilterGroup` (each operator its type offers, nesting up to 3, conditions through up to 2 relationship hops) and every `SortRules` compiles to parameterised SQL with no user text in the SQL string. Relative date operators resolve against the `now`, time zone and week start passed in. On a seeded sample, results match a reference evaluator written over plain objects, including empty values, multi valued attributes and nulls in sorts.
- **AC-15**: On a seeded workspace of 1,000,000 records, every query in the benchmark grid (below) returns its first page of 50 rows in under 300 ms at p95 in the database call, on Neon's smallest paid compute, warm. The exact count comes from a second query that can be cancelled. Fetching 50 rows at position 600,000 for a single indexed sort stays inside the same budget.
- **AC-16**: The limits module refuses, with `LIMIT_REACHED` naming the limit, more than 50 custom objects per workspace, 250 attributes per object or list, 500 options per attribute, 1,000,000 live records per workspace, 500 lists per workspace and 1,000,000 entries per list, even under concurrent creates. Nothing is truncated silently.
- **AC-17**: Every write runs through one transaction function that calls the given `afterWrite` hooks inside the same transaction. A hook that throws rolls the whole write back.
- **AC-18**: The erasure function deletes every value and every past version of one record, then calls the hooks with an erasure event. Normal deletes keep history.
- **AC-19**: Each object names one primary attribute (text or personal name). A record's display (`RecordRefDisplay`: name, kind and hue) comes from that attribute and its object; an empty name reads "Unnamed <object>".

## Decision

**Chosen option**: Option 1: typed value rows with history in place, one links table, and a compiled query engine.

One `values` table holds every value of every object as typed rows with `active_from` and `active_until`. Relationships live in one `record_links` table. A query engine in `packages/core` compiles saved filters and sorts to SQL, and the design is proven at a million records before screens build on it. Milestone 4 also benchmarks one alternative: current values and past versions in two separate tables. If it clearly wins, the storage choice returns to `/architect`.

**Implementation skills**: `drizzle` (`lobehub/lobehub`, `.claude/skills/drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `crm-data-model-access` (project, `.claude/skills/crm-data-model-access/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `domain-modeling` (`mattpocock/skills`, `.claude/skills/domain-modeling/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (Postgres 18, Drizzle schema in `packages/db/src/schema/`). Shared rules:
- Every table has `workspace_id uuid not null`, `FORCE ROW LEVEL SECURITY` with the plain comparison policy, and primary key `(workspace_id, id)`.
- Every foreign key is composite: `(workspace_id, x_id) references x (workspace_id, id)`.
- Actors are stored as `*_type` (`member`, `api_key`, `automation`, `system`) plus `*_id`. When the type is `member`, the id also sits in a `*_member_id` column with a foreign key to `members`. API key and automation ids get their own foreign keys in #34 and #47. The system's id is null.
- Definition, record, entry and link rows carry `created_at`, `created_by_*`, `updated_at` and `updated_by_*`.
- Every index leads with `workspace_id`.

| Table | Key columns | Constraints |
|---|---|---|
| `workspaces` | id, name, slug, deleted_at | primary key `id` (it is the tenant); policy compares `id` to the setting; slug unique while live |
| `workspace_counters` | workspace_id, live_records, custom_objects, lists | one row per workspace; updated under `FOR UPDATE` by the limits module |
| `members` | id, user_id (nullable until #10), name, email, status (`active`, `removed`) | email unique per workspace while active |
| `objects` | id, api_slug, singular_name, plural_name, icon, hue, is_standard, standard_key, template_version, primary_attribute_id (set in the same transaction as its attribute), archived_at | api_slug unique per workspace; standard_key unique per workspace |
| `lists` | id, object_id, api_slug, name, allows_duplicates (default true), entry_count, archived_at | api_slug unique per workspace |
| `attributes` | id, object_id or list_id (exactly one), api_slug, title, type, is_multi, is_required, is_unique, is_system, system_column (`id`, `created_at`, `created_by`, `updated_at`, `updated_by`, or null), default_value jsonb, config jsonb, description, position, relationship_id, archived_at | api_slug unique per parent; is_multi only for `MULTIPLE_VALUE_TYPES`; is_unique only for the unique capable types; `config` parsed by `AttributeConfig[type]`; indexes by object and by list |
| `attribute_options` | id, attribute_id, label, hue, position, archived_at, outcome (`open`, `won`, `lost`; status only), target_time_in_stage interval | unique `(workspace_id, attribute_id, id)` so values can point at both; label unique per attribute while not archived; index `(workspace_id, attribute_id, position)` |
| `relationships` | id, cardinality (`one_to_one`, `one_to_many`, `many_to_one`, `many_to_many`), from_attribute_id (the defining side), to_attribute_id (null for a one way reference), target_object_ids uuid[] (one way references only) | each attribute in at most one relationship; on a relationship from an object to itself, `from` and `to` are the two named ends |
| `records` | id (UUID v7), object_id, deleted_at, deleted_by_* | indexes below |
| `list_entries` | id (UUID v7), list_id, record_id, deleted_at, deleted_by_* | indexes `(workspace_id, list_id, id)` where live, `(workspace_id, record_id)` |
| `values` | id (UUID v7), version_id (UUID v7, shared by the item rows of one write), attribute_id, record_id or entry_id (exactly one), owner_id (equals whichever is set; the indexes use it), position smallint, is_cleared bool, text_value, number_value numeric(19,4), date_value, timestamp_value timestamptz, bool_value, option_id, actor_type, actor_id, actor_member_id, json_value jsonb, unique_key, held_unique_key, active_from timestamptz, active_until timestamptz, set_by_* | check: exactly one of record_id and entry_id, and owner_id equals it; `(workspace_id, attribute_id, option_id)` references `attribute_options`; unique `(workspace_id, owner_id, attribute_id, position)` where `active_until is null` |
| `record_links` | id (UUID v7), version_id, relationship_id, from_record_id, to_record_id, position smallint, from_single bool, to_single bool, active_from, active_until, set_by_* | unique `(workspace_id, relationship_id, from_record_id, to_record_id)` where current; unique `(workspace_id, relationship_id, from_record_id)` where current and `from_single`; unique `(workspace_id, relationship_id, to_record_id)` where current and `to_single` |

Storage settings for `values` and `record_links`: `fillfactor 80`, `autovacuum_vacuum_scale_factor 0.01`, `autovacuum_analyze_scale_factor 0.02`. Every edit moves rows out of the current value indexes, so dead entries pile up fast without this. The scale run watches table and index bloat.

Notes, tasks, comments and files (#19, #29, #32) attach through their own `(workspace_id, record_id)` foreign key to `records`. There is no column per object.

**How each type maps onto a value row**: one row per item. Multi valued types write one row per item with `position` 0, 1, 2 and so on, and position 0 is the primary. "Narrowed only" means the operator has no index of its own. It runs on rows other conditions have already narrowed, and stays outside the AC-15 grid.

| Type | Columns | Sort key | Operators and how they compile |
|---|---|---|---|
| text | text_value | `lower(left(text_value, 256))` | is, is not (on the sort key); contains, does not contain (trigram) |
| long_text | text_value | none (not sortable) | contains, does not contain (trigram on the first 2,048 characters) |
| email, domain, url | text_value (schemas lowercase email and domain) | `lower(left(text_value, 256))` | is (on the sort key); contains (trigram) |
| number | number_value | number_value | eq, neq, gt, gte, lt, lte, between (inclusive at both ends) |
| rating | number_value | number_value | at least, at most |
| currency | number_value (amount), text_value (code) | (code, amount); in a column of mixed codes, codes sort A to Z | eq, neq, gt, gte, lt, lte, between, all within the operand's code |
| date | date_value | date_value | is, before, after, within (resolved in the passed time zone) |
| timestamp | timestamp_value | timestamp_value | before, after, within last |
| checkbox | bool_value; only `true` is stored, unchecked has no row | bool_value | is checked (exists true); is not checked (no true row). Never empty |
| select | option_id | the option's position | is, is not, is any of (single); contains any of, all of, none of (multi) |
| status | option_id | the option's position | is, is not, is any of |
| phone | text_value (E.164), json_value `{ country }` | text_value | is, contains (on text_value); country is (narrowed only) |
| location | json_value (the whole value), text_value (country code) | text_value, then `json_value->>'locality'` | country is (on text_value); locality is, region is (narrowed only) |
| personal_name | json_value (first, last), text_value (full name) | `lower(left(text_value, 256))` | contains (trigram); first name is, last name is (narrowed only) |
| actor_reference | actor_type, actor_id, actor_member_id | the member's name (best effort, outside AC-15) | is, is any of, is me (the passed actor) |
| record_reference | not in `values`; one `record_links` row per item | the linked record's name (best effort, outside AC-15) | is, is any of (existence over links); through (below) |
| file | json_value (the whole `FileValue`), text_value (name) | text_value | name contains (trigram); has files (exists) |
| interaction | json_value (the whole value), timestamp_value (its `at`) | timestamp_value | before, after, within last; kind is (narrowed only) |

Every type also has is empty and is not empty, except checkbox.

Compile rules for every operator:
- Each condition compiles to `EXISTS` (or `NOT EXISTS`) over the attribute's current value rows, so a multi valued attribute matches when any item matches.
- The negative operators (is not, does not contain, contains none of, neq) also match records with no value.
- Is empty means no current row; a cleared marker row counts as empty.
- A multi valued attribute sorts by its position 0 item.

**Cleared values**: clearing writes one row at position 0 with `is_cleared` true and every value column null. It ends the old version, records who cleared it, and is left out of every value index (the index predicates require a value column to be not null). A current cleared row reads as empty.

**Filters through relationships**: `{ path, condition }` walks at most 2 hops. Each hop names the attribute it leaves by, which tells the compiler which side of `record_links` it starts from. Each hop compiles to `EXISTS (select 1 from record_links … where current)` around the next hop, with the far condition innermost. A negative condition through a path means "no linked record matches", compiled with `NOT EXISTS`, never by negating an inner `EXISTS` row by row.

**Sorting and paging**:
- Empty values sort last in both directions.
- Text sorts and indexes use the pinned ICU collation `und-x-icu`, so order never depends on the database default.
- Every sort ends with `id` as the tiebreak.
- A select or status sort walks the attribute's options in position order with one index range per option (at most 500), then the empties. Archived options keep their position.
- The cursor is the row's sort keys plus `id`, compiled as an expanded `OR` chain (with `IS NULL` branches) so mixed directions and empty keys page correctly.
- A jump to a position runs one index only scan to that offset to find the cursor, then continues by cursor. That holds only for a single indexed sort with no filters; filtered views page by cursor only, and the grid's scrollbar uses `countMatches`.

**Unique keys**: the unique capable types are text, email, domain, url, phone and number.
- **Normalising** (`normaliseUniqueKey`): text is trimmed and lowercased; email and domain are already canonical; url is lowercased in scheme and host, with the path kept; phone is E.164; number is the canonical decimal.
- **Multi valued** attributes have one key per item.
- **On delete**, the record's current keys move into `held_unique_key` in one statement, and a restore moves them back in one statement. A collision there raises the unique index error, which maps to `UNIQUE_CONFLICT`.
- **Turning Unique on** first checks for duplicates (refusing with them), then fills `unique_key` in batches of 10,000 rows. Once #8 exists, this runs as a job. Archiving the attribute or turning Unique off sets its keys to null.

**Indexes** (value indexes are partial on `active_until is null and not is_cleared`):
- `values (workspace_id, owner_id, attribute_id, position)`: read a record's or entry's current values; also the unique current version index.
- Per kind, `values (workspace_id, attribute_id, <sort key>, position, owner_id)` for text, number, date, timestamp, option, bool and actor. These serve filters and sorts for records and entries alike.
- `values using gin (workspace_id, attribute_id, lower(left(text_value, 2048)) gin_trgm_ops)` (needs the `btree_gin` extension, added in migration 1): contains and does not contain.
- `values (workspace_id, owner_id, attribute_id, active_from)` over all rows: as of reads and history.
- `record_links (workspace_id, relationship_id, from_record_id, position)` and `(workspace_id, relationship_id, to_record_id)`, current only, plus the unique indexes in the table above.
- `records (workspace_id, object_id, id)`, `(workspace_id, object_id, created_at, id)` and `(workspace_id, object_id, updated_at, id)`, all where `deleted_at is null`.

**Benchmark grid** (AC-15, seeded object of 1,000,000 records with the template's attributes filled realistically; each run reports p95, the plan, and table and index sizes):
1. No filter, sort by a text attribute; and the same at position 600,000.
2. One select filter (is any of, matching about 20%), sort by created at.
3. Three filters (text contains, number between, select is), two sorts (date, then text).
4. A filter through one relationship (people whose company's industry is X), sort by name.
5. Is empty on a text attribute, sort by a status attribute.
6. A list of 200,000 entries, filtered by an entry status and sorted by an entry date.

The same grid runs against the split table variant (current values and versions apart) for the comparison in Decision.

**State transitions**:
- Record: `live` → (delete) → `deleted` → (restore within 30 days) → `live`; `deleted` → (purge after 30 days) → gone. A deleted record refuses writes with `RECORD_DELETED`.
- A value version: `current` (active_until null) → `past` (active_until set). Past versions never change, except that erasure and purge remove them.
- Option and attribute: `active` ⇄ `archived`. Neither is ever hard deleted in #5.

**Write protocol** (inside `runWrite`, for every value or link write):
1. Lock the owning record (or entry) row with `SELECT … FOR UPDATE`. Delete, restore and every value write take the same lock, so they never interleave.
2. Read the current version. When the new value equals it, write nothing for that attribute.
3. Take `t = greatest(clock_timestamp(), current.active_from + 1 microsecond)` after the lock, so versions never run backwards. Every row of one attribute's write uses the same `t`.
4. Set `active_until = t` on the current rows. Insert the new rows with `active_from = t` and a fresh `version_id`.
5. Update the record's `updated_at` and `updated_by`.

A batch takes a savepoint per record. A refused record rolls back to it, and its change is left out of what the hooks see. A deadlock or serialisation failure (`40P01`, `40001`) retries the whole transaction up to 3 times.

**API surface** (core services in `packages/core`, no endpoints; #9 puts the access door in front of them and #10 adds the oRPC procedures). Every service takes `{ db, workspaceId, actor }` and runs inside `withWorkspace()`. Reads that resolve relative dates also take `{ now, timeZone, weekStart }`; `timeZone` defaults to `UTC` and `weekStart` to Monday.

| Service | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `createWorkspace` | write, inside `withWorkspace()` for the new id | name, slug, first member | workspace id, seeded object ids | system only (#10 calls it on sign up) | `SLUG_TAKEN` |
| `defineObject`, `defineAttribute`, `defineOption`, `defineRelationship`, `defineList` | write | the definition (config parsed by Zod per type) | the new id | workspace scope (#9 adds the door) | `SLUG_TAKEN`, `CONFIG_INVALID`, `LIMIT_REACHED` |
| `updateDefinition`, `archiveDefinition`, `restoreDefinition` | write | id, changed fields (title, description, required, unique, options' label, hue, position, outcome, target; type and multi are #14's) | the row | workspace scope | `NOT_FOUND`, `UNIQUE_HAS_DUPLICATES` |
| `createRecord` | write | objectId, values map, optional client id (UUID v7) | record id, version ids | workspace scope | `ATTRIBUTE_VALUE_INVALID`, `VALUE_REQUIRED`, `UNIQUE_CONFLICT`, `LIMIT_REACHED`, `ID_TAKEN` |
| `setValues` | write | recordId or entryId, map of attribute → { value, baseVersionId? } | per attribute: new version id, or none when unchanged; `replaced` (version and actor) when the base had moved | workspace scope | `ATTRIBUTE_VALUE_INVALID`, `VALUE_REQUIRED`, `UNIQUE_CONFLICT`, `OPTION_ARCHIVED`, `RECORD_DELETED`, `RELATIONSHIP_TAKEN`, `ATTRIBUTE_READ_ONLY` |
| `setValuesBatch` | write | up to 500 `setValues` inputs | per record result (ok or refusals) | workspace scope | as `setValues`, per record |
| `deleteRecord`, `restoreRecord` | write | recordId | the record state | workspace scope | `NOT_FOUND`, `UNIQUE_CONFLICT` |
| `addEntry`, `removeEntry`, `restoreEntry` | write | listId, recordId | entry id | workspace scope | `ENTRY_EXISTS`, `RECORD_DELETED`, `LIMIT_REACHED` |
| `getRecords` | read | ids (up to 500), attribute ids | records with current values and `RecordRefDisplay` | workspace scope | none |
| `getHistory` | read | recordId or entryId, attributeId | `ValueVersion[]` (links too) | workspace scope | `NOT_FOUND` |
| `getValuesAsOf` | read | recordId, timestamp | the values at that moment | workspace scope | none |
| `getTimeInStages` | read | recordId, status attributeId | per option: every visit (entered, left or null), and the total | workspace scope | none |
| `queryPage` | read | object or list id, `FilterGroup`, `SortRules`, cursor or position, limit (up to 200), now, timeZone, weekStart | rows, next cursor | workspace scope | `FILTER_INVALID` |
| `countMatches` | read, cancellable | object or list id, `FilterGroup`, now, timeZone, weekStart | exact count | workspace scope | `QUERY_CANCELLED` |
| `purgeDeleted` | write, job | cutoff (now minus 30 days), batch size | counts removed per table | system only (#8 schedules it) | none |
| `eraseRecord` | write, job | recordId | counts removed | system only (#36 runs it) | none |

A list's `queryPage` filters and sorts on entry attributes and on the record's own attributes alike; the record side compiles through the entry's `record_id`.

`runWrite(scope, fn, hooks)` is one transaction: `withWorkspace()` sets the workspace first, `fn` writes by the protocol above, then each `afterWrite(change, tx)` hook runs in order. `change` names the workspace, the actor, and every record, entry, attribute and version id that landed (with `replaced` where AC-12 applies). #7 adds the outbox hook, #36 the audit hook. `purgeDeleted` and `eraseRecord` run as system jobs, one workspace at a time, each inside its own `withWorkspace()`. They never bypass row level security. Purge deletes in foreign key order: values, links, entries, then records.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| any write | workspace | `scope.workspaceId`, set by `withWorkspace()` |
| any write | actor (`created_by`, `set_by`, `deleted_by`) | `scope.actor`; #9's door produces it later, tests pass it directly now |
| any write | `created_at`, `updated_at` on rows | the transaction's `now()` |
| value or link write | `active_from`, `active_until` | `t` from the write protocol: `clock_timestamp()` after the lock, never before the prior version |
| `createRecord` | record id | the client's UUID v7 when given and valid, else Postgres 18 `uuidv7()` |
| `createRecord` | defaults | `attributes.default_value`: static values as stored; `current-user` gives `scope.actor`'s member; `P1M` style durations give `now` plus the duration, in the passed time zone for dates (UTC by default) |
| `setValues` | `replaced` notice | the current version's `version_id` compared with `baseVersionId`, and its `set_by` |
| `setValues` | `unique_key` | `normaliseUniqueKey(type, value)` in `packages/core` |
| `queryPage`, `countMatches` | "today", "this week", relative spans | the passed `now`, `timeZone` (the viewer's, as `filters.ts` says) and `weekStart` |
| `queryPage` | "is me" | `scope.actor`'s member id |
| `createWorkspace` | standard objects, attributes, options | the template `packages/core/src/templates/standard-v1.ts`, from research 5b (launch types only), `template_version` 1 |
| `getRecords`, `queryPage` | `RecordRefDisplay.name` | the object's primary attribute's `text_value`; "Unnamed <singular_name>" when empty |
| `getRecords`, `queryPage` | `RecordRefDisplay.kind` and hue | `objects.standard_key` (`people` is a person, otherwise a company or record tile) and `objects.hue`; pictures wait for #32 |
| `getHistory` | option labels | the option row as it is now |
| `getTimeInStages` | visits per stage | the status attribute's versions, each `[active_from, active_until or now)` |
| `countMatches` | count | `count(*)` over the same compiled filter, in its own statement with a 10 s `statement_timeout`; the caller cancels with an abort signal. Capped at 10,000 by [0004-stored-sort-keys.md](0004-stored-sort-keys.md) (AC-23) |
| `purgeDeleted` | cutoff | now minus 30 days (`RESTORE_WINDOW` in the limits module) |
| limits module | each limit and current count | `packages/core/src/limits.ts` constants, and `workspace_counters` or `lists.entry_count` read under `FOR UPDATE` |
| reads | numbers | `number_value` returned through `toCanonicalDecimal` from contracts; ratings as integers |

**Key invariants**:
- Records, entries and options are referenced by id only; slugs and labels are for display and URLs.
- At most one current row per (owner, attribute, position), enforced by a unique index; a write ends it and starts the next under the owner's row lock.
- A value row's attribute belongs to the record's object, or the entry's list. The service checks this, and the composite keys keep it inside the workspace.
- A single side never has two current links from one record, enforced by the partial unique indexes on `from_single` and `to_single`.
- Past versions are never updated or deleted, except by `eraseRecord` and `purgeDeleted`.
- Reads of links and entries always join `records` (and `list_entries`) and skip deleted ones. A delete never ends links or entries.
- System attributes are read only; writes to them are refused with `ATTRIBUTE_READ_ONLY`. They compile from `records` columns, not `values`.
- No service reads env, globals or HTTP; dependencies come in as arguments (the house rule).

**Security model**:
- **The database is the fence.** Every table forces row level security, `withWorkspace()` is the only query path, and primary and foreign keys are composite, so no row can point into another workspace and no client chosen id can probe one.
- **Creating a workspace** runs entirely inside `withWorkspace()` for the new workspace's id, so even its first row passes the policy; no owner connection is needed.
- **Who may call which service** is #9's access door. Until it exists, the services are reachable only from tests and the seed scripts, never from an endpoint.
- **Privacy.** Values hold personal data (names, emails, phones), so erasure (AC-18) and the audit hook keep the design ready for #36's privacy tools under GDPR.

**Configuration required**: none new. The scale seed (`pnpm db:seed:scale`) uses the existing `DATABASE_URL_OWNER` and refuses to run against the production branch.

**Critical test scenarios** (integration tests against a real Postgres, as the house rules require):
- **Happy path:** a workspace seeds its three objects and a custom object is defined. A record of each gets every attribute type set, read, changed, cleared and read as of the earlier times, verifies **AC-1**, **AC-2**, **AC-3**, **AC-7**.
- **Option rename:** rename, reorder and archive an option on 10,000 records; no value row changes, and the sort follows the new order, verifies **AC-4**.
- **Relationships:**
  - link, then replace on a single side;
  - refuse a taken one to one;
  - read from both ends in order;
  - race two links onto a single side;
  - delete and restore one side, verifies **AC-5**, **AC-8**.
- **Isolation:** with the workspace filter removed from a query, nothing from workspace B comes back. Inserting a value with workspace B's attribute id is refused by the foreign key. Creating a record with workspace B's existing id in workspace A succeeds, and reveals nothing, verifies **AC-9**.
- **Concurrency:**
  - two transactions write the same unique email at once, and one is refused;
  - two saves from one base version both land, the second reports `replaced`, and only one current row remains;
  - a save racing a delete either lands before the delete or is refused, verifies **AC-3**, **AC-10**, **AC-12**.
- **Partial failure:** a batch of 500 records with 3 bad emails writes 497 and lists the 3, and the hooks see 497. Inside one record, a bad value writes nothing, verifies **AC-13**.
- **Hooks:** a hook that throws leaves no value, link or version behind, verifies **AC-17**.
- **Compiler:** every operator for every type, against the reference evaluator, including empties, multi valued items, nulls in sorts, mixed directions and 2 hop paths, plus a fuzzed set of nested groups, verifies **AC-14**.
- **Limits:** two concurrent creates at the record limit leave exactly one, verifies **AC-16**.
- **Scale:** the benchmark grid on the million record seed, on a Neon branch, verifies **AC-15**.

## Build plan

Tracer Bullet: the first milestone threads one text attribute from the migration through the write protocol and the query engine, with isolation proven, before breadth. Each later milestone thickens one strand.

**Milestone 1: one value through every layer**
1. Migration 1: `workspaces`, `workspace_counters`, `members`, `objects`, `attributes`, `records`, `values`, with the `btree_gin` extension, forced row level security, the policies, composite keys, the current value indexes and the storage settings. Extend the two guard tests to every new table, satisfies **AC-7**, **AC-9**.
2. `runWrite()` with the write protocol, the savepoint per record, the retry on deadlock, `afterWrite` hooks, and the `{ code, message }` refusals listed here, satisfies **AC-3**, **AC-13**, **AC-17**.
3. `createWorkspace` with a minimal template (People with name and email), `defineObject`, `defineAttribute`, `createRecord`, `setValues` and `getRecords` for text and email, with history, clearing and the record display, satisfies **AC-1**, **AC-3**, **AC-19**.
4. The query compiler for text operators, is empty, one sort and keyset paging, and the reference evaluator it's tested against, satisfies **AC-14**.

**Milestone 2: every type and the rules**
5. Migration 2: `attribute_options`. Every type's column mapping and canonical read back, `AttributeConfig` per type in contracts, defaults, required, unique (normalising, `held_unique_key`, turning on and off), and the limits module with its counters, satisfies **AC-2**, **AC-4**, **AC-10**, **AC-11**, **AC-16**.
6. `version_id`, `baseVersionId` and the `replaced` result, `setValuesBatch`, `getHistory`, `getValuesAsOf` and `getTimeInStages`, satisfies **AC-3**, **AC-12**, **AC-13**.
7. The full standard template v1 (People, Companies and Deals from research 5b, launch types only), satisfies **AC-1**.

**Milestone 3: relationships, lists and deletion**
8. Migration 3: `relationships`, `record_links`, `lists`, `list_entries`. Add `defineRelationship`, and linking with item order, single side flags, one way references and history. Lists get entries and entry values, satisfies **AC-3**, **AC-5**, **AC-6**.
9. `deleteRecord`, `restoreRecord`, `purgeDeleted` (batched, in foreign key order) and `eraseRecord`, satisfies **AC-8**, **AC-18**.

**Milestone 4: the whole query engine at scale**
10. Every operator in the type table, nesting up to 3, filters through relationships, every sort (option position, linked record and member names best effort), lists sorted by entry attributes, position jumps, and `countMatches`, satisfies **AC-6**, **AC-14**, **AC-15**.
11. `pnpm db:seed:scale` and the benchmark grid on a Neon branch, against this design and the split table variant. Record the results in `verify.md`. A miss, or a clear win for the variant, goes back to `/architect` with the measured plans, satisfies **AC-15**.

## Consequences

**Positive**:
- Standard and custom objects share one path, so every later feature works on every object for free.
- Renames, recolours and new attributes are row changes, never migrations or rewrites.
- History in place answers as of and time in stage with one range filter.
- The million record proof settles the riskiest question (dynamic attribute queries) before any screen depends on it.

**Negative / tradeoffs**:
- **Reads cost more than native columns.** Reading a record means gathering its value rows, and a sort on an attribute is a join.
- **Writes and storage cost more too.** There's one index per kind, and every edit moves a row out of the current indexes, so it can't be a cheap in place update. `values` grows with edits, not only with records, so vacuum and storage need watching, and partitioning may arrive after #12.
- **Some operators fall outside the budget.** Sorts by a linked record's name or a member's name, and the "narrowed only" operators, are best effort. A view built only on those can be slow at a million records.
- **Position jumps are limited.** They're fast only on unfiltered single sort views. A filtered view scrolls by cursor.
- **The query compiler is ours.** It's the riskiest piece here, and the reference evaluator has to keep it honest.
- **Every key is wider.** Composite primary and foreign keys widen every key, and every join has to carry `workspace_id`.

**Neutral**:
- Three migrations, each with hand written policies beside the generated SQL, and one new extension (`btree_gin`).
- `@crm/contracts/values` gains `AttributeConfig` per type and the refusal codes.
- The access door (#9), the outbox (#7), the audit log (#36) and the purge schedule (#8) plug into hooks and functions defined here.

## Follow-up

- [ ] **The scale proof's compute:** production is on Neon's Free plan today. Run AC-15 on a branch with the smallest paid compute, or record the Free plan result beside it and say which one the budget means.
- [ ] **#12's load harness** reuses `pnpm db:seed:scale` and the benchmark grid, and decides on hash partitioning of `values` by workspace.
- [x] **If the grid misses:** it did (the position jump, and more the performance review measured). Decided in [0004-stored-sort-keys.md](0004-stored-sort-keys.md): one `sort_keys` table refreshed in the write transaction, chosen over the split table variant.
- [ ] **#6's windowed client query** is designed against `queryPage`'s cursor, and against position jumps only for unfiltered views.
- [ ] **#14 (type changes)** designs how a type or multi change converts existing value rows in a background job.
- [ ] **Formula, rollup and lookup types (#16)** need their own storage decision; nothing here stores derived values.
- [ ] **`target_time_in_stage`** is stored now; the board and reports (#21, #52) decide how to show a stuck record.
