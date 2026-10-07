# 0013. Changing an attribute's type

## Summary

A type change is a row in a ledger plus three background jobs. The first job checks every value and shows a preview. After you confirm, the second fills in the new type's columns on the same value rows people are already reading, without anyone seeing a change, then switches the attribute's type in one short transaction. The third rewrites only the values that couldn't share their row (a phone number reformatted, a list trimmed to one item, a value that didn't convert), as versions set by the system; until it reaches them, reads convert them on the fly. Old values stay in history and read in their old type, values that didn't convert are listed for 30 days, and the change can be undone for 30 days.

## Allowed changes

`ALLOWED_CHANGES` in `packages/contracts/src/values/convert.ts` is this table; `typeChangeTargets(attribute)` reads it. "Multi select" is `select` with `isMulti`; "Allow multiple" toggles `isMulti` on the types that have it.

| From | To |
|---|---|
| text | long text, number, currency, date, checkbox, select, multi select, status, rating, email, phone, URL, domain, member |
| long text | text |
| number | text, currency, rating |
| currency | text, number, rating |
| rating | text, number, currency |
| date | text |
| checkbox | text |
| select | text, multi select, status |
| multi select | text, select, status |
| status | text, select, multi select |
| email, phone, URL, domain, member | text; one value ⇄ several (Allow multiple) |
| location | text |
| a record reference side that holds one | holds many (cardinality, below) |

Refused (`TYPE_CHANGE_REFUSED`, 422), with the reason the dialog shows:
- the primary attribute: "The record's name can't change type."
- system attributes: "System attributes can't change type."
- computed attributes (spec 0015): "Change its formula, rollup or lookup instead."
- personal name, file, interaction, timestamp: "<Type> attributes can't change type."
- a record reference to another type: "Relationships can't become another type."
- an archived attribute: "Restore <Title> before changing its type."
- any pair not in the table: "<From> can't change to <To>."

## Converters

`packages/contracts/src/values/text.ts` holds `toText(type, value, context)` and `fromText(type, text, context)`, moved from the field set's `type.ts` files (spec 0003) with their helpers (`parseLocaleDate`, `parseLocaleDecimal`, `splitList`, the operator labels); the field set's types call them. `convert.ts` holds `convertValue(from, to, value, context)`:

```ts
/** One value of `from` as a value of `to`, and what happened to it. Pure. */
export function convertValue(from: TypeSpec, to: TypeSpec, value: unknown, context: ConvertContext): ConvertOutcome;
// TypeSpec: { type, isMulti, config?, options?: { id, label, archived }[] }
// ConvertContext: { locale, defaultCountry?, defaultCurrency?, phone: PhoneParser, members: { id, name, email }[],
//                   optionFor(key: string): string | undefined   // text to select: the plan's option id for a key }
// ConvertOutcome: { outcome: 'same' | 'converted' | 'reformatted' | 'trimmed' | 'partial', value }
//               | { outcome: 'emptied', reason: string }
```

