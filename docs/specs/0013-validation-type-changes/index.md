# 0013. Validation and type changes: clean data, and a model that can change its mind

**Date**: 2026-10-08
**Status**: Proposed

## Summary

This keeps data clean and lets the data model evolve. An owner or admin adds rules to an attribute (a length, a format, a range, a list of allowed email domains, "required once the stage is Won"), and any save that breaks a rule is refused with a plain reason, checked in the browser first and always on the server. An admin can also change an attribute's type after records exist (text to select, number to currency, one email to several): a background job checks every value first and shows what will convert and what won't, then converts a million records in under ten minutes while people keep working, and nothing is lost, because every old value stays in history, every value that didn't convert is listed for 30 days, and the whole change can be undone for 30 days. It is built in four visible steps.

## Structure

- [0013-type-changes.md](0013-type-changes.md): the type change in full: which changes are allowed, the converters, the ledger, the four phases (check, prepare, switch, finish), how history reads old types, undo, relationship cardinality, and the jobs.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As an admin, I want to say what a valid value looks like (a format, a range, allowed domains), so bad data never gets in, whoever types it.
- As an admin, I want a field to become required only in some cases ("Close date once the deal is Won"), so people aren't forced to fill it too early.
- As a member, I want to be told exactly why my save was refused, on the field I touched, before anything is sent when possible.
- As an admin, I want to know how many existing records don't meet a new rule, without the rule changing or blocking them.
- As an admin, I want to change an attribute's type after records exist, see beforehand which values won't convert, and keep working while it runs.
- As an admin, I want to get every old value back if a type change was a mistake, for 30 days.
- As the owner of this product, I want a million record type change to finish in minutes without slowing anyone else, and without keeping the database awake when nobody is using it.

**Acceptance criteria** (this spec owns AC-252 to AC-281):

