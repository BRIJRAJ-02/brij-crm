# 0004. Stored sort keys, capped counts and fast contains

**Date**: 2026-10-02

## Summary

The query engine missed its 300 ms budget in a few places at a million records, because row level security stops Postgres from using indexes on computed or numeric keys. This child spec adds one narrow table, `sort_keys`, that stores each record's sortable values as plain, index friendly keys with a flag that says whether the record is live, and keeps it current inside every save. It also caps counts at 10,000 ("10,000+"), and lets "contains" use the trigram index through one small search function that filters by the workspace itself. The benchmark grid grows to hold every case the reviews found, and the proof runs on a paid Neon branch.

## Context

Milestone 4 of spec 0004 met the original grid but missed the position jump (9.2 s at row 600,000), and the performance review measured more misses outside the grid: deep text cursors (2.05 s at row 500,000), a rare "name contains" (3.9 to 4.2 s), a narrow number range (0.6 s), currency sorts (1.2 s), list views sorted by a record attribute (0.6 s), a big first group with a second sort (2.2 to 2.5 s), the empty values branch (1.4 to 1.7 s), and counts up to 9.7 s, near their 10 s cutoff. The measured plans are in [verify.md](verify.md).

The cause is the same throughout. Every table forces row level security, so Postgres won't use an operator that isn't marked leakproof (safe to run before the policy check) as an index condition, or trust its estimate. Text comparison is leakproof, but `lower` and `left` inside the text sort key are not, so a text key can't be returned from the index or sought by a cursor. Numeric comparison isn't leakproof either, and neither is the trigram `like`. Only a superuser can change that, and Neon has none. Position jumps have a second problem: the value rows of a trashed record stay current, so skipping 600,000 rows exactly means checking each one's record.

## Requirements

**User stories**:
- As a member, I want to drag the scrollbar anywhere in a million records and land on exactly that row, fast.
- As a member, I want "name contains acme" to come back fast even when only a few records match.
- As a member, I want a row count that is always quick, even when it can only say "10,000+".

