# 0017. Record page: verification

How each acceptance criterion is proved, the measured numbers, and the calls made while building. Milestone 1's calls are in [index.md](index.md) ("Calls made building milestone 1"); this file starts with milestone 2, the timeline (build plan tasks 6 to 10, 12 and 13 October 2026).

## Milestone 2: the timeline

### What was built

| Task | Commit (lane) | What |
|---|---|---|
| 6 | `feat(db)` | Migration `0032_record_links_ended.sql`: `record_links_from_ended` and `record_links_to_ended`, partial on `active_until is not null`. Guard tests rerun (packages/db, 148 passed) |
| 7 | `feat(core)`, `fix(core)` | `packages/core/src/engine/activity-sources.ts`: the value source and the link source, registered in `ACTIVITY_SOURCES`; `bench-activity.ts` |
| 8 | `feat(ui)`, `fix(ui)` | ActivityFeed: the `links` entry, the `inline` layout, the entry being read kept in place, a 2,000 entry perf test |
| 9 | `feat(data)`, `fix(data)` | `activity.forRecord` and `recent`: paging as the feed scrolls, the live head refetch, merge by key, resets, actor fallbacks |
| 10 | `feat(web)` | The Activity tab and Overview's Recent activity; `e2e/timeline.flow.ts` and `e2e/timeline-scale.flow.ts` |

### Acceptance criteria

