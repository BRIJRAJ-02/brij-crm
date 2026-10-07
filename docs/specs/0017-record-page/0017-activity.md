# 0017. The activity timeline, built on read

## Summary

A record's timeline is never stored. `getActivity` reads it from the history the engine already keeps: the record's creation, every version of every visible attribute, and every link added to or removed from either side of a relationship. Each source returns its newest entries older than a cursor, the service merges them, and the browser pages through 50 at a time. The values a create writes fold into the creation entry, a write that adds many links reads as one entry, and anything the viewer can't see is simply missing. Later features add a source each (notes and tasks in #19, comments in #29).

## Order and the cursor

- Every entry has a sort key (`at` descending, `rank` ascending, `id` ascending). `at` is the moment with microseconds as Postgres stores it; `rank` breaks ties at one moment: `links` 1, `change` 2, `comment` 3, `note` 4, `task` 5, `created` 9. `id` is the entry id below, compared as text. The key is total, so pages never repeat or skip an entry.
- The cursor is base64url of `{ "at": "<ISO instant with microseconds>", "rank": <0 to 9>, "id": "<entry id>" }`, at most 512 characters, parsed with a strict Zod schema (`ActivityCursor` in `packages/contracts/src/activity.ts`). Anything else answers 422 `FILTER_INVALID`.
- A source with rank `r` reads, against cursor `c`: `at <= c.at` when `r > c.rank`; `at < c.at` when `r < c.rank`; and `at < c.at or (at = c.at and id > c.id)` when `r = c.rank`. With no cursor it reads everything up to now.
- Each source returns at most `limit + 1` entries in key order. The service merges them, keeps the first `limit`, and sets `nextCursor` from the last kept entry when any source had more.

## Entry ids

