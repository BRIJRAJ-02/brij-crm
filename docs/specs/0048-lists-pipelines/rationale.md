# 0048. Lists and pipelines: rationale

## Context

Scope #51 asks for "collections of records with fields of their own, such as a hiring pipeline over People or a partner list over Companies", done when a member makes a list over any object, adds records one by one or in bulk, gives the list its own fields such as a stage, puts one record in many lists, and sees the list as a table and a board.

Most of the ground is already laid. Spec 0004 built `lists`, `list_entries`, entry values with full history, entry sort keys, and a query engine that filters and sorts a list by its own fields and its records' fields (`queryPage({ listId })`). `addEntry`, `removeEntry`, `restoreEntry` and `getRecordEntries` exist and lock in one order. Spec 0007 defined the `entries` event and `listId` on `definitions` and `views` events. Spec 0020's `views` table already has `list_id`. Spec 0034 reserved the sidebar's Lists section and the `list` nav kind. What is missing is everything a person touches: no API procedure, no client store, no screen, and the one permission check on lists (`schema.manage`) assumes only admins make them.

The forces: the scale budget (a million records, 100 people online, room for 1,000) applies to a list as much as to an object, and spec 0004 already promised that a 200,000 entry list filters and sorts as fast as an object view. Access must stay one door (spec 0009), and spec 0032 already decided that a list follows its object in this slice. Every change must show live within a second (spec 0007). The client has one data layer with one copy of each thing (spec 0006), and a list row shows two things at once: the entry's own fields and the record's. The owner wants a clickable product early and delegates product and UX calls, and the house rules ask for full width pages, every setting under Settings, a Modal before ending actions, and one click Undo for deletes.

Leaving it undecided keeps Deals without a pipeline. Today a team runs stages only through a status field on the object itself, so a deal can be in one pipeline only, and a person can't be in a hiring process and an event list with separate statuses.

## Options considered

### Option 1: Attio style lists, entries with fields of their own (chosen)

A list is a parent of attributes and views, as an object is. Entries are rows that point at a record and carry their own values. A list page shows entries as a table or a board with the record's fields alongside. The record page shows every entry of the record.

**Pros**:
- The engine, values, history, sort keys, events and the views table already model it; the work is API, client and screens.
- One record in many pipelines, each with its own stage and owner, which is the scope's done line.
- Views, boards, bulk edit and import are widened from "object" to "object or list" rather than rebuilt.

**Cons**:
- Every parent taking call site (views, attributes, options, bulk, imports) widens to a union.
- A row joins two stores in the browser and two tables in SQL.
- People must learn the difference between a record's field and a list's field.

### Option 2: pipelines as status fields on the object (HubSpot, Pipedrive)

A pipeline is a status attribute on Deals (several pipelines are a "Pipeline" select plus one status each), and a "list" is a saved filtered view. No entries at all.

**Pros**:
- Nothing new in the data model or the client; boards already work on objects (spec 0021).
- Familiar to anyone from HubSpot or Pipedrive.

**Cons**:
- A record sits in one stage of one pipeline only; a person can't be in Hiring and Events with two statuses.
- Fields that matter only to one process pile up on the object for everyone.
- Fails the scope's "one record can sit in many lists" and "fields of their own".

### Option 3: groups that mix objects (Folk)

A group is a top level space holding people and companies together, with group fields and a pipeline view, and its own sub views.

**Pros**:
- One place per process, even when it spans people and companies.

**Cons**:
- A list over two objects breaks the engine's rule that an entry's list holds one object's records (spec 0004, AC-6), its typed columns and its query compilation.
- Access by object (spec 0032) no longer says who sees a group.

### Option 4: lists as a multi select tag on records

A "Lists" multi select on every object; a list page is a view filtered by that tag.

**Pros**:
- Smallest build: one attribute and a sidebar entry per option.

**Cons**:
- No fields of their own and no stage per list; the tag only says "in or out".
- Tag options per object cap at 500 and leak list names to everyone who reads the object.

## Rationale

Option 1 is the only one that meets the scope's done line ("fields of their own", "one record in many lists") and it is also the cheapest of the ones that do, because spec 0004 already paid for the data model and the query engine. The remaining work is widening, not inventing: `views`, `attributes`, `options`, `bulk` and `imports` learn that a parent can be a list, and the client learns an entry store that is the record store's twin. That keeps one view model, one board and one bulk path, which matters for the scale budget and for the many later features (reports, automations, the API) that will read views.

The client choice follows the frontend rules: one copy of each thing. An entry store keyed by entry id, beside the record store, keeps the entry's own values in one place, while the record's fields in a list row come from the one record copy, so an edit on a record page shows in every list row at once. Making it a second instance of the same store module, rather than one store keyed by "owner id" for both, keeps the types honest (a `RecordView` and an `EntryView` differ) and reuses the layering, revision and undo rules that already pass their tests.

On access, spec 0032 already decided that a list follows its object, so this spec does not invent list level rules. It does add one permission, `lists.manage`, because the scope's user is a member making a working set, and Attio and Folk both let members make lists. The creator manages their own list, owners and admins manage all, mirroring how booking pages split `booking.manage` and `booking.admin`. Counts are the subtle leak: `lists.entry_count` counts entries whose records a member may not see under a record rule, so only owners and admins (who see everything, spec 0032 decision 2) are shown it; everyone else sees the count of what they can see.

### Calls made for the owner (23 October 2026)

The owner delegates product and UX calls. Each is listed in [index.md](index.md) with a runner up. The reasoning in short:

