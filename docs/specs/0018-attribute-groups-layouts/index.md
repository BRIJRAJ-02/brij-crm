# 0018. Attribute groups and layouts: sections, order and highlights per object

**Date**: 2026-10-08
**Status**: Proposed

## Summary

An admin organises each object's attributes into named sections (About, Contact, Financials), orders them, chooses which attributes the record page shows, and picks up to six highlights for the record's Overview. That one layout is the workspace's for the object: the record page, the side panel, the create form, the settings page and the default column order of tables all follow it, and attributes hidden from the page stay in tables, filters and the API. Each person can fold sections and hide empty fields on their own screen, remembered in their browser. People, Companies and Deals start with sensible sections, and existing workspaces get them once by a migration.

## Structure

- [0018-screens.md](0018-screens.md): the settings page's sections, the dialogs, the highlights picker, the record page and panel following the layout, the personal fold and hide empty controls, the create form, and the library work.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #13 objects and attributes (spec 0012) | the Attributes tab, AttributeSettings, `attributes.reorder`, `attributes.update`, `attributes.archive` and `attributes.restore`, the generic create dialog, the definitions store with `definitions` events per object | none: hard prerequisite (milestone 1 here starts after #13's milestone 3) |
| #17 record page (spec 0017) | `RecordDetails` (the sidebar and the panel's Details tab) and Overview | none: hard prerequisite (milestone 1 here starts after #17's milestone 1; the Highlights block needs #17's Overview) |
| #9 access model (spec 0009) | `schema.manage` on every definition write (AC-135 already lists groups and layouts), `visibleAttributes` | none: #9's milestone 1 is a prerequisite of #13 already |
| #7 realtime (spec 0007) | `definitions` rows per object (AC-81 names attribute groups), with `item_ids` | none: the rows need nothing new; section ids go in the row's `item_ids` only, and the event keeps spec 0007's shape (no `groupIds`) |
| #6 client data (spec 0006) | the definitions store | none: #13 already depends on it |
| #20 table views | new views seed their columns from the default order | none: tables keep reading `attributes.position` |

## Requirements

**User stories**:
- As an admin, I want to group an object's attributes into named sections and order them, so a record reads the way my team thinks about it.
- As an admin, I want to keep some attributes off the record page without deleting them, so the page stays short while tables and filters keep them.
- As an admin, I want to pick the few attributes that matter most for each object, so they lead the record's Overview.
- As a member, I want the record page, the create form and settings to show the same sections in the same order, so I learn the layout once.
- As a member, I want to fold sections I don't use and hide empty fields, just for me, so my record page stays focused.

**Acceptance criteria** (this spec owns AC-402 to AC-431):

*Sections*
- **AC-402**: On an object's Attributes settings tab, an owner or admin creates a section ("New section"), giving a title of 1 to 100 characters that no other section of that object uses (ignoring case); the section appears at the end. A taken title is refused `NAME_TAKEN` on the field ("A section called <title> already exists."); the 51st section of one object is refused `LIMIT_REACHED` ("An object holds at most 50 sections.").
- **AC-403**: An admin renames a section, moves it up or down (by drag and by the menu's "Move up" and "Move down"), and deletes it after a confirm ("Delete <title>? Its <N> attributes move to the section without a title. No values change."). Deleting a section moves its attributes, archived ones included, to the untitled section after the attributes already there, in their order. No value, history or column is lost.
- **AC-404**: Each object has one attribute order: the untitled section first, then each section in its order, and within each, the admin's order. Moving an attribute within a section or into another (by drag, or the row menu's "Move up", "Move down" and "Move to section") changes that one order. The record page, the side panel, the create form, the Attributes tab and the default column order of every table of that object follow it.
- **AC-405**: A new attribute goes to the end of the section chosen in AttributeSettings' "Section" field, which defaults to the last section in order (so it is still the last column), or to the untitled section when the object has no sections. Editing an attribute's section moves it to the end of the new section.
- **AC-406**: Two admins moving attributes or sections at the same moment leave one order with no gaps and no duplicates: every move renumbers under the object's row lock, and the positions are always 0 to N minus 1 in display order after the system attributes.

