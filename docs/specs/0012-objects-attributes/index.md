# 0012. Objects and attributes: a workspace shapes its own data

**Date**: 2026-10-08
**Status**: Proposed

## Summary

This lets a workspace shape its own data. An owner or admin creates custom objects (Projects, Partners), gives any object attributes of fifteen types, sets options and stages for select and status, marks an attribute required or unique or gives it a default, and renames, reorders, archives and restores objects and attributes; People, Companies and Deals are edited in exactly the same way. Every change reaches every open screen within a second, and members see the settings but can't change them. The engine (spec 0004) already stores all of this, so the work is the settings screens, a dozen small procedures, a few engine fixes and one small migration, built in four visible steps.

## Structure

- [0012-screens.md](0012-screens.md): the settings routes and screens, the object and attribute dialogs, the type picker, the options editor, the grid's entry points, the generic create dialog, and the library modules pulled forward from spec 0003's milestone 4.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As an admin, I want to create an object for something my team tracks (projects, partners), so the CRM fits our work instead of the other way round.
- As an admin, I want to add, edit, reorder and archive attributes of any type on any object, standard or custom, from settings or straight from the table, so the columns match what we need.
- As an admin, I want select and status options I can name, colour, reorder and retire, so a pipeline can change without losing old data.
- As an admin, I want required, unique and default settings, so new records start clean.
- As a member, I want the sidebar, tables and fields to change in front of me when an admin changes the model, so I never work on a stale shape.
- As a member, I want to see how objects and attributes are set up without being able to break them, so I understand the data.
- As the owner of this product, I want every object and attribute count to pass one limits check, so plans can cap them later in one place.

**Acceptance criteria** (the range reserved for this spec is AC-222 to AC-251):

