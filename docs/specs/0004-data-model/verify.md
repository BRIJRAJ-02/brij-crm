# Verify: The data model · spec 0004 · updated 2026-10-02
_Steps derived from spec 0004's acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones. Every engine test runs against a real Postgres 18 (the local Docker one, or the CI service), never a mock._

## Commands
- [ ] `pnpm --filter @crm/db test` → the guard tests pass: every table forces row level security with a policy, every index leads with `workspace_id`, a read without the workspace returns nothing, and a write into another workspace is refused by the database → AC-7, AC-9
- [ ] `pnpm --filter @crm/core test` → the engine suites pass (`engine.test.ts`, `rules.test.ts`, `links.test.ts`, `query/query.test.ts`, `sort-keys.test.ts`) → AC-1 to AC-21
- [ ] `pnpm db:migrate` on an empty database → migrations 0001 to 0011 apply in order; `pnpm db:generate` afterwards reports no schema changes → AC-9
- [ ] `pnpm db:migrate` on a database that already has data → 0009 fills `sort_keys` for every workspace, and afterwards every table still forces row level security → AC-9, AC-20
- [ ] `pnpm check` → green

## Milestone 1: one value through every layer
- [ ] A new workspace has People, Companies and Deals as ordinary object rows marked standard with `template_version` 1, and a custom object defined afterwards has the same system attributes (record id, created at and by, updated at and by) → AC-1
- [ ] Set a text value, change it, clear it: `getHistory` lists three versions, each with who and when, the cleared one null, each `active_until` equal to the next `active_from`; saving the same value again writes nothing → AC-3
- [ ] Every value write moves the record's `updated_at` and `updated_by` → AC-7
- [ ] A hook that throws leaves no value, version or record behind → AC-17
- [ ] An unnamed record reads "Unnamed <object>"; a person's name reads its full name → AC-19

## Milestone 2: every type and the rules
- [ ] Each of the stored types reads back as its schema parses it (`1.5`, not `1.5000`), multi valued ones in order; a refused value names its attribute and writes nothing → AC-2
- [ ] Rename, reorder and archive an option: no value row changes; an archived option stays on records and is refused for new writes with `OPTION_ARCHIVED` → AC-4
- [ ] Two concurrent writes of one unique email to two records: one lands, one is refused `UNIQUE_CONFLICT`. Turning Unique on over duplicates is refused with the values and their counts → AC-10
- [ ] A required attribute refuses a create without it and refuses clearing it, with `VALUE_REQUIRED`; old empty records stay as they are → AC-11
- [ ] Two saves from one base version both land; the second names the version and actor it replaced → AC-12
- [ ] A batch with bad rows lands the good records, lists the bad ones, and the hooks see only the good → AC-13
- [ ] Limits refuse with `LIMIT_REACHED` naming the limit, even under concurrent creates at the last slot → AC-16

