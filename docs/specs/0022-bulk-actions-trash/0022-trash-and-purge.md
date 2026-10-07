# 0022. The trash, restore, delete forever and the purge

## Summary

The trash is not a separate store: it is every record with `deleted_at` set, shown on one workspace screen. Anyone can restore what they could change; owners and admins can delete forever. Thirty days after a delete, the daily cleanup (already scheduled by spec 0008) removes the record and everything that hangs off it. The purge adds no timer of its own, so the free database still sleeps all day except for that one short wake.

Brief (the three lines the house rule asks for): **Purpose**: get deleted records back, or get rid of them for good. **Main task**: find a record deleted by mistake and restore it. **Leaves out**: editing trashed records, opening them, trashed list entries on their own (they come back with their record), and changing the 30 days.

## The screen (`/w/$slug/trash`)

- Route `apps/web/src/routes/w.$slug.trash.tsx` (new); feature code `apps/web/src/features/trash/` (`TrashScreen.tsx`, `strings.ts`, `README.md`).
- Sidebar: a NavItem "Trash" (icon `trash`) at the foot of the Records section, for every member.
- TopBar: title "Trash", `meta` the count ("1,234 records", "10,000+ records"); for `records.purge` holders, "Empty trash" (ghost, danger tone through the confirm only).
- Under it: a Select "Object" ("All objects" then each live and archived object the member can read, by sidebar order) narrowing the list (UI state, also in the URL as `?object=<id>`).
- The list: the DataGrid (`@crm/ui/grid`, lazily loaded) with every cell read only and no editing, fed by `data.trash.view(workspace, { objectId? })`. Columns are synthetic field attributes so each value renders through its one field design:

| Column | Field type for its display | Value |
|---|---|---|
| Name (row header, pinned) | record reference | the record's `display` (name, kind, hue; the object's tile). When the primary attribute is hidden from the member, the read leaves its value out and the chip reads "Unnamed <singular>", exactly as for an empty name |
| Object | text | the object's plural name, "(archived)" appended for an archived object |
| Deleted by | actor reference | `deletedBy` |
| Deleted | timestamp | `deletedAt` |
| Removed after | date | `expiresAt` in the browser's time zone |

