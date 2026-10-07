# 0017. Record page: decision record

## Context

Until now a record lives only as a row: the table edits it, and #15's thin panel shows its details and related lists. There is nowhere to see a record whole, and nowhere to see what happened to it. The scope's "Done when" for #17 asks for every attribute editing in place, related records listed per relation with add and remove, and a timeline of creation, every field change with who and when, notes, tasks and comments, updating live.

The engine already keeps the facts a timeline needs. Every value write ends the current version and starts a new one with `set_by` and `active_from` (spec 0004's write protocol), and every link is one `record_links` row with `set_by`, `ended_by`, `active_from` and `active_until`, read from both ends. `getHistory` reads one attribute's versions; nothing reads a record's history across attributes and relationships in time order, and nothing tells which versions the create itself wrote.

Forces: the scale budget (#12: open a record in 200 ms, a read in 300 ms at p95) with a hub company of 150,000 people whose links are history too; one copy of each record in the browser (house rule); hidden is absent (spec 0009), so the timeline must leave out what a viewer can't see without a second policy; the library already has RecordHeader, RecordPanel, AttributeList, ActivityFeed and TaskList built for this page (spec 0003); notes, tasks (#19) and comments (#29) come later and must join the same timeline; Neon's free plan, so nothing may query on a timer.

## Options considered

### Option 1: build the timeline on read from the history tables (chosen)

One service merges sources (creation, value versions, link periods; later notes, tasks, comments) newest first with a keyset cursor, filtered through the door.

**Pros**: no second copy of history, no write cost on every edit, nothing to backfill; always consistent with `getHistory`; access applies through the same `visibleAttributes` and record rule as every read; new sources plug in.
**Cons**: each page runs one small read per attribute and relationship side; link removals need two new partial indexes; grouping and folding logic lives in the reader.

### Option 2: an `activity` table written in every write transaction

The outbox hook (or an after write hook) inserts one row per entry, already grouped, and the timeline reads one indexed table.

**Pros**: one simple indexed read per page; easy to add free text entries (an email arrived).
**Cons**: a second write on every value and link change, including bulk jobs and hub link writes; a backfill for every existing record; entries must be filtered by access at read time anyway (a hidden field's entry is still stored), so the policy is applied twice; it can drift from history if a write path forgets the hook; it grows forever on Neon's free plan storage.

### Option 3: build the timeline from the outbox stream

Read the outbox rows naming the record.

**Pros**: no new storage; already ordered.
**Cons**: the outbox holds ids only and is pruned (24 hours, spec 0007), so it can't show who changed what a week ago; it doesn't hold old values.

## Rationale

Option 1 fits the forces best. The history already is the truth of who changed what and when, written in the same transaction as each change, so a reader can't miss an entry or show one that rolled back; Option 2 would add a write to the hottest path (and to hub link writes and bulk jobs) to save a few index reads on a page people open far less often than they edit. Access was the deciding detail: with Option 1 the timeline uses exactly the same `visibleAttributes` and record rule as every other read, so #24's rules hold on the timeline the day they land. Option 3 can't answer the question at all after a day.

Per decision:
- **Fold by version id**: a create and a later first set can land within the same second, so any time window guesses; stamping the create's versions with the record's id is exact, costs nothing, and needs no column.
- **Group link changes by moment**: one write that links 100 people is one thing a person did; the moment (side, time, actor) is exactly one write's footprint, since a write stamps all its links with one time.
- **Leave out links to trashed far records**: the timeline shows what can be seen now, like every other read; showing "a deleted record" would need a second display path.
- **`links.page` for related sides, not `records.query`**: spec 0014 built `links.page` for exactly this (the side's order, capped totals, displays only), and `records.query` would put related records' bodies into the store and filter by a link predicate per page.
- **One `RecordDetails` for page and panel**: the same attribute must edit the same way in both.
- **Panel tab in the URL**: a reload and a shared link reopen the same view, like the record and the page's tab.
- **No presence, delete or restore here**: each belongs to its own feature (#26, #22), and the header and Callout leave their slots.

## References

**Project sources**:
- `packages/core/src/engine/history.ts`: `getHistory` groups value rows by `version_id`, oldest first; cleared versions decode to `null`; record references read `linkHistory`.
- `packages/core/src/engine/values.ts`: each attribute write stamps `greatest(clock_timestamp(), max(active_from) + 1 microsecond)` and `uuidv7()` as the version id, ends the current rows with `active_until` equal to the new `active_from`.
- `packages/core/src/engine/relationships.ts`: `writeLinks` ends a side's current links and starts the new ones at one moment under one version id; links carry `set_by` and `ended_by`.
- `packages/core/src/engine/records.ts`: `insertRecord` writes the record, then its values through `writeAll`, in one transaction; `RecordView.display` is `RecordRefDisplay`.
- `packages/db/src/schema/records.ts`: `values_history` (`workspace_id`, `owner_id`, `attribute_id`, `active_from`), `record_links_from_history` and `record_links_to_history`; no index on `active_until`; no unique index on `version_id`.
- `packages/ui/src/modules/`: RecordHeader, RecordPanel (tabs, Previous and Next, `status`), AttributeList (sections, edit in place, lock reasons), ActivityFeed (`change`, `created`, `note`, `task`, `comment` entries, a `ListSource`, period headings), TaskList.
- Specs 0004 (history and displays), 0006 (`records.one`, windows, versions), 0009 (hidden is absent, the record check), 0011 (the open record budget), 0014 (links, `links.page`, the panel slice).
- `.notes/briefs.md`, the #17 brief (3 October 2026).

**Practices**:
- Event sourced reads over an append only history; keyset pagination over a total order.
