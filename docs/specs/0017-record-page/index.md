# 0017. Record page: one place for a record's details, related records and history

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Every record gets its own page: a header with its name, a main column with tabs (Overview and Activity now, Notes and Tasks with #19), and a fixed Details sidebar where every attribute edits in place and every relationship lists its records with Add and Remove. The Activity tab is a timeline built when it is read from the history the engine already keeps (creation, every value version, every link added or removed), newest first, paged, filtered by access and live. A record can also be opened in a side panel beside any table and stepped through with Previous and Next. It is built in four visible steps, each running in production.

## Structure

- [0017-activity.md](0017-activity.md): how the timeline is read: its sources (creation, value versions, link changes, and the slots #19 and #29 fill), how creation values fold into one entry, the keyset cursor and merge, the two new indexes, access filtering, and how the browser keeps it live.
- [0017-screens.md](0017-screens.md): the routes, the page layout and its library pieces, each tab and block, the side panel with Previous and Next, every screen state, keyboard and focus.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #10 core loop (spec 0005) | the record procedures, the generic object route, the data layer's write path | none: hard prerequisite |
| #13 objects and attributes (spec 0012) | any live object's table on `/w/$slug/objects/$object`, the definitions store with options inline, `definitions` events for objects and attributes | none: hard prerequisite (milestone 1 here starts after #13's milestone 2) |
| #15 relations (spec 0014) | `links.add`, `links.remove`, `links.page`, `records.search`, `linkTotals`, the `ReferencePicker` notes, the section source, and the thin `RecordPanel` slice on `?record=<id>` | none: hard prerequisite. Milestone 1 here starts after #15's milestone 3. This spec takes the panel over |
| #6 client data (spec 0006) | `records.one`, the definitions store, the window a table holds (for Previous and Next), versions and the replaced notice on Details edits | if `records.one` hasn't landed, milestone 1 builds it exactly as `0006-live-and-definitions.md` describes, and #6 keeps it. Previous and Next (milestone 4) need #6's windows; with only spec 0005's windows they work the same over its id ordered blocks |
| #9 access model (spec 0009) | milestone 1 (the sealed scope, `inWorkspace`, the access table) for the new service; `fieldLevel`, `visibleAttributes` and the record rule for activity | none. Until #9's milestone 2 lands the open policy applies and the activity reader calls the same pure functions, so nothing changes when rules arrive |
| #7 realtime (spec 0007) | `records` events naming the near record, far records and moved holders of every link change (spec 0014); the live router `live.on` | none: `records` events exist from spec 0005; the router is #6's or #7's |
| #12 load harness (spec 0011) | the `crm` scale seed (the 150,000 person hub company), `SCALE_BUDGET` | if `packages/load` doesn't exist yet, spec 0004's `pnpm db:seed:scale` with one hub company stands in (owner decision: scale proofs run locally) |
| #18 attribute groups | sections and the trailing Record group in Details, Highlights on Overview | none: until #18 lands, Details is one untitled section in attribute order and Overview has no Highlights block |
| #19 notes and tasks | the Notes and Tasks tabs, the Open tasks block, note and task activity entries | none: #19 adds them into the slots named here |
| #16, #26, #29 | computed attributes left out of activity; presence in the header; comments in activity | none: each fills its named slot later |

## Requirements

**User stories**:
- As a member, I want one page per record with its details, its related records and what happened to it, so I can understand a customer at a glance.
- As a member, I want to edit any attribute right where I read it, so I never hunt for an edit form.
- As a member, I want to add and remove related records from the record itself, from either side of a relationship.
- As a member, I want to see who changed what and when, including changes made while I'm looking, so I trust the data.
- As a member, I want to peek at records beside a table and step through them, so I can review a list quickly without losing my place.

**Acceptance criteria** (this spec owns AC-372 to AC-401):

*The page*
- **AC-372**: A record has a page at `/w/$slug/objects/$object/$recordId/$tab`, where `$object` is the object's API name and `$tab` is `overview` or `activity` (`notes` and `tasks` join with #19). `/w/$slug/objects/$object/$recordId` and an unknown tab redirect to `overview`. A reload reopens the same tab. The tab title is "<record name> · CRM". The top bar shows the object's icon tile and the crumbs "<Plural> › <record name>", the plural linking to the object's table.
- **AC-373**: The page shows RecordHeader (the record's avatar or tile, its name, the object's singular name, and a "Copy link" action), a tab bar with the main column under it, and the Details sidebar on the right. When the page's container is narrower than `bp-container-md`, the sidebar moves above the tabs inside a Disclosure titled "Details", closed by default. A record whose name is empty reads "Unnamed <singular>".
- **AC-374**: Details lists every visible, live, non system attribute of the object that holds one value or one record, in attribute order (one untitled section until #18). Each shows and edits in place through AttributeList and the field set's one editor per type: an edit shows at once, is saved through the data layer, and on a refusal rolls back with the message under the value and a toast with Retry. The primary attribute edits only here, and the header's name follows it at once. A relationship side that holds one record edits through the record picker with #15's rules ("At Acme", the move). A read only attribute shows its lock and reason and opens no editor.
- **AC-375**: After Details, the sidebar shows one section per visible relationship side that holds many records, in attribute order: the first 20 related records in that side's order, the total ("150,000 people", or "10,000+" when capped), "Show more" for 20 more each time, "Add" (the record picker, #15's search and move rules) and "Remove" on each row. An empty section reads "No <plural, lowercased> yet" with "Add". A row's name links to that record's page.
- **AC-376**: Every state is handled. Loading: header and Details skeletons after the loading delay, each tab with its own skeleton. A record that doesn't exist, is in the trash, or is hidden from the viewer shows one and the same EmptyState: "This record doesn't exist or you can't see it." with "Back to <Plural>"; nothing tells those three apart. A record deleted while open shows a danger Callout "This <singular> was deleted." above the page, closes any open editor, and turns the page read only. A failed load shows the error EmptyState with Retry. An archived object shows #13's archived page.
- **AC-377**: The page is live. A value changed in another browser, a link added or removed from either side, and a related record renamed or deleted elsewhere show on the page within 1 second without a reload. An editor open on the page keeps its draft while the value under it changes. When someone else's save replaces the member's own Details edit, spec 0006's replaced notice shows.

*Activity*
- **AC-378**: The Activity tab lists, newest first under the feed's period headings: the record's creation ("<actor> created this record"); each change of a visible attribute ("changed Stage from Lead to Won", "set Job title to CTO", "cleared Phone"); and each change on a relationship side, on whichever side it was made ("added Jane Doe to Team", "removed Jane Doe from Team", and on a side that holds one "changed Company from Acme to Globex"). Every entry names who and when. The values written by the create itself appear inside the creation entry, never as separate entries. System attributes and computed attributes (#16) never appear.
- **AC-379**: One write that adds or removes several links on one side reads as one entry naming up to 3 records and the rest as a count ("added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team"); each name links to its record. A write that only reorders a side makes no entry.
- **AC-380**: The feed loads 50 entries at a time by keyset cursor as the member scrolls, and ends with the creation entry. On the scale seed, the first page of the 150,000 person hub company and of a record with 10,000 value versions each returns within 300 ms at p95 in the database call; after scrolling 2,000 entries the feed stays smooth and its memory flat (it is virtualised).
- **AC-381**: The feed is live: a change to the record, made anywhere and from either side of a link, appears at the top within 1 second without a reload. When the member has scrolled down, the entry they are reading stays where it is on screen.
- **AC-382**: Hidden is absent in the feed: entries about an attribute the viewer can't see, and link entries whose other record the viewer can't see or is in the trash, are left out. An entry by a member who has since left reads "Former member"; by an API key "An API key"; by an automation "An automation"; by the system "System". A test with injected rules proves each.

*Overview*
- **AC-383**: Overview shows, in this order: "Recent activity" with the newest 5 entries and "View all" (opens the Activity tab); "Related", one Card per visible relationship side that holds many records, each with its first 5 records, the total, and "View all <N>" (moves focus to that side's section in the sidebar, opening the Details Disclosure first on a narrow page); Highlights from #18 above both once #18 lands; and Open tasks from #19 between them once #19 lands. Each block has its own loading and error state with Retry; a related card with no records reads "No <plural, lowercased> yet". Recent activity is never empty, since the creation entry is always there.

*The side panel*
- **AC-384**: In any object's table, a plain click on a record's name (or on a chip in a relation cell) opens RecordPanel beside the table with `?record=<id>` in the address; Cmd or Ctrl click and middle click open the full page in a new browser tab, since the name is a real link to it. The panel has the tabs Details (Details and the relationship sections, exactly as the page's sidebar) and Activity (the same feed), with Notes and Tasks from #19. The panel's tab is `?panelTab=` in the address, `details` by default. A reload reopens the panel on the same record and tab.
- **AC-385**: Previous and Next step through the table's rows in its current order. At the first or last row of the view the button is disabled. Stepping onto a row whose block isn't loaded yet loads that block first, with the button busy meanwhile. When the panel's record isn't among the rows the table holds (it left a filter, or the panel was opened from a link), both buttons are left out.
- **AC-386**: "Open full page" opens the record's page on Overview (or Activity when the panel showed Activity). Esc closes the panel and focus returns to the row it was opened from. A record deleted while its panel is open shows the deleted Callout in the panel and stays read only until closed.

*Across the feature*
- **AC-387**: Access follows spec 0009 everywhere on the page and the panel: a hidden record is absent (AC-376), hidden attributes and hidden related records are absent, a read only attribute or object shows its lock and reason, and a relationship side the member may not change shows no Add or Remove. `records.activity` passes the door and has an access table entry.
- **AC-388**: Opening a record page shows its header and Details within #12's 200 ms open record budget at p95, measured as #12 measures its `open` action (the `records.get` for one record, end to end at the API, locally on the scale seed), and every read goes through `packages/data` (`records.one`, the section sources, the activity source). Nothing on these screens polls the server; relative times and period headings update from the browser's own clock.
- **AC-389**: Every new screen part is built from tokens and library components only, works fully by keyboard with a visible focus ring, meets contrast in light and dark, and the record route loads lazily so the first load stays under 250 kB. Each milestone runs in production on brij-crm-phi.vercel.app.

## Decision

**Chosen option**: Option 1: a record page and panel assembled from the existing library modules over the one data layer, with the timeline built on read from the engine's history tables by one `getActivity` service that merges sources with a keyset cursor.

No activity table is written. The engine already keeps every value version (`values`, with `set_by` and `active_from`) and every link period (`record_links`, with `set_by`, `ended_by`, `active_from` and `active_until`); `getActivity` reads them through the access door, folds creation values, groups link changes per moment, and merges sources that later features add (notes and tasks from #19, comments from #29).

Calls made here (the brief's recommendations, taken, plus the gaps it left):
- Tabs Overview, Activity, Notes, Tasks; a fixed Details sidebar with one section per relationship side (brief).
- Overview shows related records 5 per side, the last 5 activity entries and open tasks (brief).
- Activity is built on read, keyset paged, creation values folded, system and computed attributes left out (brief).
- **Creation values fold by version id**: the create write stamps every value and link it writes with the new record's id as their version id, so the reader folds exactly the create's versions and nothing else (added here; the brief left the rule open).
- **Related sides page through `links.page`** (spec 0014), not `records.query` as the brief worded it: `links.page` already keeps the side's own order, caps the total and returns displays only, so related records never enter the record store as bodies.
- Adding related records uses `ReferencePicker` with spec 0014's `records.search` (brief).
- The name edits in Details only (brief).
- The panel opens on `?record=<id>` with Previous and Next over the table's own window (brief); its tab is `?panelTab=` (added).
- Comments in the timeline (named in the scope's "Done when") arrive with #29 through the slot built here; listed for the owner to confirm.

**Implementation skills**: `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `drizzle` (`.claude/skills/drizzle/`) · `neon-postgres` (`.claude/skills/neon-postgres/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`) · `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `tanstack-router-best-practices` (`.claude/skills/tanstack-router-best-practices/`) · `tanstack-virtual` (`.claude/skills/tanstack-virtual/`) · `react-aria` (`.claude/skills/react-aria/`) · `stories` (`.claude/skills/stories/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model

No new table. One engine rule change and one migration (milestone 2):

| Table | Change | Rules |
|---|---|---|
| `values`, `record_links` | none in shape. The create path (`insertRecord`, and the `writeAll` and `writeLinks` calls it makes) passes the new record's id as the `version_id` of every value and link it writes | a uuid v7 that no other write uses as a version id (they mint `uuidv7()`); there is no unique index on `version_id`, and every reader compares version ids per record and attribute only, so sharing one id across a record's attributes is safe. Records created before this change keep their random ids: their initial values show as separate entries right after creation (accepted, production holds little data) |
| `record_links` | two new partial indexes: `record_links_from_ended` on (`workspace_id`, `from_record_id`, `relationship_id`, `active_until`) and `record_links_to_ended` on (`workspace_id`, `to_record_id`, `relationship_id`, `active_until`), both `where active_until is not null` | serve "links removed before this moment" per side in time order; ended links are a small share of the table. Starts use the existing `record_links_from_history` and `record_links_to_history` |

### Engine service

`packages/core/src/engine/activity.ts` (new), one exported service with an access table entry `{ data: 'read' }`:

`getActivity(scope, { recordId, cursor?, limit })` → `{ entries: ActivityItem[], nextCursor?: string }`, inside `inWorkspace`. Sources, merge, fold and grouping are in [0017-activity.md](0017-activity.md). A source is a function registered in `ACTIVITY_SOURCES` in that file; #19 and #29 add theirs there, and nothing else changes.

### API surface

oRPC on `/api/rpc`; every procedure passes the `member` door; refusals as `{ code, message, data?: { refusals } }`.

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `records.activity` (new) | `workspace`, `recordId` uuid, `cursor?` string (≤ 512 characters), `limit` 1 to 50 (default 50) | `{ entries: ActivityItem[], nextCursor?: string }` | member, data `read` on the record's object | 404 `NOT_FOUND` (missing, trashed or hidden record, unknown workspace); 422 `FILTER_INVALID` "That page of activity can't be found. Reload to start again." (a cursor that doesn't decode); 503 `QUERY_CANCELLED` |
| `records.get`, `links.page`, `links.add`, `links.remove`, `records.search`, `records.setValues` | unchanged (specs 0005, 0006, 0014) | | | |

**ActivityItem** (Zod in `packages/contracts/src/activity.ts`, new; one name per schema and type): `{ id: string, at: string (ISO UTC, milliseconds), actor: Actor, kind: 'created' | 'change' | 'links' | 'note' | 'task' | 'comment', attributeId?: uuid, from?: unknown, to?: unknown, fromRefs?: RecordRefDisplay[], toRefs?: RecordRefDisplay[], added?: RecordRefDisplay[] (≤ 3), addedCount?: number, removed?: RecordRefDisplay[] (≤ 3), removedCount?: number, itemId?: uuid, title?: string, excerpt?: string, isDone?: boolean }`. `from` and `to` hold values in the attribute's own value shape (the same as `RecordView.values`); `fromRefs` and `toRefs` are set only for a side that holds one record. `note`, `task` and `comment` items are produced only once #19 and #29 register their sources; the client ignores a kind it has no mapping for.

**Status codes**: as spec 0005. No new code.

### Data layer (`packages/data`, the house rule: screens never fetch)

- The page and the panel read the record through `records.one(workspace, recordId, { attributeIds: 'all' })` (spec 0006): one body in the store, shared with every table showing it.
- `activity.forRecord(workspace, recordId)` (new) returns `{ source: ListSource<ActivityEntry>, status, retry }`: pages of 50 through `records.activity`, mapped to the library's `ActivityEntry` by `toActivityEntry(item, definitions)` (attribute from the definitions store through `toFieldAttribute`, actor displays from the members store, and the field set's display shapes). Its live rule is in [0017-activity.md](0017-activity.md).
- `activity.recent(workspace, recordId)` (new) is the same source cut to its first 5 entries, sharing the first page request when both are open.
- Relationship sections and Overview's related cards use spec 0014's section source per (record, attribute); the Overview card asks for `limit: 5`, the sidebar for 20.
- `records.view(...).neighbours(recordId)` (new on the window, spec 0006's windows) returns `{ previousId?, nextId?, loadPrevious(), loadNext() }` from the window's ordered ids; `loadNext` asks the window for the block holding the next row and resolves with its id. It returns nothing when the record isn't in a loaded block.
- Edits in Details go through `data.records.setValue` (one cell) and the link calls of spec 0014, so optimistic layers, rollback, versions, undo and the replaced notice all apply unchanged.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| route | which object | `$object` matched to `apiSlug` in the definitions store's objects |
| route | which record | `$recordId`, through `records.one`; absent from `records.get` means not found, trashed or hidden (all one state) |
| route | which tab | `$tab`; anything but `overview`, `activity` (and #19's `notes`, `tasks`) redirects to `overview` |
| header | name, avatar or tile, hue | `RecordView.display` (`RecordRefDisplay`: the primary attribute, "Unnamed <singular_name>" when empty, spec 0004 AC-19) |
| header | object label | the object's `singularName` |
| header | "Copy link" | the page URL without search params, written with the Clipboard API; toast "Link copied" |
| crumbs | plural and link | the object's `pluralName`; `/w/$slug/objects/$object` |
| tab title | text | `<display.name> · CRM` |
| Details | which attributes | the definitions store's attributes for the object: not archived, not system, visible (present in `attributes.list`), and not a relationship side that holds many (a record reference with `isMulti` true), by `position` |
| Details | each value | `RecordView.values[attributeId]`; displays from the field set and, for references, `RecordRefDisplay` in the read |
| Details | read only and its reason | `AttributeDefinition.readOnly.reason` (spec 0009), or the field set's own read only types |
| Details edit | the write | `data.records.setValue` for values; `links.add` or `links.remove` (spec 0014) for a side that holds one |
| sections | which sides | record reference attributes of the object, not archived, visible, `isMulti` true, by `position` |
| sections | rows, order, total | `links.page` through spec 0014's section source: side order, `RecordRefDisplay`, `{ count, atLeast }` |
| sections | the noun in "150,000 people" | the far object's `pluralName`, lowercased; the far object from `relationship.targetObjectIds[0]` |
| sections | whether Add and Remove show | the side's attribute has no `readOnly` and the object's `access` is `write` |
| activity | every entry | `records.activity`; see the value sourcing table in [0017-activity.md](0017-activity.md) |
| activity | actor name | `members.list` in the definitions store for a member; "Former member" when the id isn't among active members; "An API key", "An automation", "System" by actor type (`strings.ts`) |
| activity | period headings and "Today" | the ActivityFeed's own rule, in the provider's time zone (the browser's `Intl` time zone) |
| Overview | recent activity | `activity.recent`: the first 5 entries |
| Overview | related cards | the same sides as the sections; `links.page` with `limit: 5` |
| panel | which record and tab | `?record=<id>` and `?panelTab=` (`details` default; `activity`; #19's `notes`, `tasks`) in the table route's search params |
| panel | Previous and Next | `neighbours(recordId)` on the table's window |
| panel | "Open full page" target | `/w/$slug/objects/$object/$recordId/overview`, or `/activity` when the panel shows Activity |
| table | the name link | `href` to the record's page; a plain primary click is intercepted to open the panel |
| constants | 50, 5, 20, 3 | `ACTIVITY_PAGE` (50), `ACTIVITY_RECENT` (5), `RELATED_PREVIEW` (5) and `LINKS_SHOWN_PER_ENTRY` (3) in `packages/contracts/src/activity.ts`; 20 is spec 0014's `LINK_PREVIEW` |

### Key invariants

- The page holds no copy of a record: it reads the store's one body through `records.one`; related rows and activity entries are displays, never record bodies.
- The timeline is derived, never stored: deleting history is impossible from this feature, and the timeline always agrees with `getHistory` for every attribute.
- A version whose id equals the record's id is part of the creation, and only those versions are folded.
- Hidden is absent: no entry, row, count or message names an attribute or record the viewer can't see; a hidden record and a missing one answer the same.
- Activity reads touch only indexes keyed by the record (no scan grows with the workspace), and each source reads at most `limit + 1` groups per attribute or relationship side per page.
- Nothing here reads the database on a timer.

### Security model

- Every read passes the `member` door and `inWorkspace`; `getActivity` locks nothing and reads under forced row level security.
- `getActivity` checks the record with the record rule (spec 0009's record check), so a hidden record is `NOT_FOUND`; it reads only attributes `visibleAttributes` returns, and only far records that pass the record rule and are live.
- The cursor is opaque but untrusted: it is base64url JSON parsed with a strict Zod schema (an ISO instant, a rank 0 to 9, an id), and only used as query parameters.
- Writes on the page are the existing record and link procedures, with their own checks; this spec adds no write procedure.
- `security-access-reviewer` reviews milestones 2 and 4; `state-performance-reviewer` reviews every milestone.

### Configuration required

None. No new environment variable or service.

### Critical test scenarios

- Happy path: a member opens a company from the table's name, edits Domains and Stage in Details, adds a person to Team from its section, opens Activity and sees each change with who and when; a second browser on the same page sees every change within a second (Playwright, two browsers, locally and in production), verifies **AC-372** to **AC-375**, **AC-377**, **AC-378**, **AC-381**.
- Fold: create a deal with five values and two links; its Activity shows one creation entry; a value set later shows as its own entry; the linked company's Activity shows "added <deal> to Associated deals", verifies **AC-378**.
- Bursts: `links.add` with 100 people reads as one entry with 3 names and "97 others"; a reorder only write makes no entry; a one side replacement reads as one change, verifies **AC-379**.
- Scale: on the seed, the hub company's first activity page and a record with 10,000 versions each within 300 ms in the database call; 2,000 entries scrolled with flat memory; the record open within 200 ms; numbers in `verify.md`, verifies **AC-380**, **AC-388**.
- States: a missing id, a trashed record and a record hidden by an injected rule render the identical EmptyState; a record deleted in another browser turns the open page read only with the Callout, verifies **AC-376**, **AC-382**.
- Access: injected rules hide one attribute and one far record; their entries, rows and counts are absent from the page, the panel and `records.activity`, verifies **AC-382**, **AC-387**.
- Panel: open from a name, step with Next across a block boundary (busy, then the next row), reach the end (disabled), filter the record out (buttons left out), Esc returns focus to the row; Cmd click opens the page in a new tab, verifies **AC-384** to **AC-386**.
- Narrow: at a container below `bp-container-md` the sidebar sits in the closed Details Disclosure; "View all" on a related card opens it and focuses the section, verifies **AC-373**, **AC-383**.
- Quality: keyboard only runs through the page and panel, axe and contrast in both themes, the first load budget (`pnpm size`), verifies **AC-389**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 starts after #15's milestone 3 and #13's milestone 2.

**Milestone 1: the page, thin all the way through**
1. Engine: the create path stamps every value and link it writes with the new record's id as their version id; tests that `getHistory` and spec 0006's versions are unchanged for later writes, satisfies **AC-378**
2. Engine and contracts: `activity.ts` with `ACTIVITY_SOURCES` holding the creation source only, the merge and cursor; `ActivityItem` and the constants in `packages/contracts/src/activity.ts`; `records.activity` with its access table entry and the contract walking test, satisfies **AC-378**, **AC-382**, **AC-387**
3. Data layer: `activity.forRecord` and `activity.recent` (first page only, no live rule yet); `records.one` if #6 hasn't built it, satisfies **AC-374**, **AC-378**
4. Library: `RecordLayout` (new module) with stories for wide, narrow, loading and read only, README, `design-system-guardian`, artifact publish, satisfies **AC-373**, **AC-389**
5. Screen: the route files, top bar crumbs, RecordHeader with "Copy link", the Details sidebar editing in place, Overview with "Recent activity" (the creation entry), every page state from AC-376; the table's name becomes a link to the page; deploy; `ux-interaction-reviewer`, `state-performance-reviewer`, satisfies **AC-372** to **AC-374**, **AC-376**, **AC-377**, **AC-389**

**Milestone 2: the timeline**
6. Migration: `record_links_from_ended` and `record_links_to_ended`; guard tests rerun, satisfies **AC-380**
7. Engine: the value source and the link sources with the per moment grouping, the net diff for moments with both starts and ends, the fold, access filtering, the trashed far record rule; the reference test against `getHistory`; measured on the scale seed, satisfies **AC-378** to **AC-380**, **AC-382**
8. Library: the ActivityFeed variants (the `links` entry with names and "and N others", the `inline` layout for Overview, the anchor on prepend), stories, README, guardian, artifact publish, satisfies **AC-379**, **AC-381**, **AC-383**, **AC-389**
9. Data layer: paging as the feed scrolls, the live head refetch with its merge and coalescing, actor fallbacks, satisfies **AC-380** to **AC-382**
10. Screen: the Activity tab and Overview's "Recent activity" with "View all"; `verify.md` numbers; deploy; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-378** to **AC-383**, **AC-388**

**Milestone 3: related records and the Overview**
11. Library: the relationship section as a library module `RelatedRecords` (moved from #15's screen into `packages/ui` if #15 composed it there; otherwise its existing module gains a `limit` and a "View all <N>" footer variant), stories, README, guardian, artifact publish, satisfies **AC-375**, **AC-383**, **AC-389**
12. Screen: the sidebar's relationship sections with Show more, Add and Remove; Overview's Related cards with "View all" focusing the section (opening the narrow Disclosure first); every block's states; two browser Playwright run for links from either side; deploy; `ux-interaction-reviewer`, satisfies **AC-375**, **AC-377**, **AC-383**, **AC-387**

**Milestone 4: the side panel**
13. Data layer: `neighbours` on the window, satisfies **AC-385**
14. Library and screen: RecordPanel's `pendingStep` variant (stories, guardian, artifact publish); RecordPanel takes over #15's slice: `?panelTab=`, Details and Activity tabs, Previous and Next with busy and disabled states, "Open full page", the deleted state, Cmd click to a new tab; deploy; `ux-interaction-reviewer`, `security-access-reviewer`, satisfies **AC-384** to **AC-387**
15. Proof: the full Playwright flow locally and in production, keyboard, axe and contrast in both themes, `pnpm size`, the scale numbers in `verify.md`; `dxe quick` on the page and the panel, satisfies **AC-372** to **AC-389**

## Consequences

**Positive**:
- No activity table: no double write on every edit, no backfill, and the timeline can never disagree with the history it is built from.
- #19 and #29 add timeline entries by registering one source each; no screen changes for them.
- The page, the panel and the table share one record body, so an edit anywhere shows everywhere in the same frame.

**Negative / tradeoffs**:
- Each activity page runs a lateral read per visible attribute and per relationship side (up to a few hundred tiny index reads); fine at 250 attributes, measured in milestone 2, but heavier than reading one prebuilt table.
- Two more indexes on `record_links` add a little cost to every link end.
- Records created before milestone 1 show their initial values as separate entries after creation.
- Link entries whose far record is in the trash are left out, so restoring that record brings its old entries back (the timeline follows what can be seen now).
- Activity doesn't show deletes and restores of the record itself until #36's audit log, since the record row keeps only the latest delete.
- The scope's "comments in the timeline" waits for #29.

**Neutral**:
- One migration (two indexes) and one engine rule change (the creation version id). One new procedure (`records.activity`), one new library module (`RecordLayout`), library variants (ActivityFeed `links` entry and `inline` layout, RecordPanel `pendingStep`), and the relationship section as the library module `RelatedRecords`.
- No new dependency and no new error code.

## Open questions for the owner

1. **Can #17 be marked done before comments show in the timeline?** The scope's "Done when" names comments, which are #29's. Recommended: yes; #29 registers its source in the slot built here, with no screen change.
2. **Related records on the page page through `links.page`, not `records.query` as the brief worded it.** Recommended: accept; `links.page` (spec 0014) keeps the side's order, caps totals and keeps related records out of the record store.
3. **Records created before milestone 1 show their initial values as separate entries.** Recommended: accept, no backfill; production holds little data and a backfill would rewrite version ids clients hold.
4. **The timeline doesn't show the record's own delete and restore until #36.** Recommended: accept; the record row keeps only the latest delete, and the audit log is the right source.

## Follow-up

- [ ] **Owner**: answer the open questions above.
- [ ] **#18**: Details follows sections and adds the trailing Record group; Overview gets Highlights.
- [ ] **#19**: registers the note and task activity sources, the Notes and Tasks tabs on the page and the panel, and the Open tasks block.
- [ ] **#29**: registers the comment source.
- [ ] **#16**: `AttributeDefinition` must carry a computed flag the activity reader can skip.
- [ ] **#22**: a deleted record's page and panel offer "Restore" next to the Callout; the trash links to record pages.
- [ ] **#26**: presence fills RecordHeader's `viewers`.
- [ ] **#36**: record delete and restore entries in the timeline come from the audit log.
- [ ] **#12**: an `open` scenario that also loads the first activity page, at 100 online.
- [ ] `/sync`: spec 0003's inventory gains `RecordLayout` (and `RelatedRecords` if it moves); spec 0014's follow up for #17 is covered here.