*Validation rules*
- **AC-252**: AttributeSettings (spec 0012) gains a Validation section. An owner or admin adds rules of the kinds the attribute's type allows (the rule kinds table below), edits them, reorders them by drag and by keyboard, and deletes them, each with an optional message of 1 to 200 characters. Rule changes save with the dialog's Save, in the same write as the rest of the attribute. An attribute holds at most 20 rules; the 21st is refused 409 `LIMIT_REACHED` "An attribute holds at most 20 rules." Members see the rules read only; a member calling `attributes.create` or `attributes.update` with rules gets 403 `FORBIDDEN` and nothing is written.
- **AC-253**: A rule's settings are checked when it is saved and refused 422 `CONFIG_INVALID` on that rule's field with the message from the rule kinds table: a minimum above its maximum, a bound outside the type's own limits, a pattern longer than 200 characters or one RE2 can't compile ("That pattern can't be used: <RE2's reason>."), a domain or country that doesn't parse, more than 50 domains or countries, and a condition that names another object's attribute, follows a relationship, or uses more than 10 conditions or groups nested more than 2 deep ("Conditions can only use this object's own attributes." and the limits' own messages).
- **AC-254**: Every create or edit of a record (the create dialog, a cell, a paste, `setValuesBatch`, the API, a job a member started) that breaks a touched rule is refused 422 `VALIDATION_FAILED`, listing every failing rule as a refusal with its `attributeId`, `ruleId` and message, and nothing is written. In a batch only that record is refused. A value that doesn't parse is refused first with its own code, before any rule runs.
- **AC-255**: Only touched rules run: a rule is touched when the write sets its attribute or an attribute its condition names; a create touches every rule of the object. Rules other than Required never apply to an empty value. Rules are never retroactive: a record that already breaks a rule keeps its value, and an edit that touches none of that rule's attributes saves normally.
- **AC-256**: A refusal shows the rule's own message, or the generated one from the rule kinds table. In the create dialog it shows on the field of the rule's attribute. In the grid the edited cell rolls back and shows the message, with a toast that offers Retry (spec 0005 AC-36); a failure on an attribute the edit didn't touch shows on the edited cell, naming that attribute. No message names an attribute hidden from the writer or quotes another record's value.
- **AC-257**: The browser checks rules before it sends a write, with the same `checkRules` function from `packages/contracts` that the server runs. A failure there shows the message at once, sends nothing and never flashes the new value. A rule whose inputs the browser doesn't hold is left to the server. A raw procedure call that skips the browser check is refused exactly the same.
- **AC-258**: Pattern rules offer presets (Digits only, Letters only, Letters and digits, No spaces, Starts with, Ends with) and a custom pattern, all run by RE2 semantics (`re2js`) in the browser and on the server, matched against the whole value, with an "Ignore case" switch. A 10,000 character value checked against `(a+)+$` takes under 50 ms on the server. The browser loads `re2js` only when a pattern rule needs checking, so the first load stays under 250 kB.
- **AC-259**: Only three paths skip rules: `restoreRecord`, the writes of a type change's jobs, and computed attribute writes (spec 0015). A test walks every exported engine write service and fails when another one skips them.

*Required*
- **AC-260**: Required becomes a three way choice: Never, Always, When…. When opens the FilterBuilder limited to this object's own attributes (no relationship paths), with at most 10 conditions nested at most 2 deep, and every operator the field set offers, relative dates included. After a create or edit in which the condition holds and the attribute is empty, the write is refused `VALIDATION_FAILED` "<Title> is required when <summary>." Relative dates resolve when the write runs, in the writer's time zone, weeks starting Monday. Checkbox and computed attributes have no Required choice.
- **AC-261**: Choosing Always shows, before Save, "N records have no <Title> now. They stay as they are; each one needs a value the next time it's edited." N is the capped count of records where the attribute is empty ("10,000+" past the cap), or no line when N is 0.
- **AC-262**: After a rule is saved, or "Recount" is pressed, a background count runs and the rule shows "N records don't meet this rule yet" with up to 20 of them as record chips (which open the record panel, `?record=<id>`, once spec 0014's milestone 3 has built it; plain chips before), or "Every record meets this rule", with "Counted <relative time>". While it runs the rule shows "Counting…". It counts only records the admin who started it may see. Every admin with the settings open sees the result within 1 second of the count finishing.
- **AC-263**: The OptionsEditor's Archived group shows "Held by N records" beside each archived option (spec 0012 left this to #14), from one grouped count per attribute, capped at "10,000+".

*Type changes*
- **AC-264**: In AttributeSettings an owner or admin sees "Change type", which offers exactly the targets the allowed changes table lists for the attribute's type (switching Allow multiple goes through the same flow). The primary attribute, system attributes, computed attributes, and personal name, file, interaction, timestamp and record reference attributes show "This type can't be changed" with the reason; a direct call is refused 422 `TYPE_CHANGE_REFUSED` with the same reason. Archived attributes can't be changed.
- **AC-265**: Choosing a target starts a check of every value in the background, and the dialog shows "Checking N values…" with a progress bar, then the preview: how many values stay as they are, convert, get reformatted, keep only part of their items (the first item, or the items that match an option), and can't convert (and so will be empty); up to 100 examples shown before and after through the field set, each value that can't convert with its reason; and every consequence (rules that will be removed, Unique turned off, the default converted or cleared, how many records will be empty while Required is on). On a million values the preview appears within 2 minutes. The counts say "As of <time>". A preview left unconfirmed for 1 hour expires, and Confirm then answers 409 `CONVERSION_EXPIRED` "This preview is more than an hour old. Check the values again."
- **AC-266**: Text to Select, Multi select or Status makes one option per distinct value (trimmed, ignoring case; for Multi select each value is split on commas, semicolons and line breaks first). The 500 most common become options (ties by the first record that holds them, in id order), labelled as first seen, with hues in `HUES` order; values longer than 100 characters, and the rest past 500, can't convert. In the preview the admin renames, recolours, merges ("Merge into…") and leaves out options, and every count and example updates at once without checking the values again.
- **AC-267**: After Confirm the change runs as a background job. Everyone sees it live: the column header shows "Changing to <Type>" with progress, and the attribute's settings row the same. Values stay readable and editable in the old type while it runs, and no edit made during it is lost. Every other change to the attribute's definition (title, flags, options, rules, archive) and archiving its object is refused 409 `ATTRIBUTE_CONVERTING` "<Title> is changing type. Try again when it's done." Cancel, before the switch, ends the job and leaves everything people can see as it was.
- **AC-268**: The switch to the new type is one short transaction, under 1 second on the million record run. Within 1 second of it (p95, measured by Playwright as AC-38 is), every open table, cell editor, filter and create dialog uses the new type, through one `definitions` event and one coarse `records` event for the object. A test with concurrent writers before, during and after the switch finds every edit in the result.
- **AC-269**: After the switch a finishing job rewrites, as versions set by the system, the values that had to be reformatted, trimmed or emptied, without moving any record's `updated_at` and without running rules. Until it finishes, every read shows those values already converted. It can't be cancelled. If it fails after its retries, the attribute shows "Finishing the type change failed." with Retry for owners and admins.
- **AC-270**: Nothing is lost. A value's history before the switch shows it in its old type, values as of a moment before the switch read in the old type, and time in stage counts visits from before a select became a status. Every value that couldn't convert is listed for 30 days in "Values that didn't convert" (the record, its old value through the old type's display, and the reason), 50 at a time, for owners and admins.
- **AC-271**: Across a change: Required stays; Unique turns off (the preview says so, and turning it back on runs the usual duplicate check); the default is converted, or cleared when it can't be; a Currency target takes a default currency chosen in the dialog; rules whose kind doesn't fit the new type, or whose condition no longer parses for it, are removed and listed in the preview; Select to Status gives every option the outcome Open; Status to Select keeps the options and drops their outcomes and target times.
- **AC-272**: For 30 days after its switch, the latest type change of an attribute can be undone from its settings ("Undo type change"), through the same check and preview. Values nobody changed since go back exactly as they were; values changed since convert back by the converters, and those that can't are listed; removed rules and the old default come back; options the change made are archived. After 30 days, or once a later change exists, the action is gone and a direct call answers 409 `UNDO_EXPIRED` "Type changes can be undone for 30 days. This one was on <date>."
- **AC-273**: A relationship side that holds one record can be widened to hold many (one to one to one to many, many to one or many to many; one to many or many to one to many to many) through the same flow, with no link changed. Its undo narrows it back only when no record holds more than one link on that side; otherwise the preview shows how many do, with examples, and Confirm is disabled. While a narrowing runs, link writes on that relationship are refused `ATTRIBUTE_CONVERTING`.
- **AC-274**: On the local capped seed (owner decision: scale proofs run locally), a text attribute with 12 distinct values on 1,000,000 deals converts to Select with its check finished within 2 minutes, the whole change within 10 minutes of Confirm and the switch under 1 second, while the `steady` mix of 100 members (spec 0011) stays inside its budget (read 300 ms, edit 250 ms at p95). A change where every value must be rewritten (a text attribute holding phone numbers in mixed formats, to Phone) is measured and recorded, not judged. Results go in `verify.md`.
- **AC-275**: Nothing here runs on a timer while the app is idle: every job starts in the transaction of the write that asks for it, and the worker is woken by the API's nudge (spec 0008). The browser follows jobs by `jobs` events, never by polling. An expired preview is found when it is next read, never by a timer.
- **AC-276**: Hidden means absent: examples, counts, the "Values that didn't convert" list and the rule count's example records include only records and fields the person may see; refusal messages follow AC-256. Every write here needs `schema.manage` (spec 0009 AC-135) and answers 403 `FORBIDDEN` without it; reading a conversion or its list needs it too.
- **AC-277**: The jobs show on Settings, Background jobs (spec 0008) as "Checking values for a type change", "Changing a type", "Finishing a type change" and "Counting records against a rule", with progress, counts and the failure message, and the starter gets spec 0008's finish toast.
- **AC-278**: The new codes join `ENGINE_REFUSAL_CODES` and `ERROR_MAP`: `VALIDATION_FAILED` 422, `TYPE_CHANGE_REFUSED` 422, `ATTRIBUTE_CONVERTING` 409, `CONVERSION_EXPIRED` 409, `CONVERSION_SWITCHED` 409 ("The type has already changed. Use Undo instead.") and `UNDO_EXPIRED` 409, each with the message given here, in the `{ code, message, data? }` shape.
- **AC-279**: `toText`, `fromText` and `convertValue` live in `packages/contracts` and are the only converters: the grid's copy and paste (spec 0003) and the type change both call them, and the field set's browser tests still pass unchanged. A table driven test runs every allowed change on sample values of every kind (empty, multi valued, edge cases) and checks each outcome.
- **AC-280**: Every new screen part is built from tokens and library components only (ChangePreview pulled forward from spec 0003's milestone 4), works fully by keyboard with a visible focus ring and focus returned after each dialog, meets contrast in light and dark, and loads lazily so the first load stays under 250 kB.
- **AC-281**: Each milestone runs in production on `brij-crm-phi.vercel.app`, proven with two browsers: a rule refusing a save in one while the other sees the rule appear, and a type change seen live in both.

## Decision

**Chosen option**: Option 1: rules as definition rows checked by one pure function under the record lock, and type changes converted in place behind a short switch, with a finishing pass for the values that can't share their row.

Rules live in a `validation_rules` table and travel inline with each attribute; `runWrite` runs the touched ones under the record lock, and the browser runs the same function first. A type change is a ledger row plus three jobs: a check that previews, a convert job that fills the new type's columns on the same current value rows and switches the definition in one short transaction, and a finishing job that writes versions only for values that had to change form.

Decisions taken from the brief and the owner decisions, recorded here so they can be confirmed:
- **Schema changes are admins only** (owner decision): rules, Required, type changes and undo need `schema.manage`.
- **Server authority, browser first** (brief): one checker in contracts, run by both.
- **Never retroactive** (brief): rules check only touched values; existing data is counted, never refused.
- **No bypass** except restore, the type change jobs and computed writes (brief, plus spec 0015's computed values, which can't have rules).
- **RE2 semantics through `re2js`** (recommendation): a pure JavaScript port of RE2, linear time, the same engine in the browser and on the server. Runner up: the native `re2` package, which can't run in the browser.
- **Unique turns off on any type change** (recommendation): new keys can repeat where old ones didn't ("042" and "42" both become 42), and keeping both key sets live at once can't fit one column. The admin turns Unique back on after, through the existing duplicate check.
- **The conversion matrix** below (brief, made exact here).
- **Values that can't share their row are finished after the switch** (recommendation): reformatted, trimmed and emptied values become system versions after the switch, while reads convert them on the fly. This keeps the switch short and keeps anything people see from changing before they confirmed it had.
- **Cardinality widening here, narrowing only as undo** (recommendation, see open questions).
- **Lists come later**: rules and type changes cover object attributes; #51 extends both to list attributes.

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `db-core` and `react-db` (`tanstack/db`, `.claude/skills/db-core/`, `.claude/skills/react-db/`) · `react-aria` (`.claude/skills/react-aria/`) · `stories` (`.claude/skills/stories/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #10 core loop (spec 0005) | the record procedures, the data layer's optimistic writes with cell errors and toasts, the outbox | none: milestone 1 starts after #10's milestone 3 |
| #13 objects and attributes (spec 0012) | AttributeSettings, OptionsEditor, `attributes.update`, the Attributes tab, the definitions store with options inline | none: milestone 1 starts after spec 0012's milestone 3. This spec removes its "Changing the type comes later." note |
| #9 access model (spec 0009) | `schema.manage` on definition writes, `fieldLevel` and the record rule for hidden means absent | if spec 0009's milestone 1 hasn't landed, spec 0012 builds its thin role (as it says); field and record rules apply once they exist, through the engine choke points this spec uses |
| #8 background jobs (spec 0008) | the runner, `startJob`, the kind contract, `data.jobs`, the Background jobs page, the daily cleanup | none: a hard dependency from milestone 3 (the rule count and every type change job). Milestones 1 and 2 need no job |
| #6 client data (spec 0006) | the definitions store, `RecordView.versions`, coarse event coalescing | the definitions store is built by spec 0012's thin slice if spec 0006 hasn't landed; nothing else here is needed before it |
| #7 realtime (spec 0007) | `definitions` events per object, coarse `records` events | spec 0012's thin slice of widened `definitions` rows is enough |
| #15 relations (spec 0014) | `relationships`, the stored reference sort keys and `syncReferenceKeys`; the record panel for AC-262's chips | AC-273 needs spec 0014's milestone 4, so task 17 waits for it even though #15 sits after #14 in the scope order; everything else here ships without #15 (AC-262's chips stay plain until the panel exists) |
| #12 load harness (spec 0011) | the `steady` scenario for AC-274 | if `packages/load` doesn't exist, AC-274's budget line runs the existing `bench-scale.ts` read and edit grid during the conversion instead, and says so in `verify.md` |

### Rule kinds

Each rule may also carry a condition (Only when…, the same limited FilterBuilder as Required When); a generated message then ends with " when <summary>". Rules check every item of a multi valued attribute; one bad item fails the rule.

| Kind | Types | Settings (`RuleParams[kind]`, Zod in contracts) | Generated message |
|---|---|---|---|
| `required_when` | every editable type but checkbox | the condition (required); at most one per attribute | "<Title> is required when <summary>." |
| `length` | text, long text | `min?`, `max?` characters (1 to 500 for text, 1 to 10,000 for long text), at least one | "<Title> needs at least <min> characters." / "<Title> can have at most <max> characters." / "<Title> needs <min> to <max> characters." |
| `pattern` | text, long text, email, URL, domain | `preset`: `digits` (`[0-9]+`), `letters` (`[\p{L} ]+`), `letters_digits` (`[\p{L}\p{N} ]+`), `no_spaces` (`\S+`), `starts_with` or `ends_with` (`text`, 1 to 100 characters, matched literally), or `custom` (`regex`, 1 to 200 characters); `ignoreCase` boolean | "<Title> can only contain digits." / "…only letters." / "…only letters and digits." / "<Title> can't contain spaces." / "<Title> must start with "<text>"." / "<Title> must end with "<text>"." / "<Title> isn't in the required format." |
| `email_domain` | email | `mode` (`allow` or `block`), `domains` 1 to 50 (`DomainValue`) | allow: "<Title> must be an address at <d1>, <d2> or <d3>." (past three: "at one of the <n> allowed domains"); block: "<Title> can't be an address at <the value's domain>." |
| `phone_country` | phone | `countries` 1 to 50 (`COUNTRY_CODES`) | "<Title> must be a number from <country>, <country> or <country>." (past three: "from one of <n> countries"); names from `Intl.DisplayNames('en', { type: 'region' })` |
| `range` | number, currency (the amount, whatever its code), rating | `min?`, `max?` (`Decimal`; rating 1 to 5), at least one | "<Title> must be at least <min>." / "…at most <max>." / "…between <min> and <max>." (numbers as canonical decimals) |
| `integer` | number | none | "<Title> must be a whole number." |
| `currency_in` | currency | `codes` 1 to 20 (`CURRENCY_CODES`) | "<Title> must be in <USD>, <EUR> or <GBP>." (past three: "in one of <n> currencies") |
| `date_range` | date | `min?`, `max?`, each `{ date: DateValue }` or `{ daysFromToday: -36,500 to 36,500 }`, at least one | "<Title> must be on or after <8 October 2026>." / "…on or before…" / "…between … and …"; an offset reads "today", "<n> days from today" or "<n> days before today" |
| `count` | any attribute with Allow multiple (multi select, email, phone, URL, domain, member) | `min?`, `max?` items (1 to 100), at least one | "<Title> needs at least <min> values." / "<Title> can hold at most <max> values." / "<Title> needs <min> to <max> values." |

Settings refusals (422 `CONFIG_INVALID`, on the named field): "The smallest value must not be above the largest." (`min` over `max`), "Give at least a smallest or a largest value." (neither), "Text holds at most 500 characters." and the like for bounds outside the type's limits, "That pattern can't be used: <reason>." (RE2), "Keep the pattern to 200 characters.", "Add between 1 and 50 domains." (and countries), "Conditions can only use this object's own attributes.", "A condition holds at most 10 conditions, nested at most 2 deep."

**The summary** (`summarizeCondition` in contracts): one condition reads "<attribute title> <operator phrase> <operand as text>" ("Stage is Won", "Close date is empty", "Value is at least 10000"), with the operand through `toText`; two or three conditions are joined by "and" or "or" as their group says; more than three, or any nested group, reads "its conditions are met". An attribute hidden from the person reading the message reads "another field", and its operand is left out. Operator phrases are the field set's operator labels (spec 0003's `operators.ts`, moved to contracts with the converters).

**Dates in messages**: `formatDay(iso)` in contracts, `Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })` ("8 October 2026"). The app's copy is English.

### Data model sketch

Migration A (milestone 1) and migration B (milestone 3). Every new table has `workspace_id` first in every key, composite foreign keys, forced row level security with the standard policy, and joins both guard tests.

| Table | Change | Rules |
|---|---|---|
| `validation_rules` (A) | new: `id` uuid v7 (client chosen), `object_id`, `attribute_id` (the attribute it checks), `kind` enum `validation_rule_kind`, `params` jsonb not null (`RuleParams[kind]`), `condition` jsonb null (`RuleCondition`: a `FilterGroup` with no `through`, at most 10 leaves, depth 2), `message` text null (1 to 200), `position` smallint, `version` integer default 1 (bumped when kind, params or condition change), `breaking_count` integer null, `breaking_sample` uuid[] null (at most 20), `counted_at` timestamptz null, `counted_version` integer null, `counted_by_member_id` uuid null, `created_*`, `updated_*` | primary key (`workspace_id`, `id`); FKs to `objects` and `attributes`; index (`workspace_id`, `object_id`, `attribute_id`, `position`); partial unique (`workspace_id`, `attribute_id`) where `kind = 'required_when'`. Rules are hard deleted (they are definitions; the outbox event records the change) |
| `attributes` (A) | new `rule_count` smallint not null default 0, `rules_version` integer not null default 0 | `rule_count` is the number of rules on the attribute plus the number of other rules whose condition names it; `rules_version` goes up by 1 whenever one of those rules is created, changed or deleted. Both are kept by the rule writes in the same transaction, so a write to an object with no rules makes no extra query |
| `attributes` (B) | new `conversion_id` uuid null, FK to `attribute_conversions` | set while a conversion of the attribute is unfinished (checking to finishing); see the child spec |
| `attribute_conversions`, `conversion_values`, `conversion_misses` (B) | new | see [0013-type-changes.md](0013-type-changes.md) |
| `outbox` | none | rule and conversion writes are `definitions` changes for their object |

**Write paths** (`packages/core/src/engine/`, changed):
- `loadAttributes` returns `ruleCount` and `conversionId` on `AttributeDef`.
- `loadRules(tx, objectId)` (new, `packages/core/src/validation/rules.ts`) reads the object's rules once per write, kept on the `WriteContext` beside `activeMembers` (a new `rules` map by object), and only when some attribute of the object has `ruleCount > 0`.
- `updateRecord` and `insertRecord` (in `records.ts`) run, after `parseAll` and before `writeAll`: pick the touched rules; read the current values of any attribute a touched rule needs that the write doesn't set (`currentItems` for the one owner, plus `linkValues` for a record reference in a condition); merge; call `checkRules`; refuse `VALIDATION_FAILED` with every failure. This is under the record lock `lockOwner` already took.
- `holdDefinitions` also takes its key share lock on the definition rows of every written attribute that has `ruleCount > 0` or a `conversionId`, and starts the write again (`writeConflict`) if that attribute's `rules_version`, `type`, `is_multi` or `conversion_id` changed since it was loaded, so a rule saved, or a type switched, at the same moment is either seen or waited for. Rule writes and the type switch take the attribute rows they change `for update`, as Unique already does.
- `restoreRecord` and the type change jobs' writes skip rules; spec 0015's computed writes never reach `updateRecord`.

### API surface

oRPC on `/api/rpc`, each through the `member` door; every write takes a `mutationId`, is composed with `writeHooks` (spec 0005), stores one outbox row, and nudges the worker (spec 0008). Refusals answer `{ code, message, data?: { refusals } }`.

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `attributes.create`, `attributes.update` (changed, spec 0012) | adds `required?`: `{ mode: 'never' }`, `{ mode: 'always' }` or `{ mode: 'when', ruleId, condition, message? }`; `rules?`: `ValidationRuleInput[]` (`id` uuid v7, `kind`, `params`, `condition?`, `message?`; array order is the position; the list replaces the attribute's rules, rules left out are deleted). `required` takes the place of spec 0012's `isRequired` input; a call sending both is refused 400 `INPUT_INVALID` | AttributeDefinition | `schema.manage` | 403; 404; 409 `LIMIT_REACHED`, `ATTRIBUTE_CONVERTING`; 422 `CONFIG_INVALID` |
| `attributes.list` (changed) | as spec 0012 | each AttributeDefinition adds `validation`: `{ required: 'never' \| 'always' \| 'when', rules: ValidationRuleView[] }` (`id`, `kind`, `params`, `condition?`, `message?`, `position`, `breaking?`: `{ count, sampleIds, countedAt, counting }`) and `conversion?` (child spec) | member | 404 |
| `records.create`, `records.setValues`, `records.setValuesBatch` (changed) | add `timeZone?` (IANA, the browser's; UTC when absent) | as before | member | adds 422 `VALIDATION_FAILED` |
| `validation.recount` | `workspace`, `ruleId`, `mutationId` | `{ jobId }` (the unfinished count job for the rule if one exists) | `schema.manage` | 403; 404 |
| `options.usage` | `workspace`, `attributeId` | `{ [optionId]: { count, atLeast } }` for the attribute's archived options | member | 404 |
| type change procedures | see the child spec | | `schema.manage` | |

`ValidationRuleView` leaves out, for each viewer, any rule whose condition names an attribute hidden from that viewer, and `breaking.sampleIds` keeps only records that viewer may see. The server still enforces every rule.

**The `VALIDATION_FAILED` answer**: `message` is the single failure's message, or "<n> rules aren't met." for several; `data.refusals` holds one refusal per failing rule (`code` `VALIDATION_FAILED`, `message`, `attributeId`, `ruleId`), in attribute position, then rule position.

**Status codes**: as spec 0005 and spec 0012, plus 422 `VALIDATION_FAILED`, 422 `TYPE_CHANGE_REFUSED`, 409 `ATTRIBUTE_CONVERTING`, `CONVERSION_EXPIRED`, `CONVERSION_SWITCHED`, `UNDO_EXPIRED`. `ApiRefusal` gains `ruleId?`.

### The checker (`packages/contracts/src/validation/`)

```ts
/** Every rule a write touches that it breaks, in attribute position then rule position. Pure: no clock, no I/O. */
export function checkRules(input: {
  readonly rules: readonly ValidationRule[];
  readonly attributes: ReadonlyMap<string, RuleAttribute>;   // id → { type, isMulti, title, position, visible, archived }
  readonly values: Readonly<Record<string, unknown>>;         // the record after the write: current values merged with the write's
  readonly written: ReadonlySet<string>;                      // attribute ids the write sets (every attribute on a create)
  readonly clock: { readonly now: string; readonly timeZone: string; readonly weekStart: 'monday' };
  readonly actorMemberId?: string;                            // for "is me"
  readonly pattern: (source: string, ignoreCase: boolean) => { test(text: string): boolean };
}): readonly RuleFailure[];                                   // { ruleId, attributeId, message }
```

- `matchesCondition(group, values, attributes, clock, actorMemberId)` evaluates a same record condition. It agrees with the engine's reference evaluator (`packages/core/src/engine/query/evaluate.ts`) on every operator of every type; a test runs both on the same samples.
- A condition on an archived attribute treats that attribute as empty, and its settings row says "Uses <title>, which is archived".
- `pattern` is injected: the server passes `re2js` (`packages/core/src/validation/pattern.ts`, the only importer on the server), the browser passes it from a lazy import in `packages/data`. The checker wraps a custom pattern as `^(?:<pattern>)$` and compiles each distinct pattern once per call.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| rule write | who may | `can(scope.access, 'schema.manage')` (spec 0009) in the definition write |
| rule write | rule id, position | the client's uuid v7 (kept across edits); the index in the `rules` input |
| rule write | `version` | 1 at create, plus 1 when `kind`, `params` or `condition` change; message changes don't bump it |
| rule write | `rule_count` | the rules on the attribute plus the rules naming it in their condition, recounted in the same transaction |
| rule write | the 20 rule limit | `LIMITS.rulesPerAttribute` = 20, new in `packages/core/src/engine/limits.ts` |
| rule write | a pattern's validity | `re2js` compiling the wrapped pattern on the server |
| any record write | which rules run | the touched rule test (AC-255) over `loadRules` |
| any record write | `now` | the database's `now()`, read in the statement that loads the rules |
| any record write | the time zone | the procedure's `timeZone` input (the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`), else `UTC` |
| any record write | the week start | Monday (spec 0006's default until #23 adds a workspace setting) |
| any record write | "is me" | `scope.actor`'s member id |
| any record write | other attributes' values for conditions | `currentItems` for the owner (and `linkValues` for a reference), read under the record lock |
| refusal | the message | the rule's `message`, else the generated message from the rule kinds table |
| refusal | the condition summary | `summarizeCondition` with the writer's visible attributes |
| browser check | the rules | the definitions store's `attributes[].validation.rules` |
| browser check | the record's values | the record store's body; a rule needing an attribute the body doesn't hold is skipped |
| browser check | the clock | `Date.now()` and the browser's time zone |
| Always confirm line | N empty records | `records.count` with `{ attributeId, operator: 'is_empty' }` (`{ count, atLeast }`) |
| rule count | the result | the `validation.count` job: records of the object visible to `counted_by_member_id`'s scope, checked by `checkRules` with `written` = the rule's attribute and condition attributes |
| rule count | the clock | the job's batch `now()`, in UTC |
| rule count | example chips | `breaking_sample`, through the record store (`records.get`) |
| rule count | "Counting…" (`breaking.counting`) | an unfinished `validation.count` job whose `dedupe_key` is the rule id, read by `listAttributes` in one query over the object's rules |
| rule count | a result for a changed or deleted rule | discarded: the last batch writes only when the rule still exists with the `version` it counted |
| rule count | "Counted <relative time>" | `counted_at` through RelativeTime |
| archived option counts | N | `select option_id, count(*)` over current, not cleared values of the attribute where `option_id` is archived, grouped, each capped at 10,001 by `limit` per option |
| type change | everything | see the child spec |

### Key invariants

- The server is the authority: no write path but the three in AC-259 reaches the value rows without `checkRules`.
- Rules are checked under the record's row lock against the record's values after the write, so two writes can't each pass a rule the pair breaks.
- A rule never changes or refuses data nobody touched.
- `rule_count` is exact, so skipping the rule load for an object with no rules is safe.
- A rule's message never reveals what the writer can't see.
- At most one Required When rule per attribute; Required Always and Required When never coexist (the write sets one and deletes the other).
- Every definition write here stores exactly one outbox row; a refused one stores none.

### Security model

- Rule, Required and type change writes need `schema.manage`; reads of rules are member level and filtered per viewer (AC-276).
- Patterns run under RE2 semantics (linear time, no backtracking), are at most 200 characters, and run against values of at most 10,000 characters, so no rule can stall a write.
- Messages are plain text, at most 200 characters, rendered as text. An admin's custom message is shown to everyone who edits the attribute; the editor's hint says so.
- The count job runs as the member who saved the rule (`enterAsActor`, spec 0009), so it sees and counts only what that member may.
- `security-access-reviewer` reviews milestones 1, 3 and 4; `state-performance-reviewer` reviews milestones 1 (the write path) and 4 (the scale run).

### Configuration required

No new environment variables. New pinned dependency: `re2js` (the current release at build time, exactly, in the catalog), imported only by `packages/core/src/validation/pattern.ts` and `packages/data/src/validation/pattern.ts`. `packages/core` also takes `libphonenumber-js` (already pinned in the catalog for `packages/ui`) for the server's phone parser, which it passes into `fromText` (child spec).

### Screens and the library

- **AttributeSettings** (library, changed): a Validation section after the type settings. Required is a SegmentedControl (Never, Always, When…); When reveals the FilterBuilder with `allowRelations={false}` (a new optional FilterBuilder prop; without it nothing changes). Below it, the rules list: a `GridList` with drag and keyboard reorder (the existing `reorder.ts`), each row the rule's summary (its generated or custom message) and its count line; "Add rule" is a Menu of the kinds the type allows; a row opens its form in place (the kind's fields through Field, Select, DatePicker or the type's own form editor; "Message" Field with a counter; an "Only when…" Disclosure with the same FilterBuilder); a row menu with Move up, Move down and Delete. Counts: a warning Badge "N records don't meet this rule yet" with the example RecordChips in a Popover, a muted "Every record meets this rule", or a Spinner with "Counting…", and a "Recount" ghost Button. Members see the section read only with no controls.
- **OptionsEditor** (library, changed): an optional `heldBy` prop per archived option, shown as "Held by N records".
- **DataGrid** (library, changed): an optional `columnNote(columnId)` returning `{ label, progress? }`, drawn as a Spinner or a small ProgressBar in the header with the label in a Tooltip; used for "Changing to <Type>, 40%".
- **ChangePreview** (library, pulled forward from spec 0003 milestone 4): presentational; see the child spec.
- Grid and create dialog: refusals land as spec 0005 AC-35 and AC-36 say; `VALIDATION_FAILED` refusals carry their `attributeId`.
- Every string lives in the feature's `strings.ts`; `dxe quick`, `ux-interaction-reviewer` and `design-system-guardian` before each milestone lands.

### Critical test scenarios

- Happy path: an admin adds a pattern rule to Email (`@acme.com` only, as an allow list) and a Required When on Close date (Stage is Won); a member's paste of a gmail address is refused in the browser with the message; a raw call is refused by the server with the same refusal; moving a deal to Won without a close date is refused on the Stage cell naming Close date; a second browser sees the rules appear live, verifies **AC-252**, **AC-254**, **AC-256**, **AC-257**, **AC-260**, **AC-281**.
- Touched and never retroactive: a record breaking the email rule changes its phone fine; a create with every attribute runs every rule; an empty value passes every rule but Required, verifies **AC-255**.
- Settings refusals: each row of the refusals list on its field, verifies **AC-253**.
- Concurrency: a rule saved while a batch of 500 writes runs is either applied to a record or that record was written before it, never half; two writes that each pass a conditional rule alone but break it together on one record leave the second refused, verifies **AC-254**.
- RE2: `(a+)+$` on 10,000 characters under 50 ms; presets and Ignore case; the lazy load seen in `pnpm size`, verifies **AC-258**.
- Bypass walk: every exported write service either runs rules or is on the list, verifies **AC-259**.
- Counts: Always shows the empty count before Save; a rule count job reports N and 20 examples, as the admin may see; a second admin's settings update live; archived option counts, verifies **AC-261**, **AC-262**, **AC-263**.
- Type changes: see the child spec's scenarios, verifies **AC-264** to **AC-275**, **AC-279**.
- Permission and hidden: a member's rule write and every type change procedure get 403 with no outbox row; with rules injected (spec 0009), a hidden field never appears in a summary, an example list or a misses list, verifies **AC-276**.
- Quality: keyboard only runs of the Validation section and the type change dialog, axe and contrast in both themes, `pnpm size`, verifies **AC-277**, **AC-278**, **AC-280**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 starts after spec 0012's milestone 3; milestone 3 needs spec 0008's milestone 2 (snapshot, coalescing and retries) and its daily cleanup from milestone 3.

**Milestone 1: rules, one strand through every layer, then every kind**
1. Contracts: `RuleParams`, `RuleCondition`, `ValidationRuleInput`, `ValidationRuleView`, `checkRules`, `matchesCondition`, `summarizeCondition`, `formatDay`, the generated messages, `VALIDATION_FAILED` and `ruleId` on `ApiRefusal`; the agreement test against the engine's reference evaluator, satisfies **AC-253**, **AC-255**, **AC-256**, **AC-278**
2. Migration A: `validation_rule_kind`, `validation_rules`, `attributes.rule_count`; guard tests, satisfies **AC-252**
3. Engine: rule writes inside `insertAttribute` and `updateAttribute` (replace semantics, versions, `rule_count`, the 20 limit in `limits.ts`, `schema.manage`, the settings checks with `re2js`), `loadRules`, the touched rule check in `updateRecord` and `insertRecord`, `holdDefinitions` widened; the length rule first through every layer, then every kind; the bypass walk test, satisfies **AC-252** to **AC-255**, **AC-258**, **AC-259**
4. Procedures: `attributes.create` and `attributes.update` with `rules`, `attributes.list` with `validation` filtered per viewer, `timeZone` on the record writes, satisfies **AC-252**, **AC-254**, **AC-276**
5. Data layer: rules from the definitions store, `checkRules` before every create and edit with the lazy `re2js`, refusals on fields and cells, satisfies **AC-256**, **AC-257**, **AC-258**
6. Library: AttributeSettings' Validation section (the rules list and forms, without Required When yet), FilterBuilder's `allowRelations`; stories, README, guardian, artifact publish, satisfies **AC-252**, **AC-280**
7. Deploy; Playwright with two browsers (a rule refusing a paste, the rule appearing live); `security-access-reviewer`, `state-performance-reviewer`, `ux-interaction-reviewer`, satisfies **AC-254**, **AC-257**, **AC-281**

**Milestone 2: Required When, and what's already empty**
8. Engine and contracts: `required_when` (one per attribute, the Always and When exclusivity, `required` input), relative dates on the write clock, satisfies **AC-260**
9. Screens: Required as Never, Always, When… with the FilterBuilder; the Always confirm line from `records.count`; `options.usage` and "Held by N records" in the OptionsEditor, satisfies **AC-260**, **AC-261**, **AC-263**
10. Deploy; Playwright: a deal refused at Won without a close date, live in a second browser; `ux-interaction-reviewer`, satisfies **AC-260**, **AC-281**

**Milestone 3: type changes (after spec 0008)**
11. The `validation.count` kind and `validation.recount`; counts and examples on rule rows, live, satisfies **AC-262**, **AC-277**
12. Contracts: converters moved from the field set (`toText`, `fromText`, `parseLocaleDate`, `parseLocaleDecimal`, operator labels), `convertValue`, `ALLOWED_CHANGES` and `typeChangeTargets`; the field set calls them; the table driven pair test, satisfies **AC-264**, **AC-279**
13. Migration B and the type change in [0013-type-changes.md](0013-type-changes.md), milestone 3 there: the ledger, the check, the preview, prepare, the switch, finishing, reads during finishing, history by type, the misses list, the cleanup phase, satisfies **AC-264** to **AC-271**, **AC-275**, **AC-276**, **AC-277**, **AC-278**
14. Library: ChangePreview, OptionsEditor's plan mode, DataGrid's `columnNote`; stories, README, guardian, artifact publish, satisfies **AC-265**, **AC-266**, **AC-267**, **AC-280**
15. Deploy; Playwright: text to select on People with two browsers, a cancel before the switch, a value that didn't convert in the list; `security-access-reviewer`, `ux-interaction-reviewer`, satisfies **AC-265** to **AC-270**, **AC-281**

**Milestone 4: undo, cardinality and scale**
16. Undo, as the child spec says, satisfies **AC-272**
17. Cardinality widening and narrowing as undo (after spec 0014's milestone 4), satisfies **AC-273**
18. The million record run and the rewrite heavy run on the local capped seed with the `steady` mix, numbers in `verify.md`; `state-performance-reviewer`, satisfies **AC-274**
19. The full Playwright flow locally and in production; `security-access-reviewer`, satisfies **AC-252** to **AC-281**

## Consequences

**Positive**:
- One checker for the browser and the server means the message a person sees first is the one the server would give.
- Rules cost nothing on objects without rules, and one indexed read on objects with them.
- A type change never blocks work and never loses a value: old values stay in history and the ledger, and undo restores them.
- The converters move to one place, so paste, import (#30) and type changes always agree.

**Negative / tradeoffs**:
- A write that touches a conditional rule reads the condition's attributes under the record lock: one more query on those writes.
- A pattern rule's first check in a browser waits for `re2js` to load (once per session).
- Unique turns off on every type change; an admin who wants it back turns it on again and may meet duplicates the conversion created.
- While a type change finishes, filters and sorts on that attribute read stored columns, so a reformatted, trimmed or emptied value can match a filter by its old form until its rewrite lands (minutes at a million records). Reads always show the converted value.
- The value rows of a converted attribute keep the old type's columns as well, so a converted attribute's rows are a little wider until they are next edited.
- `attribute_conversions` is kept for good, because history before a switch is read through it.
- Cardinality can only be narrowed as an undo, and only when no record breaks it.
- Pulling ChangePreview forward amends spec 0003's milestone 4 again.

**Neutral**:
- Two migrations (A in milestone 1, B in milestone 3), one new dependency (`re2js`), six new refusal codes.
- Four new job kinds join spec 0008's registry.
- `maintenance.daily` gains a phase (child spec).

## Open questions for the owner

- **Narrowing a relationship** (spec 0014 asked #14 for widening and narrowing): narrowing is offered only as the undo of a widening, and only when no record breaks it. Recommended: keep it so; a general narrowing would have to choose which links to drop, which is data loss by design.
- **Unique across a type change**: turned off every time (recommended, see Decision). The alternative keeps Unique when both types are unique capable and the check finds no repeats, at the cost of a second key column on `values` (6 GB at a million records).
- **Currency, location and member to text** keep the text as it reads on the day of the change (a member's name today, "USD 1200.5"). Recommended: yes; the alternative (refusing them) contradicts "anything to text" in the brief.
- **Rule examples**: up to 20 records per rule (recommended). A full list would need a filter that compiles each rule to SQL, which RE2 patterns can't.

## Follow-up

- [ ] **Spec 0012** (`/sync`): AttributeSettings' type note is replaced by "Change type"; the OptionsEditor gains `heldBy` and the plan mode; DataGrid gains `columnNote`; FilterBuilder gains `allowRelations`.
- [ ] **Spec 0003** (`/sync`): ChangePreview moves forward from milestone 4; the converters and operator labels move from the field set to contracts.
- [ ] **Spec 0008**: four new kinds, the `conversions` phase in `maintenance.daily`, and the per phase cancel split (the convert job is cancellable, the finishing job isn't).
- [ ] **Specs 0008 and 0009**: the job entry is named `enterAsJob` in spec 0008 and `enterAsActor` in spec 0009; this spec uses `enterAsActor` and needs the two settled to one name.
- [ ] **#16 (spec 0015)**: a type change of an attribute a computed attribute reads checks it again at the switch (spec 0015 adds that call to the switch).
- [ ] **#20**: saved views whose filters or sorts name a converted attribute with an operator or operand the new type doesn't take show #20's "skipped" warning.
- [ ] **#30**: import uses `fromText` and `checkRules`, so imported rows meet the same rules.
- [ ] **#51**: rules and type changes for list attributes.
- [ ] `re2js` is a new library with no community skill; `/sync` should note in `packages/core/AGENTS.md` that only `validation/pattern.ts` imports it.
