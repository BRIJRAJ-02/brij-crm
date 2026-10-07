# 0014. Relations: link records across objects, from either side

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Relations connect records: a person works at a company, a deal has many people. The engine already stores links once and reads them from both ends, so this feature is mostly about using them: an admin creates a relationship in one dialog, anyone links and unlinks records from a table cell or a record panel, and a table filters and sorts through relations. Links change one at a time (add this one, remove that one) instead of rewriting the whole list, and a record never loads more than its first 20 links (spec 0005 already caps cells that way), so a company with 150,000 people opens as fast as one with three. It is built in four visible steps, each running in production.

## Structure

- [0014-reference-sort-keys.md](0014-reference-sort-keys.md): the stored sort key for a relation that holds one record (People sorted by Company), how it stays exact when the linked record is renamed, deleted or restored, the lock rule that keeps it exact under concurrent writes, and the background job for targets with more than 10,000 records pointing at them.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #10 core loop (spec 0005) | milestones 2 and 3: the `records.*` procedures, `attributes.list`, "Add attribute", the People table and its data layer, the outbox, relay and live subscription; and what 0005 already ships for links: a many side cell carries at most its first 20 links (`MAX_CELL_LINKS`), `RecordView.linkTotals` holds the side's exact count for each cell cut short, and `RecordView.versions` the value version per attribute | none: a hard prerequisite. Milestone 1 here starts after #10's milestone 3 |
| #9 access model (spec 0009) | `schema.manage` on definition writes (AC-135); the link rule in the door: near field `write`, far records visible (AC-143); the record rule predicate per `Level` (its query compiler row) | if #9's milestone 1 hasn't landed when milestone 1 here starts, this spec builds exactly spec 0009's thin role (`members.role`, `can(access, 'schema.manage')` on `relationships.create` and `relationships.update`, `access.mine` for the screen); #9 keeps it. Every link read here (`linkValues` counts, `pageLinks`, `searchRecords`) joins through #9's record rule predicate from day one, which is empty until #24 adds rules, so every active member sees every record until then |
| #6 client data (spec 0006) | filtered and sorted windows in cursor mode, the settle rule, the definitions store, the replaced notice | milestone 4 needs `records.view(workspace, objectId, { filter, sorts })` with cursor mode and settle exactly as `0006-windows.md` says. If #6 hasn't built it, this spec builds that slice (no checkpointed jumps, no visible attribute narrowing) and #6 extends it. The replaced notice shows only once #6 exists; the server answer is built here either way |
| #7 realtime (spec 0007) | the `records` and `definitions` events, coarse events for huge deletes | none: link changes are ordinary `records` events naming every record and both attributes they touched |
| #8 background jobs (spec 0008) | the runner and kind contract, for the `records.refresh_sort_keys` kind (already named in spec 0008's follow up) | none. Until #8 lands, a sort by a single relation end stays best effort (the engine's lateral key), and task 17 waits. Everything else here ships without #8 |
| #12 load harness (spec 0011) | the `crm` scale seed (a hub company with 150,000 people) and its `hub` scenario (the hub edited while 100 users link to it) | budgets here are measured on the local capped Docker seed (owner decision: no paid Neon branch). If `packages/load` doesn't exist yet, `pnpm db:seed:scale` with one hub company stands in |
| #13 objects and attributes (spec 0012) | the object settings page and AttributeSettings' `relationshipEntry` prop; `attributes.archive` and `attributes.restore` (each returns every definition it changed, both ends here, and stores one `definitions` row per object); `toApiSlug(title, 'attribute')`; the archived by object rule (an attribute whose far object is archived counts as archived) | the relationship dialog is mounted from the table's "Add attribute" here until AttributeSettings exists, then through its `relationshipEntry`. If #13 hasn't built `attributes.archive` and `attributes.restore`, milestone 1 adds them exactly as spec 0012 names them (admins only), and #13 keeps them. If `toApiSlug` isn't in contracts yet, milestone 1 adds it as spec 0012 defines it. The sidebar lists only People after #10; if #13 hasn't widened it, milestone 1 lists every live object from `objects.list` (People, Companies, Deals) on the generic `/w/$slug/objects/$object` route, and #13 adds custom objects and their order |
| #17 record page | the record panel and related sections | the thin panel slice in milestone 3: `?record=<id>`, Details, and one paged section per relationship end. #17 adds tabs, activity, the full page route and previous and next |

## Requirements

**User stories**:
- As an admin, I want to add a relationship between any two objects, or an object and itself, and name each side, so the data model matches how my business works.
- As a member, I want to link a person to a company from either record, and see the other side update in the same save, so the two never disagree.
- As a member, I want to be warned when the person I pick already works somewhere else, and move them in one step, so I never break a "one company per person" rule by accident.
- As a member, I want a company with 150,000 people to open as fast as a small one, so big accounts stay usable.
- As a member, I want to filter and sort a table through its relations (people whose company is in Software, people sorted by company), so I can slice records the way I think about them.

**Acceptance criteria** (this spec owns AC-282 to AC-311):