*Objects*
- **AC-222**: Settings, Objects (`/w/$slug/settings/objects`) lists every live object, standard and custom, in sidebar order, each with its icon tile, plural name, a "Standard" or "Custom" badge and its attribute count, then an "Archived" section. For owners and admins a Meter shows "N of 50 custom objects".
- **AC-223**: "New object" opens a dialog with singular name, plural name, API name (prefilled from the plural name by the same function the server uses, editable until created), icon (IconPicker) and colour (HuePicker). Create waits for the server, then opens the new object's settings, and the object appears at the end of every member's sidebar. It starts with the five system attributes and a text "Name" as its primary attribute. A taken API name shows `SLUG_TAKEN` on that field, a reserved one (`map`, `list`, `new`, `settings`, `attributes`, `configuration`, which are route segments) `CONFIG_INVALID` on that field, a taken name `NAME_TAKEN` on its field, and the 51st custom object `LIMIT_REACHED` in the dialog naming the limit.
- **AC-224**: An object's Configuration tab changes its singular and plural names, icon and colour, for standard and custom objects alike. The API name shows read only with a copy button; no procedure can change it after create. Names are unique per workspace, ignoring case, archived objects included.
- **AC-225**: Objects reorder in the settings list by drag and by keyboard (the row menu's "Move up" and "Move down"). The order is the workspace's: every member's sidebar follows it.
- **AC-226**: Archiving an object (standard ones included) asks to confirm, saying how many records it holds and that they are kept. The object leaves the sidebar, every picker and the create flows; its records, values and history stay untouched. The relationship attributes on other objects that point to it are treated as archived while it is (left out of tables, dialogs and filters, refused for writes), without their own rows changing. Restoring it from the Archived section (`objects.restore`) brings all of it back unchanged. Its URL shows "<Plural> is archived" and, to admins, "Restore". `/` opens the first live object by sidebar order, or Settings, Objects when none is live.

*Attributes*
- **AC-227**: An object's Attributes tab lists its attributes by position: the editable ones (draggable), then a read only "System" section, then "Archived". Each row shows the type's icon and label, the title, and badges for Required, Unique and Default. For owners and admins a Meter shows "N of 250 attributes".
- **AC-228**: The type picker offers exactly fifteen entries, in this order: Text, Long text, Number, Currency, Date, Checkbox, Select, Multi select, Status, Rating, Email, Phone, Link, Location, Member. Multi select is a select with `isMulti`. Member, Email and Phone show "Allow multiple". Domain, personal name, timestamp, interaction, file and record reference are not offered. AttributeSettings takes an optional `relationshipEntry` prop: when #15 passes it, the picker adds "Relationship" as a sixteenth entry, and choosing it hands over to #15's RelationshipSettings in the same Modal. Without the prop there is no entry and no placeholder.
- **AC-229**: Creating an attribute of any of the fifteen types adds it at the end of the object's attributes and as the last column of every open table of that object, for every member. The dialog takes the title, API name (prefilled, editable until created), description, Required, Unique (shown only for text, number, email, phone and link), Allow multiple where offered, a default, and the type's own settings.
- **AC-230**: Type settings: Number takes plain or percent; Currency requires a default currency code; Rating is fixed at 1 to 5 with no settings; Select, Multi select and Status take options in the dialog before create. A new Status starts with three stages: "Not started" (open, gray), "In progress" (open, blue), "Done" (won, green), editable before create.
- **AC-231**: The same AttributeSettings dialog edits an attribute, opened from its settings row, from its column header menu, or by `?attribute=<id>` on the object's Attributes tab, so other screens (the schema map, #56) can link straight to it. Closing the dialog removes the param; an id that is unknown, hidden from the viewer or on another object clears the param and opens nothing. A relationship attribute opens #15's RelationshipSettings in edit mode instead. The dialog changes the title, description, Required, Unique, the default, the type's settings and the options. The type, Allow multiple and the API name show read only. System attributes open read only; the primary attribute can't be archived.
- **AC-232**: Attributes reorder in settings by drag and by keyboard. Their order is every table's default column order, for every member; moving a column in the grid changes only that view (#20), never this order.
- **AC-233**: Archiving an attribute (standard ones included) asks to confirm. It leaves every table, dialog and filter for everyone; its values and history stay. It shows under Archived with "Restore", which brings it back at its old position. Restoring a unique attribute whose values now repeat is refused `UNIQUE_HAS_DUPLICATES` (worded as spec 0009 AC-144 says). `attributes.archive` and `attributes.restore` act on both ends of a relationship in the same write, return every definition they changed (an array: one attribute, or both ends), and store one `definitions` outbox row per object touched. Restoring either end while the other end's object is archived is refused `NOT_FOUND` with "Restore <Plural> first."
- **AC-234**: Defaults are set with the type's own editor from the field set. Member offers "Current user" or a chosen member; Date offers a fixed date or "Today + N days" (N from 0 to 3,650). A create that leaves the attribute out gets the default; a cleared default gives nothing.
- **AC-235**: Required refuses a create without a value and refuses clearing it (`VALUE_REQUIRED`); records already empty stay as they are. Turning Unique on while duplicates exist is refused `UNIQUE_HAS_DUPLICATES` and changes nothing; once on, two records can't share a value.

*Options*
- **AC-236**: The OptionsEditor adds an option (label, and the next hue in `HUES` order after the last option's, changeable), renames, recolours, reorders by drag and keyboard, archives and restores. Archived options sit muted in their own group, still show on the values that hold them, and are refused for new values (`OPTION_ARCHIVED`). Status options also take an outcome (Open, Won, Lost) and an optional target time in days. A label already used by a live option of that attribute is refused on the label. Archiving an option that is the attribute's static default is allowed and keeps the stored default, as the engine already does (spec 0004's fix in `c435302`): while it is archived, a create that leaves the attribute out gets the first live option when the attribute is required and no value otherwise. The Default badge then reads "Default archived", the dialog's default field says what new records get, and restoring the option brings the default back.
- **AC-237**: An attribute holds at most 500 live options. Adding the 501st, or restoring an archived option while 500 are live, is refused `LIMIT_REACHED`. (Today a restore skips the check; this fixes it.)
- **AC-238**: In a select, multi select or status cell, typing a label no live option has offers "Create "<label>"" to owners and admins only. Choosing it sends one `records.setValues` whose value names `{ newOption: { id, label } }`: the server creates the option (the next hue; a status option is Open) and sets it on the record in one transaction, so both happen or neither. The cell shows the label at once and rolls back on a refusal (the 500 limit, `FORBIDDEN`), which shows on the cell; no option is left behind. If a live option with that label (ignoring case) appeared meanwhile, the write sets it and creates none. Members never see the offer, and a member's `newOption` is refused 403 `FORBIDDEN` (spec 0009 AC-136).

*Everywhere*
- **AC-239**: Every type renders through its one shared field design: the grid, the create dialog, the default editor and the settings badges read the field set registry (spec 0003) and nothing else. A test walks the fifteen picker entries and renders each in all three places.
- **AC-240**: Any live object has a table at `/w/$slug/objects/$object` exactly like People's (windows, inline edit, live), with "New <singular>" in the top bar. The create dialog shows the primary attribute, then every required attribute, then "Add more fields", which reveals the rest in attribute order; defaults are prefilled and refusals show on their fields.
- **AC-241**: Every definition change (an object created, renamed, restyled, reordered, archived or restored; an attribute created, edited, reordered, archived or restored; an option created, edited, reordered, archived or restored) reaches every open screen of the workspace (sidebar, tables, cell options, record chips, create dialogs, settings pages) within 1 second at p95 without a reload, measured by Playwright in production as AC-38 is. Record chips read their object's icon and hue from the definitions store by `objectId`, never from the record's body, so restyling an object restyles every chip of it.
- **AC-242**: Every write here needs `schema.manage` (spec 0009 AC-135). A member gets 403 `FORBIDDEN` and nothing is written, and no outbox row is stored. Members open the settings pages read only: no create, edit, reorder or archive controls, and no "+" column or schema items in the column menu.
- **AC-243**: Every count goes through the one limits module (`packages/core/src/engine/limits.ts`): at most 50 custom objects per workspace, 250 attributes per object, 500 live options per attribute. Archived objects and attributes keep counting; archived options don't. `usage.get` reads the same counts the checks use, through the same access filter as `objects.list` (spec 0009's `objectLevel`): an object the caller can't see is absent with its counts, a per object count counts only attributes the caller can see, and the custom object count is answered only with `schema.manage`. Until #24 adds rules these equal the limit counts. Two concurrent creates at a limit leave exactly one.
- **AC-244**: Creating an object, an attribute or an option takes a client minted uuid v7 `id`. Repeating the same create after a lost answer returns the row already made and writes nothing twice; the same id with a different parent answers `ID_TAKEN`.
- **AC-245**: API names are derived by one function in `packages/contracts` (`toApiSlug`) from the plural name or the title, shared by the dialog, the server, #15's relationship sides and #56's links. An API name the admin types that isn't lowercase letters, digits and underscores starting with a letter, or an object API name on the reserved list (`RESERVED_SLUGS`: `map`, `list`, `new`, `settings`, `attributes`, `configuration`), is refused `CONFIG_INVALID` on that field; a derived object API name on the list gets `_object` appended.
- **AC-246**: Every screen here is built from tokens and library components only, works fully by keyboard (reordering included) with a visible focus ring and focus returned after each dialog, meets contrast in light and dark, and the settings routes load lazily so the first load stays under 250 kB.
- **AC-247**: Every settings screen has its states. Settings, Objects and the Attributes tab show skeleton rows while `objects.list`, `attributes.list` and `usage.get` load (a meter shows a skeleton until `usage.get` answers); a failed read shows an EmptyState error with Retry in place of the table, and the rest of the frame stays usable. The Configuration tab's Save shows busy while it waits, keeps what was typed, and puts each refusal on its field (`NAME_TAKEN` on the name it names, `CONFIG_INVALID` on its field) or else in the form's banner.

## Decision

**Chosen option**: Option 1: settings screens over the engine's existing definition services, with one shared AttributeSettings dialog for create and edit, and one definitions store per workspace refetched by `definitions` events.

The engine already stores objects, attributes and options as rows; this spec adds the procedures, a handful of engine changes (client ids, reorders, object positions, unique object names, archived paired attributes, the option restore check), and the screens. Every write passes spec 0009's `schema.manage` check and the one limits module, and records a `definitions` change so every browser refetches what it holds.

Decisions taken from the brief and the owner decisions (all decided: the owner took the recommended defaults for #11 to #22 on 3 October 2026, and the cross check of 8 October settled the names):
- **Schema changes are admins only** (owner decision; the thin role and `schema.manage` are spec 0009's). This includes creating an option from a cell, which overrides the brief's "allowed for everyone" (spec 0009 records the same).
- **Members see settings read only**: the pages open, the controls don't show.
- **Relationship in the type picker waits for #15**: the picker has no Relationship entry until #15 passes `relationshipEntry` to AttributeSettings with its dialog. No disabled placeholder. Relationship sides get no editable API name: `toApiSlug` derives each from its title.
- **Archived counts against limits**: archived objects and attributes keep their slot, so a restore never fails on a limit and archiving isn't a way round one. Options are the exception: only live ones count, because pipelines retire stages often, and a restore checks room.
- **Archive and restore are separate procedures** (`objects.archive`, `objects.restore`, `attributes.archive`, `attributes.restore`, `options.archive`, `options.restore`). The attribute pair returns an array, since a relationship changes both ends; this spec owns them, and #15 and #56 call them.
- **One reserved list for object API names** (`RESERVED_SLUGS`), since `$object` and the map share route segments with settings.
- **Creating an option from a cell is one write** (`records.setValues` with `newOption`), so a refused value never leaves a stray option.
- **An archived option that is a static default** keeps the default stored, matching the engine's fallback.
- **API names**: derived on the server, editable only in the create dialog, then locked (brief).
- **Attribute order** is the default column order and changes in settings only; a view's own order is #20's (brief).
- **Object order** is a new `objects.position`, the workspace's sidebar order (brief).
- **Archive any object**, standard included; its paired relationship attributes are treated as archived while it is (brief).
- **Object names unique** per workspace, ignoring case, archived ones included (added here, so two "Projects" never sit in the sidebar and a restore never collides).
- **Three starter stages** for a new status attribute: Not started, In progress, Done (brief; labels chosen here).
- **Rating is fixed at 1 to 5**, Number takes plain or percent, Currency a default code (brief).
- **Defaults** come from the type's own editor; Member "Current user", Date "Today + N days" (brief).
- **Turning Unique on runs inside the request** until #8 moves it to a job (spec 0004 already batches it).

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `drizzle` (`.claude/skills/drizzle/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`) · `domain-modeling` (`mattpocock/skills`, `.claude/skills/domain-modeling/`) · `react-aria` (`.claude/skills/react-aria/`) · `building-components` (`.claude/skills/building-components/`) · `stories` (`.claude/skills/stories/`) · `tanstack-router-best-practices` (`.claude/skills/tanstack-router-best-practices/`) · `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

- **#10 core loop**: hard. Milestone 1 here needs #10's milestone 2 (the record procedures, `attributes.list` and `attributes.create`, the data layer's windows and optimistic writes, the People screen and its create dialog). AC-241 needs #10's milestone 3 (the outbox, the relay, the browser subscription). This spec makes the People screen generic over any object and turns its "Add attribute" dialog into AttributeSettings.
- **#9 access model** (spec 0009): hard. Its milestone 1 (`members.role`, `schema.manage` on every definition write, `access.mine`, the sealed scope) lands before this spec's milestone 1, because this spec puts schema writes in front of every member. This spec adds no role column (if #8 lands first it adds the same one, spec 0008). The new procedures each get an access table entry (spec 0009 AC-139).
- **#6 client data** (spec 0006): its definitions store (objects, members, attributes with options inline, one per workspace) is what every screen here reads. Thin slice if spec 0006's milestone 3 hasn't landed when this starts: build that store exactly in spec 0006's shape (`definitions(workspace)`, `useDefinitions`, `useAttributes(objectId)`, options inline on `attributes.list`) with the event rule below, and spec 0006 keeps it. Definition writes stay server confirmed, never optimistic (spec 0005).
- **#7 realtime** (spec 0007): its AC-81 defines widened `definitions` rows. Thin slice if spec 0007's milestone has not landed: `Change.definitions` entries gain an optional `objectId` (absent means the workspace's object list), the outbox hook writes one `definitions` row per object touched and one with no object for object list changes, and the client refetches `objects.list` plus every loaded object's attributes on a row with no object. If `outbox.object_id` is not null today, the milestone 1 migration relaxes it.
- **#8 background jobs**: none needed. Turning Unique on and archiving stay in the request; #8 later moves Unique fills on large objects to a job.
- **#15 relations** (spec 0014): builds on this, not the other way round. It passes `relationshipEntry` to AttributeSettings and mounts its RelationshipSettings there; it calls `attributes.archive` and `attributes.restore` for relationship ends; its sides' API names come from `toApiSlug`. If #15's milestone 1 lands before this spec's milestone 2, it builds `attributes.archive` and `attributes.restore` exactly as named here, and this spec keeps them.
- **Later features that build on this**: #14 (type and multi changes, validation rules, the "N records don't meet this yet" count), #18 (attribute groups, edited in this Attributes tab), #20 (per view column order and saved views skipping archived attributes), #56 (the schema map opens these settings pages).

### Data model sketch

One migration (milestone 1). Everything else is already in spec 0004's tables.

| Table | Change | Rules |
|---|---|---|
| `objects` | new `position` integer not null | Backfilled per workspace by `created_at`, then id, from 0 (template order for standard objects). A new object takes `max(position) + 1` under the workspace counters row lock it already takes. Index `(workspace_id, position)`. `listObjects` orders by `position`, then `created_at`, then id. |
| `objects` | unique indexes `objects_singular_name` on `(workspace_id, lower(singular_name))` and `objects_plural_name` on `(workspace_id, lower(plural_name))` | Archived objects included, so a restore never collides. The migration first lists any workspace with duplicates and stops if it finds one (none expected: only the template and test objects exist). A clash maps to `NAME_TAKEN`. |
| `outbox` | `object_id` nullable, only if it isn't already (thin slice of spec 0007) | A `definitions` row with no object means "refetch the object list". |

No column changes on `attributes` or `attribute_options`: `position`, `archived_at`, `default_value`, `config`, `description`, `outcome` and `target_time_in_stage` exist.

**Read rule, archived by its object**: an attribute is effectively archived when `archived_at` is set, or when it is a record reference whose other end's object is archived. `listAttributes`, `loadAttributes`, the write parser and the query compiler apply that one rule (a shared SQL fragment and a pure check in `packages/core`), so the paired attribute behaves exactly like an archived one without its row changing. In settings it shows under Archived with the reason "Links to <Plural>, which is archived" and no Restore of its own.

**State transitions**:
- Object: `live` ⇄ `archived`. Never hard deleted here.
- Attribute: `live` ⇄ `archived`; also effectively archived while its far object is archived. The primary attribute and system attributes never archive.
- Option: `live` ⇄ `archived`; restore needs room (AC-237).

### Engine changes (`packages/core/src/engine/`)

- `insertObject`, `insertAttribute`, `insertOption` take an optional `id` (uuid v7, `checkId`); a replay with the same id under the same parent returns the existing row, any other clash is `ID_TAKEN` (the `records.create` pattern). `insertAttribute` also takes `options` for select and status (inserted in the same write, counted against the 500).
- `insertObject` sets `position`; `reorderObject(scope, { objectId, position })` and `reorderAttribute(scope, { attributeId, position })` renumber in one statement under the parent row's lock, like `updateOption`'s `renumber`. Attribute reorder renumbers only the non system attributes (archived ones included, so a restore lands where it was), numbered after the system ones.
- `updateOption` with `archived: false` on an archived option calls `checkOptionRoom` first (the bug fix, AC-237).
- `archiveAttribute` and `restoreAttribute` on a record reference act on both ends of its relationship in the same write and return both definitions; a restore while the far end's object is archived is refused `NOT_FOUND` ("Restore <Plural> first.").
- The write parser accepts `{ newOption: { id, label } }` as a select, multi select or status value in `records.setValues`: it checks `can(scope.access, 'schema.manage')` (403 `FORBIDDEN`), takes the attribute row's lock, reuses a live option whose label matches ignoring case, else inserts the option (`insertOption` with the client id, `nextHue`, outcome Open for status) after `checkOptionRoom`, and sets it, all inside the record write's transaction. The `Change` carries both the value and a `definitions` entry for that attribute.
- `checkName` stays at 1 to 100 characters; descriptions get a 500 character check.
- `definitionGuard` maps `objects_singular_name` and `objects_plural_name` to `NAME_TAKEN` (new code, 409) with "An object called <name> already exists."
- Every definition write records `definitions` in its `Change`: `{ objectId, attributeIds }` for attribute and option writes (one entry per object touched, so a relationship's two ends give two), `{}` (no object) for object writes. A reorder records only the moved item. The outbox hook stores one `definitions` row per entry.
- `getUsage(scope)`: the custom object count (`workspace_counters.custom_objects`, only when the scope holds `schema.manage`), each visible object's attribute count (the same non system count `checkAttributeRoom` makes, archived included, counting only attributes `visibleAttributes` keeps), and the limits from `limitsOf(scope)`. Objects at `objectLevel` `none` are left out, as `listObjects` does.
- `listObjects(scope, { includeArchived })` and `listAttributes(scope, objectId, { includeArchived })` (the archived ones for the settings pages only).
- `toApiSlug(text, kind)` (contracts, pure, `kind` is `object` or `attribute`): lowercase, runs of anything but letters and digits become one `_`, trimmed of `_`, prefixed with `x_` when it starts with a digit, cut to 63 characters; an empty result becomes `object` or `attribute`; an object result in `RESERVED_SLUGS` gets `_object` appended. `RESERVED_SLUGS` (contracts): `map`, `list`, `new`, `settings`, `attributes`, `configuration`. `checkSlug(slug, kind)` stays the server's check and also refuses a reserved object API name with `CONFIG_INVALID` ("That API name is reserved.").

### API surface

oRPC procedures on `/api/rpc`, each through the `member` door; every write takes a `mutationId` and is composed with `writeHooks` (spec 0005), and needs `schema.manage` (spec 0009). Refusals answer `{ code, message, data?: { refusals } }`.

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `objects.list` (changed) | `workspace`, `includeArchived?` | ObjectSummary[] now with `position`, `isStandard`, `isArchived`, in `position` order | member | 404 |
| `objects.create` | `workspace`, `id` uuid v7, `singularName`, `pluralName`, `apiSlug?` (derived when absent), `icon`, `hue`, `mutationId` | ObjectSummary | `schema.manage` | 403 `FORBIDDEN`; 409 `SLUG_TAKEN`, `NAME_TAKEN`, `LIMIT_REACHED`, `ID_TAKEN`; 422 `CONFIG_INVALID` |
| `objects.update` | `workspace`, `objectId`, `singularName?`, `pluralName?`, `icon?`, `hue?`, `mutationId` | ObjectSummary | `schema.manage` | 403; 404; 409 `NAME_TAKEN`; 422 |
| `objects.reorder` | `workspace`, `objectId`, `position`, `mutationId` | ObjectSummary[] | `schema.manage` | 403; 404 |
| `objects.archive`, `objects.restore` | `workspace`, `objectId`, `mutationId` | ObjectSummary | `schema.manage` | 403; 404 |
| `attributes.list` (changed) | `workspace`, `objectId`, `includeArchived?` | AttributeDefinition[] (below), options inline (spec 0006) | member | 404 |
| `attributes.create` (changed, from #10) | `workspace`, `objectId`, `id` uuid v7, `title`, `type` (the fifteen picker types), `apiSlug?`, `description?`, `isMulti?`, `isRequired?`, `isUnique?`, `config?`, `defaultValue?`, `options?` (≤ 500: `id`, `label`, `hue`, `outcome?`, `targetTimeInStage?`), `mutationId` | AttributeDefinition | `schema.manage` | 403; 404; 409 `SLUG_TAKEN`, `LIMIT_REACHED`, `ID_TAKEN`; 422 `CONFIG_INVALID` |
| `attributes.update` | `workspace`, `attributeId`, `title?`, `description?`, `isRequired?`, `isUnique?`, `config?`, `defaultValue?` (null clears), `mutationId` | AttributeDefinition | `schema.manage` | 403; 404; 409 `UNIQUE_HAS_DUPLICATES`; 422 `CONFIG_INVALID`, `ATTRIBUTE_READ_ONLY` (system) |
| `attributes.reorder` | `workspace`, `attributeId`, `position`, `mutationId` | AttributeDefinition[] | `schema.manage` | 403; 404; 422 `ATTRIBUTE_READ_ONLY` (system) |
| `attributes.archive`, `attributes.restore` | `workspace`, `attributeId`, `mutationId` | AttributeDefinition[]: every definition changed (both ends for a relationship) | `schema.manage` | 403; 404 (also "Restore <Plural> first." when the far end's object is archived); 409 `UNIQUE_HAS_DUPLICATES` (restore); 422 `CONFIG_INVALID` (primary), `ATTRIBUTE_READ_ONLY` (system) |
| `options.create` | `workspace`, `attributeId`, `id` uuid v7, `label`, `hue?` (next hue when absent), `outcome?`, `targetTimeInStage?`, `mutationId` | Option | `schema.manage` | 403; 404; 409 `LIMIT_REACHED`, `ID_TAKEN`; 422 `CONFIG_INVALID` (label taken, not select or status) |
| `options.update` | `workspace`, `optionId`, `label?`, `hue?`, `outcome?`, `targetTimeInStage?`, `mutationId` | Option | `schema.manage` | 403; 404; 422 |
| `options.reorder` | `workspace`, `optionId`, `position`, `mutationId` | Option[] | `schema.manage` | 403; 404 |
| `options.archive`, `options.restore` | `workspace`, `optionId`, `mutationId` | Option | `schema.manage` | 403; 404; 409 `LIMIT_REACHED` (restore) |
| `records.setValues` (changed) | as #10; a select, multi select or status value may name `{ newOption: { id, label } }` | RecordView | member; `schema.manage` for `newOption` | 403 `FORBIDDEN` (`newOption` without it); 409 `LIMIT_REACHED`, `ID_TAKEN`; as #10 |
| `usage.get` | `workspace` | `{ customObjects?: { used, limit }, attributes: { [objectId]: { used, limit } }, optionsPerAttribute: limit }`, filtered by the caller's access (`customObjects` only with `schema.manage`) | member | 404 |

**AttributeDefinition** (in `packages/contracts`): `id`, `objectId`, `apiSlug`, `title`, `description?`, `type`, `isMulti`, `isRequired`, `isUnique`, `isSystem`, `isPrimary`, `config`, `defaultValue?`, `position`, `isArchived`, `archivedBy?` (`{ objectId }` when its far object is archived), `options?` for select and status: `[{ id, label, hue, position, isArchived, outcome?, targetTimeInStage? }]`, plus spec 0009's `readOnly?`.

**Status codes**: 403 `FORBIDDEN` (no `schema.manage`), 404 `NOT_FOUND` (unknown or hidden object, attribute or option), 409 for conflicts (`SLUG_TAKEN`, `NAME_TAKEN` new, `ID_TAKEN`, `LIMIT_REACHED`, `UNIQUE_HAS_DUPLICATES`), 422 `CONFIG_INVALID` and `ATTRIBUTE_READ_ONLY`, 400 `INPUT_INVALID` for malformed input.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| any write here | who may | `can(scope.access, 'schema.manage')` (spec 0009), checked in the engine's definition writes |
| any write here | actor, `created_at`, `updated_at` | `scope.actor` and the transaction's `now()` (spec 0004) |
| object create | id | the client's uuid v7 (the replay key) |
| object create | API name | `apiSlug` input when given, else `toApiSlug(pluralName, 'object')`; checked by `checkSlug(slug, 'object')`, which also refuses `RESERVED_SLUGS` |
| object create | position | `max(objects.position) + 1` in the workspace, under the counters row lock |
| object create | primary attribute | the engine default: text, "Name", API name `name`, not required |
| object create | system attributes | `SYSTEM_ATTRIBUTES` in `definitions.ts` |
| new object dialog | plural name before it is edited | the singular name plus "s", following it as it is typed |
| new object dialog | default icon and colour | `box` and the first hue in `HUES` not used by a live object, else `gray` |
| attribute create | id, API name | the client's uuid v7; `apiSlug` input, else `toApiSlug(title, 'attribute')` |
| attribute create | position | `max(position) + 1` on its object (`insertAttribute`) |
| attribute create | `isMulti` | Multi select maps to `select` with `isMulti: true`; "Allow multiple" for Member, Email, Phone |
| attribute create | which types the picker offers | `PICKER_TYPES` in `packages/contracts` (the fifteen, in AC-228 order), labels and icons from the field set registry |
| attribute create | which types may be unique | `UNIQUE_TYPES` in the engine, filtered to the picker types (text, number, email, phone, url) |
| status create | starter stages | `STARTER_STAGES` in contracts: Not started (open, gray), In progress (open, blue), Done (won, green) |
| option create | hue when not given | `nextHue(options)` in contracts: the hue after the last option's in `HUES` order, cycling; `gray` for the first |
| option create, cell | the label, the id | what the person typed in the cell editor; a uuid v7 the data layer mints, sent as `newOption` in `records.setValues` |
| option create, cell | which option is set | a live option of that attribute with the same label ignoring case if one exists, else the new one |
| status option | target time | the days field (1 to 365), stored as `P<N>D` |
| default, date | "Today + N days" | `{ kind: 'offset', duration: 'P<N>D' }`, N from 0 to 3,650; resolved by the engine at create in the time zone passed (spec 0004) |
| default, member | "Current user" | `{ kind: 'current_user' }`; a chosen member is `{ kind: 'static', value }` |
| default, other types | the value | `{ kind: 'static', value }` from the type's editor, parsed by `parseAttributeValue` |
| settings, Objects | order and badges | `objects.list({ includeArchived: true })`: `position`, `isStandard`, `isArchived` |
| settings, Objects | attribute counts and the custom object meter | `usage.get` (filtered by the caller's access; the meter only with `schema.manage`) |
| settings, Attributes | rows, sections and badges | `attributes.list({ includeArchived: true })`: `isSystem`, `isArchived`, `archivedBy`, `isRequired`, `isUnique`, `defaultValue` |
| settings, Attributes | the attribute meter | `usage.get().attributes[objectId]` |
| OptionsEditor | the 500 cap | `usage.get().optionsPerAttribute`, against the live options inline |
| archive object confirm | how many records it holds | `records.count` for that object |
| any settings control | whether it shows | `access.mine().permissions` includes `schema.manage` (spec 0009); the server checks again |
| sidebar | objects and order | the definitions store's objects, live only, by `position` |
| `/` | which page | the first live object by `position`, else `/w/$slug/settings/objects` |
| any table | columns and default order | the definitions store's attributes, live and non system, by `position` |
| create dialog | fields shown first | the primary attribute (`objects.primaryAttributeId`), then attributes with `isRequired`, by `position` |
| create dialog | "Add more fields" | the remaining live, non system attributes the field set can edit in a form, by `position` (record references wait for #15) |
| create dialog | prefilled values | each attribute's static default; `current_user` shows the signed in member; offsets show the resolved date; a default naming an archived option shows the first live option (required) or nothing (optional), as the engine resolves it |
| Default badge | "Default archived" | `defaultValue` names an option whose `isArchived` is true in the options inline |
| Attributes tab | which attribute's dialog is open | `?attribute=<id>` in the route's search params, matched against the definitions store's attributes of this object |
| record chips | icon tile and hue | the definitions store's object for the chip's `objectId`, never the record body |
| live | which definitions to refetch | the `definitions` event: with `objectId`, that object's attributes; without, `objects.list` and every loaded object's attributes |
| `UNIQUE_HAS_DUPLICATES` | values or a count | spec 0009's rule (AC-144) |
| settings screens | loading, error, busy | the definitions store's and `usage.get`'s `status` (`loading`, `ready`, `error`) and `retry`; a write's pending state for Save |
| archived paired attribute | its reason | "Links to <far object plural name>, which is archived", from `archivedBy` and the definitions store |

### Key invariants

- Standard and custom objects share every path here; no code branches on `isStandard` except the "Standard" badge.
- API names never change after create; every reference is by id.
- Every count against a limit goes through `limits.ts`, read under the same lock the check takes.
- Definition writes are never optimistic in the browser; they wait for the server, then the store refetches.
- Archiving changes one row (or two, for a relationship) and rewrites no record, value or link.
- An attribute whose far object is archived behaves exactly as an archived one, everywhere, through one rule. Spec 0014 applies the same rule to link writes, search and link reads.
- An object's look (icon, hue, names) has one source on the client: the definitions store. Nothing caches it per record.
- No reserved word is ever an object API name.
- The primary attribute and system attributes are never archived; system attributes are never reordered or edited.
- Every definition write stores one `definitions` outbox row per object it touched (spec 0005's composer); a refused one stores none. A cell's `newOption` write stores its `records` row and its `definitions` row in the same transaction.

### Security model

- Every write needs `schema.manage` in the engine's definition writes (spec 0009 AC-135); the client hides controls but never decides.
- Reads (`objects.list`, `attributes.list`, `usage.get`) are member level and go through spec 0009's filters, so hidden objects and fields stay absent once #24 adds rules; `usage.get` gives no hidden object's id or count, and the custom object total only to `schema.manage`.
- `newOption` in a record write needs `schema.manage` on the server, whatever the cell showed.
- Ids in inputs are uuid shaped and checked inside the workspace; composite keys and forced row level security keep every write in its workspace (spec 0004).
- Labels, names and descriptions are plain text, length checked (1 to 100, descriptions to 500), and rendered as text, never HTML.
- `UNIQUE_HAS_DUPLICATES` follows spec 0009's wording rule.
- `security-access-reviewer` reviews milestones 1 and 2; `state-performance-reviewer` reviews the definitions store and events in milestone 1.

### Configuration required

None new.

### Critical test scenarios

- Happy path: an admin creates "Projects", adds one attribute of each of the fifteen types (select with options, status with the starter stages, currency with a code), sets a default and Required on two of them, creates a project through the generic dialog, reorders and archives an attribute, archives and restores the object; a second browser sees every step within a second (Playwright, locally and in production), verifies **AC-222** to **AC-234**, **AC-240**, **AC-241**.
- Limits: at 50 custom objects the 51st is refused; two concurrent creates at 49 leave 50; archive one and restore it at 50; 500 live options refuse the 501st and refuse a restore; archived attributes still count, verifies **AC-223**, **AC-237**, **AC-243**.
- Replays: each create repeated with the same id returns the same row, one outbox row in total; the same id under another object answers `ID_TAKEN`, verifies **AC-244**.
- Relationship ends: archiving one end returns both definitions and stores one `definitions` row per object; restoring an end while the far object is archived answers "Restore <Plural> first.", verifies **AC-233**.
- Cell option: an admin's `newOption` creates and sets in one transaction (one `records` and one `definitions` row); at 500 live options it is refused and no option exists; a label created meanwhile by someone else is reused; a member's `newOption` gets 403, verifies **AC-237**, **AC-238**.
- Archived default: archive the option a required select defaults to; a create gets the first live option and the badge reads "Default archived"; restore brings the default back, verifies **AC-236**.
- Archived by object: archive Companies; People's Company column, filter and create field are gone, a write to it is refused, a filter on it answers `FILTER_INVALID`; restore brings it back with its links, verifies **AC-226**.
- Unique: turn Unique on with duplicates (refused, nothing changes), then without (on); restore a unique attribute after a duplicate appeared (refused), verifies **AC-233**, **AC-235**.
- Permission: a member's call to each write procedure gets 403 and stores no row and no outbox row; the settings pages render without controls for a member; no "Create option" in a member's select cell, verifies **AC-238**, **AC-242**.
- Names: a taken API name, a taken plural name (any case, archived included), a malformed API name and each reserved object API name refuse on their field; an object named "Map" derives `map_object`, verifies **AC-223**, **AC-224**, **AC-245**.
- Links and chips: `?attribute=<id>` opens the dialog and an unknown id clears the param; restyling Companies changes every company chip in an open People table in a second browser, verifies **AC-231**, **AC-241**.
- Usage under rules: with a hidden object injected through the door's rules, `usage.get` names neither it nor its count, and a member gets no custom object count, verifies **AC-243**.
- States: slow and failing `objects.list`, `attributes.list` and `usage.get` (a fake API) show skeletons, then EmptyState with Retry; a refused Save keeps the typed values with the refusal on its field, verifies **AC-247**.
- Field set: the fifteen picker types each render in the grid, the create dialog and the default editor from the registry, verifies **AC-239**.
- Accessibility: reorder objects, attributes and options by keyboard only; axe and contrast in both themes on every settings screen; first load budget, verifies **AC-225**, **AC-232**, **AC-236**, **AC-246**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production.

**Milestone 1: custom objects, end to end**
1. Migration: `objects.position` with its backfill and index, the two unique name indexes with the duplicate check, `outbox.object_id` nullable if needed; guard tests rerun, satisfies **AC-224**, **AC-225**
2. Contracts: `toApiSlug` and `RESERVED_SLUGS`, `PICKER_TYPES`, `STARTER_STAGES`, `nextHue`, `NAME_TAKEN` (409) in the error map, the widened `ObjectSummary` and `AttributeDefinition`, the `objects.*` and `usage.get` contracts, satisfies **AC-223**, **AC-243**, **AC-245**
3. Engine: client ids and replays on `insertObject`, `position` on create, `reorderObject`, `listObjects` by position with `includeArchived`, `checkSlug` with the reserved list, the archived by object read rule in `listAttributes`, `loadAttributes`, the write parser and the compiler, `getUsage` with its access filter, `definitions` changes for object writes (and the thin outbox slice if spec 0007 hasn't landed), access table entries, satisfies **AC-223** to **AC-226**, **AC-241**, **AC-243**, **AC-244**
4. Procedures: `objects.create`, `objects.update`, `objects.reorder`, `objects.archive`, `objects.restore`, `objects.list` changed, `usage.get` with its access filter, satisfies **AC-222** to **AC-226**, **AC-242**, **AC-243**
5. Data layer: the definitions store in spec 0006's shape if not yet built, the object event rule, server confirmed object writes, satisfies **AC-241**
6. Library (pulled forward from spec 0003 milestone 4): SettingsLayout, with stories, README, `design-system-guardian` and the artifact publish, satisfies **AC-246**
7. Screens: Settings in the workspace menu, Settings, Objects (list, meter, reorder, Archived), the new object dialog, the Configuration tab, the archive confirm, the archived object page, the sidebar by position, `/` by position, chips reading the definitions store, the loading, error and busy states, satisfies **AC-222** to **AC-226**, **AC-241**, **AC-242**, **AC-246**, **AC-247**
8. The object table made generic (any live object, "New <singular>") and the generic create dialog (primary, required, "Add more fields"), satisfies **AC-240**
9. Deploy; Playwright: create an object, see it in a second browser's sidebar, create a record in it; `security-access-reviewer`, `state-performance-reviewer`, `ux-interaction-reviewer` before it lands, satisfies **AC-222** to **AC-226**, **AC-240** to **AC-242**

**Milestone 2: attributes without setup**
10. Engine: client ids on `insertAttribute`, `reorderAttribute`, relationship ends archived and restored together (both returned, restore refused while the far object is archived), `definitions` changes for every attribute write, one per object, satisfies **AC-229**, **AC-232**, **AC-233**, **AC-244**
11. Procedures: `attributes.create` widened (id, API name, description, flags, default), `attributes.update`, `attributes.reorder`, `attributes.archive` and `attributes.restore` (arrays), `attributes.list` with `includeArchived` and the new fields, satisfies **AC-229**, **AC-231** to **AC-235**
12. Library: AttributeSettings (title, API name, description, type, flags, the default through the field set's form editor) and the type picker from `PICKER_TYPES` with the optional `relationshipEntry` prop; DataGrid gains an `onAddColumn` "+" header and schema items in the column menu ("Edit attribute", "Archive attribute"), each optional; stories, README, guardian, artifact publish, satisfies **AC-228**, **AC-231**, **AC-239**, **AC-246**
13. Screens: the Attributes tab (sections, badges, meter, reorder, archive and restore, `?attribute=<id>`, its states), the dialog for create and edit from settings, the "+" header, the column menu and #10's "Add attribute", for the ten types without setup (Text, Long text, Date, Checkbox, Rating, Email, Phone, Link, Location, Member), satisfies **AC-227** to **AC-235**, **AC-242**, **AC-247**
14. Deploy; Playwright for each of the ten types, a default, Required and Unique, and a second browser's live column; `security-access-reviewer` and `ux-interaction-reviewer`, satisfies **AC-229**, **AC-234**, **AC-235**, **AC-239**, **AC-241**

**Milestone 3: types with setup and options**
15. Engine: `insertAttribute` with initial `options`, client ids on `insertOption`, the option restore room check, `definitions` changes for option writes, `newOption` in the write parser, satisfies **AC-230**, **AC-236** to **AC-238**, **AC-244**
16. Procedures: `options.create`, `options.update`, `options.reorder`, `options.archive`, `options.restore`; `records.setValues` accepting `newOption`, satisfies **AC-236** to **AC-238**
17. Library: OptionsEditor (label, HuePicker, drag and keyboard reorder, archive and restore, status outcome and target days), the type settings for Number, Currency and Status starter stages in AttributeSettings, and "Create option" in the Select and Status editors behind an optional `onCreateOption`; stories, README, guardian, artifact publish, satisfies **AC-230**, **AC-236**, **AC-238**, **AC-246**
18. Screens: Number, Currency, Select, Multi select and Status in the picker; the options editor in the dialog; the "Default archived" badge and note; "Create option" in cells for `schema.manage` only, as one optimistic write with rollback in the data layer, satisfies **AC-228**, **AC-230**, **AC-236** to **AC-238**
19. Deploy; Playwright: a pipeline status with stages edited, an option archived and refused for new values, a cell created option seen in a second browser, satisfies **AC-236** to **AC-238**, **AC-241**

**Milestone 4: finish and harden**
20. Concurrency and limits tests (two creates at each limit, reorders racing, restore at the limit), the field set walk over the fifteen types, satisfies **AC-237**, **AC-239**, **AC-243**
21. Keyboard, focus and contrast passes on every settings screen and dialog in both themes, `dxe quick`, the first load budget with the settings routes lazy, satisfies **AC-246**
22. The full Playwright flow locally and against production, the AC-241 timing over 20 definition changes, `verify.md` with results, satisfies **AC-222** to **AC-247**

## Consequences

**Positive**:
- A workspace can model its own data with no migration and no code; standard objects edit the same way.
- Every later schema feature (#14, #15, #16, #18, #56) adds to these screens and procedures instead of building its own.
- One shared dialog for create and edit, and one definitions store, keep every screen in step.

**Negative / tradeoffs**:
- Turning Unique on and restoring a unique attribute run in the request; on an object with hundreds of thousands of records they can hit the request time limit until #8 makes them a job.
- Archived objects keep their custom object slot, and their records keep counting toward the 1,000,000 record limit.
- Object names must be unique, so a rename or a create can be refused for a name an archived object holds.
- Every definitions event refetches a whole attribute list (or the object list and every loaded attribute list); fine at 250 attributes and 500 options each, chattier than a precise patch.
- Type and multi can't change until #14, and relationships can't be added until #15, so an admin who picks wrong archives and recreates.
- The effectively archived rule adds a join to attribute reads and filters on record references.
- Pulling SettingsLayout, AttributeSettings and OptionsEditor forward amends spec 0003's milestone 4 again.
- Spec 0005's attribute replay by derived API name is replaced by client ids.
- A record write can now create an option (`newOption`), so the write parser holds one definition write; it is kept to that one case and checked like every definition write.
- Members see no usage meters, and under #24's rules their per object counts count only what they can see.

**Neutral**:
- One migration (`objects.position`, two name indexes, and possibly `outbox.object_id`).
- One new refusal code, `NAME_TAKEN`.
- Six archive and restore procedures instead of three toggles.
- No new dependencies.

## Follow-up

- [ ] **#8**: turning Unique on and restoring a unique attribute as a job past a size threshold, with progress on the attribute.
- [ ] **#14**: "Change type" in AttributeSettings, validation rules, and the "N records don't meet this yet" count beside Required.
- [ ] **#15**: pass `relationshipEntry` to AttributeSettings with RelationshipSettings; record reference fields in the create dialog; apply the archived by object rule to link writes, search and link reads (spec 0014).
- [ ] **#56**: the List and Map SegmentedControl in the Objects header, and links to `?attribute=<id>` (spec 0016).
- [ ] **#18**: groups in the Attributes tab; the create dialog follows them.
- [ ] **#20**: saved views and filters skip archived (and effectively archived) attributes.
- [ ] **#33**: search leaves out records of archived objects.
- [ ] **#38**: the limits come from the plan; the meters already read `usage.get`.
- [ ] **Spec 0003 and the scope** (`/sync`): SettingsLayout, AttributeSettings and OptionsEditor moved forward from milestone 4; DataGrid and the Select and Status editors gained optional props.
- [ ] **Spec 0008**: its note that #13 adds `members.role` is out of date; spec 0009 adds it.
- [ ] **Spec 0009** (`/sync`): AC-136's "Create option" is one `records.setValues` with `newOption` under `schema.manage`, not a separate `options.create`.

## Open questions for the owner

None open. Decided by the owner's acceptance of the recommended defaults for #11 to #22 (3 October 2026): archived objects and attributes count against limits while archived options don't; no Relationship entry until #15; members see settings read only; object names are unique ignoring case, archived ones included; the three starter stages Not started, In progress and Done. Decided in the cross check (8 October 2026): relationship sides get derived API names, not editable ones; archive and restore are separate procedures; creating an option from a cell is one write.
