# Records

Spec 0017, milestones 1 to 3: a record's own page, its timeline, and its related records. It sits in `WorkspaceFrame` through `WorkspacePage`, laid out by the library's `RecordLayout`.

## The record page (`/w/$slug/objects/$object/$recordId/$tab`, RecordPage)

- **Purpose**: everything about one record in one place: its details, and what happened to it.
- **Main task**: read and edit its details in place, and see who changed what and when, live.
- **Leaves out**: presence (#26), editing related records' own values. Tasks (#19 milestone 1) have their own tab and Overview block, `features/tasks`.

- **Stat strip** (13 Oct reference batch 4; owner's call 22 Oct: the tabs keep their counts, so the strip says only what they don't): the record's value (an attribute `value` of type currency, through its field display), `Entered <stage>` with how long ago (the first live status attribute; `records.stageSince`, read afresh when the stage changes), the next meeting (`calendar.meetings.forRecord`, the first one not yet over), and the last activity (`useLatestActivityAt`, opening Activity). `data.records.facts` holds the meeting and the stage age; `useRecordFacts` reads them.

## The record panel (`?record=<id>&panelTab=` on a view, RecordPeek, spec 0017 milestone 4)

- **Purpose**: glance at a record beside its table or board, and change it, without leaving the list (Twenty's side panel; the CRM flow pass, 31 October 2026).
- **Main task**: read and edit its details, then step to the row or card above or below with ↑ and ↓ (or Previous and Next) and keep going.
- **Leaves out**: Overview, the stat strip and the record's menu (delete, copy link), all on its full page one press away (Open full page, on the tab the panel shows). A trashed record shows the unavailable state rather than the page's read only copy with Restore.

- A row's name in the table, a card on the board, and a created toast's Open show the record here; the address keeps `?record=` (and `?panelTab=` past Details), opening it pushing one step (Back closes it) and steps, tabs and Close replacing it, so a reload or a shared link reopens it. A step waits 150 ms before reading its record, so a held ↓ reads only where it stops; the last record stays until the next one's reads are in, so the panel never mounts twice. `peek.ts` opens the same subscriptions the page's loader does; the panel's body is the page's own (`RecordDetails`, `RelatedSections`, `ActivityTab`, `NotesTab`, `TasksTab`, `CommentsTab`, `FilesTab`), so an edit there is the table's edit. A task and a note open over it as on the page, held by the panel rather than the address. Steps come from the table's rows in its order (none while grouped), or from the card's own column on a board (`stepsAround` in `params.ts`). A neighbour the list has but hasn't loaded (its block of 100 is out of the window) keeps its step on (`isNextPending`): pressing it asks the list for that row (`loadRowId`, through the list's own range change), opens the record when its block lands and gives up after 8 seconds, so Next is off only at the real end. The open row or card is tinted, marked `aria-current` and scrolled into view (DataGrid and Board `activeId`); while the next record loads, a thin progress line shows along the panel's top after the loading delay (RecordPanel `isStepping`), with no change of layout. A row or card whose record has open comment threads shows a comment mark and the count: `RecordView.openThreads`, read with the window (`threadCounts` on `records.query`, `groups` and `get`; one grouped statement per read, `packages/core/src/comments/counts.ts`), kept through partial reads, patched by this tab's own comment changes (the comments store's open count) and re-read when a `comments` event names the record.

## Details (RecordDetails)

- **Purpose**: a record's details, in the page's sidebar (and, from milestone 4, the side panel's Details tab).
- **Main task**: read every attribute and edit it in place, saved through the data layer, a refusal said under the value.
- **Leaves out**: relationship sides that hold many records (each gets a related section after Details) and attribute groups (#18).

## Overview (OverviewTab) and Activity (ActivityTab)

- **Purpose**: a record at a glance, and what happened to it, newest first.
- **Main task**: see the newest entries (Overview draws five in place, the library's `inline` layout), and go on to the whole timeline ("View all"), which pages as it scrolls and shows changes made anywhere within a second.
- **Leaves out**: Highlights (#18), notes and comments in the feed (#19, #29), the record's own delete and restore (#36). Overview shows Open tasks above Recent activity, and the feed shows tasks (spec 0019).

## Related sections and cards (RelatedSections, spec 0017 milestone 3)

- **Purpose**: who and what is linked to this record on each side that holds many (a company's Team and Associated deals, a person's deals).
- **Main task**: scan a side's records and open one, add one, or remove one, from the record itself.
- **Leaves out**: editing the related records' own values, sorting or filtering a side, removing several at once.

- Which sides: `relatedSides` in `details.ts`, every live, visible record reference that holds many, by position, whose far object the person can see. The loader starts one `data.links.section` per side (never waiting on it); the sidebar's section and Overview's card share it, so the first page is read once.
- The sidebar, after Details: the library's `RelatedRecords`, the side's title with its total in full, its first 20 records (each a link to its page), Show more for 20 more, Add (the record search, "At …" moving a record from its holder, as a cell does, and "Create "<typed>"" last when nothing has that name: made by name, or through the far object's full form when it needs more, then linked, "Created Initech." with Undo) and a Remove per row. Remove acts at once, with no confirm (owner, 30 Oct: Undo over confirm; only the link goes, the record stays); once it lands, a toast "Removed Ada Lovelace from Team." offers Undo (one click, or Cmd+Z, the same undo entry). An Add says "Added Ada Lovelace to Team.", or "Moved Ada Lovelace to Team from Acme." when it took her from the record holding her, with the same Undo. Add and Remove show only where the person may change the record and the side has no read only reason; a side with a reason shows its lock after the heading.
- Overview, after Recent activity: a Card per side, its first five records and, in the card's actions as on Open tasks and Recent activity, "View all <N>", which moves focus to the side's section (opening the narrow page's Details fold, and the section if folded, first).
- A record in the trash or no longer available shows no sections or cards (its links come back with a restore). A side that goes out of reach (archived or hidden while open) drops out.
- Every change shows within a second: a link added or removed from either side, a related record renamed or deleted elsewhere (the section source reads again, at most twice a second).

## Notes

- `$tab` is `overview`, `activity`, `notes`, `tasks`, `comments` or `files` (#32, the record's own files: `features/files`); anything else, and no tab at all, goes to `overview`. Switching tabs replaces the address, and focus stays on the tab (`isSamePage` in `features/navigation/focus.ts`). A reload reopens the same tab.
- The loader warms the record through `data.records.one` with the attributes Details lists (`detailAttributes` in `details.ts`, shared with the screen) and the timeline's first page (`data.activity.forRecord` and `recent`, one request), waiting at most 300 ms; it hands the screen subscriptions, never rows. A record the table already shows opens at once from the same store body.
- The header's More menu ("More actions", `RecordActions.tsx`, beside Copy link) holds Copy link and, for someone who may change the object, Delete <singular>. Delete is one click with Undo, as a single row's delete in the table (owner rule, 21 Oct: an Undo delete never asks first). It goes through `data.records.deleteMany` as the table's bulk Delete does, then opens the object's table with the "Deleted Ada Lovelace." toast and its Undo; a refusal keeps the page and says why in a danger toast.
- A trashed record's banner offers Restore to someone who may change the object (the Trash screen's rule): `data.trash.restore`, pending while it runs, then "Restored Ada Lovelace." and the record read again, so the page is back to normal. A refusal (an email another record took meanwhile) says the server's reason in a danger toast and the banner stays.
- On an object the person may only read, the header says "View only" (a Badge after the object's name) with a lock whose tooltip says why ("People are view only. Ask an admin.").
- The header's name follows the primary attribute as the store holds it (`recordName`), so an edit in Details shows there and in the tab's title at once. "Copy link" writes the page's address (no search) and says "Link copied".
- States (AC-376): loading (the layout's skeletons), failed (Try again), unavailable (a missing id, a hidden record and an address that isn't an id: one EmptyState, "This record isn't available.", with "Back to <Plural>"), trashed (read only from `data.records.trashed`, with "This <singular> was deleted."), and no longer available (deleted or out of reach while open: the last record stays, read only, with "This <singular> is no longer available."). An object the person may only read shows every value with no editor. While live updates are paused a Callout says so.
- The timeline (`data.activity.forRecord` and `recent`, with the object's id so changes name their attribute) shows the creation (the create's own values folded into it), each value's change ("set", "changed", "cleared"), and what each write linked or unlinked on a side that holds many ("added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team"), each named record a link to its page (`timeline.ts`: `recordLinks` from the workspace's objects, kept per entry so an entry draws again only when it changes). A side that holds one reads as a change ("set Company").
- A record reference links through its record picker (spec 0014), and a side that can't link stays read only ("You can't change this here yet."), as in the table. A member (Owner) edits through the member picker (`members.ts`, `useMemberPicker`): the workspace's members by name or email, "Me" pinned first, saved optimistically through `data.records.setValue`.
- A record's name in the table opens its page (the grid's open action: a click on the name, or Space). The side panel (milestone 4) takes this over, with the name a real link for a new tab.
- Every string is in `strings.ts`.