*Creating relationships*
- **AC-282**: An owner or admin picks "Relationship" in the table's "Add attribute" dialog (and in #13's "New attribute" once it exists). The dialog asks for the related object (any live object, this one included), the cardinality as four plain choices phrased with both object names ("Each person has one company, each company has many people"), and a name for each side, prefilled from the other object's singular or plural name by cardinality. Each side's API name is `toApiSlug(title, 'attribute')` (spec 0012), never typed. A sentence under the choices restates the result. The dialog mints the relationship id once when it opens and sends that same id on every retry. Create waits for the server; on success both attributes exist, the column appears on this object's table at once, and both objects' tables show their new column in every open browser within 1 second.
- **AC-283**: All four cardinalities work (one to one, one to many, many to one, many to many), and so does a relationship from an object to itself (Manager and Reports on People), whose two sides must have different names. A side that holds one record shows and edits one record; a side that holds many shows and edits a list.
- **AC-284**: A name already used on either object is refused on that side's name field with `SLUG_TAKEN`; the attribute limit on either object answers `LIMIT_REACHED` in the dialog; an archived or missing object answers `NOT_FOUND`. A refused create leaves neither side behind. Repeating a create whose response was lost (same relationship id, whatever its `mutationId`) returns the relationship already made, not an error.
- **AC-285**: A member without `schema.manage` sees no "Add attribute" button and no "Relationship" choice. Calling `relationships.create` anyway answers 403 `FORBIDDEN` with spec 0009's message, and nothing is written.
- **AC-286**: Cardinality can't change after creation (#14 adds widening). The dialog and `relationships.create` make two way relationships only; a one way reference (spec 0004) can't be created through either.
- **AC-287**: Archiving either side of a relationship through spec 0012's `attributes.archive` archives both sides in one write and returns both: both columns disappear for everyone live, and every link stays. Restoring either side (`attributes.restore`) restores both, with every link back as it was. A restore is refused with `NOT_FOUND` "Restore <Plural> first." while the other side's object is archived (spec 0012 AC-233).

