# 0015. Computed attributes: decision record

## Context

The scope asks for attributes that work themselves out: formulas on a record, rollups across relations and lookups, each updating live, each filterable and sortable like any other attribute, with recomputation across a million records inside the scale budget. Spec 0004 left this open on purpose ("formula, rollup and lookup types need their own storage decision; nothing here stores derived values"), and spec 0014 moved "show a related record's attribute as a column" here.

The forces. Filtering and sorting at a million records only meets the budget through stored, indexed keys (spec 0004's stored sort keys); anything worked out at read time can't use them. A computed value can depend on other records: one company's industry feeds 150,000 people in the load seed's hub, and one company's deal total depends on every deal linked to it, changed from either side of the link. People keep editing while values change, and two writes can race. Access rules (spec 0009) must not leak through a value that summarises records a viewer can't see. Neon stays on the free plan, so nothing may poll or recompute on a timer while idle. Schema changes are admins only. And the background job runner (spec 0008) exists to take exactly this kind of slow, fair, resumable work.

## Options considered

### Option 1: stored values, formulas in the write, lookups and rollups by coalesced jobs (chosen)

Computed values are ordinary value rows written by the system, with stored sort keys. Formulas, which read only their own record, are worked out in the write's transaction; lookups and rollups are queued, in the write's transaction, through a dependency index, and recomputed set based by background jobs.

**Pros**: every read, filter, sort, count, search and event path works unchanged, at the budget; formulas are exact when the save returns; heavy fan out never slows the write; nothing runs on a timer.
**Cons**: lookups and rollups lag by seconds (minutes for hubs); one extra indexed read on every write; history grows with recomputed versions.

### Option 2: work everything out at read time

Store only definitions; compute values in SQL (lateral joins and aggregates) or in the API on every read.

**Pros**: never stale; no jobs, no dependency index, no storage.
**Cons**: filters and sorts on a computed attribute can't use an index, so a million record view misses its 300 ms budget by orders of magnitude (spec 0004's measured misses were the same shape); every page pays the joins; formulas would need an SQL compiler of their own.

### Option 3: everything in the write's transaction

Stored values, but every dependent (lookups and rollups too) recomputed inside the write that changed an input.

**Pros**: never stale; no jobs.
**Cons**: a hub company's rename would rewrite 150,000 people inside one person's edit, holding locks far past the 250 ms edit budget; writes from either side of a link would contend on the far records' rows; a chain three deep multiplies it.

### Option 4: database triggers and materialised views

Postgres triggers maintain rollups; materialised views hold lookups.

**Pros**: close to the data; no application planner.
**Cons**: triggers run as the writer under forced row level security and would need definer functions to see far rows (more holes like `crm_search_text`); materialised views refresh whole, not per record, and can't be indexed per workspace usefully; the logic would live in SQL, outside the pure, tested engine, and access rules can't be applied there.

## Rationale

Option 1 is the only option that meets both the read budget (stored keys) and the edit budget (fan out outside the write). Option 2 fails the read budget; Option 3 fails the edit budget at the hub; Option 4 fights row level security and the house rule that the engine is the one write path. The lag Option 1 brings is bounded and visible (the header's progress while filling, and seconds for ordinary changes), and convergence is guaranteed by queuing every dependent in the same transaction as the change, with jobs that read inputs after locking what they write.

Specific calls:
- **Formulas in the write**: they read only their own record, which the write already holds locked, so working them out costs one read of their other inputs and keeps them exact in the save's own response.
- **A dependency index rebuilt with each definition**: finding dependents is one indexed read per write, with no parsing of definitions on the hot path.
- **Inline items up to 1,000, a fill job beyond**: a light job keeps ordinary changes within seconds; a heavy, sliced job keeps hubs fair to other workspaces (spec 0008's lanes).
- **Coalescing with a one second delay**: a burst of edits on one company's deals becomes one recompute, not dozens.
- **Mirrored options**: the alternative (a select lookup storing text) would lose hues, order and archived state, and would sort by text rather than by the pipeline's order.
- **Lookups through many limited to multi capable types**: the value rows can't hold several numbers or dates, and pretending with the first value would mislead.
- **No NOW or TODAY**: a value that changes with the clock needs a scheduled recompute, which keeps the database awake (the Neon decision); dates relative to today stay a filter feature, worked out at read time against the viewer's clock.
- **Broken keeps values**: an archive is often temporary; emptying a column people filter by would be a bigger surprise than a marked, frozen one.

## References

**Project sources**:
- Spec 0004: value rows, the write protocol, stored sort keys, the follow up that leaves derived values to #16.
- Spec 0005: `runWrite`, hooks, the outbox, the counter row taken last.
- Spec 0007: coarse events past `CHANGE_CAP`, coalesced refetches.
- Spec 0008: kinds, item and cursor jobs, coalescing with `dedupeKey` and a start delay, the light and heavy lanes, the job row lock a merge takes, worker sleep and the nudge.
- Spec 0009: `fieldLevel` treating a computed attribute as hidden when an input is; rollups count all records; `systemScope`.
- Spec 0012: AttributeSettings, the type picker, the 250 attribute limit.
- Spec 0013: the converters in contracts, the type change switch, `columnNote`, the rule bypass list, the same object condition.
- Spec 0014: relationship sides, link writes recording both sides, side order, the hub, the lock rule for keys derived from another record.
- Spec 0011: the `crm` profile's Hub Company and the `steady` mix.
- The owner decisions of 3 October 2026 and the #16 brief.

**Practices and standards**:
- Store what you filter and sort by; work out the rest at write time when it is cheap, and asynchronously when it fans out.
- Transactional outbox and job enqueue: queue follow up work in the same transaction as the change that needs it.
- Exact decimal arithmetic for money.
- Interpret user expressions with a closed grammar and a fixed evaluator, never as code.

### Evidence (read from the code on 8 October 2026)

- `packages/contracts/src/values/attribute-values.ts`: "Formula, rollup, lookup and AI attributes produce one of these" types; `MULTIPLE_VALUE_TYPES` lists which can hold several values.
- `packages/core/src/engine/write.ts`: `runWrite` collects a `Change` with values, created, deleted and restored records and far `references`, then runs hooks after the counter row; `capChange` and `CHANGE_CAP`.
- `packages/core/src/engine/records.ts`: `writeAll` records far records' reference changes for link writes without touching their rows; `insertRecord`, `updateRecord`, `readRecords`.
- `packages/core/src/engine/values.ts`: `writeAttribute`, `parseFor` refusing system and archived attributes, `syncSortKey`, `touchOwner`.
- `packages/core/src/engine/options.ts`: `insertOption`, `updateOption`, `renumber`, where mirrors hook in.
- `packages/db/src/schema/records.ts` and migration `0004_engine_options.sql`: the composite foreign key from a value's option to its own attribute's options.
- `packages/core/scripts/seed-scale.ts`: a million deals over 20,000 companies, 90% linked, the base for AC-332.