| Change | Rule | When it can't (the reason stored and shown) |
|---|---|---|
| anything to text | `toText`: number as its canonical decimal; currency as "<CODE> <amount>" ("USD 1200.5"); rating "4"; date ISO ("2026-10-08"); checkbox checked "Yes" (unchecked has no value, so stays empty); select and status their label (archived ones too); a member their name today; email, URL, domain as stored; phone in E.164; location its parts joined by ", " (lines, locality, region, postcode, then the country's English name); several values joined by ", " | longer than 500 characters: "Longer than 500 characters." |
| long text to text | line breaks become spaces (`TextValue`'s own transform); `reformatted` when that changed it | "Longer than 500 characters." |
| text to long text | unchanged (`same`) | never |
| text to number | `parseLocaleDecimal(text, locale)`, else `toCanonicalDecimal` | "Not a number."; past `DECIMAL_LIMITS`: "Too large, or more than 4 decimal places." |
| text to currency | "<CODE> <amount>" or "<amount> <CODE>" with a code from `CURRENCY_CODES` (ignoring case), or an amount alone in the default currency | "Not an amount." / "<code> isn't a currency." |
| text to date | `parseLocaleDate(text, locale)`: ISO, or the locale's numeric day order | "Not a date. Use 2026-10-08." |
| text to checkbox | checked for yes, true, 1, checked, x; unchecked for no, false, 0, unchecked (ignoring case and spaces) | "Not yes or no." |
| text to rating | a whole number from 1 to 5 | "Ratings are whole numbers from 1 to 5." |
| text to email, URL, domain | the type's schema (it lowercases what it should); `reformatted` when the stored text changes | the schema's own message |
| text to phone | `context.phone.parse(text, defaultCountry)` (libphonenumber), giving E.164 and the country | "Not a phone number." / "No country code, and no default country was chosen." |
| text to member | an active member by email, else by name, ignoring case | "No member called <text>." / "Two members are called <text>." |
| text to select, status | the trimmed, lowercased text's option in the plan (below) | "<text> has no option." / "Longer than 100 characters, too long for an option." |
| text to multi select | split on commas, semicolons and line breaks, each item to its option, duplicates dropped, at most 100; `partial` when some items had none | every item without an option: "No option for any of its values." |
| number ⇄ currency ⇄ rating | the amount carries over; to currency it takes the default currency; currency to number drops the code | to rating: "Ratings are whole numbers from 1 to 5." |
| select, multi select, status among each other | option ids carry over (the options belong to the attribute and stay); several to one keeps the first (`trimmed`) | never |
| one value to several | a list of one (`same`) | never |
| several to one | the first item by position (`trimmed`) | never |

A `trimmed` or `partial` result, and an `emptied` one, are listed in "Values that didn't convert" with "Kept the first of <n> values.", "<n> of <m> values have no option." or the reason.

**The plan for text to select, multi select or status**: the check fills `conversion_values` with every distinct key (the item lowercased and trimmed) and how many values hold it. The 500 keys with the highest counts (ties by `first_owner_id`, ascending) each get a new option: id a uuid v7, label the key's first seen text, hue the next in `HUES` order after the previous option's (gray first), outcome Open for status. Keys longer than 100 characters never get one. The admin's edits in the preview: rename and recolour (the label rules of spec 0012), "Merge into…" (every key of one option moves to another; the emptied option goes), and "Leave out" (its keys map to nothing, so its values can't convert). Each edit recomputes counts and examples from `conversion_values`, never from the values again.

## Where each value goes

Two independent answers for every current value row (`classifyRow` in `packages/core/src/convert/classify.ts`):
- **The outcome** (what people are told): `convertValue`'s outcome.
- **The storage** (what the jobs do): `none` when the row already holds the new encoding (`encodeValue(to, value)` equals the row's columns for every column it sets); `fill` when every column the new encoding sets is empty on the row (or already equal), so it can be written onto the same row with no new version; `rewrite` for everything else: a column both types use with different content (text to phone, currency to text, location to text, reformatted text), a trimmed or partial list, and every emptied value.

Prepare does the `fill` rows before the switch; finishing does the `rewrite` rows after it.

## Data model (migration B, milestone 3)

| Table | Columns | Rules |
|---|---|---|
| `attribute_conversions` | `id` uuid v7 (the client's), `attribute_id`, `object_id`, `relationship_id` null (cardinality), `kind` (`type`, `cardinality`), `from_spec` jsonb, `to_spec` jsonb (`TypeSpec`, or `{ cardinality }`), `context` jsonb (`locale`, `defaultCountry?`, `defaultCurrency?`), `status` enum `conversion_status` (`checking`, `ready`, `preparing`, `finishing`, `done`, `cancelled`, `failed`), `finish_failed` bool default false, `undo_of` uuid null → `attribute_conversions`, `counts` jsonb null (per outcome), `samples` jsonb null (at most 100), `consequences` jsonb null, `removed_rules` jsonb null (the rules' full rows, for undo), `default_before` jsonb null, `was_unique` bool, `ready_until` timestamptz null, `prepare_started_at`, `flipped_at`, `finished_at` timestamptz null, `check_job_id`, `convert_job_id`, `finish_job_id` uuid null, `created_*`, `updated_at` | primary key (`workspace_id`, `id`); index (`workspace_id`, `attribute_id`, `flipped_at`). Kept for good: history before a switch is read through it. `samples` is cleared when the conversion ends (done, cancelled, failed, expired) |
| `conversion_values` | `conversion_id`, `key` text, `label` text, `count` integer, `first_owner_id` uuid, `option_id` uuid null | primary key (`workspace_id`, `conversion_id`, `key`); index (`workspace_id`, `conversion_id`, `option_id`). Only for text to select, multi select or status; deleted when the conversion ends |
| `conversion_misses` | `conversion_id`, `record_id`, `attribute_id`, `outcome` (`trimmed`, `partial`, `emptied`), `old_value` jsonb (the old type's value), `new_value` jsonb null, `reason` text, `created_at` | primary key (`workspace_id`, `conversion_id`, `record_id`); deleted 30 days after `created_at` by the daily cleanup |
| `attributes` | `conversion_id` uuid null → `attribute_conversions` | set from start to `done`, `cancelled`, `failed` or expiry, on both sides' attributes for a cardinality change |
| function `sort_key_parts(type, text_value, number_value, json_value, date_value, timestamp_value, option_id, bool_value)` | returns the seven key columns | `immutable`, `language sql`. The `sort_key_sources` view is rebuilt to call it with `a.type`, so the view and prepare compute keys with one expression (spec 0004's "keys computed only in SQL" holds). Not a security definer |

All three tables: forced row level security, the standard policy, both guard tests.

## States

```
checking → ready → preparing → finishing → done
checking | ready | preparing → cancelled        (Cancel, or closing the dialog before Confirm)
ready → (read after ready_until) expired       (treated as cancelled; the daily cleanup sets cancelled)
checking | preparing → failed                  (the job failed after its retries, or its starter lost schema.manage)
finishing → finishing with finish_failed       (the finishing job failed after its retries; Retry starts a new one)
```

The switch is the last batch of `preparing` and moves the row to `finishing` in the same transaction. A conversion that is `checking`, `ready` (not expired), `preparing` or `finishing` holds the attribute: every other definition change on it, archiving it or its object, and starting another conversion answer 409 `ATTRIBUTE_CONVERTING`.

## The phases

**Start** (`conversions.start`): checks `schema.manage`, the attribute (live, not held), the pair (`TYPE_CHANGE_REFUSED`), the target's settings (`AttributeConfig[to]`; a currency target needs `defaultCurrency`), `locale` (`Intl.getCanonicalLocales`, else 422 `CONFIG_INVALID` "That language isn't known.") and `defaultCountry` (`COUNTRY_CODES`); inserts the conversion (`checking`), sets `attributes.conversion_id` under the attribute row's `for update`, and starts `attributes.analyse` with `id` = a new uuid v7 in the same transaction. One `definitions` event.

**Check** (`attributes.analyse`, a cursor job): walks every current value row of the attribute by owner id, 5,000 per batch, whatever the starter's record rules (a type change must map every value, so its counts cover all records, and the preview says so), decoding each in the old type and running `convertValue`; it adds to the counts, keeps the samples (below), and for a text to select target upserts `conversion_values`. Its last batch builds the plan's options (without writing any option row), computes the consequences, sets `ready` and `ready_until` = now + 1 hour, and records a `definitions` change. A cardinality check counts current links, and for a narrowing, the records holding more than one on the side that will hold one (with up to 100 of them as samples).

**Samples**: kept from every record, and filtered to the records the reader may see each time the preview is read (so a reader may see fewer than 100). In owner id order, the first 40 values that won't convert whole (emptied, trimmed, partial), then the first 30 reformatted, then the first 30 converted or same; when a group has fewer, the others fill up to 100. Each holds the record id, the value before (old type) and after (new type, or null), the outcome and the reason. For a text to select target, "after" is worked out from the current plan each time the preview is read.

**Consequences** (`consequences`): rules removed (each rule whose kind isn't allowed for the new type, and each rule on any attribute of the object whose condition names this attribute with an operator the new type doesn't offer or an operand that doesn't parse for it), with their summaries; "Unique will be turned off" when it is on; the default before and after (`convertValue` on a static default; "Current user" and "Today + N days" defaults are cleared unless the target keeps the type); and, when Required is on, "<n> records will have no <Title>".

**Confirm** (`conversions.confirm`): only `ready` and not expired (else `CONVERSION_EXPIRED`); writes the planned options (for text to select, as new `attribute_options` rows of this attribute, invisible while it is text, counted against the 500), maps `conversion_values.option_id`, sets `preparing` and `prepare_started_at`, and starts `attributes.convert` (member, cancellable) in the same transaction.

**Prepare** (`attributes.convert`, phase `fill`): walks the current rows by owner id, 5,000 per batch, classifying each: for `fill` rows it writes the new encoding's columns onto the same row (`update values … where id = $row and active_until is null`, so a row a person ended meanwhile is skipped), and upserts the target type's key columns on the owner's `sort_keys` row from `sort_key_parts(<target type>, …)`, leaving the old type's columns in place. No version, no `updated_at`, no event: nobody sees a thing.

**Writes during prepare** (`writeAttribute`, changed): for an attribute whose conversion is `preparing`, a value write also runs `convertValue` on the new value and, when its storage is `fill`, writes the new columns on the rows it inserts and the target key columns. A write that loaded the attribute before the conversion reached `preparing` is caught by the catch up.

**Catch up** (phase `catchup`): every record of the object with `updated_at >= prepare_started_at - 1 minute`, read through the `records` updated index, has its current row classified and filled again. The phase repeats from the time it began until a pass finds fewer than 500 records.

**The switch** (phase `switch`, one batch, one transaction): `pg_advisory_xact_lock(hashtextextended('crm:conversion:' || attribute_id, 0))`, then the attribute row `for update` (waiting for writes that hold its key share lock, `holdDefinitions`); a last catch up over records updated since the previous pass began; then sets `attributes.type`, `is_multi`, `config`, `default_value` (converted or null), `is_unique` false, the removed rules deleted (and stored in `removed_rules`), `rule_count` and `rules_version` recomputed for the attributes they named, Select to Status options given outcome Open, Status to Select options' outcome and target time cleared; the conversion to `finishing` with `flipped_at` = `clock_timestamp()`; starts `attributes.finish` in the same transaction (a system kind started from inside the member's convert job transaction, spec 0008 AC-125, so it commits only with the switch); records a `definitions` change for the object and a coarse `records` change for it (`Change.coarseObjects`, spec 0007), so every screen refetches the column. Writes that waited on the lock start again with the new definition (`writeConflict`). The job logs the switch's duration.

**Finishing** (`attributes.finish`, a system cursor job, not cancellable): walks the current rows with `active_from < flipped_at` by owner id, 5,000 per batch. It locks the batch's owners `for no key update` in id order, classifies each row again, writes every `rewrite` row as a version set by the system (the write protocol: `t` after the lock, the old row ended, the new rows or a cleared marker inserted), fills any `fill` row prepare missed, inserts `conversion_misses` for trimmed, partial and emptied values, clears `unique_key` on the batch's rows when the attribute was unique, and runs `syncSortKeys(tx, attribute, ownerIds)` (new, the set form of `syncSortKey`), which rewrites each key row from the view and drops the old type's columns. It never moves `updated_at` and never runs rules. The batch's `Change` lists the rewritten records (coarse past `CHANGE_CAP`, spec 0007). Its last batch sets `done`, `finished_at`, clears `attributes.conversion_id`, `samples` and `conversion_values`, and records a `definitions` change.

**Reads during finishing** (`readRecords`, changed): for an attribute whose conversion is `finishing`, current item rows come back with their `active_from`; a row from before `flipped_at` is decoded in the old type and passed through `convertValue` with the conversion's context (the plan's options read from `conversion_values` for the keys in the rows being read), so every read shows the converted value. Rows from after the switch decode normally. Filters and sorts read the stored columns and keys (see Consequences in the index).

**Cancel** (`conversions.cancel`): `checking`, `ready` or `preparing`: cancels the running job (spec 0008), sets `cancelled`, clears `attributes.conversion_id`, archives options Confirm created, deletes `conversion_values`. Filled columns and key columns stay on the rows; nothing reads them, and the next save of each row drops them. After the switch: 409 `CONVERSION_SWITCHED`.

**Failure** (spec 0008 AC-124): the check and convert steps check `can(scope.access, 'schema.manage')` at the first batch of each slice and, when the starter lost it, return `failed: { code: 'FORBIDDEN', message: 'The person who started this can no longer change attributes.' }`, so the job ends at once with no retry. Every way these jobs end `failed` (that outcome, attempts used up, `ACTOR_REMOVED`, `JOB_INVALID`) runs the kind's `onFailed` hook in the same transaction: for `attributes.analyse` and `attributes.convert` it sets the conversion `failed` and releases the attribute exactly as cancel does (clears `attributes.conversion_id`, archives options Confirm created, deletes `conversion_values`) and records a `definitions` change; for `attributes.finish` it sets `finish_failed` and records a `definitions` change, leaving the conversion `finishing`, so reads keep converting on the fly. `conversions.retryFinish` starts a new finishing job from the start (it skips rows already done). The switch is the convert job's last batch, so a convert job can only fail before it; after the switch only the finishing job can fail.

## History in the type of its time

`typeAt(attribute, instant)` (in `packages/core/src/convert/history.ts`) is the `from_spec` of the earliest conversion of the attribute that is `finishing` or `done` with `flipped_at` after the instant, else the attribute's current type.
- `getHistory`: each version decodes in `typeAt(active_from)`, and carries `as: { type, isMulti }` when that differs from the attribute's type now (`ValueVersion` in contracts gains the optional `as`), so the activity feed shows it through the right field display. Option labels come from the option rows as they are now (spec 0004), which a conversion never deletes.
- `getValuesAsOf(t)`: each row current at `t` decodes in `typeAt(active_from)`, then passes through `convertValue` for every conversion switched between its `active_from` and `t`, in order.
- `getTimeInStages`: visits count from every version that decodes as a select or status option, so a status that was a select keeps its earlier visits.

## Undo

`conversions.undo` is allowed for the attribute's latest conversion when it is `done`, `flipped_at` is within the last 30 days, the attribute is live and no conversion holds it; else 409 `UNDO_EXPIRED` (with the switch date) or `ATTRIBUTE_CONVERTING`. It starts a new conversion with `undo_of` set, `from` = the current spec and `to` = the undone one's `from_spec`, and the same context, through the same check, preview and confirm. Its converter per current row:
- a row with `active_from` before the undone `flipped_at` (nobody changed it): decoded in the original type from its own columns, which were never cleared: `same`, no write;
- a row the undone finishing job wrote (set by the system, `active_from` between the undone `flipped_at` and `finished_at`, and the version before it began before `flipped_at`): the version before it, exactly (`rewrite`, outcome `same` in the preview);
- any other row (changed by a person after the switch): `convertValue` back, with misses listed as usual (for an undone location to text, every such row is a miss: "Text can't become a location.").

At its switch it also puts back `removed_rules` (new ids if a clash), `default_before`, archives the options the undone change created, and leaves Unique off (the preview says "Unique stays off; turn it on again after."). A cardinality undo is a narrowing (below).

## Cardinality

Allowed: a side that holds one becomes one that holds many (`one_to_one` to `one_to_many`, `many_to_one` or `many_to_many`; `one_to_many` or `many_to_one` to `many_to_many`), and the undo of such a widening.
- **Widening**: the check counts links (no samples). The convert job has nothing to fill and switches at once: `relationships.cardinality` and the side's `attributes.is_multi`. New links are written with the new single flags. The finishing job sets `from_single` or `to_single` false on the relationship's current link rows, 5,000 per batch (until then the old flag only keeps rows that were already unique), and deletes the reference sort keys (spec 0014) of the side that now holds many.
- **Narrowing (undo only)**: the check counts the records holding more than one current link on the side that would hold one, and if any do, the preview shows the count and up to 100 of them, and Confirm stays disabled. From Confirm until `done`, link writes on the relationship (`writeLinks`, `writeLinksDelta`) are refused 409 `ATTRIBUTE_CONVERTING`. The switch checks again (any violation fails the conversion with `TYPE_CHANGE_REFUSED` "<n> records now hold more than one."), then finishing sets the flags true in batches and builds the side's reference keys with spec 0014's `syncReferenceKeys`.

## Jobs (spec 0008 kinds)

| Kind | Lane | Actor | Cancellable | Shape | Batch | Label |
|---|---|---|---|---|---|---|
| `attributes.analyse` | heavy | member | yes | cursor (phase, owner id) | 5,000 rows | "Checking values for a type change" |
| `attributes.convert` | heavy | member | yes (the switch is its last batch) | cursor (`fill`, `catchup`, `switch`) | 5,000 rows | "Changing a type" |
| `attributes.finish` | heavy | system | no | cursor (owner id) | 5,000 rows | "Finishing a type change" |
| `validation.count` | heavy | member, `countsTowardLimit: false` | yes | cursor (record id) | 2,000 records | "Counting records against a rule" |

Each passes spec 0008's kind contract test (idempotent batches, under 5 seconds a batch on the million record seed). `subject` is the attribute (`attribute`, its id), so the attribute's settings find its job. `attributes.analyse` and `attributes.convert` declare an `onFailed` hook that sets the conversion `failed` and releases the attribute; `attributes.finish` declares one that sets `finish_failed` (Failure, above). `attributes.finish` is started by the switch inside the convert job's transaction (spec 0008 AC-125). `validation.count` is one job per attribute: it starts from every rule write's transaction on that attribute (and from `validation.recount`) with `dedupeKey` = the attribute id and a start delay of 2 seconds, so quick edits make one count, and it declares `countsTowardLimit: false` (spec 0008 AC-126), since a burst of rule edits must never fill a workspace's job limit. Its first batch reads the attribute's rules and their versions into its checkpoint; each batch checks every one of them; its last batch writes `breaking_count`, `breaking_sample`, `counted_at` and `counted_version` for each rule whose `version` still equals the one it counted, and records a `definitions` change.

`maintenance.daily` (spec 0008) gains a `conversions` phase: delete `conversion_misses` older than 30 days (5,000 at a time); set expired `ready` conversions `cancelled`, release their attributes and delete their `conversion_values`; delete `conversion_values` of ended conversions.

## API surface

oRPC on `/api/rpc`, `member` door, `schema.manage` for every procedure here (reads too, since previews and lists hold values); writes take a `mutationId`, store one outbox row and nudge the worker.

| Procedure | Key inputs | Key outputs | Key errors |
|---|---|---|---|
| `conversions.start` | `workspace`, `id` uuid v7, `attributeId`, `to` (`{ type, isMulti, config? }` or `{ cardinality }`), `locale`, `defaultCountry?` | ConversionView (`checking`) | 403; 404; 409 `ATTRIBUTE_CONVERTING`; 422 `TYPE_CHANGE_REFUSED`, `CONFIG_INVALID` |
| `conversions.get` | `workspace`, `conversionId` | ConversionView | 403; 404 |
| `conversions.editOption` | `workspace`, `conversionId`, `optionId`, `label?`, `hue?`, `mergeInto?`, `leaveOut?` | ConversionView | 403; 404; 409 when not `ready`, `CONVERSION_EXPIRED`; 422 `CONFIG_INVALID` (a label in use) |
| `conversions.confirm` | `workspace`, `conversionId` | ConversionView (`preparing`) | 403; 404; 409 `CONVERSION_EXPIRED`, when not `ready`, or a narrowing with violations |
| `conversions.cancel` | `workspace`, `conversionId` | ConversionView (`cancelled`) | 403; 404; 409 `CONVERSION_SWITCHED` |
| `conversions.undo` | `workspace`, `id` uuid v7, `conversionId`, `locale` | ConversionView (`checking`) | 403; 404; 409 `UNDO_EXPIRED`, `ATTRIBUTE_CONVERTING` |
| `conversions.retryFinish` | `workspace`, `conversionId` | ConversionView | 403; 404; 409 when not `finishing` with `finish_failed` |
| `conversions.misses` | `workspace`, `conversionId`, `cursor?`, `limit` ≤ 50 | `{ items: [{ record: RecordRefDisplay, before, after?, outcome, reason }], nextCursor? }`, by `record_id`; the cursor follows spec 0005's pattern (opaque base64url of the last `record_id`, bound to the conversion, parsed by a strict Zod schema) | 403; 404; 400 `INPUT_INVALID` naming field `cursor` for a cursor that doesn't parse or belongs to another conversion |

`ConversionView`: `{ id, attributeId, kind, from, to, status, expired, undoOf?, counts?, samples?, options? ([{ id, label, hue, count, examples (up to 3 keys' first seen text) }]), consequences?, checkedAt?, readyUntil?, flippedAt?, finishedAt?, finishFailed, jobId?, startedBy }`. Samples and misses leave out records the caller may not see.

`AttributeDefinition` (spec 0012) gains `conversion?`: `{ id, status, to, jobId, startedBy, done, total? }` while one holds it (members see it, for the header note and its progress: `done` and `total` are the current job's, read by `listAttributes` from that `jobs` row in the same query, so a member who can't read the job still sees the progress), and `lastChange?`: `{ conversionId, from, to, flippedAt, undoableUntil?, missesCount }` (owners and admins only).

## Screens

- **AttributeSettings, edit mode**: the type row shows the type read only with "Change type" (a secondary Button) for `schema.manage`, or the refusal reason as hint text. For a relationship side that holds one: "Allow many" instead.
- **The change type dialog** (Modal): step one, a Select of `typeChangeTargets` with the field set's icons and labels, plus the target's settings (Currency: default currency Select, required; Phone: "Numbers without a country code are from" country Select, prefilled from the browser locale's region, with "No default"); a line "Numbers and dates are read as <language name>." from `Intl.DisplayNames`. "Check values" starts it. Step two, ChangePreview: while checking, "Checking <n> values…" and a ProgressBar from the definition's `conversion.done` and `total`; ready, the preview; failed, an error EmptyState "Checking the values failed." with Retry. Footer: Cancel (cancels the conversion and closes) and "Change type" (primary; disabled while checking and for a blocked narrowing). Expired: a warning Callout "This preview is more than an hour old." with "Check again". Closing the dialog before Confirm cancels the conversion. After Confirm the dialog closes and focus returns to the settings row.
- **ChangePreview** (library module, presentational): a header "<Title>: <from> → <to>" with both type icons; a DescriptionList of the counts (Same, Converted, Reformatted, Partly kept, Empty), each count a Badge (Empty and Partly kept in the warning tone), under the line "Counts cover all <N> records, including any you can't open."; the samples in a Table: RecordChip, the before value through `AttributeDisplay` in the old type, an arrow Icon, the after value through `AttributeDisplay` in the new type or a muted "Empty" with the reason; a Callout (warning when anything is lost, info otherwise) listing the consequences; "As of <RelativeTime>"; and a slot for the options plan.
- **OptionsEditor, plan mode** (library, changed): each option row shows its count and examples; the row menu has "Merge into…" (a Select of the other options) and "Leave out" (the row then shows muted with "Left out"); no drag (order is by count).
- **Progress everywhere**: the column header's `columnNote` "Changing to <Type>" with progress, and on the Attributes tab a Badge "Changing to <Type>" with a ProgressBar on the row; both read the definitions store's `conversion` (`done` of `total`), which every member holds. `data.jobs` (spec 0008) stays for the starter's finish toast and the Background jobs page of holders of `jobs.manage`. "Finishing the type change failed." shows as a danger Callout in the attribute's settings with Retry.
- **The Attributes tab row menu**: "Undo type change" (when `lastChange.undoableUntil` is in the future) and "Values that didn't convert (<n>)" (when `missesCount` > 0 and the misses are under 30 days old). The second opens a Modal with a Table (RecordChip, the old value through the old type's display, the new value or "Empty", the reason) and "Show more", 50 at a time.

## Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| start | which targets | `ALLOWED_CHANGES` through `typeChangeTargets` in contracts |
| start | conversion id | the client's uuid v7 (the retry key) |
| start | locale | the dialog sends `navigator.language`, checked by `Intl.getCanonicalLocales` |
| start | default country | the dialog's choice, prefilled from `new Intl.Locale(locale).maximize().region` |
| start | default currency | the target config's `defaultCurrency`, chosen in the dialog |
| check | counts, samples, consequences | the `attributes.analyse` batches, as above |
| check | progress shown | `AttributeDefinition.conversion.done` and `total`: the analyse job's own (`total` = the attribute's current row count, read at its first batch), read by `listAttributes` from the job row |
| check, prepare, finishing | how progress reaches screens | each batch of the three kinds records a `definitions` change for the object at most once a second (the runner's throttle for `jobs` events, the same clock), and always on its last batch; every member's definitions store refetches the object's attributes |
| check | the plan's options | the top 500 `conversion_values` by count, ties by `first_owner_id` |
| check | an option's hue | the next in `HUES` order after the previous one's, gray first (`nextHue` from spec 0012) |
| preview | "after" for a select target | `conversion_values.option_id` for the sample's keys, now |
| preview | "As of" | the analyse job's `finished_at` |
| confirm | expiry | `ready_until` = the check's end plus 1 hour |
| any job | members for text to member and member to text | the workspace's members (active ones for matching), read once per slice |
| prepare, finishing | the new columns | `encodeValue(to, convertValue(…).value)` in `packages/core` |
| prepare | the target key columns | `sort_key_parts(<target type>, …)` in SQL |
| catch up | which records | `records.updated_at >= prepare_started_at - interval '1 minute'` for the object, through `records_updated` |
| switch | `flipped_at` | `clock_timestamp()` inside the switch transaction |
| switch | the new default | `convertValue` on a static default; null for the others unless the type is kept |
| finishing | a rewrite's time | the write protocol's `t` after the batch's lock |
| finishing | who | the system actor (spec 0009's `systemScope`, the worker's) |
| reads during finishing | the shown value | `convertValue(from, to, decode(from, row))` for rows from before `flipped_at` |
| history | the type of a version | `typeAt(active_from)` from `attribute_conversions` |
| undo | allowed until | `flipped_at` plus 30 days |
| misses list | rows | `conversion_misses` joined to live records the caller may see, by `record_id` |
| misses list | kept for | 30 days from `created_at`, by the daily cleanup |
| header and settings progress | progress | the definitions store's `conversion.done` and `total` |
| check, preview | counts | every current value row of the attribute, whatever the reader's record rules (labelled "all <N> records") |
| misses list | cursor | spec 0005's pattern over `record_id`; a bad one is 400 `INPUT_INVALID` naming `cursor` |

## Key invariants

- Before the switch nothing people can see changes: prepare writes only columns the old type doesn't read, and key columns its sorts don't use.
- After the switch every read shows the new type: rows the finishing job hasn't reached are converted when read.
- The switch is one transaction, ordered against every write to the attribute by its row lock and the advisory lock.
- A value row's old columns are never cleared by a conversion, so history and undo can always read them.
- At most one unfinished conversion per attribute (`attributes.conversion_id`), and none on an archived one.
- Outside an unfinished conversion, every `sort_keys` row holds only its type's columns, as spec 0004's AC-20 test expects; that test runs with no conversion open, and a second one checks the same after a conversion's finishing job.
- The finishing job writes versions only through the write protocol, as the system, and never moves `updated_at`.
- Every allowed change has an undo path. The table is closed under reversal except location to text: its undo restores unchanged values exactly, and lists every value changed after the switch with "Text can't become a location."

## Critical test scenarios

- Text to select on People (real Postgres): check, plan edits (rename, merge, leave out) with counts updating, confirm, a second browser sees the column change within a second, history before the switch shows text, verifies **AC-265**, **AC-266**, **AC-268**, **AC-270**.
- Every pair: the table driven `convertValue` test, and an engine test per pair through prepare, switch and finishing, checking reads, filters on stored keys after finishing, history and as of reads, verifies **AC-264**, **AC-269**, **AC-279**.
- Concurrency: writers editing the attribute through check, prepare, catch up, the switch and finishing; every edit present at the end, no row with both forms missing; a write that loaded the old definition retries after the switch, verifies **AC-267**, **AC-268**.
- Cancel: before the switch, nothing visible changes and the attribute is released; after it, `CONVERSION_SWITCHED`, verifies **AC-267**.
- Carry over: Unique off, Required kept, defaults, rules removed and listed, options' outcomes, verifies **AC-271**.
- Undo: unchanged values exactly back, changed ones converted back with misses, rules and default back; after 30 days (injected clock) `UNDO_EXPIRED`, verifies **AC-272**.
- Cardinality: widen Person · Company, link a second company; undo refused while a person has two; remove one, undo succeeds; links refused during the narrowing, verifies **AC-273**.
- Failure: a finishing job forced to fail shows Retry (its `onFailed` set `finish_failed`), reads still converted, Retry completes; a check job whose starter is demoted ends `failed` with `FORBIDDEN` at once, with no retry, and its hook releases the attribute; a convert job whose starter is removed ends `ACTOR_REMOVED` and its hook releases the attribute, verifies **AC-269**, **AC-277**.
- Progress: a member who can't read the convert job sees the header's progress move at least every 2 seconds from the definition; a misses call with a tampered cursor answers 400 `INPUT_INVALID` naming `cursor`, verifies **AC-267**, **AC-270**.
- Expiry: a preview read after an hour (injected clock) is expired and Confirm answers `CONVERSION_EXPIRED`; the daily cleanup cancels it, verifies **AC-265**, **AC-275**.
- Scale: the million record runs, verifies **AC-274**.

## Build plan (the parts of the index's milestones 3 and 4)

Milestone 3:
1. Migration B: the three tables, `attributes.conversion_id`, `sort_key_parts` and the view rebuilt on it; guard tests (the function is not a definer).
2. Contracts: `TypeSpec`, `ConvertContext`, `ConvertOutcome`, `ConversionView`, `ValueVersion.as`, the procedures, the codes.
3. Core: `classifyRow`, `typeAt`, the `attributes.analyse`, `attributes.convert` and `attributes.finish` kinds, the dual write in `writeAttribute`, `holdDefinitions` widened, reads during finishing in `readRecords`, history by type, `syncSortKeys`, the server phone parser, the `conversions` phase of the daily cleanup.
4. The procedures and the data layer (`data.conversions.start`, `get`, `editOption`, `confirm`, `cancel`, `undo`, `retryFinish` and the `misses` source, plus `@crm/data/react`'s `useConversion(conversionId)`, refetched on `definitions` events for the object).
5. Screens: the dialog, ChangePreview, plan mode, progress in the header and settings, the misses Modal; text to select first through every layer, then every pair.

Milestone 4:
6. Undo.
7. Cardinality.
8. The scale runs (a bench script, `packages/core/scripts/bench-convert.ts`, adds a text attribute "Region" with 12 values to the million deals of `pnpm db:seed:scale` and converts it; a second run converts a text attribute of mixed format phone numbers to Phone), with the `steady` mix running.

## Rationale (short)

Writing the new type onto the same current rows is what makes a million record change cheap: no second copy of the values, no change to any read path before the switch, and a switch that only edits one definition. Some values can't share a row with their old form (a column both types use with different content, or fewer items), so those are rewritten after the switch, where a version is the honest record of what changed, and reads convert them until then. The alternative of a shadow attribute with its own rows needs every value query to learn a second id, and options can't be shared across it, because a value's option must belong to its attribute.
