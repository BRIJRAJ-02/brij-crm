# 0014. Relations: decision record

## Context

The engine (spec 0004) already stores relationships the way Attio does: one definition gives each object its own attribute, each link is one `record_links` row read from both ends, single sides are enforced by partial unique indexes, history is kept in place, and filters walk up to two relations. What is missing is everything a person touches: no way to create a relationship from the app, reference cells are read only (spec 0005), and nothing pages or searches records to link.

The engine's link path was built for whole values. `writeLinks` takes the full new list of a side, reads every current link on it, and ends and restarts them; `linkValues` returns every link of every side it reads. That is right for a person's one company and wrong for a company's people: the scale seed (#12) has a hub company with 150,000 people, so one read would ship 150,000 ids to the browser, and one edit would send them back. A browser that holds only part of a list can't safely send it back as the whole, and once #9 hides records, a writer can't send links it can't see.

Sorting by a relation is the other gap. Spec 0004 left "sort by a linked record's name" best effort: a lateral join per row, under row level security, which can't use an index to jump to row 600,000. Every other sortable kind was fixed by stored keys (spec 0004's child), and the relation kind was left out because its key depends on another record.

Forces: the scale budget (#12: read 300 ms, edit 250 ms at p95); one field design everywhere (the reference editor and picker already exist in the library); the owner's "visible product first"; schema writes for admins only (owner decision, spec 0009); Neon stays on the free plan, so scale proofs run on the local capped seed; and #6, #8, #9, #13 and #17 are being built in parallel, so this feature must name exactly what it needs from each.

## Options considered

### Option 1: link deltas and paged reads on the existing engine (chosen)

Add `writeLinksDelta` (add or remove named records) beside the whole value path, cap reads at the first 20 links per many side with its total, page the rest by keyset, search through one procedure, and store a name key for sides that hold one.

**Pros**: no cost grows with the size of a side; deltas commute, so concurrent adds never overwrite each other and hidden links are never dropped; no schema change until milestone 4; reuses the engine's indexes, protocol and history.
**Cons**: two write paths that must keep the same rules; cells show at most 20 chips; a stored key that depends on another record needs a lock rule and a job.

### Option 2: keep whole values, page only the display

Reads still return every link; the browser renders only the first chips and a virtualised list; edits send the full list as today.

**Pros**: one write path; the simplest client logic.
**Cons**: a hub read ships 150,000 ids per record and blows the read budget and the browser's memory; an edit rewrites 150,000 rows of history; concurrent edits to one hub lose each other's links; once #9 hides records, a writer would delete links it can't see.

### Option 3: edit relations only as filtered views of the far object

No relation cell editing on the many side: "Company · People" is a filtered People view (people whose company is X), and linking happens only from the side that holds one.

**Pros**: no new write path; the existing windowed table handles any size.
**Cons**: many to many sides have no side that holds one, so they couldn't be edited at all; it breaks the scope's "setting a link from either side"; a filtered view of a small company scans by sort order and can be slow.

## Rationale

Option 1 is the only one that meets the hub budgets and the "either side" requirement together. Option 2 fails the read and edit budgets by orders of magnitude at the hub size the load harness seeds, and quietly loses data under concurrency and hidden records. Option 3 can't edit many to many at all. The cost of Option 1, a second write path, is contained by sharing every check (targets, trash, self links, taken sides) in one module and running the race tests against both paths.

Per decision (the brief's recommendations, which the owner accepted):
- **One dialog, a library module**: #13's settings and #56's schema map create relationships too; one component keeps the wording and rules identical.
- **No one way references in the UI**: they have no attribute on the other side, which confuses "either side" editing; the engine and the future public API keep them.
- **Fixed cardinality**: narrowing breaks existing links and needs a preview, which is #14's machinery.
- **Archive both sides together**: half a relationship (a column whose partner is gone) can't be edited from either side consistently.
- **"At Acme" and an explicit move flag**: the person sees the consequence in the picker, so no second dialog; a stale picker can never move silently because the server refuses without the flag.
- **Optimistic near side only**: the far side's display (its first 20, its total) depends on server order and counts the client doesn't hold.
- **Search by mode** (recent, prefix, contains): a one or two character contains can't use the trigram index, and a prefix seek on the stored name key is an index range; three or more characters use the existing `crm_search_text`.
- **Stored key for sides that hold one, job above 10,000**: inline refresh keeps small renames exact at once; a hub rename inline would hold a 150,000 row transaction.
- **Unsaved Filter and Sort here**: the scope's "Done when" needs filtering and sorting through relations to be usable now; #20 adds saving.
- **Related attributes as columns wait for #16**: a column showing a company's industry on People is a lookup, with its own storage and refresh rules; building it here would build #16 twice.
- **A thin record panel here**: a hub can't be browsed in a cell; #17 takes the panel over.
- **One dialog with two modes, and `relationships.update` for names only** (cross check, 8 October): #13's settings and #56's map both edit relationships; one owner of the dialog and the procedure keeps the rules in one place. Objects and cardinality stay fixed in edit mode, since changing them is #14's widening.
- **The id minted once per dialog**: the server replays a create by the relationship's id, so a retry after a lost answer must resend the same id; a new `mutationId` per attempt is fine.
- **Exact totals, measured at the worst page** (spec 0005 already ships exact counts for cells cut short): a capped count changes 0005's shape for a cost nobody has measured; the worst page (100 large companies) is measured first, and cells fall back to "20+" only if it misses.
- **The record rule predicate in every link read from day one**: it is empty until #24, so it costs nothing now, and adding it later would mean finding every count and page again.
- **Spec 0012's archived by object rule on every link path**: an archived object must vanish from links, search and sections the way it vanishes from tables, or a chip would lead to a record nobody can open.
- **A bounded prefix range**: an open ended `>=` seek keeps reading keys after the last match; bounding it with `|| U&'\FFFF'` makes the plan a range scan whose cost is the matches, verified on the seed.

## Evidence

Read from the code on 3 October 2026:
- `packages/core/src/engine/relationships.ts`: `writeLinks` reads every current link of a side (`endLinks`, no limit) and ends them with one set based update; `linkValues` returns every link of every side read; a far side that holds one refuses a live holder with `RELATIONSHIP_TAKEN` and frees a trashed one; far records' rows are not locked (spec 0004, AC-7), except `FOR SHARE` on holders being freed.
- `packages/db/migrations/0006_engine_links.sql` and `0019_engine_link_positions.sql`: `record_links_from` (`workspace_id`, `relationship_id`, `from_record_id`, `position`) and `record_links_to` (… `to_record_id`, `to_position`), both current only, so either side pages in order by index; partial unique indexes enforce one sides.
- `packages/core/src/engine/query/compile.ts`: a sort by a record reference is a lateral join to the first linked record's primary value, per row; filters through relations compile to `EXISTS` per hop, up to 2.
- `packages/core/src/engine/sort-keys.ts` and `0011_engine_sort_key_kinds_sources.sql`: keys come from one view, `sort_key_sources`; record references have no key today.
- `packages/core/src/templates/standard-v1.ts`: the standard relationships (Person · Company with Company · Team, Parent company and Subsidiaries, Deal · Associated company, Deal and People many to many) are all many to one or many to many, so Company · Team is the hub side.
- `packages/ui`: `RecordReferenceEditor`, `ReferencePicker` (searchable, virtualised, `ListSource`), `RecordPanel`, `AttributeList`, `FilterBuilder`, `SortBuilder` and `Path` already exist; no relationship dialog does.
- Spec 0009 already names `links.add` and `links.remove` with the near field `write` and far visible rule; spec 0008 already names the `records.refresh_sort_keys` kind; spec 0006 leaves relation cell versions to #15.