**Acceptance criteria** (numbered after spec 0004's, so every ID in the data model is unique):
- **AC-20**: `sort_keys` holds exactly one row for every current, set, position 0 value of a sortable attribute on a live or trashed record or entry, and no other rows. It changes in the same transaction as the save, clear, delete, restore, entry removal, purge or erasure that moves it. `live` is false exactly while the record is trashed or the entry removed. A test drives a random mix of those writes and compares `sort_keys` with what the current values say.
- **AC-21**: A jump to any position on an unfiltered object view with one sort (any kind with a stored key, created at, updated at or record id), or on an unfiltered list view sorted by one of its entry attributes, returns the same rows the reference evaluator puts there, with trashed records and removed entries left out. Sorts by created by or updated by (member names) and list views sorted by a record attribute page by cursor only. On the scale seed, the jump to row 600,000 sorted by name returns its 50 rows under 300 ms at p95 in the database call.
- **AC-22**: Every query in the extended grid (below) returns its page of 50 rows under 300 ms at p95 in the database call, warm, on the scale seed, on the Neon branch of AC-26. Sorts by a linked record's name and by a member's name are measured and recorded, but stay best effort, as spec 0004 says.
- **AC-23**: `countMatches` returns `{ count, atLeast }`: the exact count when it is 10,000 or fewer (`atLeast` false), otherwise `count` 10,000 and `atLeast` true. An unfiltered object or list view always gets its exact total. Every grid query's count finishes inside the 10 s timeout, and an aborted count is still refused with `QUERY_CANCELLED`.
- **AC-24**: `contains` and `does not contain` (text, long text, email, domain, url, full name and file name) whose pattern holds a run of 3 or more letters or digits use the trigram index through the search function, directly or through a relationship. A negative uses it only when the function returned fewer ids than its cap. A rare match (under 0.5% of rows) returns its first page within AC-22's budget. The function returns nothing from another workspace and nothing when no workspace is set; it is the only `security definer` function, and `crm_search` the only role that bypasses row level security (a guard test lists both).
- **AC-25**: If the Neon branch can't create a role that bypasses row level security, `contains` stays narrowed only (no index), is recorded outside the budget, and every other criterion still ships. No weaker workaround replaces the function.
- **AC-26**: The AC-15 and AC-22 proof runs on a Neon branch on the smallest paid compute, seeded by `pnpm db:seed:scale`, with the results recorded in [verify.md](verify.md) beside the local Docker run.

**Extended grid** (adds to spec 0004's grid, same seed):

| # | Query |
|---|---|
| 7 | Sort by name, the page after a cursor at row 100,000 |
| 8 | Sort by name, the page after a cursor at row 500,000 |
| 9 | Sort by probability, the page after a cursor at row 500,000 |
| 10 | Sort by stage, then by name |
| 11 | Name contains a string matching under 0.5% of deals, sort by name |
| 12 | The same filter, sort by close date |
| 13 | Probability between 41 and 42, sort by name |
| 14 | Sort by value (currency) |
| 15 | The pipeline list sorted by the deal's close date (a record attribute) |
| 16 | Sort by next step, the page that runs from the last values into the empties |
| best effort | Sort by associated company (a linked name); sort by owner (a member) |

## Options considered

### Option 1: A sort keys table with a live flag (chosen)

One narrow table holds a copy of each current, set, position 0 sortable value as a typed, leakproof key (ICU text, a scaled `int8`, `date`, `timestamptz`, option id, bool), plus `live`. Partial indexes on `live` give index only scans for jumps and seeks for cursors.

**Pros**: exact jumps with no record check per row; seeks for every kind; `values` (6 GB with indexes at a million records) is not rewritten; option renames and reorders still touch nothing, because the key is the option id.
**Cons**: every save of a sortable value writes one more small row; a delete or restore flips about one row per sortable attribute; one more table to purge, erase and backfill.

### Option 2: Generated key columns on `values`

Stored generated columns (`lower(left(text_value, 256))`, a float key) on `values` itself, indexed.

**Pros**: no new write path; the key can never drift from the value.
**Cons**: rewrites the 2.3 GB table and widens its indexes; it can't answer "is this record live" without a flag on every current value row, which a delete would have to rewrite through the value indexes; jumps stay inexact without it.

### Option 3: The split table variant

Current values in their own table, history apart, with keys.

**Pros**: smaller current indexes for every read.
**Cons**: the benchmark showed no clear win on the grid, it moves every read and write path, and it still needs stored keys and a live flag to fix the jump.

## Decision

**Chosen option**: Option 1: a `sort_keys` table with typed, leakproof keys and a live flag, written in the save's transaction, plus a capped count and a workspace scoped trigram search function.

**Implementation skills**: `drizzle` (`lobehub/lobehub`, `.claude/skills/drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `crm-data-model-access` (project, `.claude/skills/crm-data-model-access/`)

## Rationale

Option 1 fixes the root cause (keys Postgres can use under row level security) where the misses live, and leaves the storage design of spec 0004 alone. Option 2 was the runner up; it loses because a jump can't be exact without a live flag, and putting that flag on `values` makes every delete rewrite value index entries. The answers that shaped it: jumps must be exact, keys are written in the same transaction, empties get no key row, numbers use a scaled `int8` (so the contract caps them at 14 integer digits), and every scalar sortable kind gets a key. On the local Postgres 18, text, `int8`, `float8`, `date`, `timestamptz`, `uuid` and `bool` comparisons are all marked leakproof, and `lower`, `like` and numeric comparisons are not; a probe confirms the same on the Neon branch before milestone 5 relies on it.

### Calls made in this spec

- **Number keys:** `number_key int8` holds the value times 10,000, exact for 14 integer digits and 4 decimals. `DECIMAL_LIMITS.integerDigits` in `@crm/contracts` goes from 15 to 14 (99 trillion), before any real data exists. Filter operands are scaled in the engine and bound as typed `int8` parameters. Runner up: `float8` with an exact numeric tiebreak, which keeps 15 digits but adds a second column, an edge recheck on ranges and a special cursor case.
- **Where keys are written:** one `syncSortKey(tx, owner, attribute, items)` at the end of `writeAttribute` in `values.ts`, the one path every value write takes (`setValues`, `setValuesBatch`, `createRecord` defaults and entry values). It upserts from item 0, deletes the row when the value is cleared or empty, and writes nothing when the key is unchanged, so a reorder that keeps item 0 costs nothing. Links and actors have no key, so `writeLinks` is untouched.
- **One text key expression:** `text_key` is computed only in SQL, as exactly the expression the existing text indexes and the compiler use (`lower(left(text_value, 256)) collate "und-x-icu"`). The save, the backfill, the seed and the evaluator's comparison all use it; nothing computes it in JavaScript.
- **Live formulas:** a record's rows get `records.deleted_at is null`; an entry's rows get `list_entries.deleted_at is null and records.deleted_at is null`. Through the services an entry can't be written while its record is trashed (`lockEntry` refuses), so the second half matters only in the backfill and the seed. `restoreRecord` flips back the rows of its entries that aren't removed. Lock order stays as today: `lockEntry` takes the entry, then the record (share), before it writes a key row; `deleteRecord` takes the record, then flips its entries' rows.
- **Purge, erasure and archive:** `purgeDeleted` deletes key rows by `record_id` for purged records, and by `entry_id` for purged removed entries, before their values and entries. `eraseRecord` deletes by `record_id`. Foreign keys are plain restrict (no cascade), so a missed delete fails loudly instead of hiding an AC-20 bug. Archiving an attribute or an option leaves its key rows; #14 rebuilds them on a type change.
- **Jumps by kind:** a stored key sort jumps by `offset` over its live key index. A select or status sort first runs one index only `count(*) group by option_id` over the live keys, walks the options in position order to the one holding the position, then offsets inside it by owner id; the same counts tell where the empties start. Created at, updated at and record id jump over the records indexes. Every jump query repeats its partial index condition (`live` and the key `is not null`) literally, so the planner picks that index.
- **Cursors:** the expanded OR chain the engine uses today, never a row value comparison, because currency `(code_key, number_key)` and location `(code_key, text_key)` keys can mix directions with the tiebreak.
- **Count cap:** 10,000, counted as `count(*)` over the filtered rows with `limit 10001`. An unfiltered object view counts its live records with an index only scan (about 100 to 300 ms at a million, not instant). An unfiltered list view takes `lists.entry_count` minus its live entries of trashed records, found through a new small index on trashed records. A rare filter that matches almost nothing still reads every candidate, so its speed comes from the stored keys and the search function. Runner up: a planner estimate, which row level security makes unreliable.
- **Search function cap:** it returns at most 5,000 distinct owner ids. Fewer means a rare match: the page filters those ids first and sorts them. Exactly 5,000 means a common match: the page takes the index first path, which fills quickly. A pattern with no run of 3 or more letters or digits has no trigram, so it skips the function (it would scan every value with row level security off).
- **Contains through a relationship:** the function's far record ids feed `record_links.to_record_id = any(ids)` (or `from_record_id`, by the hop's side), and the far record's liveness is still checked through `records`, because the ids include trashed records. A negative, directly or through a path, uses the ids only when they came back under the cap; otherwise it takes the narrowed path.
- **Location keys:** `code_key` holds the country code and `text_key` the lowercased locality, with their own index, matching spec 0004's order (country, then locality).
- **Empties:** no key row. The empties branch reads records in id order (a list view: its live entries in id order, joined to live records) with `not exists` a key row for that attribute, checks each one per row behind the fence, and stops at the page limit or after 50,000 rows read, whichever comes first; past 50,000 it is best effort and the page says so in its plan. Its id tiebreak follows the last sort's direction, as the valued rows do. It is skipped when the filter needs a value of the sorted attribute (a positive condition on it at the top level of an "and"). A checkbox's unchecked records are its empties, last in both directions, as the evaluator already sorts them.
- **A big first group:** when a capped round cuts a group of equal first keys and a second sort exists, the engine reads that group alone, driven by the second sort's key, with "first key equals the edge" checked per row like any other filter.
- **List views by a record attribute:** drive from the record's key rows, join the list's live entries by record id, ties broken by entry id.
- **Filters on stored keys:** a filter on a single valued number, rating, currency, date or timestamp attribute compiles against `sort_keys` (an index condition on live rows; numbers compare as scaled `int8`, so no recheck). Multi valued attributes keep filtering on `values`, because a filter matches any item and the key holds only position 0.

## Feature design

**Data model sketch** (Postgres 18, Drizzle schema in `packages/db/src/schema/records.ts`):

| Column | Type | Null | Notes |
|---|---|---|---|
| workspace_id | uuid | no | part of every key |
| owner_id | uuid | no | the record or entry, as on `values` |
| attribute_id | uuid | no | FK `(workspace_id, attribute_id)` to attributes |
| record_id | uuid | no | FK to records; the entry's record, or the record itself |
| entry_id | uuid | yes | FK to list_entries; set for an entry's own attribute |
| live | bool | no | false while the record is trashed or the entry removed |
| text_key | text, collation `und-x-icu` | yes | `lower(left(value, 256))` for text kinds; the locality for location |
| number_key | int8 | yes | number, rating, currency amount, times 10,000 |
| code_key | text, collation `C` | yes | currency code; location country code |
| date_key | date | yes | date |
| time_key | timestamptz | yes | timestamp; interaction's `at` |
| option_id | uuid | yes | select, status; FK to attribute_options |
| bool_key | bool | yes | checkbox (only true is stored) |

- Primary key `(workspace_id, owner_id, attribute_id)`. Forced row level security with the plain comparison policy, like every table.
- Indexes, each partial on `live` and its key `is not null`, each leading `(workspace_id, attribute_id, …, owner_id)`: text `(text_key)`, number `(number_key)`, currency `(code_key, number_key)`, location `(code_key, text_key)` partial on `code_key is not null` (a country with no locality sorts its locality last), date `(date_key)`, time `(time_key)`, option `(option_id)`, bool `(bool_key)`. Plus `(workspace_id, record_id)` and `(workspace_id, entry_id)` over all rows, for delete, restore and purge.
- On `records`, a small partial index `(workspace_id, id) where deleted_at is not null`, for the unfiltered list count.
- Storage settings as on `values` (`fillfactor` and the `autovacuum_*` settings), because live flips and key changes are not in place updates and index only scans need a current visibility map.
- Which kind fills which key follows spec 0004's type table: text, email, domain, url, phone, personal name (full name) and file (name) fill `text_key`; actor and record reference get no key (best effort sorts).

**State transitions** (`live`):
- A save of a set value: upsert the row, `live` copied from its owner (true for a live owner).
- A clear, or a value moved off position 0: delete the row (the new position 0 item, if any, takes it).
- Delete a record: `live = false` for every row with that `record_id` (its own and its entries').
- Restore a record: `live = true` for its own rows and the rows of its entries that aren't removed.
- Remove an entry: `live = false` for its rows; restore the entry: `live = true` if its record is live.
- Purge and erasure: delete the rows, before `values`.

**API surface** (services in `packages/core`, no HTTP yet):

| Service | Change | Key inputs | Key outputs | Key errors |
|---|---|---|---|---|
| `queryPage` | reads `sort_keys` to drive sorts, cursors, jumps and stored key filters | unchanged | unchanged | unchanged |
| `countMatches` | capped | unchanged | `{ count, atLeast }` | `QUERY_CANCELLED` |
| `crm_search_text(attribute_id, pattern, max)` | new SQL function, `security definer`, owned by `crm_search` | attribute id, raw text, limit | up to `max` owner ids | none (no workspace means no rows) |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| any save | `text_key` | `lower(left(text_value, 256))` in `und-x-icu`; for location, the lowercased `json_value->>'locality'` |
| any save | `number_key` | `(number_value * 10000)::int8`; the contract's 14 digit cap keeps it in range |
| any save | `code_key` | `text_value` (currency code, or location country code) |
| any save | `date_key`, `time_key`, `option_id`, `bool_key` | `date_value`, `timestamp_value`, `option_id`, `bool_value` of the same row |
| any save | `live` | the owner's state under its row lock: the record's `deleted_at` and, for an entry, its `deleted_at` |
| delete, restore, remove | `live` | the write itself, as in State transitions |
| migration | the first rows | a backfill from current, set, position 0 value rows joined to their owners |
| `queryPage` jump | the row at a position | an index only scan with `offset` over the live key index; for created and updated at, the records index |
| `queryPage` | which path a contains takes | the function's result size: under 5,000 ids filters first, exactly 5,000 drives from the index |
| `countMatches` | `count`, `atLeast` | `count(*)` over the filter with `limit 10001`; unfiltered object: index only count of live records; unfiltered list: `lists.entry_count` minus live entries of trashed records |
| `crm_search_text` | the workspace | `nullif(current_setting('app.workspace_id', true), '')::uuid`, set by `withWorkspace()`; an empty or missing setting gives no rows |
| `crm_search_text` | the match | `lower(left(text_value, 2048)) like '%' || escaped pattern || '%'`, the trigram index's own expression, with the index's own predicate (`active_until is null and not is_cleared and text_value is not null`); `%`, `_` and `\` escaped inside the function |
| `crm_search_text` | `max` | clamped to 1 to 5,000 inside the function; `distinct owner_id`, so a multi valued attribute doesn't spend the cap on duplicates |
| `queryPage` | a number filter's operand | the parsed decimal times 10,000 in the engine, bound as `int8` |
| scale seed | trashed records, removed entries, rare names | about 1% of deals trashed and 1% of entries removed; a token on 0.1% of names (about 1,000) and another on 0.4%; then `vacuum (analyze)` |
| Neon proof | the branch host | `SEED_SCALE_ALLOW_HOST`, which the seed and bench already read |

**Key invariants**:
- At most one key row per (owner, attribute), and one exactly when a current, set, position 0 value exists (AC-20).
- A key row's `live` always equals its owner's state, because both change under the owner's row lock in one transaction.
- Option keys are option ids, so renaming, recolouring, reordering or archiving an option rewrites no key row (spec 0004, AC-4).
- `values` stays the truth. `sort_keys` can always be rebuilt from it, and the rebuild is the backfill.
- No read trusts `sort_keys` for a value it shows; reads still come from `values`.

**Security model**:
- `sort_keys` is a tenant table like any other: `workspace_id` first in every key, composite foreign keys, forced row level security, covered by both guard tests.
- `crm_search_text` is the one hole in row level security, kept as small as possible: `language sql stable security definer`, `set search_path = public, pg_temp`, `set statement_timeout = '2s'`, `rows 5000`, owned by `crm_search` (`nologin`, `bypassrls`, with `usage` on `public` and `select` on `values` only, owning nothing else), `execute` granted to `crm_app` only and revoked from `public`. It reads only `values`, filters by the session's workspace itself, returns only owner ids (never values), and returns the ids of trashed records too, so the caller's liveness checks still decide what shows.
- The migration that creates it grants `crm_search` to the migrating role `with set true` (Postgres 16 and later don't grant that on create), sets the owner, then revokes the grant.
- Guard tests: the function returns nothing for workspace B's attribute under workspace A, nothing with no workspace set and nothing with it set to empty. Outside extension owned objects and the system schemas, the database holds exactly one `security definer` function, and `crm_search` is the only `bypassrls` role besides the superuser. `crm_search` owns nothing else, can't log in, and `crm_app` can't `set role` to it.
- Field permissions (#9) will hide some attributes from some members. The search function sees every attribute, so the access door must check a member may read an attribute before the compiler calls the function for it.
- `security-access-reviewer` reviews the function and its migration before it lands.

**Configuration required**:
- No new env vars. `pnpm db:setup` creates `crm_search` locally; on Neon the setup script creates it through the owner role, which needs the right to grant `bypassrls` (checked first, see AC-25).
- `SEED_SCALE_ALLOW_HOST`: the Neon branch host for the proof (already read by the seed and bench).

**Critical test scenarios** (real Postgres, never mocks):
- **Leakproof probe:** the comparisons the keys seek on are leakproof, and an `EXPLAIN` as the app role shows each seek as an index condition, locally and on the Neon branch, verifies **AC-21**, **AC-22**.
- **Keys follow values:** a random mix of saves, clears, multi value reorders, deletes, restores, entry removals, purges and erasures, then `sort_keys` compared with the current values, verifies **AC-20**.
- **Exact jumps:** the reference evaluator against jumps on every kind, with trashed records and removed entries in the sample, verifies **AC-21**.
- **Ties and big groups:** the largest and smallest 14 digit numbers, a select sort with a second sort at a cap of 3, a list view by a record attribute, a page across into the empties, against the evaluator, verifies **AC-22**.
- **Counts:** under, at and over 10,000 (with a lowered cap for the test), unfiltered object and list totals with trashed records, and an aborted count, verifies **AC-23**.
- **Search:** rare and common patterns, patterns with no 3 character run (`a b`, `%--%`), `%` and `_` in the pattern, negatives under and at the cap, through a relationship to a trashed far record, and the tenancy guards, verifies **AC-24**.
- **No bypass:** with `crm_search` absent, contains still answers correctly by the narrowed path, verifies **AC-25**.
- **Scale:** the extended grid on the Neon branch, verifies **AC-22**, **AC-26**.

## Build plan

Tracer Bullet: one text key from the migration through the save, the delete and the jump, measured at scale, before every kind.

**Milestone 5: one stored key through every layer**
1. The leakproof probe, locally. Migration: `sort_keys` with its policy, storage settings, the text index and the record and entry indexes, and a backfill from current text values. Extend the guard tests, satisfies **AC-20**, **AC-21**.
2. Write the key in the save, clear, delete, restore, removal, purge and erase paths for text kinds, satisfies **AC-20**.
3. Drive a single text sort, its cursor and its jump from `sort_keys`. Seed the scale workspace's keys (with the trashed records, removed entries and `vacuum (analyze)`) and run grid 1b, 7 and 8. If the jump has no headroom under 300 ms here, stop and come back before milestone 6, satisfies **AC-21**, **AC-22**.

**Milestone 6: every kind, and the paths around them**
4. `DECIMAL_LIMITS.integerDigits` to 14 in `@crm/contracts`. The other key columns and indexes, the trashed records index, their backfill and their writes, satisfies **AC-20**.
5. Drive every stored key sort, cursor and jump from `sort_keys`; filters on single valued numbers, ratings, currency, dates and timestamps against it with the exact recheck, satisfies **AC-21**, **AC-22**.
6. The big first group, list views by a record attribute, and the empties branch as the calls above say, satisfies **AC-22**.
7. The capped `countMatches` and its new return shape (the bench and tests follow), satisfies **AC-23**.

**Milestone 7: contains, and the proof**
8. Run the leakproof probe on the Neon branch, and check it can create `crm_search`. Then the migration for `crm_search` and `crm_search_text`, the compiler's use of it, the guard tests, and `security-access-reviewer`; or, if it can't, the narrowed only fallback recorded, satisfies **AC-24**, **AC-25**.
9. Add the rare name tokens to the seed, and grid 7 to 16 and the best effort pair to `bench-scale.ts`. Run it locally, then on the paid Neon branch, and record both in `verify.md`, satisfies **AC-22**, **AC-26**.

## Migration plan

**Strategy**: no flag needed. Production holds almost no data, so the migration backfills in one statement and the engine reads `sort_keys` from the same deploy.
**Phases**:
1. The migration creates the table and indexes, then backfills from `values`.
2. The engine's writes and reads switch in the same release.
**Rollback**: revert the commit. The table stays, but its keys go stale as soon as writes stop maintaining them, so before any later release reads it again, truncate it and run the backfill again (the backfill statement is kept as a script for that).
**Risks**: a backfill on a large workspace would hold locks for a while (none exists yet; #12's harness sizes it for later). A write path that forgets a key leaves a sort wrong; AC-20's comparison test is the guard. An ICU upgrade in the Neon image can change text order under an existing index: compare `pg_collation.collversion` with `pg_collation_actual_version()` after any Postgres upgrade, and if they differ, `alter collation "und-x-icu" refresh version` and reindex the text key indexes. A test asserts the version recorded at migration time.

## Consequences

**Positive**:
- Exact, fast jumps and deep cursors for every stored kind.
- Number, date and currency ranges become index conditions despite row level security.
- Counts are always quick, and say "10,000+" honestly instead of timing out.
- Rare contains matches come back fast.

**Negative / tradeoffs**:
- Every save of a sortable value writes one more row (none when the key is unchanged), and a delete or restore writes about one row per sortable attribute, so a bulk delete of 100,000 records flips about 2 million rows. The scale seed and #12 measure it, and bulk deletes will need batches.
- Numbers lose one integer digit: the contract caps them at 14 (99 trillion).
- A jump is an offset over the index, so its cost grows with the position; at 600,000 it may have little headroom on the smallest Neon compute. Milestone 5 measures it first.
- `sort_keys` adds roughly the size of the current text and number indexes again.
- `crm_search_text` is a deliberate gap in row level security. It is small, reviewed and guard tested, but a bug there could cross workspaces, so any change to it goes through `security-access-reviewer`.
- A jump that lands among the empties, and an empties page past 50,000 rows read, still read records in id order, so they stay best effort.
- Counts over 10,000 are no longer exact; the scrollbar sizes itself from "at least 10,000" until the user reaches the end.

**Neutral**:
- One migration (two with the search function), one new role, one new SQL function.
- `countMatches` changes its return shape before anything outside tests calls it.
- `values` and the storage choice of spec 0004 stay as they are.

## Follow-up

- [ ] **Neon branch:** create a `brij-crm` Neon project on a paid plan (the cost is yours to approve), and give its branch host for `SEED_SCALE_ALLOW_HOST` before milestone 7.
- [ ] **#14 (type changes)** must rebuild an attribute's key rows when its type or multi setting changes.
- [ ] **Whole call cost:** `readRecords` and setup add 10 to 25 round trips (94 to 148 ms whole call against 23 to 74 ms for the page). Passing `prepare`'s attributes into `readRecords` and reading only visible attributes belongs with #6's windowed client query.
- [ ] **#6's scrollbar** sizes itself from `{ count, atLeast }`.
- [ ] **#9 (access door):** check a member may read an attribute before a `contains` on it reaches `crm_search_text`.
- [ ] **If the jump misses at 600,000:** rank checkpoints (a stored key every 10,000 rows per sort, refreshed by a job) are the next step, back through `/architect`.
- [ ] **Global search (#33):** when a dedicated search index arrives, `contains` may route through it and `crm_search_text` may retire.