*Shown on the record page*
- **AC-407**: Every attribute has "Show on record page", on by default, switched in AttributeSettings and in the row menu ("Hide from record page", "Show on record page"); a hidden one carries a "Hidden" badge in settings. A hidden attribute leaves the record page's and the panel's sections and the create form (unless it is required), and stays in tables, filters, sorts, views, the API and history. A hidden relationship side that holds many records loses its sidebar section and its Overview card.
- **AC-408**: On the record page and in the panel, attributes hidden from the page are listed last in a section "Hidden fields (<N>)", closed by default, where they still edit in place, so a member can reach them without settings.

*Highlights*
- **AC-409**: An admin picks up to 6 highlights per object in settings ("Edit highlights"), in order, from any live, shown, non system attribute that is not a relationship side holding many records. The 6 count the highlights the admin can see; a 7th is refused `CONFIG_INVALID` "Up to 6 highlights.", and a hidden one, a system one, an archived one, or a side that holds many records is refused `CONFIG_INVALID` with its reason. Hiding or archiving a highlighted attribute removes it from the highlights in the same write.
- **AC-410**: The record's Overview opens with a "Highlights" block showing each highlight's title and value as tiles, in order, editing in place through the same field set editors as Details. With no highlights the block is left out.

*The record page and panel follow the layout*
- **AC-411**: Details shows the untitled section first with no heading, then each section with at least one shown attribute the viewer can see, as a titled foldable group in order, then "Hidden fields" (AC-408), then a trailing "Record" group with Created at, Created by, Updated at, Updated by and Record ID, read only with the reason "Set by the system." Sections with nothing to show are left out.
- **AC-412**: Each person can fold and unfold every group, and switch "Hide empty fields" from the Details menu. Both are remembered per person, per workspace and object, in this browser. Defaults: every section open, "Record" and "Hidden fields" closed, empty fields shown. An attribute the person empties while hiding empty fields stays visible until they leave the page. When the browser's storage is unavailable, the defaults apply and nothing breaks.

*The create form and settings follow the layout*
- **AC-413**: The create dialog shows the primary attribute, then every required attribute in layout order, then "Add more fields", which reveals the rest of the shown attributes under their section titles in layout order (the untitled ones first, with no title).
- **AC-414**: The Attributes tab lists "No section" first (always, so attributes can be dropped there), then each section with its title, attribute count and menu, then #13's System and Archived sections. Each section's menu holds "Add attribute here", "Rename", "Move up", "Move down" and "Delete". Moving works by drag and fully by keyboard, and a live region announces "<Title> moved to <Section>, position <N> of <M>".

*Templates and existing workspaces*
- **AC-415**: A new workspace's People get sections About and Contact, Companies get About and Company, Deals get Deal, with the attributes and highlights listed in this spec's template table, and template version 2.
- **AC-416**: The migration upgrades every standard object still at template version 1, in every workspace, once: it creates the same sections, assigns the template's attributes by API name, sets the highlights, puts any custom attribute already on the object into a last section "More" (so existing tables keep those columns last), renumbers positions, and sets template version 2. Running it again changes nothing.

*Across the feature*
- **AC-417**: Every section, move, show or hide, and highlights change reaches every open record page, panel, settings page, create dialog and table of the workspace within 1 second at p95 without a reload.
- **AC-418**: Every write here needs `schema.manage` (spec 0009 AC-135): a member gets 403 `FORBIDDEN`, nothing is written and no outbox row is stored. Members see the Attributes tab's sections read only, with no section controls. Folding and "Hide empty fields" work for everyone.
- **AC-419**: Hidden is absent: a section whose attributes are all hidden from the viewer is left out of `attributeGroups.list` for them, and so out of every screen; a section with no attributes at all is listed (settings shows it) but never shown on a record page; highlights leave out attributes the viewer can't see, and a viewer sees at most the first 6 of the ones they can; setting highlights keeps highlighted attributes the admin can't see, after the ones they chose, even past 6 in total (the limit counts only what the admin sees).
- **AC-420**: Creating a section with a client minted id, then repeating the call after a lost answer, returns the same section and writes nothing twice; the same id under another object answers `ID_TAKEN`.
- **AC-421**: Sections work on lists too (`listId` instead of `objectId`) through the API, with the same rules and limits; no list screen shows them yet.
- **AC-422**: Every screen part here is built from tokens and library components only, works fully by keyboard (moving attributes and sections included) with a visible focus ring, meets contrast in light and dark, and keeps the first load under 250 kB. Each milestone runs in production.