| AC | How it is proved | Result |
|---|---|---|
| AC-378 | `activity-sources.test.ts`: the fold (a create with values and links is one entry; later writes are their own), "set", "changed" and "cleared" with values in their own shape, no system attributes, both ends of a link (the far end sees "added <deal> to Associated deals"), the reference test against `getHistory` for values and both kinds of side over seeded random runs of writes, deletes and restores (4 seeds). `timeline.flow.ts`: an edit in Details reads "set Job title" in Recent activity; a link made from the person's side reads "set Company" there and "added Grace Hopper to Team" on the company | Pass |
| AC-379 | `activity-sources.test.ts`: 100 people linked in one write is one entry naming 3 (by the side's order) and counting 100; a reorder only write makes no entry; a replace nets to "1 added, 2 removed"; a move reads as a change on the side that holds one and as a removal and an add on the two companies. ActivityFeed's Links story ("and 97 others", "and 1 other", both ways in one sentence, names as links, a record with no page named without a link). `timeline.flow.ts`: the name links to the person's page | Pass |
| AC-380 | Paging: `activity-sources.test.ts` pages of 1, 2, 3 and 7 equal one page of 50, ties at one microsecond page through, a long run of reorders pages in bounded reads; `feed.test.ts` reads the next page near the end. Numbers below | Pass on the smoke seed; the million record seed is waived by the owner (12 October 2026) |
| AC-381 | `timeline.flow.ts`: a second browser on the Activity tab sees a change made elsewhere in 58 to 182 ms (runs of 12 and 13 October); `feed.test.ts`: coalescing (one read at once, at most one more 500 ms later), merge by key, the gap reset, own writes, definitions and resync resets, a hidden tab reading when shown. ActivityFeed's KeepsReading and NewerAtTop stories: entries arriving above keep the entry being read in place to the pixel, and show at the top when at the top | Pass |
| AC-382 | `activity-sources.test.ts` with injected rules: a hidden attribute, a hidden far object, a far record outside a record rule, a far record in the trash (and back with a restore), removals and a side that holds one against hidden far records, a hidden side from either end, a far record whose name is hidden ("Unnamed person"), and no actor on changes or link entries when Created by or Updated by is hidden. `feed.test.ts`: "Former member", "An API key", "An automation", "System" | Pass |
| AC-383 | Overview draws Recent activity with the library's `inline` layout (five entries, no scroll of its own, never empty: the creation), with "View all"; `record.flow.ts` and `timeline.flow.ts`. The Related cards are milestone 3 | Pass for this milestone's part |
| AC-388 | Open record (`records.get` for one record, 30 warm calls at the API): p95 19 ms for the deal with 10,000 versions, 42 ms for the hub company, against the 200 ms budget (local, smoke seed). Every read goes through `packages/data`; nothing polls (the feed reads only for a live event, an own write, a definitions change, a resync, or a scroll) | Pass on the smoke seed; million record seed waived |
| AC-389 | Library only (ActivityFeed, Card, Button); stories per state in Chromium and WebKit (Firefox can't start on this machine, as before; CI runs it); axe in light and dark in `timeline.flow.ts` (Activity with changes, and with a links entry) at 1280 and 375; `pnpm size` 173.66 kB of 250 kB | Pass locally; production deploy is the coordinator's |

### Measured numbers

All local: Docker Postgres 18 on this laptop, the smoke profile of `pnpm load:seed` (30,000 people, 7,500 companies, 12,500 deals, 50 users; the hub company has 7,502 people in Team), seeded into a database of this lane's own. The million record (`crm`) profile is waived by the owner (12 October 2026): AC-380 and AC-388 name the 150,000 person hub and the scale seed, and those runs are not made. The reads below don't grow with a side's size (each step of a side's read is one index probe), but that is reasoning, not a measurement on 150,000.

**The database call** (`packages/core/scripts/bench-activity.ts`, the whole `getActivity` call as the app role with row level security on, 30 warm runs; one deal given 10,000 value versions through the engine's own write path):

| First page | p50 | p95 | max |
|---|---|---|---|
| Hub company (7,502 people in Team) | 27.4 ms | 34.4 ms | 34.6 ms |
| Deal with 10,000 value versions | 11.0 ms | 14.7 ms | 17.1 ms |
| Hub company, as a member who sees only the people they own (a record rule on People) | 41.2 ms | 62.8 ms | 68.2 ms |

| Paging through 2,000 entries | pages | p50 per page | p95 per page |
|---|---|---|---|
| Hub company | 40 | 38.6 ms | 57.4 ms |
| Bench deal | 40 | 14.0 ms | 18.8 ms |

The budget is 300 ms at p95. A first page sends 10 raw statements for the hub company (6 for the deal) plus the access and display reads; each statement's `explain (analyze, buffers)` runs in under 1 ms, except the value read of the deal (2.3 ms) and the ruled member's moment read (9.3 ms, stepping past links to people they can't see). The hub's moment read, abbreviated:

```
Limit (actual time=0.534..0.543 rows=51 loops=1)  Buffers: shared hit=426
  -> Recursive Union (actual time=0.034..0.365 rows=52 loops=1)
       -> Limit -> Nested Loop
            -> Index Scan Backward using record_links_to_history on record_links k_2 (rows=1)
                 Index Cond: workspace_id = ..., to_record_id = <hub>, relationship_id = <Team>
            -> Index Only Scan using records_live on records r (rows=1)
       -> Limit (loops=51) -> Nested Loop
            -> Index Scan Backward using record_links_to_history (rows=1 loops=51)
                 Index Cond: ... AND active_from < starts.at
            -> Index Only Scan using records_live on records r_1 (loops=51)
Execution Time: 0.986 ms
```

Before the loose index scan (one index step per moment), the same read grouped every one of the hub's links: 139.8 ms for 7,500 links, which would not have held at 150,000. Statements per page matter more in production: locally there is about 0.1 ms between the app and the database; from Railway to Neon each statement adds about 1 to 5 ms, so a company with 8 relationship sides (about 20 statements) could add 20 to 100 ms. Measured locally only; see the owner decisions.

**The browser** (`apps/web/e2e/timeline-scale.flow.ts` on React's production build, `vite preview`, Chromium at 1280 by 800, heap after a full garbage collection through the DevTools protocol; frames timed between animation frames in the page while it scrolls 300 px every frame):

| Record | Heap, first page | Heap at 2,000 entries | Growth | Frames (p50 / p95 / max) | Dropped |
|---|---|---|---|---|---|
| Deal with 10,000 versions | 9.2 MB | 12.1 MB | 2.9 MB | 16.7 / 16.7 / 16.8 ms | 0 of 412 |
| Hub company | 9.5 MB | 13.5 MB | 4.0 MB | 16.7 / 16.8 / 16.8 ms | 0 of 246 |

Budgets: heap under 200 MB, growth under 20 MB, frames under 16.7 ms at p95 (a frame on time reads 16.7 ms give or take the timer's resolution; a dropped one 33 ms). Scrolled on through all 10,000 of the deal's entries the heap reached 15.7 MB (growth 6.5 MB, about 0.65 MB per 1,000 entries held), with no frame dropped in 2,065. The library's perf test (`ActivityFeed.perf.test.tsx`, 2,000 entries, a links entry every fifth) holds p95 under one frame with at most 24 entries in the DOM.

### Calls made building milestone 2 (pending owner confirmation)

Technical:
1. **Moments are found one index step at a time** (a recursive loose index scan per side), then grouped by actor, so a side's first page reads about a page of index entries however many links it holds. A side reads at most four steps past moments with nothing to show (reorders only); the page then ends where it stopped and the next one goes on from there (`ActivitySourceAnswer.stoppedAt`), so no read is unbounded and nothing is skipped. A page can therefore hold fewer than 50 entries with more to come; the browser reads on.
2. **Changes and link entries name nobody when a field rule hides Created by or Updated by** (the newest change's actor is the record's Updated by). The creation entry follows Created by alone, as in milestone 1. `getHistory` still names who set each version: the same leak predates this spec and belongs with it.
3. **A side that holds one record reads as a `change`** (rank 2) with `from` and `to` as references and `fromRefs`, `toRefs` as displays; its id is the moment's `links:…` id.
4. **The far record join keeps to the side's own objects** (`r.object_id = any(allowed)`), so a far record anywhere else fails closed.
5. **A timeline watches its workspace while shown** (`live.watch`). `records.one` doesn't watch on its own, so a record page opened directly (not from a table) had no live updates; the timeline's watch now carries them for the whole page. `records.one` watching for itself is left to #6.
6. **This tab's own writes refresh every shown timeline of the workspace**, not only the record written and `changedRecordIds` as 0017-activity.md says: the write's answer doesn't name the far records a write unlinks. Typically one timeline is shown; milestone 4's panel beside a table makes this more frequent, so it may then want the far ids in the answer.
7. **Hidden tabs read nothing**: a change marks a shown feed stale while the tab is hidden, and it reads once when shown again. Definitions resets go through the same coalescer and are spread 0 to 2 s across tabs.
8. **`NOT_FOUND` after entries were shown drops them** (`unavailable`): the server still answers a record in the trash, so `NOT_FOUND` means hidden or purged.
9. **Paging**: one entry still loading is drawn past the loaded ones while there are more; the next page is asked for when the range on screen comes within 10 entries of the end; a failed page is tried again while shown (2 s, doubling, at most 30 s). `aria-setsize` is -1 until the last page.
10. **Relative days count calendar days** in the provider's time zone (`formatRelative`, shared by every RelativeTime), so an entry under "Yesterday" never reads "2 days ago". This changes how every relative time reads past a day.
11. **The bench and the browser runs use a database of this lane's own** (the test roles on a copy seeded with the smoke profile), not the shared dev or load database.

Design (each the conservative option, open to change):
1. **Names in a links entry are parted by the chips' boxes on screen; the commas are for screen readers only.** The spec quotes the line with commas ("added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team"); a visible comma after a chip's box read as "Jane Doe ,". "and" and the ", and removed" clause stay visible.
2. **Change values draw on the field set's `card` surface**: one line each, chips flat like the names around them, a long text cut (Details holds it whole). The reference chips in a change are not links yet (the field set's display has no `href`); the links entry's names are.
3. **A clear draws the old value, the arrow and the empty mark**, so it never reads as a value still held.
4. **The verb and its attribute never split across lines, and the time sits on the first line.**
5. **Ctrl (or Cmd) with Home or End leaves the feed** (the feed pattern's own way out), past every linked name.
6. **A flat linked chip deepens on hover** (`surface-selected`), in RecordChip itself, so linked names read as links; this also changes TaskList's flat linked chips.
7. **Inline headings are h4**, under the Card's own h3.

### Owner decisions

1. **The million record seed is waived** (12 October 2026): AC-380 and AC-388 are measured on the smoke seed only. Confirm the timeline can be marked done on that basis, or ask for the `crm` profile run when the load stack is next up.
2. **Network round trips** (technical call above): measure statements per page against a Neon preview, or accept the local numbers until #12's next run. If it misses, the sides' reads can be joined into one statement.
3. **Hidden actors** (technical call 2): close the same leak in `getHistory` too, or leave it for #24's audit.
4. **A "New activity" pill** when entries arrive while scrolled down (the reader's place holds, but nothing says entries arrived): not built; worth a design call.
5. **Visible commas** between linked names (design call 1).
6. **The Activity tab's touch scroll at narrow widths** wasn't checked on a device: the feed's `overscroll-behavior: contain` inside a column that also scrolls might stop a touch scroll at the feed's top. A check on a phone is worth doing.
7. **The artifact publish** is held (not approved): ActivityFeed (links entry, inline layout, keyboard, card surface) and RecordChip (flat hover) need the next `pnpm ui:artifact` publish.

### Reviews

`security-access-reviewer`, `state-performance-reviewer`, `design-system-guardian` and `ux-interaction-reviewer` ran on the milestone's diff; every real finding was fixed in the `fix(core)`, `fix(data)` and `fix(ui)` commits, with tests. Left as calls or owner decisions above: the "New activity" pill, the touch scroll check, visible commas, linking a change's reference chips, `ownWrite` naming far records, and the round trip measurement. The index builds are plain `CREATE INDEX`, which blocks writes to `record_links` while it builds: fine at today's size, worth knowing before a large tenant arrives.
