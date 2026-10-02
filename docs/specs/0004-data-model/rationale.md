# 0004 · Rationale: the data model

## Context

The CRM is meant to be as flexible as Attio: People, Companies and Deals come standard, but a workspace can add objects and attributes of its own, and every feature (views, boards, record pages, imports, the API, search, automations) has to work on all of them alike. The engine underneath is the most expensive thing in the product to redo, because every later feature stores into it and queries out of it.

The forces that shaped it:
- **Shape changes at runtime.** Admins add, rename, archive and retype attributes and options all day. That has to be cheap and safe, with no downtime and no rewrite of records.
- **History is a product feature, not a log.** The scope asks for the value of any field as of any date, and the time a record spent in each status stage.
- **Scale.** The budget is a million records per workspace, 100 people online with room for 1,000, and any attribute filterable and sortable, including through a relationship. Spec 0001 names the dynamic attribute query engine as the main technical risk.
- **Tenancy is enforced by the database** (spec 0001): forced row level security, one query path through `withWorkspace()`, and policies that fail closed.
- **The value shapes are already fixed** in `@crm/contracts/values` (spec 0003), including the `ValueVersion` history envelope the editors and timeline read.
- **Privacy.** Values are personal data, so erasure has to be possible without breaking the model.

The workspace for this decision is repo wide: tables in `packages/db`, services in `packages/core`, shapes in `packages/contracts`.

## Options considered

### Option 1: Typed value rows, history in place (chosen)

One `values` table with a row per value item and a few typed columns, plus `active_from` and `active_until`. Partial indexes per kind on current rows serve filters and sorts. Relationships live in one links table.

**Pros**: one path for every object; schema changes are rows; history and as of reads come for free; it matches Attio's model and the contracts' `ValueVersion`.
**Cons**: reading a record gathers many rows; every sort is a join; many indexes slow writes; the query compiler is ours to build and keep correct.

### Option 2: JSONB of current values on each record

Each record carries a jsonb document of its current values, with GIN and expression indexes, and a separate history table.

**Pros**: one row per record, cheap to read whole; simple writes.
**Cons**: sorting or range filtering on an arbitrary attribute needs an expression index per attribute, created at runtime; history needs a second table and a union for as of; jsonb statistics are weak, so the planner guesses badly at a million rows.

### Option 3: A real table per object

Creating an object or attribute runs DDL, so each object gets native columns (Twenty's approach).

**Pros**: native types, native indexes and the fastest single object queries.
**Cons**: runtime DDL per workspace (locks, migrations, failure halfway); row level security, history and triggers repeated per table; a million workspaces' worth of tables; type changes become table rewrites.

### Option 4: Value rows plus a JSONB snapshot

Option 1 as the source of truth, plus a jsonb copy of current values on each record, kept in the same transaction for fast page reads.

**Pros**: page reads are one row per record.
**Cons**: two copies to keep in step on every write; the snapshot is a stored derived value, which the house rules avoid until a measured need.

## Rationale

The deciding forces are runtime shape changes and the history requirement. Option 3 turns every attribute change into a migration, and repeats row level security and history per table, which fights both. Option 2 handles shape changes but can't sort or range filter on any attribute without indexes created at runtime, and still needs a second store for history. Option 1 makes a schema change a row insert, keeps history in place with one range filter for as of, and gives every object the same indexes, so the query engine's cost is predictable. That predictability is what the million record budget needs.

Option 4 is Option 1 with a cache. It stays the planned fallback if the AC-15 measurement shows page reads, not filtering, are the bottleneck. Adding it later is additive, while removing a snapshot that went stale is not.

The smaller calls follow the same forces:
- **Links in their own table.** A link stored once can't drift, and cardinality has one place to be checked.
- **Composite foreign keys.** They add a second fence behind row level security, so a cross workspace bug is refused instead of stored.
- **The unique key column with a partial unique index.** Only the database can refuse two concurrent duplicates.
- **A version id shared by a write's item rows.** `ValueVersion` describes a whole value, so a multi valued change is one version, and concurrency notices compare versions, not records.
- **Services without endpoints.** No endpoint exists before #9's access door does.
- **Hooks for the outbox and audit.** #7 and #36 keep their own designs, but the transaction they need is fixed now.

The engineer picked the recommended option on every question, including the 300 ms p95 budget, exact counts sent after the page, keyset paging with position jumps, refusing Unique while duplicates exist, required for new writes only, and replacing a link on a single side.

A fresh model cross check of the first draft found gaps the engineer then had applied:
- **Current versions:** a unique current version index, plus the row lock and timestamp rule for concurrent saves.
- **Entries:** an `owner_id` so entry values share the indexes.
- **The compile rules** for every operator, empty values and multi valued attributes, with a matrix of operators by type.
- **Sorts:** option position walks the options in order, empties sort last, the collation is pinned, and cursors handle empty keys.
- **Links:** item order, a version id, and single side flags backed by partial unique indexes.
- **Deletes** hide links and entries by a join instead of ending them.
- **Unique keys** for each type.
- **Index fixes:** a length bound on text indexes, and the trigram index leading with workspace.
- **Composite primary keys**, so a client chosen id reveals nothing.

It also questioned history in the same table. Every edit moves a row out of the current indexes, which bloats them and slows position jumps. The choice stands, with vacuum tuned for it, but milestone 4 benchmarks the split table variant (current values and versions apart) on the same grid, and a clear win sends the choice back here.