## Milestone 3: relationships, lists and deletion
- [ ] Link a person to a company: one `record_links` row, read from both ends in order. Move the person to another company: the old link ends in history → AC-3, AC-5
- [ ] A one to one partner that already has a link refuses `RELATIONSHIP_TAKEN` naming that record; two racing links leave exactly one → AC-5
- [ ] A one way reference links only to the objects it names, with no attribute on the other side → AC-5
- [ ] A list entry has its own values, history and time in stage; a once only list refuses a second entry with `ENTRY_EXISTS` → AC-6
- [ ] Delete a record: it, its links and its entries vanish from every read, history included, and the record on the other side is untouched. Restore it: all three come back; a unique value taken meanwhile refuses `UNIQUE_CONFLICT` listing it → AC-8
- [ ] `purgeDeleted` removes only records deleted more than 30 days ago (whatever cutoff it's given), with their values, links and entries, and returns the counts → AC-8
- [ ] `eraseRecord` removes every value and past version of one record, and the hooks see an erasure → AC-18

## Milestone 4: the whole query engine at scale
- [ ] Every operator each type offers, negatives matching empties, nesting 3 deep, filters through 1 and 2 relationships, relative dates in a time zone with a Sunday week start, every sort with empties last, list views over entry and record attributes, paging at every page size: the compiler returns exactly what the reference evaluator does (`query/query.test.ts`) → AC-6, AC-14
- [ ] No user text reaches the SQL string: every operand is a bound parameter (`compile.ts`; the only `sql.raw` fragments are fixed column names, operators and aliases) → AC-14
- [ ] `countMatches` returns the exact count, and a count blocked behind a held lock is cancelled by its abort signal with `QUERY_CANCELLED`. The cancel names the count's own transaction (a unique `application_name`), so it never lands on a pooled connection another request has since taken → AC-15
- [ ] Every page and count statement has a 10 s `statement_timeout`; a page past it is refused `QUERY_CANCELLED` → AC-15
- [ ] A filter holds at most 50 conditions per group and 100 in all, and follows at most 2 relationships (nested `through` counted); the contract refuses more before anything walks it. A cursor key that isn't its sort's type is refused `FILTER_INVALID`, never a database error → AC-14
- [ ] A deleted record, a removed entry, an entry of a deleted record, and a deleted far record never come back from the index first pass, the empties or filter first, at any cap → AC-8, AC-14
- [ ] Another workspace's object or list id is refused `NOT_FOUND`, the same as one that never existed, and its attribute ids are unknown here → AC-9
- [ ] `pnpm db:seed:scale` then `SCALE_WORKSPACE_ID=<id> pnpm db:bench:scale` → every grid query's p95 is under 300 ms (results below) → AC-15

## Milestone 5: one stored sort key through every layer ([0004-stored-sort-keys](0004-stored-sort-keys.md))
- [ ] A random mix of saves, clears, multi value reorders, deletes, restores, entry removals and restores, an erasure and a purge leaves `sort_keys` exactly equal to `sort_key_sources` (no extra and no missing rows) → AC-20
- [ ] An unchanged value writes no key; long text gets no key → AC-20
- [ ] A jump to every position on a text sort (records, a multi valued email, and a list's entry attribute; both directions; into the empties) returns what cursor paging puts there, with trashed records and removed entries left out → AC-21
- [ ] The text, int8, date, timestamptz, uuid and bool comparisons are leakproof, and a text cursor on `sort_keys` is an `Index Cond` of an index only scan as the app role → AC-21, AC-22
- [ ] Every view in `public` is `security_invoker`, so a reader's own row level security applies (`guards.test.ts`) → AC-9
- [ ] On the scale seed (1% of deals trashed, 1% of entries removed), grid 1, 1b, 7 and 8 are under 300 ms at p95 (results below) → AC-21, AC-22

## Milestone 6: every key kind, and the paths around them
- [ ] The drift test (`sort-keys.test.ts`) holds with every kind: text, multi valued email, number, rating, currency, date, timestamp, multi select, status, checkbox, location and interaction, through random saves, clears, deletes, restores, removals, an erasure and a purge → AC-20
- [ ] A number with 15 digits before the point is refused by the contract; 14 digits and 4 decimals round trip, and its key is the value times 10,000 → AC-20
- [ ] Sorts on a status then a name, a status descending then a number, a multi select's first item, currency both ways, rating, checkbox, timestamp, and number and currency filters match the reference evaluator at the usual cap and a cap of 3 (group reads), in pages of 2 and 4 → AC-22
- [ ] A jump on currency, status (both ways), checkbox, timestamp and number lands where the evaluator puts the row → AC-21
- [ ] A list paged by an entry status then its record's name, and by its record's name alone, matches the evaluator → AC-22
- [ ] `countMatches` returns `{ count, atLeast }`: exact at and under the cap, the cap with `atLeast` true over it, and an unfiltered object or list's exact total whatever the cap → AC-23
- [ ] On the scale seed, every grid row is under 300 ms at p95 (results below) → AC-22
- [ ] A cursor key out of its type's range (a number past int8, a 30th of February, hour 25) is refused `FILTER_INVALID`, never a database error → AC-14
- [ ] After a deploy whose migration adds key kinds, `pnpm db:reconcile:sort-keys` (owner, direct connection) repairs any key the old version's saves missed during the deploy; run again, it reports 0 written and 0 removed (locally: 0 and 0 across 7.8 million keys) → AC-20

## Value sourcing
- [ ] `t` for a version is `clock_timestamp()` after the owner's row lock, never before the version it replaces; a delete's `deleted_at` is taken the same way, so no save looks later than the delete it lost to → write protocol
- [ ] Relative dates resolve against the `now`, `timeZone` and `weekStart` passed to `queryPage` and `countMatches` (the database's `now()`, UTC and Monday when absent) → queryPage, countMatches
- [ ] "Is me" is `scope.actor` → queryPage
- [ ] The standard template comes from `packages/core/src/templates/standard-v1.ts`, relationships included → createWorkspace

## Scale results (AC-15)

Run on 2 October 2026 against the local Docker Postgres 18.6 (8 CPUs, 8 GB for Docker, Apple silicon), not Neon. `pnpm db:seed:scale` made 1,000,000 deals with the template's attributes filled, a past stage version on 75% of them, a company link on 90% (20,000 companies, 20 industries), and a pipeline list of 200,000 entries: 9.6 million value rows in all. Each time is the page's database work (every statement it runs), warm, 20 runs, as the app role with row level security on. "Whole call" adds reading the 50 records back. "Split table" is the same grid with current values alone in their own table.

| Query | p50 (ms) | p95 (ms) | whole call p95 (ms) | split table p95 (ms) | exact count | Budget |
|---|---|---|---|---|---|---|
| 1. No filter, sort by name | 20.8 | 23.7 | 147.9 | 23.9 | none | met |
| 1b. The same at position 600,000 | 7,569.5 | 9,159.8 | 7,847.8 | 1,731.8 | none | **missed** |
| 2. Source is any of (about 20%), sort by created at | 37.6 | 40.2 | 131.3 | 40.6 | 199,754 in 708 ms | met |
| 3. Name contains, probability between, deal type is; sort by close date, then name | 48.7 | 53.1 | 155.8 | 49.6 | 30,435 in 9,667 ms | met |
| 4. Through the company: its category is Industry 3 (5%), sort by name | 59.0 | 74.0 | 127.0 | 64.0 | 45,055 in 276 ms | met |
| 5. Next step is empty, sort by stage | 24.3 | 25.4 | 104.7 | 38.6 | 499,156 in 2,127 ms | met |
| 6. List of 200,000 entries: entry stage is Qualified, sort by entry due date | 25.0 | 31.1 | 93.9 | 28.3 | 50,097 in 302 ms | met |

| Table | Rows (estimate) | Table size | Index size |
|---|---|---|---|
| list_entries | 201,000 | 26 MB | 36 MB |
| record_links | 901,710 | 207 MB | 634 MB |
| records | 1,082,000 | 183 MB | 326 MB |
| values | 9,564,226 | 2,322 MB | 3,654 MB |

### Milestone 5: stored text keys (local Docker, 2 October 2026)

The same seed with 10,007 deals trashed and 1,987 entries removed (15,100 hidden keys), `sort_keys` backfilled by migration 0009 (1.58 million keys, about a minute), then `vacuum (analyze)`. `BENCH_ONLY=1,1b,5,7,8 BENCH_SPLIT=off pnpm db:bench:scale`, 20 warm runs each, as the app role. "First run" is the cold one, before the warm ups.

| Query | first run (ms) | p50 (ms) | p95 (ms) | whole call p95 (ms) | before (p95) |
|---|---|---|---|---|---|
| 1. No filter, sort by name | 4.2 | 4.2 | 6.9 | 36.4 | 23.7 |
| 1b. The same at position 600,000 | 86.7 | 39.6 | 42.1 | 85.4 | 9,159.8 |
| 5. Next step is empty, sort by stage | 22.2 | 11.0 | 11.7 | 38.3 | 25.4 |
| 7. Sort by name, the page after a cursor at row 100,000 | 5.8 | 2.7 | 3.0 | 38.2 | not run |
| 8. Sort by name, the page after a cursor at row 500,000 | 3.2 | 2.6 | 2.8 | 45.1 | 2,050 (review probe) |

Every key read is an index only scan with no heap fetches; `sort_keys` is 191 MB with a 186 MB text index. The jump has headroom (the stop rule in milestone 5 doesn't fire), so milestone 6 goes ahead. A save's key sync is index lookups only (0.3 ms for one owner and attribute, as the app role); the first version joined the record through a `coalesce`, which row level security can't use as an index condition, and scanned every record (about 200 ms), so a test now pins that plan.

Still open from the review, for milestone 6 and 7:
- A jump into the empties counts the live keys first, a scan of the whole `sort_keys` heap (200 to 290 ms), and is best effort, as the spec says.
- A last page with few or no empties reads up to 5,000 rows one by one before it filters first (about 12 ms more than before).
- The cold first jump (87 ms locally) will be slower on the smallest Neon compute, where the text index may not stay cached: AC-26 records the first run there too.

### Milestone 6: every key kind (local Docker, 2 October 2026)

Migrations 0010 and 0011 added the other kinds' keys (7.8 million keys in all) and indexes; then `vacuum (analyze)`. `BENCH_SPLIT=off pnpm db:bench:scale`, 20 warm runs each, as the app role:

| Query | first run (ms) | p50 (ms) | p95 (ms) | whole call p95 (ms) | count |
|---|---|---|---|---|---|
| 1. No filter, sort by name | 4.2 | 3.3 | 4.6 | 52.9 | none |
| 1b. The same at position 600,000 | 286.1 | 39.7 | 43.3 | 84.7 | none |
| 2. Source is any of (about 20%), sort by created at | 82.1 | 13.1 | 21.4 | 103.1 | 10,000+ in 511 ms |
| 3. Name contains, probability between, deal type is; sort by close date, then name | 753.8 | 34.2 | 40.4 | 178.9 | 10,000+ in 1,530 ms |
| 4. Through the company: its category is Industry 3 (5%), sort by name | 139.4 | 31.7 | 34.5 | 101.1 | 10,000+ in 278 ms |
| 5. Next step is empty, sort by stage | 21.2 | 10.7 | 13.2 | 61.8 | 10,000+ in 39 ms |
| 6. List of 200,000 entries: entry stage is Qualified, sort by entry due date | 85.0 | 10.1 | 11.0 | 131.8 | 10,000+ in 66 ms |
| 7. Sort by name, the page after a cursor at row 100,000 | 11.7 | 4.7 | 5.0 | 31.4 | none |
| 8. Sort by name, the page after a cursor at row 500,000 | 3.3 | 2.6 | 2.9 | 46.2 | none |
| 9. Sort by probability, the page after a cursor at row 500,000 | 3.9 | 2.7 | 2.8 | 48.6 | none |
| 10. Sort by stage, then by name | 66.2 | 47.0 | 53.5 | 130.0 | none |
| 13. Probability between 41 and 42, sort by name | 117.5 | 30.5 | 43.9 | 139.8 | 10,000+ in 42 ms |
| 14. Sort by value (currency) | 4.5 | 3.5 | 5.1 | 81.6 | none |
| 15. The pipeline list sorted by the deal close date (a record attribute) | 28.3 | 4.2 | 5.3 | 86.3 | none |
| 16. Sort by next step, the page that runs from the last values into the empties | 3.0 | 2.5 | 3.0 | 27.6 | none |
| B1. Best effort: sort by associated company (a linked name) | 8,249.0 | 7,569.2 | 7,669.2 | 7,800.0 | none |
| B2. Best effort: sort by owner (a member) | 2,431.8 | 993.5 | 1,034.8 | 1,044.0 | none |

After the performance review, a group of equal first keys with a later sort is read two ways: a group of up to 20,000 rows straight from its key index, sorted; a bigger one driven by the second sort's keys, then its rows with no second value from the first key's index in id order. A select or status with a later sort reads each option as one group, and its jump counts options one at a time. Rerun of the rows this touches (`BENCH_ONLY=1b,5,10,14,15,R1`), p95: 1b 44.7, 5 12.6, 10 (stage then name) 10.0 (was 53.5), 14 4.0, 15 5.0, and R1 (stage then next step, half the deals with none, the review's 2.2 to 3.7 s case) 9.0.

Every held query is under 300 ms at p95 locally (grid 11 and 12, the rare contains, come with milestone 7).

Still open, for /architect (measured by the performance review, outside the grid):
- A select or status first sort, a second sort and a filter matching 0.5 to 4% of rows: the group reads can't fill a page, so the page filters first, 0.4 to 1.7 s. It needs a design call (a smaller fallback scope, a covering key lookup, or a stated bound).
- Capped counts with a rare filter that has no index (a rare OR, or "name contains") still read every row: 1.5 to 2.5 s locally, under the 10 s timeout but with little headroom on a small Neon compute. The AC-26 run should time one.
- The key view finds one owner's value through the history index, so a save's key sync slows with a very long edit history (an attribute an automation rewrites every minute). Not measured yet; the seed has at most one past version per owner.
- A list sorted by its records' values refuses a jump (`FILTER_INVALID`) and pages by cursor, as AC-21 says. The best effort pair stays outside the budget, as spec 0004 says. The capped count makes every count but query 3's (name contains, no index yet) finish well inside the timeout. Location keys are stored, but a location sort (country, then locality) still sorts without driving, so its jumps stay best effort: the locality can be empty inside a country, and one index can't put empties last in both directions.

### What the first run showed, and what changed

The first run missed on queries 3 (11.7 s), 4 (788 ms), 5 (342 ms) and 6 (322 ms). The cause is row level security. With a policy on every table, Postgres won't use an operator that isn't marked leakproof as an index condition, or trust its selectivity. Numeric comparisons, `like`, `lower` and `left` aren't leakproof (text comparisons are). Only a superuser can change that, and Neon gives no superuser. So the planner guessed 1 row where 400,000 matched, filtered first and sorted everything. The engine now plans those pages itself when the first sort is an indexed value of the row:

- **Index first.** It reads the next rows in sort order straight from the value index, in rounds of about 2 pages, 16 pages, then 5,000 rows. It checks each row's filters one at a time (an `OFFSET 0` fence keeps each EXISTS a per row check), and stops at the limit.
- **Options one at a time.** A select or status sort walks its options in order, one index range each.
- **Filter first when that fails.** A page that 5,000 rows can't fill (a very selective filter) falls back to filtering first and sorting.
- **Ties in the sort's direction.** The id tiebreak follows the first sort's direction, so one backward index scan serves a descending sort.

### Open (back to /architect, as the Build plan says)

- **Position jumps and deep text cursors miss (1b).** The text sort key is an expression (`lower(left(text_value, 256))` in the ICU collation). Text comparison itself is leakproof, but `lower` and `left` inside the expression are not, so an index can't return the key without reading the table, and a cursor bound on it is a filter, not a seek (a name sort's cursor at row 500,000 takes 2.05 s; numeric cursors stay index only, 68 ms). Skipping 600,000 rows reads 600,000 heap rows: 2.4 s even without the join to records, 9.2 s with it. Meeting 300 ms needs a stored key column (a generated `sort_key`), or the flat sort projection the Follow-up names. The split table is 5 times faster here (1.7 s), but still misses.
- **Exact counts.** With the same planner blindness, query 3's count takes 9.7 s, just under `countMatches`' 10 s timeout. A stored key and numeric column with leakproof operators (`float8`, `text`) would let counts use indexes too.
- **Split table variant: no clear win.** It matches within noise on the grid, and wins only on the position jump, which misses either way. Keep one table.
- **More misses the performance review measured** (same seed, app role, page statements alone):
  - *Sorts with no index to drive them:* by linked company name 8.1 s, by currency 1.2 s, by owner (an actor) 1.1 s, a list view sorted by a record attribute 0.6 s. Each computes a key for every row, then sorts a million.
  - *Very selective filters:* "name contains" a rare string, sorted by name 3.9 s or by close date 4.2 s; a narrow probability range 0.6 s. Under about 1% of rows, the 5,000 row rounds can't fill the page, and the fallback runs the plan row level security makes slow. `contains` needs the trigram index, which only a workspace scoped search function can use under row level security.
  - *A big first group with a second sort:* stage then name 2.2 to 2.5 s. Every row in one option shares the first key, so a capped round can never settle the order inside it.
  - *The empties branch:* its NOT EXISTS plans as an anti join over every record, 1.7 s on the last page with values; 1.4 s for a cursor among the empties with a second sort.
  - *Counts:* "contains" 4.3 s, query 3 9.7 s. On Neon these will reach the 10 s cancel; a capped count ("10,000+") or an estimate would not.
  - *Round trips:* a page runs 10 to 25 statements, readRecords about 5 of them, which is why the whole call is 94 to 148 ms against 23 to 74 ms for the page.
  - The stored, indexed sort key column (and a stored number for numeric sorts) answers the jump, deep cursors and most of the first two. The rest want the flat sort projection or a capped count. That choice is /architect's.
- **Neon.** This run is local. The Neon account connected here only holds other projects, each capped at a 1 GB branch, so the million record seed (6 GB with indexes) can't run on the Free plan. AC-15's Neon run needs a paid branch, per the Follow-up.
