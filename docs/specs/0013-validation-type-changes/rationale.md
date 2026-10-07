# 0013. Validation and type changes: decision record

## Context

Spec 0004 gave every attribute a type, a Required flag and a Unique flag, and refuses a value its type's schema can't parse. That is all the shape checking there is: nothing says a code has eight digits, a probability sits between 0 and 100, an email belongs to the company's own domain, or a close date is needed once a deal is won. Spec 0012 lets admins create attributes freely, so attributes will be created with the wrong type, and today the only way out is to archive the attribute and start again, losing every value's history with it.

Forces on validation: it must hold for every way data gets in (cells, paste, the create dialog, bulk edits, imports, the API, jobs), so it belongs on the server; the person typing should hear about it before a round trip, so the same logic must run in the browser; a new rule must never break existing records or block edits that don't touch it; regular expressions written by customers must never be able to stall a write (catastrophic backtracking is a classic denial of service); and a rule check runs on every write, so it must cost nothing where no rules exist.

Forces on type changes: the scope's "Done when" asks for a million records converted in the background with a preview and nothing lost. Values are typed rows with history in place (spec 0004): a million current rows, each also in per kind indexes and a stored sort key. People keep editing while it runs; screens must never show a half state; the switch must be short enough not to hold up writes; every old value must stay readable; and Neon stays on the free plan, so nothing may poll the database while idle. Spec 0004's follow up already asks #14 to convert existing rows "in a background job", and spec 0014 asks for cardinality widening.

## Options considered

### Option 1: rules as definition rows checked by one pure function; type changes in place behind a short switch (chosen)

Rules are rows with typed settings and an optional same record condition; one pure checker in contracts runs in the browser and under the record lock in `runWrite`. A type change fills the new type's columns on the same current value rows before the switch, switches the definition in one transaction, and rewrites as versions only the values whose two forms can't share a row, converting those on read until then.

**Pros**: no copy of a million rows; no read path changes before the switch; the switch edits one definition; history stays where it is, readable through a small ledger; the browser and the server can't disagree on a rule.
**Cons**: the most moving parts (a ledger, three jobs, dual writes during prepare, conversion on read while finishing); filters can lag reads for minutes while a rewrite heavy change finishes; converted rows keep their old columns too.

### Option 2: rules compiled to SQL checks; type change as a full rewrite into new versions

Rules become SQL predicates (and table constraints where possible); a type change writes a new version of every value in the new type, then switches.

**Pros**: one mechanism for every row; history shows the change as a version on every record.
**Cons**: RE2 patterns and most rule kinds can't run in Postgres under row level security (and Postgres regular expressions are not RE2); the browser can't run SQL, so the first check would need a round trip; a million version writes (end plus insert plus keys) take longer than the 10 minute budget allows on the capped stack, and every record's history fills with noise; the switch still needs every row in the new form before it, so either reads see a mix or writes stop.

### Option 3: a shadow attribute

The conversion writes the new values under a hidden second attribute and swaps them at the switch.

**Pros**: the old attribute's rows never change at all; cancel is trivial.
**Cons**: every value read, write, filter, sort key and history query would have to learn a "storage id" distinct from the attribute id; a select value's option must belong to its own attribute (spec 0004's composite foreign key), so options can't be shared across the swap; doubles the storage during the change.

### Option 4: refuse type changes; archive and create

**Pros**: nothing to build.
**Cons**: fails the scope's "Done when" outright, and loses each value's history and its place in views.

## Rationale

Option 1 is the only one that meets the scope's million record budget and "nothing is lost" together. Option 2 fails on time (a version per record) and on the browser check; Option 3 touches every query in the engine and breaks the option foreign key the data model relies on. The cost of Option 1 is complexity in one place (the conversion module and its jobs), which the phases keep testable on their own: prepare can be checked by reading rows, the switch is one transaction, and finishing is an ordinary write path run by the system.

