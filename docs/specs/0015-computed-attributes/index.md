# 0015. Computed attributes: lookups, rollups and formulas

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Some attributes should work themselves out: the industry of a person's company (a lookup), the total value of a company's deals (a rollup), or a deal's weighted value from its amount and probability (a formula). An owner or admin creates one in the same attribute dialog as any other, and from then on it updates by itself: a formula in the same save that changed its inputs, and lookups and rollups a few seconds later, in the background, when anything they read changes, even through a relationship. Computed values are stored as ordinary values, so they show, filter and sort exactly like any attribute, at a million records. It is built in four visible steps: lookups, rollups, formulas, then the scale proof.

## Structure

- [0015-formulas.md](0015-formulas.md): the formula language (its types, operators, functions and how empty values and errors behave), how a formula is checked and stored, and the FormulaEditor.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As an admin, I want to show a related record's attribute on a table (each person's company industry), so people see it without opening the company.
- As an admin, I want totals, counts, averages and dates rolled up from related records (total deal value per company, last deal closed), so I can sort and filter companies by them.
- As an admin, I want formulas over a record's own attributes (weighted value, days to close), so the team stops calculating by hand.
- As a member, I want computed values to stay right as people edit, link and delete records, without reloading.
- As a member, I want to filter and sort by a computed attribute exactly like any other.
- As the owner of this product, I want recomputing across a million records to stay inside the scale budget, and nothing to run on a timer while nobody is using the app.

**Acceptance criteria** (this spec owns AC-312 to AC-341):