## Decision

**Chosen option**: Option 1: a per object (or per list) `attribute_groups` table, three attribute columns (`group_id`, `shown_on_record_page`, `highlight_position`), and one contiguous attribute order that every screen reads.

Calls made here (the brief's recommendations, taken, plus the gaps it left):
- One layout per object for the whole workspace; folding and hide empty are personal and stay in the browser (brief).
- Order is section position, then attribute position, with an untitled leading section (brief). **Positions are kept contiguous in display order**, so tables (which order by `position`) follow the sections with no change to any reader (added).
- Deleting a section is a hard delete; its attributes move to the untitled section (brief).
- System attributes show in a trailing read only "Record" group (brief).
- Template version 2 adds default sections with a versioned backfill (brief). **Custom attributes found by the backfill go to a last "More" section** so existing column orders stay put (added).
- Editing happens in #13's Attributes tab (brief).
- `list_id` allowed now (brief).
- Highlights: up to 6 on Overview (brief), stored on the attribute (`highlight_position`) so one `attributes.list` refetch carries them, and never a relationship side holding many records (a many side can only change by deltas, spec 0014). The 6 count what the admin setting them can see; highlights hidden from that admin are kept after, so one admin can never drop another's highlight they can't see (cross check of 8 October 2026).
- **Hidden attributes stay reachable** in a closed "Hidden fields" section on the record page (owner decision, see Owner decisions).
- **The create form leaves out attributes hidden from the page unless required** (owner decision).
- **Section ids travel in `definitions` rows' `item_ids` only** (cross check): the event gains no `groupIds`, since every client refetches the object's attributes and sections on any `definitions` event naming it.
- **`attributes.reorder` moves by section and index** (cross check): `groupId` and `index`, replacing spec 0012's absolute `position` input (an amendment in Follow-up).

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `drizzle` (`.claude/skills/drizzle/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `domain-modeling` (`mattpocock/skills`, `.claude/skills/domain-modeling/`) · `react-aria` (`.claude/skills/react-aria/`) · `building-components` (`.claude/skills/building-components/`) · `stories` (`.claude/skills/stories/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model

One migration (milestone 1), with the template backfill in the same migration.

| Table | Change | Rules |
|---|---|---|
| `attribute_groups` (new) | `workspace_id`, `id` uuid v7 (client chosen, the replay key), `object_id` uuid null, `list_id` uuid null, `title` text not null, `position` integer not null, audit columns (`created_*`, `updated_*` actors, `actorConstraints`) | Primary key (`workspace_id`, `id`). Check: exactly one of `object_id`, `list_id`. Foreign keys (`workspace_id`, `object_id`) → `objects` and (`workspace_id`, `list_id`) → `lists`. Unique indexes `attribute_groups_object_title` on (`workspace_id`, `object_id`, `lower(title)`) where `object_id` is not null, and `attribute_groups_list_title` on (`workspace_id`, `list_id`, `lower(title)`) where `list_id` is not null; a clash maps to `NAME_TAKEN`. Index (`workspace_id`, `object_id`, `position`) and (`workspace_id`, `list_id`, `position`). Forced row level security, the standard policy. Hard deleted, never archived. |
| `attributes` | new `group_id` uuid null | Foreign key (`workspace_id`, `group_id`) → `attribute_groups` `on delete set null (group_id)`. Index (`workspace_id`, `group_id`) for that key. The service refuses a group of another object or list (`CONFIG_INVALID` "That section belongs to another object."). System attributes never get a group. |
| `attributes` | new `shown_on_record_page` boolean not null default true | Adding it with a constant default rewrites nothing. |
| `attributes` | new `highlight_position` smallint null, check `>= 0` | Unique per object by the service, under the object's row lock (a partial unique index can't be deferred, and a reorder swaps values). Only on live, shown, non system attributes that are not a relationship side holding many records. At most 6 are ones a given admin sees when they set them; highlights hidden from that admin are kept after, so positions can pass 5. |
| `objects` | `template_version` becomes 2 for upgraded standard objects | existing column |

**The order invariant**: for each object (or list), the non system attributes, archived included, have positions `S` to `S + N - 1` (S = the number of system attributes, 5) in display order: untitled first, then by section `position`, then by their own order. Every write that changes a section's position, deletes a section, moves an attribute, creates an attribute or changes its section renumbers in one statement under the parent's row lock:

```sql
update attributes a set position = n.rn
from (
  select a2.id, $system_count + row_number() over (
    order by g.position nulls first, a2.position, a2.id) - 1 as rn
  from attributes a2 left join attribute_groups g
    on g.workspace_id = a2.workspace_id and g.id = a2.group_id
  where a2.workspace_id = $ws and a2.object_id = $object and not a2.is_system
) n
where a.workspace_id = $ws and a.id = n.id and a.position <> n.rn
```

A move of one attribute is exact instead: under the lock it reads the object's non system attribute ids in display order (at most 250), sets the moved attribute's `group_id`, splices its id into the target section at the requested index, and writes every changed position in one `update … from (values …)` statement. Sections move the same exact way (read their ids in order, splice, write positions 0 to K minus 1), and then the statement above renumbers the attributes.

### Template version 2

`STANDARD_TEMPLATE_VERSION` becomes 2 in `packages/core/src/templates/standard-v1.ts`, and a new `packages/core/src/templates/standard-layout.ts` exports `STANDARD_LAYOUT` (sections by title with their attributes by API name, and highlights by API name). `createUserWorkspace` applies it after the standard relationships exist. The migration applies the same table to objects at version 1.

| Object | Untitled | Sections, in order, with their attributes in order | Highlights, in order |
|---|---|---|---|
| People | `name` | About: `company`, `job_title`, `description`, `owner`, `primary_location`, `timezone`, `avatar`, `associated_deals`. Contact: `email_addresses`, `phone_numbers`, `linkedin`, `twitter`, `facebook`, `instagram`, `angellist`, `email_opt_out` | `email_addresses`, `phone_numbers`, `company`, `job_title`, `owner`, `primary_location` |
| Companies | `name` | About: `description`, `categories`, `owner`, `parent_company`, `primary_location`, `logo`. Company: `domains`, `phone`, `employee_range`, `estimated_arr`, `annual_revenue`, `funding_raised`, `foundation_date`, `linkedin`, `twitter`, `facebook`, `instagram`, `angellist`, `team`, `subsidiaries`, `associated_deals` | `domains`, `categories`, `employee_range`, `estimated_arr`, `owner`, `primary_location` |
| Deals | `name` | Deal: `stage`, `value`, `owner`, `close_date`, `probability`, `associated_company`, `associated_people`, `source`, `deal_type`, `next_step`, `lost_reason`, `description` | `stage`, `value`, `owner`, `close_date`, `associated_company`, `probability` |

The migration, per standard object at version 1 (set based, one statement per step): insert the sections with `uuidv7()` ids and the creating actor `system`; set `group_id` on attributes whose `api_slug` the table lists; put every other non system, non primary attribute into a new last section "More" (only when there is at least one); set `highlight_position` for listed highlights that exist, are not archived and are shown; renumber; set `template_version = 2`. An attribute the table names but the object lacks is skipped. Objects at version 2 or with no `standard_key` are untouched, so a second run changes nothing.

### Engine services (`packages/core/src/engine/groups.ts`, new; changes in `definitions.ts`)

Each takes the scope, runs in `runWrite`, checks `schema.manage` at the definition write choke point (spec 0009), locks the parent object or list row `for update`, and records `definitions: [{ objectId | listId, attributeIds, itemIds }]` in its `Change` (`itemIds` the section ids touched, stored in the row's `item_ids`).

| Service | What it does |
|---|---|
| `insertGroup(scope, { id?, parent, title, position? })` | checks the id (replay returns the existing group under the same parent, `ID_TAKEN` otherwise), the title (`checkName`, 1 to 100), the room (`checkGroupRoom`, `LIMITS.groupsPerParent` = 50 in `limits.ts`), inserts at `position` (default last), renumbers sections |
| `updateGroup(scope, { groupId, title })` | renames; `NAME_TAKEN` on a clash |
| `reorderGroup(scope, { groupId, position })` | moves the section, renumbers sections, then attributes |
| `deleteGroup(scope, { groupId })` | deletes the row (the foreign key nulls `group_id` on its attributes), renumbers sections and attributes; returns the moved attribute ids |
| `listGroups(scope, parent)` | sections by `position`, leaving out any section that has attributes and none the principal can see (`visibleAttributes`) |
| `reorderAttribute` (changed, from #13) | takes `groupId?` (`undefined` keeps the section, `null` is untitled) and `index`, the place within the target section (0 first, clamped to its size); sets the section and renumbers. Spec 0012's absolute `position` input is removed |
| `insertAttribute` (changed) | takes `groupId?` (default: the last section by position, else untitled) and `showOnRecordPage?`; lands at the end of its section; renumbers |
| `updateAttribute` (changed) | takes `groupId?` (moves to the end of that section) and `showOnRecordPage?`; turning it off clears `highlight_position` and renumbers the remaining highlights |
| `archiveAttribute` (changed) | clears `highlight_position` and renumbers the remaining highlights in the same write |
| `setHighlights(scope, { objectId, attributeIds })` (new, in `definitions.ts`) | at most 6 distinct ids (a 7th is `CONFIG_INVALID` "Up to 6 highlights."), each a live, shown, non system attribute of that object that is not a relationship side holding many records (else `CONFIG_INVALID` naming the reason); keeps highlighted attributes the principal can't see after the given ones, in their order, whatever the total; writes `highlight_position` 0 to N minus 1 and clears it on the rest |

### API surface

oRPC on `/api/rpc`; each through the `member` door; every write takes a `mutationId`, is composed with `writeHooks`, and needs `schema.manage`. Refusals answer `{ code, message, data?: { refusals } }`.

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `attributeGroups.list` | `workspace`, `objectId` or `listId` | `AttributeGroup[]` by position | member | 404 |
| `attributeGroups.create` | `workspace`, `id` uuid v7, `objectId` or `listId`, `title`, `position?`, `mutationId` | `AttributeGroup` | `schema.manage` | 403 `FORBIDDEN`; 404; 409 `NAME_TAKEN`, `LIMIT_REACHED`, `ID_TAKEN`; 422 `CONFIG_INVALID` |
| `attributeGroups.update` | `workspace`, `groupId`, `title`, `mutationId` | `AttributeGroup` | `schema.manage` | 403; 404; 409 `NAME_TAKEN`; 422 |
| `attributeGroups.reorder` | `workspace`, `groupId`, `position`, `mutationId` | `AttributeGroup[]` | `schema.manage` | 403; 404 |
| `attributeGroups.delete` | `workspace`, `groupId`, `mutationId` | `{ movedAttributeIds: uuid[] }` | `schema.manage` | 403; 404 |
| `attributes.reorder` (changed) | `workspace`, `attributeId`, `groupId?: uuid \| null` (absent keeps the section), `index` (integer ≥ 0, the place within the target section, clamped), `mutationId`; spec 0012's `position` input is removed, and the strict schema refuses a call still sending it (400 `INPUT_INVALID`) | `AttributeDefinition[]` | `schema.manage` | as #13; 422 `CONFIG_INVALID` (another object's section) |
| `attributes.create`, `attributes.update` (changed) | add `groupId?`, `showOnRecordPage?` | `AttributeDefinition` | `schema.manage` | as #13; 422 `CONFIG_INVALID` |
| `attributes.setHighlights` (new) | `workspace`, `objectId`, `attributeIds` (0 to 6), `mutationId` | `AttributeDefinition[]` (the object's) | `schema.manage` | 403; 404; 422 `CONFIG_INVALID` |
| `attributes.list` (changed) | as #13 | each `AttributeDefinition` adds `groupId: uuid \| null`, `showOnRecordPage: boolean`, `highlightPosition: number \| null` (attributes the caller can't see are absent, so the numbers may have gaps; clients order by them) | member | as #13 |

**AttributeGroup** (Zod, `packages/contracts/src/groups.ts`, new): `{ id, objectId?, listId?, title, position }`.

**Status codes**: as spec 0012. No new code (`NAME_TAKEN` is #13's).

**Events**: every write above stores one `definitions` outbox row for its object or list, with `attribute_ids` the attributes whose section, position, visibility or highlight changed, and `item_ids` the section ids touched (spec 0007's `item_ids`); the event itself keeps spec 0007's shape, with no `groupIds`. The client refetches the object's attributes and sections on any `definitions` event naming the object (a reorder changes every position, so a partial patch would be wrong).

### Data layer (`packages/data`)

- The definitions store gains `groups(objectId)` (and `groups({ listId })`), loaded together with `attributes(objectId)` on first ask and refetched together on a `definitions` event naming that object; `@crm/data/react` adds `useGroups(objectId)`.
- `recordLayout(attributes, groups)` (new, pure, `packages/data/src/layout.ts`) returns `{ untitled, sections: [{ group, attributes }], hidden, record, manySides, highlights }`: live, visible attributes split as the record page shows them (spec 0017's Details rule: many sides go to `manySides`; `shownOnRecordPage` false to `hidden`; system ones to `record` in the order Created at, Created by, Updated at, Updated by, Record ID; `highlights` by `highlightPosition`). The record page, the panel, the create form and settings all read it, so the order rule lives in one place.
- Section writes, moves, show or hide and highlights are server confirmed, never optimistic (spec 0012's rule for definition writes): the control shows busy, then the store refetches.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| any write | who may | `can(scope.access, 'schema.manage')` (spec 0009) |
| any write | actor and times | `scope.actor` and the transaction's `now()` |
| section create | id | the client's uuid v7 |
| section create | position | `position` input, else `max(position) + 1` under the parent's lock |
| section create | room | `count(*)` of the parent's sections under its lock, against `LIMITS.groupsPerParent` (50) |
| attribute create | its section | `groupId` input; else the last section by `position`; else untitled |
| attribute create or move | its position | the order invariant's renumber |
| section delete | where its attributes go | untitled, after the existing untitled ones (they keep their relative order through the renumber) |
| highlights | which and in what order | `attributes.highlight_position` ascending; a viewer gets the first 6 they can see |
| highlights | the 6 limit | the ids given (all visible to the admin), against `MAX_HIGHLIGHTS`; hidden highlights kept after them don't count |
| record page | sections and their order | `recordLayout(attributes, groups)` from the definitions store |
| record page | fold state and hide empty | `localStorage` key `crm:record-layout:v1:<workspaceId>:<objectId>`, JSON `{ "collapsed": [sectionId], "expanded": [sectionId], "hideEmpty": boolean }`; `record` and `hidden` are the ids of the two built in groups; read and written inside try/catch; missing or unreadable means the defaults |
| record page | which values are empty | the field set's `isEmptyValue(value)` (`packages/ui/src/fields/values.ts`, spec 0003) |
| record page | attributes kept while hiding empty | the attribute ids the person committed on this page since it opened (component state) |
| "Record" group | its reason | the fixed string "Set by the system." (`strings.ts`) |
| create dialog | fields and headings | `recordLayout`: primary, then `isRequired` ones in layout order, then the rest of `untitled` and `sections` (hidden ones only when required) |
| settings | sections, counts, badges | `attributes.list({ includeArchived: true })` and `attributeGroups.list`; count = live attributes in the section |
| settings | the live region text | the moved attribute's title, the target section's title (or "No section"), its new index plus one, the section's size |
| tables | default column order | `attributes.position` (unchanged reader; the invariant makes it the layout order) |
| constants | 50, 6, 100 | `LIMITS.groupsPerParent` in `limits.ts`; `MAX_HIGHLIGHTS` and `SECTION_TITLE_MAX` in `packages/contracts/src/groups.ts` |

### Key invariants

- One layout per object or list, the workspace's; personal fold and hide empty never reach the server.
- Positions of non system attributes are contiguous in display order at every commit, so ordering by `position` is the layout order everywhere.
- A section belongs to exactly one object or list, and its attributes to the same one.
- Deleting a section never changes a value, a history row, an attribute or a link.
- Highlights have distinct positions, all on live, shown, non system attributes that are not a relationship side holding many records; any admin sees at most 6 they set, and no admin's write drops a highlight hidden from them.
- Every write here stores exactly one outbox row; a refused one stores none.
- Hidden is absent: no section title, count or highlight reveals an attribute the viewer can't see.

### Security model

- Every write needs `schema.manage` at the definition write choke point; the client hides controls but never decides.
- `attributeGroups.list` and `attributes.list` are member reads through the door, filtered by `visibleAttributes`.
- Titles are plain text, 1 to 100 characters, rendered as text; ids are uuid shaped and checked inside the workspace.
- `localStorage` holds only section ids and a flag, never record data, and is keyed by workspace.
- `security-access-reviewer` reviews milestone 1; `state-performance-reviewer` reviews the definitions store change in milestone 1.

### Configuration required

None.

### Critical test scenarios

- Happy path: an admin creates "Financials" on Companies, moves Annual revenue and Funding raised into it, renames it, moves it above Company, hides Logo, and sets highlights; a second browser's company page, panel, create dialog and Companies table follow within a second (Playwright, two browsers), verifies **AC-402** to **AC-405**, **AC-407**, **AC-409** to **AC-411**, **AC-417**.
- Delete: deleting a section with an archived attribute moves both to untitled after the existing ones; values unchanged, verifies **AC-403**.
- Order invariant: random concurrent moves, section reorders, deletes, creates and archives from two connections end with positions contiguous and equal to the reference order, verifies **AC-404**, **AC-406**.
- Highlights: the 7th ("Up to 6 highlights."), a hidden, a system, an archived and a many side refused with their reasons; hiding and archiving remove it; an admin missing one field sets 6 and the hidden highlight is kept seventh; a viewer who sees all 7 gets the first 6, verifies **AC-409**, **AC-419**.
- Hidden fields and the create form: a hidden attribute shows in the closed "Hidden fields" section and edits there; the create dialog shows required ones first, then sections under their titles, leaving out a hidden optional attribute and keeping a hidden required one, verifies **AC-408**, **AC-413**.
- Personal: fold, hide empty, reload, still folded; edit a value to empty while hiding empty, it stays until leaving; storage blocked, defaults apply, verifies **AC-412**.
- Template: a new workspace has the sections and highlights; the migration run on a copy of a version 1 workspace with one custom attribute creates "More", and a second run changes nothing, verifies **AC-415**, **AC-416**.
- Permission: a member's call to each write gets 403 with no row and no outbox row; the settings page renders without section controls, verifies **AC-418**.
- Access: injected rules hide every attribute of one section; it is absent from the list, the page and the create form, verifies **AC-419**.
- Replays and lists: a repeated create returns the same section; the same id on another object answers `ID_TAKEN`; sections on a list through the API follow the same rules, verifies **AC-420**, **AC-421**.
- Quality: moving an attribute between sections by keyboard only with the announcement; axe and contrast in both themes; `pnpm size`, verifies **AC-414**, **AC-422**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 starts after #13's milestone 3 and #17's milestone 1.

**Milestone 1: the model, the services, and a record page that follows them**
1. Migration: `attribute_groups`, the three attribute columns, the indexes and policy, and the template backfill (with "More"); guard tests (forced row level security and a policy on the new table, cross workspace read) rerun, satisfies **AC-402**, **AC-415**, **AC-416**
2. Contracts: `AttributeGroup`, the widened `AttributeDefinition`, the `attributeGroups.*` and `attributes.setHighlights` contracts, `attributes.reorder` with `groupId` and `index`, the constants; no change to the `definitions` event, satisfies **AC-402**, **AC-404**, **AC-409**, **AC-417**
3. Engine: `groups.ts`, the renumber and the order invariant, the changes to `insertAttribute`, `updateAttribute`, `archiveAttribute` and `reorderAttribute`, `setHighlights`, `checkGroupRoom`, access table entries, template version 2 in `createUserWorkspace`; the invariant's randomized test, satisfies **AC-402** to **AC-406**, **AC-409**, **AC-415**, **AC-419** to **AC-421**
4. Procedures: `attributeGroups.*`, `attributes.setHighlights`, the changed `attributes.*`; the contract walking test, satisfies **AC-402** to **AC-405**, **AC-409**, **AC-418**, **AC-420**
5. Data layer: `groups(objectId)` in the definitions store with its event rule, `recordLayout`, satisfies **AC-404**, **AC-417**
6. Screen: `RecordDetails` (spec 0017) renders untitled, then sections as titled groups, from `recordLayout`; deploy; check a production workspace shows About and Contact on a person; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-411**, **AC-417**

**Milestone 2: settings**
7. Library: `AttributeSections` (new module; its first story proves a cross section drag by pointer and by keyboard, and into an empty section, on the pinned `react-aria-components` 1.21.1 before the rest is built, else it switches to the fallback in [0018-screens.md](0018-screens.md)) and the ViewSettings `maxShown` variant, stories, README, guardian, artifact publish, satisfies **AC-409**, **AC-414**, **AC-422**
8. Screens: the Attributes tab's sections (New section, Rename, Move, Delete with its confirm, Add attribute here, Move to section, Hide or Show on record page, the Hidden badge), "Edit highlights", AttributeSettings' Section field and switch; members read only; deploy; `ux-interaction-reviewer`, satisfies **AC-402** to **AC-405**, **AC-407**, **AC-409**, **AC-414**, **AC-418**

**Milestone 3: everywhere follows**
9. Library: AttributeList variants (controlled folding, `hideEmpty` with kept ids, the `grid` layout, the heading with a menu) and the Form `FormSection` variant, stories, README, guardian, artifact publish, satisfies **AC-410** to **AC-413**, **AC-422**
10. Screens: Details with "Hidden fields" and "Record", folding and hide empty remembered per person; the panel's Details tab the same; Overview's Highlights block; the create dialog by layout, satisfies **AC-407** to **AC-413**
11. Proof: the two browser flow for every change kind with timings, the keyboard and contrast passes, `pnpm size`, `verify.md`; deploy; `ux-interaction-reviewer`, `design-system-guardian`, satisfies **AC-417**, **AC-419**, **AC-422**

## Consequences

**Positive**:
- One order serves every screen and every table, so nothing can disagree about where an attribute goes.
- Highlights and sections ride the existing `attributes.list` and `definitions` events; no new channel or store.
- Lists get sections for free when their screens arrive.

**Negative / tradeoffs**:
- Every move renumbers up to 250 rows; cheap, but it changes every position, so every client refetches the object's attribute list on any layout change.
- The default table column order now follows sections, which changes #13's rule that the order is set only by dragging attributes (the same control now, with sections around it); existing workspaces see their standard columns regrouped once by the migration.
- A custom attribute added later without a section lands at the end of the last section, not untitled, which surprises an admin who expects "no section".
- Folding and hide empty don't follow a person to another browser or device.
- Highlights can't show a relationship side that holds many records.

**Neutral**:
- One migration (a table, three columns, a backfill). One new library module (`AttributeSections`), variants on AttributeList, ViewSettings and Form.
- No new dependency and no new error code.

## Owner decisions

Decided under the owner's acceptance of the recommended defaults for #11 to #22 (3 October 2026, confirmed for this spec on 8 October 2026):
1. **A table's default column order follows the sections.** One order everywhere is simpler to learn, and saved views (#20) keep their own order anyway.
2. **Custom attributes found when the migration adds the template sections go to a last section "More"**, so existing tables keep those columns last.
3. **Attributes hidden from the record page stay reachable there**, in a closed "Hidden fields (N)" section at the end of Details.
4. **The create form leaves out attributes hidden from the record page**, unless they are required.
5. **A highlight can't be a relationship side that holds many records** in v1; those change only by adding and removing links, which a tile editor can't do safely.

## Follow-up

- [ ] **#20**: a new view's column order seeds from `attributes.position`; saved views keep their own order.
- [ ] **#23 or later**: folding synced per member on the server, if people ask.
- [ ] **Lists (#51 or the lists feature)**: the list settings page and entry pages show sections.
- [ ] **#56**: the schema map may show sections inside each object card.
- [ ] **Spec 0012** (`/sync`): AC-229 and AC-232 (new attributes at the end of the chosen section; order set in sections); `attributes.reorder` takes `groupId` and `index` in place of its absolute `position` input (amendment); `AttributeDefinition` gains `groupId`, `showOnRecordPage` and `highlightPosition`.
- [ ] `/sync`: spec 0003's inventory (`AttributeSections`, the AttributeList variants). Spec 0007's `definitions` event is unchanged; section ids ride `item_ids` only.