| Entry | id |
|---|---|
| creation | `created:<recordId>` |
| a value version | `value:<attributeId>:<versionId>` |
| a moment on a relationship side | `links:<attributeId>:<at with microseconds>:<actor type>:<actor id or "none">` |
| a note (#19) | `note:<noteId>` |
| a task linked (#19) | `task:<taskId>:linked` |
| a task completed (#19) | `task:<taskId>:done:<done_at with microseconds>` |
| a comment (#29) | `comment:<commentId>` |

Ids are stable across reads, so the browser merges pages and refetches by id.

## The sources

Every source runs inside the one `inWorkspace` transaction of the read, after the record check, using the attributes the door lets the viewer see.

**The record check** (before any source): the record's row by id, live (`deleted_at is null`), its object live (not archived) and visible, and inside the viewer's record rule (spec 0009's record check). Otherwise `NOT_FOUND` "That record does not exist.", the same answer for missing, trashed and hidden.

**Creation** (`created`, rank 9): the record row's `created_at` and `created_by`. Exactly one entry, the oldest.

**Value versions** (`change`, rank 2): for each attribute of the record's object that is not archived, not system, not computed (#16's flag, once it exists), not a record reference, and returned by `visibleAttributes`, one lateral read over `unnest(<attribute ids>)`:

```sql
select version_id, active_from, set_by_type, set_by_id
from values
where workspace_id = $ws and owner_id = $record and attribute_id = a.id
  and record_id is not null
  and version_id <> $record              -- the creation fold
  and <the cursor bound on active_from>
group by version_id, active_from, set_by_type, set_by_id
order by active_from desc, version_id
limit $limit + 1
```

It runs on the existing `values_history` index (`workspace_id`, `owner_id`, `attribute_id`, `active_from`). For the versions the merge keeps, one more read loads their items and the items of the version each replaced (the same owner and attribute with `active_until` equal to the kept version's `active_from`, which the write protocol guarantees), and decodes both with the engine's `decodeValue`: `from` is the replaced version's value (`null` for a first set), `to` is the kept version's value (`null` when it is a cleared marker). The entry's actor is the version's `set_by`.

**Relationship sides** (`links`, rank 1, or `change` for a side that holds one): for each record reference attribute of the object that is not archived and is visible, with `mine` = `from_record_id` and `far` = `to_record_id` when the attribute is the relationship's `from` side, else the reverse. Two grouped lateral reads per side, both limited to far records that are live, whose object is visible, and that pass the viewer's record rule:

- **Starts**: links with `mine = $record`, `relationship_id = $relationship`, the cursor bound on `active_from`, and `version_id <> $record` (the creation fold), grouped by (`active_from`, `set_by_type`, `set_by_id`), newest first, `limit + 1` groups; each group returns `count(*)` and its first 3 far ids by the side's position. Index: the existing `record_links_from_history` or `record_links_to_history`.
- **Ends**: the same over `active_until is not null` and the cursor bound on `active_until`, grouped by (`active_until`, `ended_by_type`, `ended_by_id`). Index: the new `record_links_from_ended` or `record_links_to_ended`.

A moment is one (side, `at`, actor). A moment with only starts is "added", only ends is "removed". A moment with both (a whole value replace, a one side replacement, or a move) is diffed in one more SQL read (`except` both ways over the far ids started and ended at that moment), and only the net is reported; an empty net (a reorder only) makes no entry. For a side that holds one, a moment becomes a `change` entry: `fromRefs` the ended record, `toRefs` the started one (either may be empty: a first set, or a clear). For a side that holds many it is a `links` entry with up to 3 `added` and up to 3 `removed` displays and both counts. Displays are `RecordRefDisplay`, built by the engine's existing display reader.

**Notes, tasks and comments**: registered by #19 and #29 in `ACTIVITY_SOURCES` with the same contract (a function of the transaction, the scope, the record, the cursor and the limit, returning keyed entries). #19's are defined in spec 0019.

## Value sourcing

| Value | Source |
|---|---|
| creation `at` and actor | `records.created_at`, `records.created_by_*` |
| a change's `at` and actor | the kept version's `values.active_from` and `values.set_by_*` |
| a change's `from` and `to` | the replaced and kept versions' items, decoded by `decodeValue` (cleared versions decode to `null`) |
| which versions fold into creation | `values.version_id` and `record_links.version_id` equal to the record's id (the create path's stamp) |
| a link moment's `at` and actor | `record_links.active_from` and `set_by_*` for starts; `active_until` and `ended_by_*` for ends |
| `added`, `removed` and their counts | the grouped starts and ends, after the far record filter, diffed when both exist at one moment |
| the 3 names shown | the first 3 far records of the moment by the near side's `position` (starts) or the ended rows' `position` (ends) |
| which attributes are read | `visibleAttributes(scope.access, attributes)` over the object's live, non system attributes, minus #16's computed ones |
| which far records count | live (`records.deleted_at is null`), object visible, inside the viewer's record rule |
| the page size | the `limit` input, 1 to 50, default `ACTIVITY_PAGE` (50) |

## Keeping it live in the browser

- `activity.forRecord` registers with the live router: a `records` event whose `recordIds` include the record, a coarse `records` event for the record's object while the store holds the record, and (from #19) a `notes` or `tasks` event whose `recordIds` include it, each schedule a head refetch. So does a confirmed write from this tab that names the record (its own events are skipped by spec 0006's pipeline, so the write path tells the activity source directly: `data.records.setValue`, `links.add` and `links.remove` notify the record and every id in `changedRecordIds`).
- A head refetch reads the first page (no cursor). It runs at once when none is in flight, and at most once more 500 ms after (`ACTIVITY_REFRESH_MS`, leading and trailing), so a burst costs at most two reads per second per open feed.
- Merge by id: ids the feed doesn't hold are added at the top in key order, held ids take the new content. When the first page shares no id with what the feed holds (more than 50 new entries), the feed drops everything and keeps the new first page.
- Adding entries above keeps the entry the member is reading fixed on screen: the feed anchors on the first visible entry (an ActivityFeed requirement, storied in milestone 2).
- A `definitions` event for the record's object resets the feed (first page again), since an attribute may have been archived, hidden or renamed.
- A full catch up of spec 0006 or a `reset` of spec 0007 resets the feed the same way.
- Nothing refetches on a timer. Relative times and the period headings recompute from the browser's clock.

## Tests

- Real Postgres: each source alone; the merge against a reference built from `getHistory` and the link periods for a random sequence of creates, value writes, whole value link writes, deltas, moves, deletes and restores of far records, on both sides of each relationship; ties at one microsecond; cursor bounds on every rank combination; a tampered cursor; the fold (only the create's versions); a reorder only write; access with injected rules (a hidden attribute, a hidden far object, a record rule on the far object, a hidden record).
- The scale seed: the hub company's first page and a record with 10,000 versions, `explain (analyze, buffers)` captured in `verify.md`.
- Data layer with a fake API and event source: head refetch coalescing, merge by id, the gap reset, own write refresh, definitions reset.

## Rationale (short)

The history tables already hold every fact the timeline shows, each written in the same transaction as the change, so reading them can't miss an entry or show one that rolled back; a stored activity table would be a second copy that must be written on every edit, backfilled, and filtered by access all over again. Grouping links by moment turns one write that links 100 people into one entry, which is what a person did. Folding by version id is exact where a time window would guess.