Specific calls:
- **Rules as rows, checked under the record lock**: two concurrent writes can't each pass a rule they break together, because each checks the record's state after its own write while holding the lock. A rule cache on `attributes` (`rule_count`) keeps the cost at zero for objects without rules.
- **Only touched rules, never retroactive**: a new rule must not lock people out of records that already break it; counting them instead (the background count) gives the admin the picture without the blockage.
- **RE2 through `re2js`**: linear time removes the backtracking risk entirely, and one engine on both sides means a pattern can't pass in the browser and fail on the server.
- **Unique off on every change**: keeping it would need old and new keys live at once in one column, or a second key column across the whole values table; turning it back on afterwards runs the duplicate check that already exists.
- **Rewrites after the switch, converted on read until done**: the alternative, rewriting before the switch, would change what people see before the admin's change took effect, and cancelling would leave those changes behind.
- **Narrowing only as undo**: narrowing chooses which links to drop; making that a general feature is data loss by design. As an undo it needs no choice, because it runs only when nothing would be dropped.
- **No timers**: every job starts in the transaction of the write that asks for it, an expired preview is noticed when read, and old misses go with the daily cleanup that already wakes the worker once a day.

## References

**Project sources**:
- Spec 0004 (`docs/specs/0004-data-model/index.md`): typed value rows, the write protocol, cleared markers, unique keys, the follow ups for #14; its child `0004-stored-sort-keys.md`: `sort_keys`, `sort_key_sources`, keys computed only in SQL.
- Spec 0005: `runWrite`, the outbox hook, the counter row taken last, cell refusals and toasts (AC-35, AC-36).
- Spec 0007: coarse events past `CHANGE_CAP`, `definitions` rows per object.
- Spec 0008: kinds, cursor jobs, `startJob` in the write's transaction, the daily cleanup, worker sleep.
- Spec 0009: `schema.manage`, hidden means absent, `enterAsActor`, `systemScope`.
- Spec 0012: AttributeSettings, OptionsEditor, `attributes.update`, `nextHue`, the type note this spec replaces.
- Spec 0014: relationships, `syncReferenceKeys`, the request for cardinality changes.
- Spec 0011: the `steady` scenario and the budget constant.
- The owner decisions of 3 October 2026 (admins only schema changes, Neon free plan, local scale proofs) and the #14 brief.

**Practices and standards**:
- RE2's linear time matching as the defence against regular expression denial of service.
- Expand, then switch, then contract, for changing a stored shape under live traffic.
- Validate on the server as the authority, and in the client for feedback.

### Evidence (read from the code on 8 October 2026)

- `packages/core/src/engine/values.ts`: `writeAttribute` follows the write protocol, `parseFor` refuses by type and Required, `holdDefinitions` takes a key share lock on unique attributes' rows and restarts the write when their flags change, `syncSortKey` runs after every value write.
- `packages/core/src/engine/records.ts`: `parseAll` collects every refusal before writing; `updateRecord` and `insertRecord` lock the owner, parse, then `writeAll`; `setValuesBatch` runs each record under its own savepoint; `restoreRecord` lives in `deletion.ts`.
- `packages/core/src/engine/columns.ts`: `encodeValue`, `decodeValue`, `sameItems`; which columns each type uses.
- `packages/core/src/engine/write.ts`: `runWrite`, `Change`, `capChange` and `CHANGE_CAP` (1,000), hooks run after the counter row.
- `packages/db/migrations/0011_engine_sort_key_kinds_sources.sql`: `sort_key_sources` decides each key from `attributes.type` in one `case` per column, the shape `sort_key_parts` takes over.
- `packages/contracts/src/values/attribute-values.ts`, `attribute-config.ts`, `filters.ts`, `engine.ts`, `options.ts`: the value schemas, `MULTIPLE_VALUE_TYPES`, `AttributeDefault`, `FilterGroup` limits, the refusal codes, `ValueVersion`.
- `packages/ui/src/fields/*/type.ts`, `values.ts`, `Date/parse-date.ts`, `lib/decimal.ts`: every type's `toText` and `fromText`, `splitList`, the locale aware date and number parsing, the injected `PhoneParser` (`libphonenumber-js` 1.13.14 in the catalog).
- `packages/core/src/engine/query/evaluate.ts`: the reference evaluator the condition checker must agree with.
- `packages/core/scripts/seed-scale.ts`: one million deals, the seed AC-274 builds on.