- `lists.manage` for members: lists are personal working sets first; gating them behind admins makes the feature a request queue. The brake is the 500 cap and archive.
- "Each record once" by default: every pipeline wants it, and an accidental double add is a worse surprise than a toggle in settings. The database default stays as it is, so existing seed lists are untouched.
- Blank and Pipeline only: one template that does the common thing (a stage board) beats a gallery the team must maintain. Attio's gallery is the later step.
- A Lists section in the record page's sidebar: Attio puts it there, it keeps the record page's tabs for the record's own story, and in place editing reuses the field set.
- No entry page: an entry is meaningful only beside its record; opening the record keeps one destination per thing.
- Archive, not delete: lists hold work in progress, so a reversible end is safer, and there is no purge machinery for lists yet.
- Boards grouped by either side: a Deals pipeline often groups by the deal's own Stage; allowing object fields keeps that working inside a list.
- Import updates entries in "Each record once" lists: re running an import with new stages is the common case, and skipping would silently drop the new values.

## Evidence: Mobbin references (looked at 23 October 2026)

| App | Screen or flow | What this spec took |
|---|---|---|
| Attio | [Sales list as a pipeline board](https://mobbin.com/screens/1ae8cb4f-5350-4fb2-abb1-6d95901c9466) | The list header (icon, name, object Badge), the ViewBar with the view switcher, "Sorted by" and Filter, columns by stage with counts, "+" per column, the Lists section in the sidebar under Records (AC-4804, AC-4806, AC-4815, AC-4820) |
| Attio | [View settings on a list board](https://mobbin.com/screens/a2b97705-be0b-44a3-84ec-522316c873bf) | Group by and the card's visible fields mixing list fields and the record's fields ("Company > When") (AC-4807, AC-4820) |
| Attio | [Creating a list](https://mobbin.com/flows/d6df8bd1-5c00-4b83-83ff-0cc082b9816b) | The Modal with Object choice and List name, then "Table" or "Kanban" as a start, the empty state with "Add your first person", and "Add to list" as a Modal with a record search above the list's fields (AC-4801, AC-4802, AC-4813, AC-4842) |
| Attio | [Creating a list from a template](https://mobbin.com/flows/1095c66f-6cbe-40b0-8c9e-b5d802b6a174) | Templates by use case; this spec keeps one (Pipeline) and leaves the gallery as the runner up (owner decision 4) |
| Attio | [Sharing a list](https://mobbin.com/flows/9eb16b88-8777-4937-a628-a6118a71e77a), [list access](https://mobbin.com/screens/273cff4c-bc26-42f9-bb03-ce07ba7fae52) | Per list access (workspace level plus named people); not taken in this slice, recorded as owner decision 2's runner up |
| Attio | [A company page with its Lists section](https://mobbin.com/screens/8f45efe4-1011-4a3b-bed0-ea66509ed4fb) | "Add to List" in the record header, and a Lists section in the details sidebar with one card per entry (list name, created when, Stage, Owner, "Show all values"); taken nearly as is (AC-4822 to AC-4824) |
| Pipedrive | [Deals pipeline board](https://mobbin.com/screens/fa0efe82-ea90-4864-ae99-ca3dd822c77b), [editing stages](https://mobbin.com/screens/d92c8976-caa2-4eab-a753-4adc235697c5) | Stages as columns with counts and totals; a pipeline as a status on the deal (Option 2), which can't hold one deal in two pipelines |
| HubSpot | [Deals board](https://mobbin.com/screens/d0daba10-b459-4c3a-9634-5a03122476cc), [board options](https://mobbin.com/screens/d9777088-2fcd-4363-9f4a-eec9f1282860) | Pipeline as a Select above the board (Option 2), and "mark cards inactive after N days", which spec 0021's stuck badge already covers for entries (AC-4820) |
| Folk | [Recruitment pipeline group](https://mobbin.com/screens/5cd42996-b3c5-47a0-a8be-5c4e1b81434c), [with cards](https://mobbin.com/screens/e2bfec60-d105-4d43-9361-d44f031befb2) | A group as a sidebar item with its own views and "Add people" at the top (Option 3); its "New status" column at the board's end matches spec 0021's add option flow |

## References

**Project sources**:
- `AGENTS.md` (Tracer Bullet, functional core, one data layer, house rules); `packages/data/AGENTS.md`.
- Spec 0004 (lists, entries, `queryPage` over lists, AC-6, AC-8, AC-16), spec 0006 (windows, store, undo), spec 0007 (`entries` events), spec 0009 and 0032 (the door; decision 7, a list follows its object), spec 0011 (the scale budget), spec 0012 (attributes, names, hues), spec 0017 (record page), spec 0020 and 0021 (views, boards), spec 0022 (bulk and jobs), spec 0034 (the Lists section), spec 0039 (⌘K), spec 0040 (import), spec 0046 (History sentences).
- Code read on `land/r13`: `packages/core/src/engine/lists.ts`, `limits.ts`, `values.ts`, `query/page.ts`, `query/groups.ts`, `access/visibility.ts` (`checkList`), `access/events.ts`, `packages/db/src/schema/definitions.ts`, `records.ts`, `views.ts`, `packages/contracts/src/access.ts`, `nav-model.ts`, `records.ts`, `views.ts`.
- Skills: `crm-data-model-access`, `crm-frontend-state`, `crm-api-backend`, `crm-design-system`.

**Practices and standards**:
- One copy of each thing in the client (normalised store), windows not downloads.
- Client minted ids as idempotency keys for creates.
- Hidden means absent (no counts or names of what a reader can't see).

**Links** (from the Mobbin MCP results on 23 October 2026): the Mobbin screens and flows in the Evidence table above.