- Selection works as in a table (AC-522, AC-523: "Select all matching" here means all trash rows of the current object filter). The BulkActionBar offers "Restore" for everyone and "Delete forever" for `records.purge` holders. Restore is enabled when at least one selected record's object is at `write` for the member (for all matching, at least one object in the list's scope); otherwise it is disabled with "You can view these records but not restore them."
- A restore refused for a row shows its message on that row's Name cell through the DataGrid's existing `cellErrors` (keyed by the record id and the Name column's id, as the grid keys every cell error; for example "Email jane@acme.com is now used by another record." or "You can view deals but not change them."), kept until the member leaves the screen. No new grid variant: spec 0006's row note holds only `new` and `no-longer-matches`.
- States: loading (the grid's), empty (EmptyState "The trash is empty. Deleted records stay here for 30 days."), no rows for one object ("No deleted <plural>."), error with Retry. Trashed records can't be opened: the Name chip is plain (no link).

## Restore

- Inline (1 to 500 selected): `trash.restore` → `restoreRecords` (savepoint per record). Restored rows leave the trash list at once (optimistic), refused ones come back with their note; one toast: "Restored 46 records." or "Restored 46 records. 2 couldn't be restored." with the reasons on their rows.
- Job (501 or more, or all matching): `records.startBulk` with `action: 'restore'` and `target: { kind: 'ids' | 'trash' }`, with the count and confirm flow ("Restore 1,200 records?").
- What comes back: the record, its values and full history (never removed by a delete), its links (hidden by every read's join on `records.deleted_at`, spec 0004 AC-8), its list entries, its stored sort keys made live, its unique keys moved back, and everything that hangs off it by record id and is read through a join on live records (notes and task links from #19, comments from #29, files from #32).
- A record of an archived object restores into it and stays out of sight until the object is restored (spec 0012 AC-226).
- Refusals: `FORBIDDEN` "You can view <plural name> but not change them." (spec 0009's message, for a record whose object is at `read`; the trash lists every object the member can read, so a selection may mix both), `UNIQUE_CONFLICT` (spec 0009 AC-144 wording, naming only attributes the actor can see), `LIMIT_REACHED` (the workspace is full), `NOT_FOUND` "That record was deleted more than 30 days ago." (purged meanwhile, or past the window and waiting for tonight's purge). The job path records the same codes per item.

## Delete forever and empty trash

- `trash.deleteForever` (1 to 500) → `purgeRecords(scope, { recordIds })`: one `runWrite`; locks the lists then the records in id order (spec 0008 task 17's order); keeps only records with `deleted_at` set (others answer `not-in-trash`); then spec 0004's `removeRecords` with the dependents first. The outbox row lists them as purged.
- More than 500, or "Empty trash": `records.startBulk` with `action: 'purge'`; Empty trash uses `target: { kind: 'trash', objectId? }` (the current object filter, or all), always with the count and confirm.
- Both need `records.purge`. Confirms (danger tone): "Delete 48 records forever? This can't be undone." and "Empty the trash? 1,234 records will be deleted forever. This can't be undone." with the button "Delete forever".

## The purge registry (`packages/core/src/engine/purge-dependents.ts`, new)

```ts
/** Rows of a feature that hang off records and must go when a record is removed for good. */
export interface PurgeDependent {
  readonly name: string;                                           // 'notes', 'task_records', 'comments', 'files'
  readonly remove: (tx: WorkspaceTx, recordIds: readonly string[]) => Promise<number>;
}
export const PURGE_DEPENDENTS: readonly PurgeDependent[];          // built from each feature's module list
```

- `removeRecords` (spec 0004, used by `purgeBatch`, delete forever and `eraseRecord`) calls every dependent's `remove` with the batch's record ids before deleting values, inside the same transaction, and adds each count to `RemovedCounts.dependents[name]`.
- The registry is the one way dependents go. Every feature table that points at `records` does so with a restricting foreign key (the engine's convention, spec 0004's sort keys), never `on delete cascade`, so a dependent that isn't registered makes the record delete fail loudly in tests instead of leaving rows behind or vanishing unseen.
- Each dependent deletes by an index that leads with (`workspace_id`, `record_id`), so a batch of 500 costs index lookups.
- #19 registers `notes` (delete the notes of those records) and `task_records` (delete the links; a task left with no links lives on, as #19 allows), both with restricting foreign keys to `records`. #29 registers `comments`. #32 registers `files`: it deletes the file rows and starts a light job (spec 0008) that deletes the stored objects from R2, since a transaction can't call the network.
- Items a feature deletes on its own (a single comment, a single file) and keeps in its own trash are that feature's to purge, as a phase it adds to `maintenance.daily` (spec 0008: "later features add phases").

## The daily purge and the sleeping database

- No new cron, timer or poll. The purge is phase 1 of spec 0008's `maintenance.daily`, which already runs once a day at 03:00 UTC per workspace and wakes the worker (and so the Neon compute) for that one run.
- The phase starts with one probe: `select 1 from records where deleted_at < $cutoff limit 1` (the `records_trash_time` index, a single index lookup). Nothing found: the phase ends at once. Otherwise `purgeBatch` runs in batches of 500 until a batch comes back short, removing dependents as above.
- With the indexes here, each batch finds its rows by `deleted_at` order instead of scanning, so even a large trash is purged in short transactions that leave the heavy lane free between batches.
- The cost on the free plan: one wake a day for the whole cleanup, plus the usual idle tail (spec 0008: about 4 minutes for the worker, then 5 for Neon to suspend). The Trash screen's "Removed after" is computed in the browser from `expiresAt`, so an open Trash tab makes no request while idle.
- After a purge batch commits, its outbox row (purged ids) reaches open Trash screens, which drop those rows at the next settle.

## `data.trash` (`packages/data/src/trash/`)

- `trash.view(workspace, { objectId? })` → a ViewStore like spec 0006's cursor mode window, over `trash.query` (keyset `deleted_at` desc, `id` desc, 100 per block) and `trash.count`.
- Marked dirty by any `records` event (and coarse events) for an object it lists; it settles 1.5 seconds after the last one (spec 0006's settle), so deletes, restores and purges elsewhere appear and vanish.
- `trash.restore(ids)`, `trash.deleteForever(ids)`: optimistic removal from the view, rollback per refused record with its note.
- Cleared with the rest of the store on sign out and workspace switch.

## Tests

- Real Postgres: `queryTrash` order, keyset and object filter; access (an object at `none` absent, an object at `read` refused per record with `FORBIDDEN`, a hidden primary attribute reading "Unnamed", injected rules); a record with an unregistered restricting dependent fails its purge batch; restore round trip with a fake dependent's rows still present; `purgeRecords` refuses live records; the dependents run before values in one transaction; the daily phase's probe on an empty trash runs one statement (counted with `pg_stat_statements` in the test database).
- Playwright: restore with a conflict shown on the Name cell; a member without `records.purge` sees no purge actions; an admin empties the trash with the count confirm.
- Production: the Neon compute history over two quiet days, recorded in `verify.md`.

## Rationale (short)

Keeping trashed records in `records` (spec 0004's design) means restore is a flag flip and every read already ignores them; a separate trash table would copy rows and their history twice. The registry keeps the purge in one transaction per batch for every feature that hangs data off a record, without the engine knowing those features. Riding the cleanup's existing daily wake is what keeps the 30 day promise free on Neon's plan.