*Linking from a table*
- **AC-288**: A relation cell shows its linked records as chips (a person as a circle, a company as a square, each with its name, and the icon and hue of its object from the definitions store, spec 0012), and a side that holds many shows "+N" for the rest. Every read returns at most the first 20 links of a many side, in that side's order, with spec 0005's `linkTotals` (the side's exact count, present only when the cell is cut short). The worst page is measured, not only the hub: a page of 100 companies that all hold more than 20 people (the 150,000 person hub and 99 companies of 2,000 people each, made by a bench fixture on the scale seed) returns within #12's 300 ms read budget at p95 and never loads more than 20 links for any record. If it misses, cells stop counting ("20+" with no number, exact totals only in the record panel) and `verify.md` records the switch.
- **AC-289**: Editing a relation cell opens the record picker. An empty search lists the target object's 20 most recently updated records; one or two characters list records whose name starts with them (a bounded range seek on the stored name key); three or more list records whose name, or an email (People) or domain (Companies) attribute, contains them, names starting with the text first. Records already linked show as chosen. On the scale seed the search answers within 300 ms at p95 in the database call.
- **AC-290**: On a side that holds many, picking a record adds that one link and removing a chip removes only that link; nothing else on the side is rewritten. The near cell changes at once. In the same save the far record's paired attribute changes too: the far cells on this screen update when the response lands, and every other open browser sees both sides within 1 second. Adding a link that already exists, or removing one that doesn't, changes nothing and succeeds. There is no per side link limit. Adding one person to the 150,000 person hub completes within #12's 250 ms edit budget at p95.
- **AC-291**: On a side that holds one, picking a record replaces the link: in the same save the old far record loses it and the new one gains it. Removing the chip clears it.
- **AC-292**: When the far side holds one and the picked record is already linked elsewhere (a person already at Acme picked for Globex's Team, or a one to one partner already taken), the picker shows "At Acme" beside it. Picking it moves the link in one save: Acme loses the person, Globex gains them, and the person's Company reads Globex. If the record became taken after the picker loaded, or a client sends no move flag, the save is refused with `RELATIONSHIP_TAKEN` naming the picked record, and nothing changes.
- **AC-293**: A link to a record in the trash (`RECORD_DELETED`), to a record of an object this side can't link to, or from a record to itself, is refused with its message. On any refusal the near cell rolls back, shows the message on the cell, and raises a toast with Retry. Two people linking two different records onto one side that holds one at the same moment: exactly one wins, the other gets `RELATIONSHIP_TAKEN`.
- **AC-294**: Through the API a side that holds many changes only by `links.add` and `links.remove`, at most 100 records a call. `records.setValues` refuses a many side with `ATTRIBUTE_VALUE_INVALID` ("Add or remove links one at a time."), so a list the client only partly holds can never replace the full one. `records.create` still accepts up to 100 initial links per side.
- **AC-295**: When two people replace the same side that holds one, the last save wins, and the earlier writer's response carries `replaced` (the version and who set it), which #6's "your value was replaced" notice shows once #6 exists. Each read carries the current link version of every side that holds one.
- **AC-296**: Every link change keeps history on both sides with who and when (the engine's version rows), and stores one outbox row naming every record it touched (near, far, and a moved link's old holder) and both attributes. A refused change stores none.
- **AC-297**: Deleting a record hides its links at once: every relation cell, picker and section that showed it drops it, in every open browser within 1 second, and no record on the other side changes or is deleted. Restoring it within 30 days brings every link back.

*The record panel for hubs* (a thin slice of #17)
- **AC-298**: Clicking a record's name in a table, or a chip in a relation cell, opens the record panel beside the table, with `?record=<id>` in the address so a reload reopens it. The panel shows the record's name, a Details section whose attributes edit in place through the same editors as the table, and one section per relationship side.
- **AC-299**: A relationship section lists the first 20 related records in that side's order with the exact total ("150,000 people"), and "Show more" loads 20 more each time. The hub company's panel shows its first 20 people and the count within 300 ms at p95 on the scale seed; its list stays smooth and its memory flat after loading 2,000 rows.
- **AC-300**: A section's "Add" opens the same picker with the same move rule, and each row has "Remove". Changes show at once in the section and the table, and live in every other browser. A related record deleted or renamed elsewhere drops out or renames in place.
- **AC-306**: The panel has its states. While the record loads it shows Skeleton lines; a failed read shows an EmptyState with Retry. An unknown id, or one the viewer can't see, clears `?record=` and shows an EmptyState ("This record isn't available.") with Close, so a reload doesn't reopen it. A record deleted while its panel is open shows a notice ("This record was deleted.") and closes the panel. A record of an archived object shows "<Plural> is archived", with "Restore" for `schema.manage`.

*Through relations*
- **AC-301**: The view bar gets Filter and Sort. They apply at once and are not saved (they reset when you leave the page; #20 saves them). Filters cover a relation (is, is any of, is empty, is not empty) and the attributes of related records through up to 2 relations (Company › Industry is Software; Associated deals › Associated company › Name contains Acme), shown with the Path atom. A negative filter through a relation means "no linked record matches". The count and rows follow the filter.
- **AC-302**: Sorting by a side that holds one (People by Company) orders by the linked record's name, empties last. Once task 17 lands, it reads a stored key: on the scale seed the first page and the jump to row 600,000 each return within 300 ms at p95 in the database call, and the view scrolls in position mode. Sorting by a side that holds many orders by its first linked record's name; it stays best effort, measured and recorded in `verify.md`.
- **AC-303**: The stored key stays exact. A link change, and a rename, delete or restore of the linked record, update every key that depends on it: in the same save when 10,000 or fewer records point at that record, otherwise through a `records.refresh_sort_keys` job that finishes the 150,000 person hub within 60 seconds while the old order shows. A randomized test with concurrent link writes, renames, deletes and restores ends with every key equal to what the links and names say.

*Across the feature*
- **AC-304**: Access (spec 0009): the picker, `records.search`, `links.page`, sections and cells show only records the viewer may see; "At Acme" reads "Linked elsewhere" when Acme is hidden from the viewer; linking needs `write` on the near attribute and a visible far record (`NOT_FOUND` otherwise); a filter or sort through a hidden attribute is refused `FILTER_INVALID`. A test walks every new procedure through the door.
- **AC-307**: An owner or admin edits a relationship's two names in the same dialog in edit mode (from the attribute's settings, spec 0012's `?attribute=<id>`, and from #56's map): both objects and the cardinality show read only, and one `relationships.update` renames both sides in one write, live for everyone within 1 second. API names never change. A self relationship's two names must still differ (`CONFIG_INVALID`); a member gets 403 `FORBIDDEN`.
- **AC-308**: Spec 0012's archived by object rule holds on every link path. A side whose far object is archived is left out of `linkValues`, `links.page`, the panel's sections and `records.search`'s `linked` state; `records.search` on an archived object, and `links.add` or `links.remove` naming an archived object's record or an effectively archived side, answer `NOT_FOUND`; restoring the object brings every link back unchanged.
- **AC-305**: Every new screen part is built from tokens and library components only, works fully by keyboard (the dialog, the picker, chips, the panel and its sections, Filter and Sort) with a visible focus ring, meets contrast in light and dark, and loads lazily so the first load stays under the 250 kB budget. Each milestone runs in production on brij-crm-phi.vercel.app.

## Decision

**Chosen option**: Option 1: link deltas and paged link reads on the existing engine, with a stored name key for sides that hold one.

Links change through `links.add` and `links.remove`, which touch only the named records (and a moved link's old holder); reads return the first 20 links of a many side plus its total (spec 0005's shape); a many side's full list is paged by `links.page`; the picker searches through one `records.search`. This spec owns `relationships.create`, `relationships.update` and the `RelationshipSettings` dialog with its `create` and `edit` modes; #13 and #56 mount it.

Calls made here (decided: the owner took the recommended defaults for #11 to #22 on 3 October 2026, and the cross check of 8 October settled the shared names; one call stays open for the owner, below):
- One relationship dialog, a library module, reused by #13's settings and #56's schema map, in two modes: `create` (each end's object preset or choosable) and `edit` (both ends preset, names only).
- Relationship sides' API names are derived by spec 0012's `toApiSlug`, never typed; archive and restore are spec 0012's `attributes.archive` and `attributes.restore`.
- One way references stay engine and API only (spec 0004), never in the UI.
- Cardinality is fixed; #14 adds widening.
- Archiving either side archives both.
- "At Acme" plus an explicit `move: true`, with no extra confirm dialog: the marker is the warning. Without the flag a taken pick is refused.
- Optimistic on the near side only; the far side refreshes from the ids the response names.
- The stored name key covers sides that hold one; above 10,000 dependents its refresh is a #8 job.
- Filter and Sort here are unsaved; #20 saves them and adds the rest of the view bar.
- Totals stay exact, as spec 0005 ships them, and the worst page is measured (AC-288); cells switch to "20+" only if that measure misses.
- Showing and sorting by an attribute of a related record (a company's industry as a column on People) is a lookup, so it arrives with #16. #15 shows, filters and sorts by the related record itself, and filters by its attributes. This narrows the scope's "Done when" line: an open owner question, recommended accept (see the end of this spec).

**Implementation skills**: `drizzle` (`lobehub/lobehub`, `.claude/skills/drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `zod` (`.claude/skills/zod/`) · `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`) · `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `tanstack-virtual` (`.claude/skills/tanstack-virtual/`) · `tanstack-router-best-practices` (`.claude/skills/tanstack-router-best-practices/`) · `react-aria` (`.claude/skills/react-aria/`) · `stories` (`.claude/skills/stories/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · house skills `crm-data-model-access`, `crm-api-backend`, `crm-frontend-state`, `crm-design-system`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Starting point**: the engine's relationships (spec 0004, AC-5, AC-7, AC-8): `defineRelationship`, `record_links` with single side flags and partial unique indexes, `writeLinks` (whole value replace), `linkValues`, `linkHistory`, filters through up to 2 hops, and sort by a reference through a lateral join. Nothing here replaces them; the whole value path stays for `records.create`, `setValuesBatch` (#22) and sides that hold one.

**Data model** (one migration, in milestone 4; milestones 1 to 3 change no schema):

| Table or view | Change | Rules |
|---|---|---|
| `relationships` | none. Its `id` may now come from the client (uuid v7) as the idempotent retry key | existing |
| `record_links` | none. The existing `record_links_from` and `record_links_to` indexes (current only, by side and position) drive `links.page` and the first 20 per side | existing |
| `sort_key_sources` (view) | adds one key per record for every side that holds one: `text_key` is the linked live record's primary attribute key (`lower(left(text, 256))` under `und-x-icu`, as every text key), no row when unlinked or the linked record is trashed | see [0014-reference-sort-keys.md](0014-reference-sort-keys.md) |
| `sort_keys` | rows for those sides, backfilled by the migration (set based; production data is small) | existing `sort_keys_text` index serves them; no new index |

No new table. The records search uses existing indexes: `records_updated` (recent), `sort_keys_text` (prefix) and `crm_search_text` (contains).

**Engine services** (in `packages/core`, each taking the door's scope):

| Service | Kind | What it does |
|---|---|---|
| `defineRelationship` (changed) | write | accepts an optional client id; a replay with a live relationship of that id and the same ends returns it, a different one answers `ID_TAKEN` |
| `updateRelationship` (new) | write | renames one or both sides' titles in one write under the relationship's attribute rows' locks; API names unchanged; a self relationship's titles must differ (`CONFIG_INVALID`); returns both definitions; one `definitions` change per object |
| `archiveAttribute`, `restoreAttribute` | write | spec 0012's: on a relationship side, act on both sides in one write and return both; restore refuses while the other side's object is archived. Built here only if #13 hasn't |
| `writeLinksDelta` (new) | write | `add` or `remove` named far records on one side of one record, under the near record's lock, by spec 0004's write protocol: a version id, `active_from` after the lock, history on the ended rows. Never reads the side's other links. Refuses `NOT_FOUND` when the side is effectively archived (spec 0012's rule) or a named far record belongs to an archived object or falls outside the writer's record rule. A many side appends at `max(position) + 1` (read through the position index); a one side ends its current link first. A far side that holds one: a live holder refuses `RELATIONSHIP_TAKEN` unless `move`, which ends that holder's link in the same write; a trashed holder gives way as today. Returns `ValueChange`s for the near record, each far record, and each moved link's old holder |
| `linkValues` (0005's, changed) | read | as 0005 ships it: per many side the first 20 links in side order (one lateral `limit 20` per side) and, for a side cut short, its exact count; per one side, the link and its `version_id`. Changed here: links and counts join through #9's record rule predicate for the far object (empty until #24), and effectively archived sides are left out |
| `pageLinks` (new) | read | one side of one record, keyset by (position, `active_from`, id), live far records the reader may see only (through #9's record rule predicate), up to 50, with `RecordRefDisplay` per row and the exact total counted the same way; `NOT_FOUND` on an effectively archived side |
| `searchRecords` (new) | read | see value sourcing; every mode joins through #9's record rule predicate; `NOT_FOUND` when the object is archived; returns `RecordRefDisplay`, `linked` and `takenBy` per result |
| `syncReferenceKeys`, `refreshDependents` (new) | write | the stored key; see the child spec |

**API surface** (oRPC on `/api/rpc`; every procedure needs a session and an active member, through the door; refusals as `{ code, message, data?: { refusals } }`):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `relationships.create` | `workspace`, `id` uuid v7 (minted once per dialog, the replay key), `cardinality`, `from` { `objectId`, `title` }, `to` { `objectId`, `title` }, `mutationId` (API names from `toApiSlug(title, 'attribute')`) | { `relationshipId`, `cardinality`, `from`: AttributeDefinition, `to`: AttributeDefinition } | `schema.manage` | 403 `FORBIDDEN`; 404 `NOT_FOUND` (object missing, or "That object is archived. Restore it first."); 409 `SLUG_TAKEN` (with the side), `LIMIT_REACHED`, `ID_TAKEN`; 422 `CONFIG_INVALID` |
| `relationships.update` | `workspace`, `relationshipId`, `from`? { `title` }, `to`? { `title` }, `mutationId` (end titles only) | as `relationships.create` | `schema.manage` | 403; 404 (unknown, hidden or archived); 422 `CONFIG_INVALID` (empty, too long, or equal titles on a self relationship) |
| `attributes.archive`, `attributes.restore` (spec 0012's; a thin slice here only if #13 hasn't built them) | `workspace`, `attributeId`, `mutationId` | AttributeDefinition[] (both sides for a relationship) | `schema.manage` | 403; 404 (incl. "Restore <Plural> first."); 409 `UNIQUE_HAS_DUPLICATES` |
| `attributes.list` (changed) | as #10 | each record reference attribute adds `relationship`: { `id`, `cardinality`, `side` (`from` or `to`), `targetObjectIds`, `pairedAttributeId`, `farHoldsOne` } | member | as #10 |
| `links.add` | `workspace`, `recordId`, `attributeId`, `targets` [{ `objectId`, `recordId` }] 1 to 100 (exactly 1 on a side that holds one), `move` boolean (default false), `baseVersionId` (one sides, optional), `mutationId` | { `record`: RecordView, `changedRecordIds`: uuid[] (far records and moved holders), `replaced`? { `versionId`, `setBy` } } | member; near attribute `write`, far records visible (#9) | 404 `NOT_FOUND` (also an archived object or an effectively archived side); 409 `RELATIONSHIP_TAKEN`, `RECORD_DELETED`; 422 `ATTRIBUTE_VALUE_INVALID`, `ATTRIBUTE_READ_ONLY` |
| `links.remove` | `workspace`, `recordId`, `attributeId`, `targetRecordIds` 1 to 100, `mutationId` | { `record`, `changedRecordIds` } | as `links.add` | 404; 409 `RECORD_DELETED`; 422 `ATTRIBUTE_READ_ONLY` |
| `links.page` | `workspace`, `recordId`, `attributeId`, `cursor`?, `limit` ≤ 50 (default 20) | { `items`: RecordRefDisplay[], `nextCursor`?, `total`: number } | member | 404; 400 `INPUT_INVALID` with field `cursor` (a tampered or foreign cursor, as 0005's cursors answer) |
| `records.search` | `workspace`, `objectId`, `query` (0 to 200 characters), `limit` ≤ 50 (default 20), `forAttributeId`?, `forRecordId`? | { `results`: [{ `ref`: RecordRefDisplay, `linked`: boolean, `takenBy`?: RecordRefDisplay \| { `hidden`: true } }] } | member | 404 (also an archived object); 503 `QUERY_CANCELLED` |
| `records.get`, `records.query` | as #10 and #6 | unchanged shape from spec 0005: `RecordView.values` holds the first 20 links of each many side, `RecordView.linkTotals` the exact count of each cell cut short, `RecordView.versions` the version per attribute (each one side's link `version_id` included; added here if 0005's doesn't carry it) | member | as before |
| `records.setValues` (changed) | as #10 | refuses a many side | member | 422 `ATTRIBUTE_VALUE_INVALID` |

**Status codes**: as spec 0005. 403 `FORBIDDEN` (no `schema.manage`), 404 `NOT_FOUND` (also hidden records and non members), 409 for `RELATIONSHIP_TAKEN`, `RECORD_DELETED`, `SLUG_TAKEN`, `LIMIT_REACHED`, `ID_TAKEN`, `UNIQUE_HAS_DUPLICATES`, 422 for invalid values and config, 400 `INPUT_INVALID` with field `cursor` for a bad `links.page` cursor, 503 `QUERY_CANCELLED` with `Retry-After`. No new code.

**Events**:
- A link change: one `records` outbox row; `record_ids` = the near record, every far record whose paired attribute changed, and each moved link's old holder; `attribute_ids` = both sides. `mutationId` as #10.
- `relationships.create`, `relationships.update`, archive and restore: one `definitions` row per object touched (one for a relationship from an object to itself), sharing the `mutationId`.
- A rename of a linked record is already a `records` event for that record; clients refetch the chips and section rows that show it (they hold its id).
- A delete or restore with very many links follows spec 0007 (coarse per object above the cap).

**Screens and the library**:
- `RelationshipSettings` (new library module, built on Modal, Select, RadioGroup, Field): object, cardinality, two names, the sentence; presentational, with stories, README, `design-system-guardian` review, published to the artifact. Props: `mode: 'create' | 'edit'`; `from` and `to`, each `{ objectId, title? }` when preset or absent when the person chooses that end's object (a Select of live objects); in `edit` both are preset and only the names are editable; `onSubmit`, `onCancel`, `refusals`, `isPending`. The screen that mounts it mints the relationship id once when it opens in `create` mode and resends that id on every retry. Mounted by the table's "Add attribute" when "Relationship" is chosen (a second step in the same dialog, through AttributeSettings' `relationshipEntry` once spec 0012 builds it), by spec 0012's Attributes tab in `edit` mode for a relationship attribute (`?attribute=<id>`), and by #56's map in both modes.
- `ReferencePicker` (library change): an optional note per item ("At Acme", "Linked elsewhere") read by screen readers with the item, and chosen state from `linked`; `RecordReferenceEditor` passes them through. One component, no new picker.
- Every object's table on `/w/$slug/objects/$object` (spec 0005's generic route), reached from the sidebar: relation cells editable through `AttributeEditor`, chips open the panel. The create dialog's title and "New <singular>" follow the object.
- `RecordPanel` (exists) on `?record=<id>`: `AttributeList` for Details, and one section per relationship side: a virtualised list of `RecordChip` rows with "Show more", "Add" and "Remove". States (AC-306): Skeleton lines while loading; EmptyState with Retry on error; EmptyState with Close for an unknown or hidden id (the param cleared); a notice and close when the record is deleted while open; "<Plural> is archived" with Restore for `schema.manage`.
- The view bar: `FilterBuilder` (with `Path`) and `SortBuilder` (both exist), unsaved.

**Data layer** (`packages/data`, the house rule: screens never fetch):
- `links.add` and `links.remove` as optimistic layers on the near record only (spec 0005's layering rule): add appends the chip when the side shows fewer than 20, else raises `linkTotals` by one (21 when the cell was exactly full); remove drops the chip or lowers the total. The response's `record` becomes the base; then `records.get` for the `changedRecordIds` the store holds. Own echoes are skipped, so the response is the only path to the far side on this screen.
- `records.search` as a `ListSource` for the picker: 150 ms debounce, the previous request aborted, results never written to the record store (they are displays).
- A section source per (record, attribute): pages from `links.page`; an event naming the record and that attribute rereads the loaded pages after #6's settle delay (1.5 seconds), an event naming a held far id rereads that display.
- If #6's undo stack exists, each delta registers its inverse (remove for add, add for remove; a move's inverse adds back to the old holder with `move`).

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| dialog | the related object choices | `objects.list`, live objects, this one included |
| dialog | the default side names | the other object's `singular_name` when that side holds one, `plural_name` when it holds many (`objects` columns) |
| dialog | which sides hold one | `singleEnds(cardinality)` in `packages/core`, mirrored in contracts for the sentence |
| dialog | the sentence | the two objects' singular and plural names and the chosen cardinality |
| `relationships.create` | each side's `apiSlug` | `toApiSlug(title, 'attribute')` (spec 0012), through the engine's `checkSlug` |
| `relationships.create` | the relationship id | a uuid v7 the mounting screen mints once when the dialog opens in `create` mode, reused on every retry (the replay key) |
| `relationships.update` | the new titles | the dialog's two name fields in `edit` mode; `from` and `to` preset from `attributes.list`'s `relationship` block |
| dialog, `edit` mode | the objects and cardinality shown | the relationship's two attributes in the definitions store (`relationship.cardinality`, `side`, `targetObjectIds`) |
| `relationships.create` | the caller may do it | `can(access, 'schema.manage')` (spec 0009 or its thin slice) |
| "Add attribute" | whether "Relationship" shows | `access.mine` lists `schema.manage` |
| a relation cell | its chips | `RecordView.values[attributeId]` (first 20) with `RecordRefDisplay` from `getRecords`; icon tile and hue from the definitions store's object for the chip's `objectId` (spec 0012) |
| a relation cell | "+N" | `linkTotals[attributeId]` (0005: the exact count, present only when the cell is cut short), else the links held, minus the chips drawn |
| a relation cell | one record or a list | `attributes.list` `relationship` and `isMulti` (to the field set's `cardinality`) |
| picker | which object to search | `relationship.targetObjectIds` of the attribute being edited |
| picker, empty query | the records | the target object's live records by `updated_at` descending, first 20 (`records_updated` index) |
| picker, 1 or 2 characters | the records | `sort_keys` on the target object's primary attribute, a bounded range: `text_key >= lower(query) and text_key < lower(query) \|\| U&'\FFFF'` (collated `und-x-icu`, as the key) in index order, live owners only, first 20. Verified on the scale seed with `explain` (an index range scan on `sort_keys_text`, no filter step reading past the range) |
| picker, 3 or more characters | the records | `crm_search_text` (up to 200 ids each) on the primary attribute plus the object's live `email` and `domain` attributes (at most 3 attributes), joined to live records of the target object, ordered by names starting with the query first, then by name key, first 20 |
| picker | chosen state | `linked`: a current link from `forRecordId` on `forAttributeId` |
| picker | "At Acme" | `takenBy`: when `relationship.farHoldsOne`, the current holder of that result on the paired side, as its `RecordRefDisplay`; `{ hidden: true }` ("Linked elsewhere") when #9 hides the holder |
| `links.add` | `move` | the picker sets it only when the person picks a result marked "At …" |
| `links.add` | a new link's position | the near side: `max(position) + 1` on that side; the far side: `max(far position) + 1`, as `writeLinks` does today |
| `links.add`, `links.remove` | `changedRecordIds` | the `ValueChange`s `writeLinksDelta` returns, minus the near record |
| `links.add` | `replaced` | the one side's current link `version_id` compared with `baseVersionId`, and its `set_by` |
| any read | `linkTotals` | spec 0005's `count(*)` over the side's current links to live records, for cells cut short; joined through #9's record rule predicate on the far object; none for an effectively archived side |
| any read | a one side's version | the current link's `version_id` |
| record panel | which record | `?record=<id>` in the route's search params |
| record panel | its state | the record subscription's `status` (`loading`, `ready`, `error`, `missing`), and a `records` event deleting the held id |
| record panel | its sections | `attributes.list` record reference attributes of the record's object, non archived, by `position` |
| a section | rows, order and total | `links.page`: side order (position, `active_from`, id), `RecordRefDisplay`, exact total |
| a section | the noun in "150,000 people" | the far object's `plural_name`, lowercased |
| Filter | operators per attribute | the field set's operator list (spec 0003), through `FilterBuilder` |
| Filter | relations to follow | `attributes.list` of each object along the path, at most 2 hops (spec 0004) |
| Sort by a one side | the key | `sort_keys.text_key` for that attribute (child spec); before task 17, the engine's lateral join |
| Sort by a many side | the key | the first linked record's name by the engine's lateral join (best effort) |
| Filter and Sort | their lifetime | component state in the route; not saved, not in the URL |
| key refresh | inline or job | the dependents count, up to 10,001, against `KEY_REFRESH_INLINE_MAX` = 10,000 |
| constants | 20, 50, 100, 10,000, 200 | 0005's `MAX_CELL_LINKS` (20); `LINK_PAGE_MAX`, `LINKS_PER_CALL` in `packages/contracts/src/relations.ts`; `KEY_REFRESH_INLINE_MAX`, `SEARCH_CANDIDATES` in `packages/core` |

**Key invariants**:
- A relationship's two sides exist, are archived and are restored together, or neither changes.
- A link change updates both sides in one transaction, one version id and one outbox row.
- Through the API, a many side changes only by delta. No read hands the client a partial list it could send back as a whole value.
- A side that holds one never has two current links (the partial unique indexes); a move ends the old holder's link in the same transaction as the new one starts.
- `writeLinksDelta` reads and writes only the named far records, the near record's lock and, on a move, each old holder's one link. Its cost never grows with the size of the side.
- A read returns at most 20 links per many side per record. Counts read the side's index only and are measured at the worst page (AC-288).
- Every link read and count joins through #9's record rule predicate, and leaves out sides spec 0012 counts as archived.
- Every stored key derived from record B is written while holding a lock on B's row, and computed after it (the child spec).
- Cardinality never changes in this spec.
- The browser holds one copy per record; the picker's results and a section's rows are displays, never record bodies.

**Security model**:
- Schema writes (`relationships.create`, `relationships.update`, archive, restore) need `schema.manage` (owner and admin, spec 0009 AC-135).
- Link writes go through the record write path: the near record's lock under the record rule, `write` on the near attribute, every far record (and a moved link's old holder) visible to the writer, else `NOT_FOUND` (spec 0009 AC-143). The far record's paired attribute changes without a check of its own, as spec 0009 says.
- Reads (`records.search`, `links.page`, `linkTotals`, `takenBy`) join through the record rule predicate from day one: hidden records are absent and never counted. `takenBy` never names a hidden holder.
- `RELATIONSHIP_TAKEN` names the record the writer picked, never the holder.
- `records.search` text never reaches SQL as text: prefix keys are parameters, contains goes through `crm_search_text` (the existing security definer function; no new one).
- Inputs are bounded: 100 records per link call, 50 per page or search, 200 search characters, cursors validated by shape.
- `security-access-reviewer` reviews milestones 1, 2 and 4 before they land.

**Configuration required**: none. No new environment variable or service.

**Critical test scenarios** (integration against a real Postgres, Playwright for flows):
- Happy path: an admin creates Investors on Companies and Investments on People (many to many) from the Companies table; a second browser sees both columns; a member links two people from a company's cell and each person's panel shows the company; Playwright with two browsers, verifies **AC-282**, **AC-283**, **AC-290**, **AC-296**, **AC-298**.
- Self relation and cardinalities: all four cardinalities, and Manager and Reports on People with equal names refused, verifies **AC-283**, **AC-284**.
- Move: a person at Acme picked for Globex's Team shows "At Acme"; picking moves them; a stale pick without `move` is refused; both companies and the person update live, verifies **AC-292**, **AC-296**.
- Races: two links onto one side that holds one at once; a move racing the holder's own unlink; an add racing a delete of the far record; a delta racing a whole value write on the same side, verifies **AC-293**, **AC-295**.
- Hub: on the scale seed, read the worst page (the hub and 99 companies of 2,000 people each), add and remove one person on the hub, open its panel and page 2,000 rows; numbers in `verify.md`, verifies **AC-288**, **AC-290**, **AC-299**.
- Edit mode: rename both sides of Investors and Investments in one save; a second browser's columns rename live; equal names on a self relationship are refused; a member gets 403, verifies **AC-307**.
- Archived by object: archive Companies; People's Company is gone from cells, sections and search state, `records.search` on Companies and `links.add` to a company answer `NOT_FOUND`; restore brings every link back, verifies **AC-308**.
- Panel states: an unknown and a hidden `?record=` clear the param and show the EmptyState; deleting the open record in a second browser closes the panel with the notice; a failing read shows Retry, verifies **AC-306**.
- Deltas only: `records.setValues` on a many side is refused; a repeated add or remove changes nothing, verifies **AC-294**.
- Delete and restore: deleting a company empties its people's Company cells live and leaves the people; restore brings the links back, verifies **AC-297**.
- Archive: archiving Team archives Company too; links survive a restore; restore refused while Companies is archived, verifies **AC-287**.
- Search: empty, prefix (its plan an index range scan bounded both ends) and contains on the scale seed within budget, and `takenBy` correct, verifies **AC-289**, **AC-292**.
- Through relations: Company › Industry is Software and a negative through filter against the reference evaluator; sort by Company with the jump to row 600,000, verifies **AC-301**, **AC-302**.
- Keys: the randomized key test with concurrent writers; the hub rename job within 60 seconds, verifies **AC-303**.
- One side and sections: replacing a deal's Associated company moves it between the two companies' Associated deals in one save; clearing it empties both; in the panel, "Add" and "Remove" on a section change the table and a second browser live; a deleted or renamed related record leaves or renames its row, verifies **AC-291**, **AC-300**.
- Fixed shape: no cardinality control exists after creation, and `relationships.create` without a `to` side is refused `CONFIG_INVALID`, verifies **AC-286**.
- Quality: keyboard only runs of the dialog, picker, panel and view bar, axe and contrast checks in both themes, and the first load budget (`pnpm size`), verifies **AC-305**.
- Permission: a member calling `relationships.create` gets 403 and nothing is written; a hidden far record answers `NOT_FOUND` on link and is absent from search; the contract walking test covers every new procedure, verifies **AC-285**, **AC-304**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 starts after #10's milestone 3.

**Milestone 1: create a relationship**
1. Engine: client id and replay on `defineRelationship`; `updateRelationship`; archive and restore of either side move both (spec 0012's, built here only if #13 hasn't), restore refused while the other object is archived; tests, satisfies **AC-284**, **AC-286**, **AC-287**, **AC-307**
2. Contracts and API: `relationships.create` and `relationships.update` behind `schema.manage` (spec 0009's check, or its thin slice per Dependencies); `toApiSlug` if not yet in contracts; the `relationship` block in `attributes.list`; one `definitions` event per object; `attributes.archive` and `attributes.restore` only if #13 hasn't built them; the contract walking test extended, satisfies **AC-282**, **AC-284**, **AC-285**, **AC-286**, **AC-287**, **AC-307**
3. Library: `RelationshipSettings` in both modes with stories (every cardinality, self relation, each end preset or choosable, edit mode, refusals on each name), README, `design-system-guardian`, artifact publish, satisfies **AC-282**, **AC-283**, **AC-305**, **AC-307**
4. Screen: the sidebar lists every live object (the thin slice per Dependencies) so Companies and Deals tables open; "Relationship" in "Add attribute" for admins only, the id minted once per dialog, server confirmed, columns appear on both tables live; edit mode from the attribute's settings once spec 0012's Attributes tab exists (else from the column menu); relation cells (still read only) show chips; deploy; `security-access-reviewer`, satisfies **AC-282**, **AC-283**, **AC-285**, **AC-305**, **AC-307**

**Milestone 2: link from the table**
5. Engine: `writeLinksDelta` (add, remove, one side replace, `move`, `baseVersionId`), the far and moved holder changes, one outbox row, the archived by object refusals; race tests, satisfies **AC-290** to **AC-293**, **AC-295**, **AC-296**, **AC-308**
6. Engine reads: `linkValues` (0005's first 20 and exact counts) joined through #9's record rule predicate, effectively archived sides left out, one side versions; `getRecords` and `queryPage` pass them through, satisfies **AC-288**, **AC-295**, **AC-308**
7. Engine: `searchRecords` (recent, the bounded prefix range, contains, `linked`, `takenBy`, the record rule predicate, `NOT_FOUND` on an archived object), measured and its prefix plan checked on the scale seed, satisfies **AC-289**, **AC-292**, **AC-308**
8. API: `links.add`, `links.remove`, `records.search`; `records.setValues` refuses many sides; `RecordView.linkTotals` and versions, satisfies **AC-288** to **AC-295**, **AC-304**
9. Data layer: optimistic near side deltas with rollback, cell errors and toasts, far refetch from `changedRecordIds`, the picker's search source, satisfies **AC-290** to **AC-293**, **AC-297**
10. Library and screen: `ReferencePicker` notes and chosen state; relation cells editable everywhere; the worst page fixture and the hub numbers in `verify.md` (and the switch to "20+" cells if the worst page misses); deploy; `state-performance-reviewer`, `security-access-reviewer`, `ux-interaction-reviewer`, satisfies **AC-288** to **AC-293**, **AC-297**, **AC-305**

**Milestone 3: the record panel for hubs**
11. Engine and API: `pageLinks` and `links.page` (keyset, exact total, live far records the reader may see, `NOT_FOUND` on an effectively archived side), satisfies **AC-299**, **AC-304**, **AC-308**
12. Data layer: the record subscription for the panel (with its `missing` status and the delete signal) and the section source (pages, rereads on events), satisfies **AC-298** to **AC-300**, **AC-306**
13. Screen: `RecordPanel` on `?record=<id>` from a name or a chip, Details through `AttributeList`, a virtualised section per side with "Show more", "Add" and "Remove"; the panel's states; the hub panel measured; deploy; `ux-interaction-reviewer`, satisfies **AC-298** to **AC-300**, **AC-305**, **AC-306**

**Milestone 4: through relations**
14. Data layer: filtered and sorted windows (spec 0006's, or the thin slice per Dependencies), satisfies **AC-301**, **AC-302**
15. Screen: Filter and Sort in the view bar (`FilterBuilder` with `Path`, `SortBuilder`), unsaved; through filters checked against the reference evaluator, satisfies **AC-301**, **AC-302**, **AC-305**
16. Migration and engine: the stored key for sides that hold one (`sort_key_sources`, backfill, `syncReferenceKeys` in link writes and in renames, deletes and restores of targets, inline up to 10,000, the lock rule); `canJump` admits a sort on a one side; the randomized key test, satisfies **AC-302**, **AC-303**
17. The `records.refresh_sort_keys` kind on #8's runner (coalesced per target, batches of 500), once #8 exists; the hub rename within 60 seconds, satisfies **AC-303**
18. Scale proof on the local capped seed (sort by Company, the jump, the refresh), the full Playwright flow with two browsers, `verify.md`; deploy; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-288**, **AC-289**, **AC-299**, **AC-302** to **AC-308**

## Consequences

**Positive**:
- Hubs stay fast: no read or write cost grows with the size of a side.
- Deltas commute: two people adding different records to one company never overwrite each other, and a writer can't drop links it can't see (spec 0009's hidden link rule holds by construction).
- The dialog, picker, search and panel slice are the pieces #13, #16, #17, #22, #33 and #56 reuse.

**Negative / tradeoffs**:
- Two write paths for links (whole value and delta) must keep identical rules; the shared checks live in one module and the race tests run against both.
- A cell shows at most 20 chips; seeing the rest means opening the record.
- Exact totals cost a count of the side's index per cell cut short; a page full of large companies is the worst case, and if its measure misses, cells fall back to "20+".
- Once #24 adds record rules, every link count runs the rule's predicate per far record, which may make hub totals slow; #24 decides whether totals cap then.
- A link written from the far side now waits briefly on a stored key's lock rule (key share on the target), and a hub rename makes links to that hub wait for each 500 record batch. This reverses spec 0004 AC-7's promise that two links from opposite ends never lock each other (see Follow-up).
- Between a hub rename and the end of its refresh job, a sort by that relation shows the old order.
- The near side is optimistic but the far side waits for the response, so on a slow network the paired cell updates a beat later.
- Showing a related record's attribute as a column waits for #16, which narrows this feature's scope line.

**Neutral**:
- One migration (the view and the backfill), in milestone 4.
- No new dependency; one library module (`RelationshipSettings`) and one library change (`ReferencePicker` notes).
- `RecordView` keeps spec 0005's shape (`linkTotals`, `versions`); every reader of reference values must treat a many side as the first 20.

## Follow-up

- [ ] **#14**: widen or narrow cardinality, with a preview of the links that would break.
- [ ] **#16**: lookups through relations reuse the stored key's lock rule and dependents refresh.
- [ ] **#17**: takes over the panel, its route and the related sections, reusing `links.page` and the section source.
- [ ] **#20**: saves the Filter and Sort built here. Spec 0006 says #20 adds the filter and sort UI; it now only adds saving and the rest of the view bar (`/sync` the line).
- [ ] **#13**: mounts `RelationshipSettings` through AttributeSettings' `relationshipEntry` and in edit mode for `?attribute=<id>`; changing an object's primary attribute must rebuild every stored key that targets it (a job).
- [ ] **#56**: mounts `RelationshipSettings` in both modes from the map, with the same id minted once per dialog.
- [ ] **#22**: bulk add and remove links through `writeLinksDelta` in batches.
- [ ] **#33**: global search starts from `records.search`.
- [ ] **#34**: the public API exposes links as deltas, and one way references.
- [ ] **#12**: the hub scenario in the load harness now includes the hub edited while 100 users link to it (spec 0011 AC-206); clearing a hub side is spec 0011's engine level bench (AC-214).
- [ ] **Spec 0004** (`/sync`): AC-7 says "two links from opposite ends never lock each other". The stored sort key's lock rule ([0014-reference-sort-keys.md](0014-reference-sort-keys.md)) takes `FOR KEY SHARE` on the far record when a one side link is written from the other side, so that is no longer true once milestone 4 lands; record the reversal and the reason (an exact sort key) in 0004.
- [ ] **#6**: undo for link deltas if its stack lands after this spec; a revision bump on far records if late link reads show up.
- [ ] Sort by a many side stays best effort; revisit only if #12 shows it matters.

## Owner decisions

**Answered by the owner on 8 October 2026: accepted as recommended.**

1. **Showing and sorting by an attribute of a related record (a company's industry as a column on People, or People sorted by Company › Industry) moves to #16 (lookups).** This narrows #15's scope line: #15 shows, filters and sorts by the related record itself, and filters through its attributes. Recommended: accept, because a related attribute as a column is a lookup with its own storage and refresh rules, and building it here would build #16 twice. Runner up: build a read only, unsortable related column here and redo it in #16. On acceptance, `/sync` updates the scope's "Done when" for #15.

Decided (not open): the dialog's two modes and `relationships.update` (end titles only) are this spec's; archive and restore are spec 0012's procedures; API names come from `toApiSlug`; totals stay exact and are measured at the worst page (the owner's recommended defaults for #11 to #22, 3 October 2026, and the cross check of 8 October 2026).