*Creating*
- **AC-312**: AttributeSettings' type picker (spec 0012) gains three entries after Member, for owners and admins: Lookup, Rollup and Formula. Each shows its settings and the result type (read only, through the field set's icon and label). Create waits for the server; the attribute appears as the last column of every open table of the object for every member within 1 second, and its values fill in the background while the header says "Working out values" with progress (carried on the attribute's definition, so every member sees it).
- **AC-313**: A lookup takes "Through" (a live, two way relationship side of this object) and "Attribute" (any live attribute of the related object except record references, files and its id; Created at and Created by are offered). Its result type is the attribute's. Through a side that holds one, it shows the related record's value as it is. Through a side that holds many, only types that can hold several values are offered (Select, Multi select, Status, Email, Phone, URL, Domain, Member; a Status becomes a Multi select), and it shows the distinct values of the linked records, in the side's order then each value's own order, at most 100.
- **AC-314**: A lookup of a Select or Status shows the related attribute's options (labels, hues, order, archived state, outcomes). Creating, renaming, recolouring, reordering, archiving or restoring one of those options changes the lookup's options in the same save, live for everyone, with no recompute.
- **AC-315**: A rollup takes "Through" (any live two way side), "Calculation" (Count, Count where, Sum, Average, Min, Max, Earliest, Latest) and, except for the counts, "Attribute" of the related object: Number, Currency or Rating for Sum, Average, Min and Max; Date or Created at for Earliest and Latest. Count where takes a condition built with the FilterBuilder on the related object's own attributes, with no relationship paths, no dates relative to today and no "is me" (422 `CONFIG_INVALID` "Count where can't use dates relative to today or "me" yet."). A Currency rollup takes one currency code, the attribute's default currency unless changed.
- **AC-316**: Rollup values: Count and Count where give the number of live linked records (0 when there are none); Sum gives the total of the values present (0 when none); Average gives their mean, rounded to 4 decimals half away from zero (empty when none); Min, Max, Earliest and Latest give empty when none. A Currency rollup uses only values in its code. Counts and sums give Number, except Currency calculations, which give Currency in the rollup's code; Earliest and Latest give Date, or Timestamp for Created at.
- **AC-317**: A formula is typed in the FormulaEditor in the language [0015-formulas.md](0015-formulas.md) defines. While typing, the editor shows the result type ("Gives a number") or the first error with its position ("Unknown attribute {{stage_x}} at character 12."), and the values it gives for up to 5 of the object's most recently updated records. Create with an invalid formula is refused 422 `CONFIG_INVALID` with the same message and its position.

*Staying right*
- **AC-318**: A formula updates in the same save as its inputs: a create or edit writes the formula's new value in the same transaction, the writer's screen shows it with the save's response, and every other open browser within 1 second at p95. A formula whose evaluation fails (division by zero, mixed currencies, a result out of range) stores empty.
- **AC-319**: A lookup or rollup updates in the background after any change it reads: a related record's value edited, a link added, removed or moved from either side, a related record created with links, deleted or restored, and the record itself created or restored. Measured warm (the worker awake) on the local stack, the new value is in a second browser's store within 5 seconds of the change's commit at p95 over 100 changes.
- **AC-320**: When more than 1,000 records depend on one change (the Hub Company's 150,000 people looking up its industry), the change still commits in the edit budget, and the dependents update by a background job; on the local capped seed all 150,000 are updated within 3 minutes, each showing its old value until rewritten.
- **AC-321**: After writers stop, every computed value equals its definition over the current data. A randomized test with concurrent value edits, link changes from both sides, moves, deletes, restores and renames ends with every lookup, rollup and formula equal to a fresh computation.
- **AC-322**: Changing a computed attribute's settings, with the same result type, recomputes every record in the background ("Working out values" with progress), old values showing until replaced. A change of result type is refused 422 `CONFIG_INVALID` "Create a new attribute for a different result type."

*Like any attribute*
- **AC-323**: Computed attributes are read only everywhere: cells show the field set's read only state with the reason "Worked out by a lookup", "…by a rollup" or "…by a formula"; they are left out of the create dialog's fields and of anything that writes values; a write naming one is refused 422 `ATTRIBUTE_READ_ONLY` "<Title> is worked out from other attributes." Required, Unique, a default and validation rules are not offered, and setting them through the API is refused `CONFIG_INVALID`.
- **AC-324**: A computed attribute shows in tables and the record panel through the one field design of its result type, filters with that type's operators, sorts by its stored key (with position jumps where the type allows them, spec 0004), and counts; the reference evaluator test treats it as a stored attribute of its result type and agrees with the compiler.
- **AC-325**: Computed values are stored as ordinary value versions set by the system. A computed write never moves a record's `updated_at` or `updated_by` and never runs validation rules (spec 0013 AC-259). A recompute job's `records` event carries no `mutationId`; a formula result written in a person's save rides that save (its response carries the result, and its event its `mutationId`, like any value of that write).
- **AC-326**: A computed attribute may read other computed attributes (a formula on a lookup, a lookup of a related rollup), at most 3 deep; a deeper chain is refused 422 `CONFIG_INVALID` "Computed attributes can build on each other at most 3 deep." A definition that would depend on itself, directly or through others, is refused "<Title> would depend on itself through <A>." Each hop of a chain updates within AC-319's time.
- **AC-327**: When an input is archived (an attribute, its object, the relationship side), or a type change (spec 0013) makes the definition invalid, the computed attribute stops updating, keeps its values, and shows "Not updating: <reason>" in its settings and as its cells' read only reason. Restoring the input, or a type change that makes it valid again, recomputes every record and clears the state. Spec 0013's preview lists the computed attributes a type change would stop.
- **AC-328**: Deleting a record hides its computed values with it; they are not recomputed while it is in the trash, and are recomputed when it is restored. Purging a related record changes nothing further, since its links were already hidden at its delete.

*Access, limits and quality*
- **AC-329**: Strictest of inputs (spec 0009): a computed attribute is hidden from anyone who can't see one of its inputs (an attribute it reads, a relationship side it follows, or their objects), and is then absent from tables, records, filters, sorts, history and events for them. A rollup counts and sums every linked record, including ones the viewer can't open; its value never names them.
- **AC-330**: Creating, changing and archiving computed attributes, and `computed.preview`, need `schema.manage`; a member gets 403 `FORBIDDEN` and nothing is written.
- **AC-331**: Limits through the one limits module: at most 50 computed attributes per object (the 51st is refused 409 `LIMIT_REACHED` "An object holds at most 50 computed attributes."), each also counting toward the 250 attributes per object; a formula of at most 2,000 characters, 200 parts and 20 attribute references (the formula child spec words each refusal).
- **AC-332**: On the local capped seed (owner decision: scale proofs run locally), working out a lookup on the 1,000,000 deals of `pnpm db:seed:scale` finishes within 15 minutes, and a Sum rollup over its 20,000 companies within 2 minutes, while the `steady` mix of 100 members (spec 0011) stays inside its budget; an edit to a deal with a 20 reference formula adds at most 10 ms at p95 to the edit. Results in `verify.md`.
- **AC-333**: Nothing here runs on a timer while the app is idle: every recompute starts in the transaction of the write that caused it, the worker is woken by the API's nudge (spec 0008), and formulas have no NOW or TODAY, so no value changes just because time passed.
- **AC-334**: Recompute jobs show on Settings, Background jobs as system jobs, "Working out values" and "Updating computed values", for owners and admins, with progress and the failure message. A fill job that ends `failed` sets, through its failure hook (spec 0008 AC-124), "Not updating: Working out values failed." with "Try again" for owners and admins; a recompute job that ends `failed` hands its records to a whole fill, so none is forgotten.
- **AC-335**: The formula language lives in `packages/contracts` as pure functions, the same in the browser editor and on the server; a table driven test covers every operator and function on typed values, empty inputs and every error.
- **AC-336**: Lookups and rollups work through any relationship side, both sides of a relationship from an object to itself (Manager, Reports) included, and through one way references never (they have no side on the far object, and the UI can't make them).
- **AC-337**: Every computed write keeps history like any value: a computed attribute's history lists its versions set by "System". The activity feed (#17) leaves computed versions out, as its brief says.
- **AC-338**: The change event for a recompute names the records whose computed values changed, coarse past `CHANGE_CAP` (spec 0007), and screens refetch only those; a recompute that changes nothing stores no event.
- **AC-339**: Archiving a computed attribute works as for any attribute (spec 0012) and stops its jobs; computed attributes that read it go to "Not updating" (AC-327).
- **AC-340**: Every new screen part is built from tokens and library components only (FormulaEditor pulled forward from spec 0003's milestone 4), works fully by keyboard (the editor's suggestions included) with a visible focus ring, meets contrast in light and dark, and loads lazily so the first load stays under 250 kB.
- **AC-341**: Each milestone runs in production on `brij-crm-phi.vercel.app`, proven with two browsers: a computed attribute created in one appears and fills in the other, and an input changed in one updates the computed value in the other.

## Decision

**Chosen option**: Option 1: computed values stored as ordinary values, formulas evaluated in the write's transaction, lookups and rollups recomputed by coalesced background jobs found through a dependency index.

A computed attribute is an ordinary attribute row whose `computed` definition says how to work it out; its values are value rows written by the system, with stored sort keys, so every read, filter, sort and count path stays as it is. Formulas only read their own record, so they are worked out in the same transaction as the write; lookups and rollups read other records, so a planner inside `runWrite` finds the records that depend on what changed (through `computed_inputs`) and queues them for a job that recomputes them set based, 500 at a time.

Decisions taken from the brief and the owner decisions (the owner accepted the recommended defaults for #11 to #22 on 3 October 2026; see Owner decisions):
- **Order**: lookups, then rollups, then formulas, then the scale proof (brief).
- **Rollups**: the eight calculations, one hop, one currency code (brief).
- **Lookups**: the related attribute's type; through many, distinct values capped at 100 (brief), and only types that can hold several values (made exact here).
- **Formulas**: a small typed language in contracts, with no NOW or TODAY in v1 (brief), so nothing changes with the clock and nothing needs a timer (the Neon decision).
- **Formulas in the transaction, lookups and rollups by job, coalesced, target 5 seconds** (brief).
- **Stored as ordinary values by the system, no `updated_at` move** (brief).
- **Recompute set based in batches of 500** (brief).
- **Dependency index, cycles refused, depth 3** (brief).
- **Errors store empty** (brief); broken definitions keep their values and stop (owner decision, see Owner decisions).
- **Access: strictest of inputs; rollups count all records** (brief, spec 0009).
- **Mirrored options for Select and Status lookups** (recommendation): a value's option must belong to its own attribute (spec 0004's foreign key), so a lookup keeps a mirror of the related attribute's options, written in the same save as the original.
- **Schema changes are admins only** (owner decision).
- **Fill progress travels on the definition** (cross check of 8 October 2026): `computed.done` and `total` on `AttributeDefinition`, so every member sees the header's progress; `data.jobs` stays for holders of `jobs.manage`.
- **Spec 0008's additions are used here**: the planner starts the system kinds `computed.recompute` and `computed.fill` inside a member's write transaction (AC-125), and a failed fill marks the attribute broken through its `onFailed` hook (AC-124).

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`) · `db-core` and `react-db` (`tanstack/db`, `.claude/skills/db-core/`, `.claude/skills/react-db/`) · `react-aria` (`.claude/skills/react-aria/`) · `stories` (`.claude/skills/stories/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #8 background jobs (spec 0008) | the runner, `startJob` with items, coalescing (`dedupeKey`, start delay), both lanes, the nudge, the Background jobs page, system kinds started from a member's write transaction (AC-125), the `onFailed` hook (AC-124) | none: a hard dependency from milestone 1 |
| #15 relations (spec 0014) | relationship sides on `attributes.list` (`relationship` block), link writes that record both sides' changes, `RelationshipSettings`, the record panel | none: milestone 1 starts after spec 0014's milestone 2 (links editable from the table) |
| #13 objects and attributes (spec 0012) | AttributeSettings and its type picker, `attributes.create` and `attributes.update`, archive and restore, the definitions store with options inline | none |
| #14 validation and type changes (spec 0013) | the rule check in `updateRecord` and `insertRecord` and its bypass list (milestone 1 there), `syncSortKeys` (milestone 3 there), the converters in contracts (`toText` for formulas' `TEXT`), the switch of a type change (this spec adds its call), `columnNote` on the DataGrid | milestone 1 here starts after spec 0013's milestone 1; if spec 0013's milestone 3 hasn't landed, milestone 1 here builds a thin `syncSortKeys(tx, attribute, ownerIds)` (the set form of `syncSortKey`, rewriting each owner's key row from the `sort_key_sources` view in one statement) and spec 0013 keeps it; milestone 3 (formulas) needs spec 0013's milestone 3; if spec 0013 hasn't built `columnNote`, milestone 1 adds it exactly as spec 0013 says |
| #9 access model (spec 0009) | `fieldLevel` treating a computed attribute as hidden when an input is, `systemScope` for the jobs | if spec 0009's milestone 2 hasn't landed, every member sees every computed attribute (as every field today), and the rule is added through spec 0009's choke points when it lands |
| #6 and #7 (specs 0006, 0007) | the definitions store, coarse event coalescing, `records` events | spec 0012's thin slices are enough |
| #12 load harness (spec 0011) | the `crm` profile's Hub Company for AC-320, the `steady` mix for AC-332 | if `packages/load` doesn't exist, AC-320 runs on `pnpm db:seed:scale` with a bench script that links 150,000 deals to one company, and AC-332's budget line runs `bench-scale.ts` during the recompute, saying so in `verify.md` |

### Data model sketch

One migration in milestone 1 (milestones 2 and 3 add enum values only).

| Table | Change | Rules |
|---|---|---|
| `attributes` | `computed` jsonb null (`ComputedDefinition`, below); `computed_state` enum `computed_state` (`filling`, `ok`, `broken`) null; `computed_error` text null; `computed_version` integer not null default 0; `computed_depth` smallint null (1 to 3); `dependent_count` smallint not null default 0 | `computed` set exactly when the attribute is computed (check); `type` and `is_multi` hold the result type; `computed_state` null exactly when `computed` is null; `dependent_count` = the computed attributes that list this attribute in `computed_inputs`, kept in the same transaction as their definitions |
| `computed_inputs` | new: `computed_attribute_id`, `input_attribute_id`, `role` enum `computed_input_role` (`same_record`, `far_value`, `link`, `far_condition`, `option_labels`), `via_attribute_id` uuid null (the side followed, for the far roles) | primary key (`workspace_id`, `computed_attribute_id`, `input_attribute_id`, `role`); index (`workspace_id`, `input_attribute_id`); FKs to `attributes`; rebuilt whole in the transaction that creates or changes a definition; forced row level security, both guard tests |
| `attribute_options` | `mirror_of` uuid null → `attribute_options` (composite with `workspace_id`) | set on a lookup's options, each the mirror of the related attribute's option; unique (`workspace_id`, `attribute_id`, `mirror_of`) where not null |
| `workspace_counters` | none | the computed per object count is `count(*)` of the object's computed attributes under the counters row lock the attribute create already takes |

**`ComputedDefinition`** (`packages/contracts/src/computed.ts`, Zod, strict):
- `{ kind: 'lookup', via: attributeId, target: attributeId }`
- `{ kind: 'rollup', via: attributeId, calc: 'count' | 'count_where' | 'sum' | 'average' | 'min' | 'max' | 'earliest' | 'latest', target?: attributeId, where?: RuleCondition (spec 0013's same object condition, here on the far object), currency?: CurrencyCode }`
- `{ kind: 'formula', source: string, ast: FormulaNode }` ([0015-formulas.md](0015-formulas.md))

**Inputs per kind** (what `computed_inputs` holds):
- lookup: (`via`, `link`), (`target`, `far_value`, via).
- rollup: (`via`, `link`); (`target`, `far_value`, via) unless a count; each attribute its `where` names (`far_condition`, via).
- formula: each referenced attribute (`same_record`), and each referenced Select or Status also (`option_labels`).

### How values are worked out

**Formulas, in the write** (`packages/core/src/computed/formulas.ts`, called from `updateRecord` and `insertRecord` in `records.ts`): after `parseAll` and before spec 0013's rule check, the write gathers the record's values after the write (the ones it sets, plus current values of every other attribute a formula of the object reads, read under the record lock in the same query spec 0013's conditions use), evaluates the object's formulas whose inputs it touched (all of them on a create; a formula reading Updated at counts as touched by every write that changes a value), in dependency order, with `evaluateFormula` from contracts, and writes each changed result with `writeComputed`. Rules then see the formula results too.

**`writeComputed(context, ownerId, attribute, value)`** and its set form `writeComputedBatch(context, attribute, Map<ownerId, value>)` (new, `packages/core/src/computed/write.ts`): the write protocol of spec 0004 with the system as `set_by`, skipping `parseFor`'s read only and archived checks (they are the system's own writes) but not the type's schema, writing nothing for an unchanged value, never calling `touchOwner`, and syncing sort keys (`syncSortKeys` from spec 0013 in the set form). The batch form locks its owners `for no key update` in id order in one statement, leaves out owners in the trash, and ends and inserts rows in one statement each.

**The planner** (`planComputed(context, change)`, new, `packages/core/src/computed/plan.ts`): `runWrite` calls it after the work and before the hooks, for every write, people's and jobs' alike. It reads `computed_inputs` for the attribute ids in the change in one indexed query (skipped when the change has no values, references, creates or restores), and for each computed attribute that is not `broken`, finds the records to recompute:
- `link` input: owners of the change's values and `references` on the `via` side;
- `far_value` and `far_condition` inputs: the far records whose input changed, mapped to near records through current `record_links` of the via relationship (live near records only), counted up to 1,001;
- a rollup's own object: created and restored records (a new record's count is 0, not empty);
- a lookup or rollup's own object: restored records;
- a change that is coarse for the via side's far object (spec 0007 AC-83 caps far references, listing that object in `Change.coarseObjects`): the near records can't be named, so the computed attribute gets a `computed.fill` over its whole object (`all`).
Then for each computed attribute: 1,000 or fewer records start (or join) a `computed.recompute` job with those ids as items; more start a `computed.fill` job scoped to the far records (`linkedTo`, up to 100 far ids) or, past that, to the whole object. Both are system kinds started in the write's transaction, whoever made the write (spec 0008 AC-102 and AC-125), so a member's edit queues them with no permission of its own and they never count toward the member's job limit.

**The jobs** (spec 0008 kinds, both system actor, not cancellable, batch 500 records):

| Kind | Lane | Shape | Coalescing | Label |
|---|---|---|---|---|
| `computed.recompute` | light | item job: record ids | `dedupeKey` = the computed attribute id, start delay 1,000 ms | "Updating computed values" |
| `computed.fill` | heavy | cursor job over the object's live records by id (`all`), or over the near records linked to `linkedTo` far ids (by link position) | `dedupeKey` = attribute id plus scope, start delay 1,000 ms | "Working out values" |

Each batch, in one engine transaction: reads the definition (a `broken` one ends the job `succeeded` with nothing done; a fill whose `computed_version` is older than the attribute's ends the same way); computes the 500 values in one SQL statement (below); writes the changed ones with `writeComputedBatch`; evaluates and writes the same record formulas that read this attribute for those records; and goes through `runWrite`, so the planner carries any chain further. A fill's batches record a `definitions` change for the attribute's object at most once a second (the runner's progress throttle), so every member's definitions store refreshes `computed.done` and `total`; its last batch sets `computed_state` to `ok` (when its version is current) and records a `definitions` change.

**Failure hooks** (spec 0008 AC-124): `computed.fill`'s `onFailed` sets the attribute `broken` with `computed_error` "Working out values failed." and records a `definitions` change; `computed.refill` is then the way back. `computed.recompute`'s `onFailed` starts a `computed.fill` (`all`) for the attribute, so the records it held are never forgotten (if that fill fails too, the attribute goes broken as above).

**Lookup statement**: for each owner, the current links on `via` to live far records, in side order (spec 0014's `position`), joined to the far records' current, not cleared value rows of `target` in item order; through a side that holds one, the first link's rows; through a side that holds many, the distinct items (by their encoded columns), first 100. Option ids map to the lookup's mirror options through `mirror_of`. Created at and Created by read the far `records` row.

**Rollup statement**: per owner, over the current links on `via` to live far records: `count(*)`; `count(*) filter (where <where compiled by the engine's filter compiler on the far level>)`; `sum`, `avg` (then `round(…, 4)`), `min`, `max` over `number_value` of `target`'s position 0 rows (for Currency, only rows whose `text_value` is the rollup's code); `min` and `max` over `date_value` (or the far records' `created_at`) for Earliest and Latest. A sum past `DECIMAL_LIMITS` stores empty.

**Mirrored options** (`packages/core/src/engine/options.ts`, changed): creating a lookup of a Select or Status inserts a mirror of each of the target's options (archived ones included, same label, hue, position, outcome, target time, `mirror_of` set). `insertOption`, `updateOption` and `renumber` on an attribute that has mirrors change the mirrors in the same transaction and record a `definitions` change for each mirror's object. Option procedures on a lookup are refused 422 `ATTRIBUTE_READ_ONLY` "Its options follow <target title>."

**Definition writes** (`packages/core/src/computed/define.ts`): parse `ComputedDefinition`; check `schema.manage`; resolve and check the inputs (live, the right object, a two way side, allowed types per AC-313 and AC-315); derive the result type; build the input graph from `computed_inputs` plus this definition, refuse a cycle (naming the first attribute on the loop) and a depth over 3; check the 50 limit; write the attribute (`computed_state` `filling`, `computed_version` + 1), its inputs, `dependent_count` on each input, the mirrors (a lookup whose target changed archives its old mirrors and mirrors the new target's options); start `computed.fill` (`all`); record a `definitions` change. A change of result type is refused (AC-322).

**Broken** (`checkComputed(tx, attributeIds)`, called by `archiveAttribute`, `restoreAttribute`, `setObjectArchived`, relationship side archive and restore, and spec 0013's switch): checks again every computed attribute whose inputs include the changed attributes; one that no longer checks gets `broken` and `computed_error` ("<Input> is archived.", "<Object> is archived.", "<Input> changed type to <type>, which this formula can't use."); one that checks again after being broken gets `filling` and a `computed.fill` (`all`). Each change records a `definitions` change. Spec 0013's check phase calls the same check in a dry run to list them in its preview.

### API surface

oRPC on `/api/rpc`, `member` door; writes take a `mutationId`, are composed with `writeHooks`, store one outbox row and nudge the worker. Refusals as `{ code, message, data?: { refusals } }`; a formula refusal's `ApiRefusal` gains `position?` (a character index).

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `attributes.create` (changed) | adds `computed?`: `ComputedDefinitionInput` (a formula sends `source` only; the server parses it); `type` is then ignored and derived | AttributeDefinition | `schema.manage` | 403; 404; 409 `LIMIT_REACHED`; 422 `CONFIG_INVALID` (with `position` for formulas) |
| `attributes.update` (changed) | `computed?` (same result type) | AttributeDefinition | `schema.manage` | as above; 409 `ATTRIBUTE_CONVERTING` (spec 0013) |
| `attributes.list` (changed) | as spec 0012 | AttributeDefinition adds `computed?`: `{ kind, definition, state, error?, resultType, fillJobId?, done?, total? }` (`done` and `total` are the running fill job's, read from its `jobs` row in the same query) and `readOnly: { reason }` for computed attributes | member | 404 |
| `computed.preview` | `workspace`, `objectId`, `definition` (`ComputedDefinitionInput`) | `{ resultType?: { type, isMulti }, error?: { message, position? }, samples: [{ record: RecordRefDisplay, value }] }` (up to 5) | `schema.manage` | 403; 404 |

**Data layer names** (`packages/data`): `data.computed.preview(objectId, definition)` holds the 400 ms debounce (a newer call cancels the older request through its `AbortController`) and returns `{ status: 'idle' | 'loading' | 'ready' | 'error', result?, retry }`; `data.computed.refill(attributeId)`. Definitions, progress and states ride the definitions store.
| `computed.refill` | `workspace`, `attributeId` | AttributeDefinition (`filling`) | `schema.manage` | 403; 404; 409 when not broken by a failed fill |
| `records.*` writes (changed) | as before | the response's RecordView includes the formula results of the same save | member | 422 `ATTRIBUTE_READ_ONLY` naming a computed attribute |
| `options.*` (changed, spec 0012) | as before | | `schema.manage` | 422 `ATTRIBUTE_READ_ONLY` on a lookup's mirrored options |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| create, update | who may | `can(scope.access, 'schema.manage')` (spec 0009) |
| create | the result type | lookup: the target's type and `isMulti` (a Status through many becomes Select with `isMulti`; Created at Timestamp; Created by Member); rollup: AC-316's table; formula: `checkFormula`'s type ([0015-formulas.md](0015-formulas.md)) |
| create | which sides "Through" offers | `attributes.list`'s `relationship` blocks (spec 0014) on this object, live and two way |
| create | which attributes "Attribute" offers | the far object's `attributes.list`, filtered by AC-313 or AC-315 |
| create | a Currency rollup's code | the dialog's choice, prefilled from the target's `config.defaultCurrency` |
| create | a currency formula's `config.defaultCurrency` | the first referenced Currency attribute's (in source order) `config.defaultCurrency`; else the code of the first `CURRENCY()` literal; else refused 422 `CONFIG_INVALID` "Give the result a currency with CURRENCY()." |
| create | the 50 limit | `LIMITS.computedPerObject` = 50, new in `packages/core/src/engine/limits.ts` |
| create | depth and cycles | the graph over `computed_inputs` (`packages/core/src/computed/graph.ts`), `MAX_COMPUTED_DEPTH` = 3 |
| formula in a write | the inputs | the write's parsed values merged with current values read under the record lock |
| formula in a write | the result | `evaluateFormula(ast, values, labels)` in contracts; Select and Status inputs as their option's label now |
| any computed write | `set_by`, version time | the system actor; the write protocol's `t` after the lock |
| planner | which records | `computed_inputs` and the change, as above |
| planner | job or fill | the dependents count up to 1,001 against `RECOMPUTE_INLINE_MAX` = 1,000 (`packages/core/src/computed/plan.ts`) |
| jobs | coalescing window | start delay 1,000 ms, `dedupeKey` per attribute (and scope for fills) |
| lookup value | items and order | links in side order, then item position; distinct; `LOOKUP_ITEMS` = 100 (contracts) |
| lookup option | which option | the mirror whose `mirror_of` is the far value's option |
| rollup value | the number | the rollup statement; Average `round(avg, 4)`; Currency only in the rollup's code |
| preview | the 5 records | the object's live records the caller may see, by `updated_at` descending |
| preview | their values | the same statements and evaluator as the jobs, run without writing |
| header progress | "Working out values, N%" | the definitions store's `computed.done` of `computed.total` through `columnNote` (members included); `data.jobs` only on the Background jobs page |
| settings panels | which sides "Through" offers, and the empty state | the object's live two way relationship sides; none gives the EmptyState |
| preview | debounce, loading, error | `data.computed.preview`: 400 ms after the last change, `loading` while in flight, `error` with `retry` |
| cell reason | "Worked out by a lookup", "Not updating: …" | `readOnly.reason` from `readOnlyReason` (spec 0009), fed by `computed.kind` and `computed_error` |
| access | hidden or shown | `fieldLevel` (spec 0009): hidden when any `computed_inputs` attribute, a via side or their objects is hidden from the viewer |

### Key invariants

- A computed value is only ever written by the system, through `writeComputed`, and never by a person or a rule bypass other than this one.
- `computed_inputs` always matches the definitions, and `dependent_count` matches `computed_inputs`, both changed in the definition's transaction.
- Every write that changes an input either recomputes the dependents in its own transaction (formulas) or queues them in its own transaction (lookups and rollups), so no committed change can be missed; a queued record merged into a waiting job is seen by that job, because the job's claim waits on the job row the merge locked (spec 0008).
- A recompute reads its inputs after locking the records it writes, and any change after that read queues those records again, so values converge.
- No computed attribute depends on itself, and no chain is deeper than 3.
- A broken computed attribute keeps its values and is skipped by the planner and the jobs.
- Nothing changes with the clock: no formula reads the time, so values only change when data does.

### Security model

- Definitions need `schema.manage`; reads are member level and filtered by spec 0009's strictest of inputs rule.
- The jobs run as the system (spec 0009's `systemScope`, the worker only); they write only computed attributes and their sort keys, through the engine, inside `withWorkspace`.
- A rollup's value is an aggregate; it carries no far record ids, so a viewer learns at most a count or a sum over records they can't open, which spec 0009 accepts.
- Formulas are data, never code: the parser builds a closed AST of known nodes, evaluated by a fixed interpreter with no access to anything but the record's values; sizes are bounded (AC-331).
- `security-access-reviewer` reviews milestones 1 and 3; `state-performance-reviewer` reviews every milestone (the planner sits on every write).

### Configuration required

None. No new environment variables, services or dependencies.

### Screens and the library

- **AttributeSettings** (library, changed): the type picker's three new entries, each with its settings panel: Lookup (two Selects: Through, Attribute; the result type line), Rollup (Through, Calculation as a Select, Attribute, the currency Select, and for Count where the FilterBuilder given the far object's own attributes and no `relatedAttributes`, FilterBuilder's existing prop, as spec 0013 uses it; relative dates and "is me" are refused by the server's check with AC-315's message, shown on the panel), Formula (the FormulaEditor). Lookup and Rollup on an object with no live two way relationship side show an EmptyState instead of their fields: "<Plural> has no relationships to look through yet." with "New relationship" (spec 0014's dialog) for `schema.manage`. Each panel ends with the preview: a small Table of up to 5 RecordChips and their values through `AttributeDisplay`, from `data.computed.preview` (refreshed 400 ms after the last change); while a request is in flight a Spinner shows beside the table (the last result stays), and a failure shows an inline error "Couldn't work out the preview." with "Try again" (`retry`) in place of the table. Required, Unique, the default and the Validation section are hidden for computed attributes. A broken attribute shows a danger Callout "Not updating: <reason>" (with "Try again" after a failed fill).
- **FormulaEditor** (library, pulled forward from spec 0003's milestone 4): see the child spec.
- **Attributes tab** (spec 0012): computed rows show a Badge "Lookup", "Rollup" or "Formula" beside the type, and "Not updating" in the danger tone when broken.
- **Tables and the record panel**: no change beyond the read only reason and `columnNote` progress; computed columns are never offered by the create dialog's "Add more fields".

### Critical test scenarios

- Happy path: an admin adds "Company industry" (a lookup) on People and "Total deal value" (a Sum rollup) on Companies; both fill; a member changes a deal's value and a company's industry; a second browser sees both update within 5 seconds; filter People by Company industry and sort Companies by Total deal value, verifies **AC-312**, **AC-313**, **AC-315**, **AC-316**, **AC-319**, **AC-324**, **AC-341**.
- Formula: Weighted value = `{{value}} * {{probability}} / 100` updates in the same save, the result in the save's response and its event carrying the save's `mutationId`; division by zero stores empty; an invalid formula is refused with its position; a currency formula takes its referenced attribute's default currency, verifies **AC-317**, **AC-318**, **AC-325**, **AC-335**.
- Links: add, remove and move a link from either side; delete and restore a far record; create a record with links; each rollup and lookup follows, verifies **AC-319**, **AC-328**, **AC-336**.
- Hub: change the Hub Company's industry; the edit returns in budget and 150,000 lookups update within 3 minutes, verifies **AC-320**.
- Convergence: the randomized concurrent test, verifies **AC-321**.
- Chains and cycles: a formula on a lookup of a rollup updates through all three; a fourth level and a loop are refused with their messages, verifies **AC-326**.
- Broken: archive a lookup's target, then restore it; change a formula input's type through spec 0013; the preview lists it, verifies **AC-327**, **AC-339**.
- Options: rename, recolour, reorder and archive the target's options; the lookup's cells and filter follow at once, verifies **AC-314**.
- Read only and history: a write to a computed attribute is refused; `updated_at` never moves on a recompute; history shows System versions; events carry no `mutationId`, verifies **AC-323**, **AC-325**, **AC-337**, **AC-338**.
- Access: with rules injected (spec 0009), a lookup of a hidden field is absent for that member everywhere, and a rollup over records they can't see still counts them, verifies **AC-329**.
- Permission and limits: a member's create and preview get 403; the 51st computed attribute and an oversized formula are refused, verifies **AC-330**, **AC-331**.
- Sleep: with the worker asleep, an edit's nudge wakes it and the rollup updates; no query runs while idle (`pg_stat_activity` empty), verifies **AC-333**.
- Failure and coarse changes: a fill forced to fail marks the attribute broken through its hook and "Try again" refills it; a recompute forced to fail starts a whole fill; deleting the hub company (its 150,000 far references capped, coarse) starts a fill over People's lookup instead of naming records, verifies **AC-320**, **AC-321**, **AC-334**.
- Progress: a member who can't read the fill job sees the header's progress from the definition, verifies **AC-312**, **AC-322**.
- Scale: the million record lookup, the 20,000 company rollup, the formula edit overhead, with the `steady` mix, verifies **AC-332**.
- Quality: keyboard only use of the three settings panels and the editor's suggestions, axe and contrast in both themes, `pnpm size`, verifies **AC-334**, **AC-340**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 starts after spec 0008's milestone 2, spec 0014's milestone 2 and spec 0013's milestone 1.

**Milestone 1: lookups**
1. Migration: `attributes.computed` and its columns, `computed_state`, `computed_input_role`, `computed_inputs`, `attribute_options.mirror_of`; guard tests, satisfies **AC-312**, **AC-325**
2. Contracts: `ComputedDefinition` (lookup), the AttributeDefinition fields, `computed.preview`, `computed.refill`, `LOOKUP_ITEMS`, satisfies **AC-312**, **AC-313**
3. Core: `define.ts` for lookups (inputs, graph, depth, cycles, limit, mirrors), `writeComputed` and `writeComputedBatch` (with the thin `syncSortKeys` if spec 0013's milestone 3 hasn't landed), the planner in `runWrite` (coarse far objects to a whole fill), the lookup statement, the `computed.recompute` and `computed.fill` kinds with the kind contract test, their `onFailed` hooks and the fill's progress `definitions` changes, mirrored options in `options.ts`, `checkComputed` and the broken states, read only refusals; a text lookup through a one side first, then every type and many sides, satisfies **AC-313**, **AC-314**, **AC-319** to **AC-321**, **AC-323** to **AC-328**, **AC-334**, **AC-336** to **AC-339**
4. Access: computed attributes in `fieldLevel` and `readOnlyReason` (spec 0009's call site), satisfies **AC-323**, **AC-329**
5. Procedures: `attributes.create` and `attributes.update` with `computed`, `attributes.list` (with `computed.done` and `total`), `computed.preview`, `computed.refill`; `data.computed.preview` and `data.computed.refill`, satisfies **AC-312**, **AC-322**, **AC-330**
6. Library and screens: the Lookup entry and panel with its preview (Spinner, inline error with Try again, the no relationships EmptyState), the Attributes tab badges, the broken Callout, `columnNote` progress from the definition; stories, README, guardian, artifact publish, satisfies **AC-312**, **AC-313**, **AC-334**, **AC-340**
7. Deploy; Playwright with two browsers (a lookup created and filled, a company's industry changed); `security-access-reviewer`, `state-performance-reviewer`, `ux-interaction-reviewer`, satisfies **AC-319**, **AC-341**

**Milestone 2: rollups**
8. Contracts and core: the rollup definition, its inputs and result types, the rollup statement (with `where` through the filter compiler), created and restored records in the planner, satisfies **AC-315**, **AC-316**, **AC-319**, **AC-328**
9. Screens: the Rollup entry and panel, Count where's condition; deploy; Playwright: a deal's value changed in one browser, the company's total in the other; `state-performance-reviewer`, satisfies **AC-315**, **AC-316**, **AC-341**

**Milestone 3: formulas (after spec 0013's milestone 3)**
10. Contracts: the formula language in [0015-formulas.md](0015-formulas.md) (`parseFormula`, `checkFormula`, `evaluateFormula`, the functions, the limits) and its table driven test, satisfies **AC-317**, **AC-331**, **AC-335**
11. Core: formula definitions, evaluation in `updateRecord` and `insertRecord` before spec 0013's rule check, formulas after lookups and rollups in the job batches, `option_labels` refills, spec 0013's switch calling `checkComputed`, satisfies **AC-318**, **AC-326**, **AC-327**
12. Library: FormulaEditor (suggestions, the reads as line, the check line), the Formula panel; stories, README, guardian, artifact publish, satisfies **AC-317**, **AC-340**
13. Deploy; Playwright: Weighted value updating in the same save in both browsers; `security-access-reviewer`, `ux-interaction-reviewer`, satisfies **AC-318**, **AC-341**

**Milestone 4: the scale proof and hardening**
14. The randomized convergence test at volume, the chain and cycle tests, the sleep test, satisfies **AC-321**, **AC-326**, **AC-333**
15. The scale runs on the local capped seed (`packages/core/scripts/bench-computed.ts` defines the lookup and the rollup on `pnpm db:seed:scale` and times them while the `steady` mix runs), the hub run, the formula edit overhead; numbers in `verify.md`; `state-performance-reviewer`, satisfies **AC-320**, **AC-332**
16. The full Playwright flow locally and in production, satisfies **AC-312** to **AC-341**

## Consequences

**Positive**:
- Computed attributes are ordinary attributes to every read, filter, sort, count, search and event path, so nothing else in the app needs to know about them.
- Formulas are exact the moment the save returns; lookups and rollups a few seconds later, and never on a timer.
- One dependency index, rebuilt with each definition, keeps the cost of a write with no dependents to one small indexed read.

**Negative / tradeoffs**:
- Every value write pays one indexed read of `computed_inputs` (planner), and a write that changes inputs of formulas reads their other inputs under the record lock.
- Stored values can lag: a lookup or rollup is up to about 5 seconds behind (more after the worker has slept), and up to minutes behind for a hub with more than 1,000 dependents. Filters and sorts on it read the lagging value meanwhile.
- Every recompute that changes a value writes a version, so busy rollups (a hub's deal total) grow `values` with history nobody edits by hand; the activity feed leaves them out.
- A lookup through a side that holds many can't show a number, date or text (they can't hold several values); a rollup covers numbers and dates.
- Mirrored options are copies, written in the same save as the original; an option change on a widely looked up attribute writes one row per mirror.
- Broken attributes keep showing their last values, marked "Not updating", rather than going empty.
- Pulling FormulaEditor forward amends spec 0003's milestone 4 again.

**Neutral**:
- One migration, two new job kinds, two new procedures, one new library module.
- `ApiRefusal` gains `position?`.

## Owner decisions

Decided under the owner's acceptance of the recommended defaults for #11 to #22 (3 October 2026, confirmed for this spec on 8 October 2026):
- **A broken computed attribute** keeps its last values and says "Not updating", rather than clearing them, so a temporary archive doesn't wipe a column people filter by.
- **Lookups through a side that holds many** are limited to types that can hold several values (the storage can't hold several numbers or dates). Showing the first linked record's value only would read as a single answer when it isn't.
- **Text comparisons in formulas ignore case** (`{{stage}} = "won"` matches "Won"), for people writing formulas by hand.
- **Rollups over related records' Updated at** are left out: every edit of a related record would recompute it.

Showing and sorting by a related record's attribute moving from #15 to #16 is spec 0014's question; the owner answered it on 8 October 2026 (it moves to #16, and the lookups here build it).

## Follow-up

- [ ] **Spec 0013** (`/sync`): its switch calls `checkComputed`; its preview lists the computed attributes a change would stop.
- [ ] **Spec 0009** (`/sync`): its #16 call site is built here; `fieldLevel` reads `computed_inputs`.
- [ ] **Spec 0008** (`/sync`): two new kinds (`computed.recompute`, `computed.fill`), named in its follow up as `computed.recompute`. This spec relies on spec 0008's AC-124 and AC-125.
- [ ] **Spec 0012** (`/sync`): `AttributeDefinition` gains `computed?` (with `done` and `total`) and `readOnly` for computed attributes.
- [ ] **Spec 0003** (`/sync`): FormulaEditor moves forward from milestone 4.
- [ ] **#17**: the activity feed leaves computed versions out.
- [ ] **#20**: saved views that filter or sort by a broken computed attribute keep working on its stored values and show its "Not updating" note.
- [ ] **#41**: a hub with millions of dependents and many writes per second may need recompute batching per hub rather than per change; the load harness decides.
- [ ] **Later**: NOW and TODAY in formulas need a daily recompute, which on the Neon free plan means one wake a day per workspace with such formulas; decide when the plan changes.
