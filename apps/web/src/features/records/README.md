# Records

Spec 0017, milestone 1: a record's own page. It sits in `WorkspaceFrame` through `WorkspacePage`, laid out by the library's `RecordLayout`.

## The record page (`/w/$slug/objects/$object/$recordId/$tab`, RecordPage)

- **Purpose**: everything about one record in one place: its details, and what happened to it.
- **Main task**: read and edit its details in place, and see who made it and when (the timeline grows with milestone 2).
- **Leaves out**: deleting and restoring it (#22), presence (#26), related records (milestone 3), notes and tasks (#19), comments (#29).

## Details (RecordDetails)

- **Purpose**: a record's details, in the page's sidebar (and, from milestone 4, the side panel's Details tab).
- **Main task**: read every attribute and edit it in place, saved through the data layer, a refusal said under the value.
- **Leaves out**: relationship sections that hold many records (milestone 3) and attribute groups (#18).

## Overview (OverviewTab) and Activity (ActivityTab)

- **Purpose**: a record at a glance, and what happened to it, newest first.
- **Main task**: see the newest entries, and go on to the whole timeline ("View all").
- **Leaves out**: Related cards (milestone 3), Highlights (#18), Open tasks (#19); changes, link entries, paging and live updates in the feed (milestone 2).

## Notes

- `$tab` is `overview` or `activity`; anything else, and no tab at all, goes to `overview`. Switching tabs replaces the address, and focus stays on the tab (`isSamePage` in `features/navigation/focus.ts`). A reload reopens the same tab.
- The loader warms the record through `data.records.one` with the attributes Details lists (`detailAttributes` in `details.ts`, shared with the screen) and the timeline's first page (`data.activity.forRecord` and `recent`, one request), waiting at most 300 ms; it hands the screen subscriptions, never rows. A record the table already shows opens at once from the same store body.
- The header's name follows the primary attribute as the store holds it (`recordName`), so an edit in Details shows there and in the tab's title at once. "Copy link" writes the page's address (no search) and says "Link copied".
- States (AC-376): loading (the layout's skeletons), failed (Try again), unavailable (a missing id, a hidden record and an address that isn't an id: one EmptyState, "This record isn't available.", with "Back to <Plural>"), trashed (read only from `data.records.trashed`, with "This <singular> was deleted."), and no longer available (deleted or out of reach while open: the last record stays, read only, with "This <singular> is no longer available."). An object the person may only read shows every value with no editor. While live updates are paused a Callout says so.
- References and members are read only here until #15 brings the record picker ("You can't change this here yet."), as in the table.
- A record's name in the table opens its page (the grid's open action: a click on the name, or Space). The side panel (milestone 4) takes this over, with the name a real link for a new tab.
- Every string is in `strings.ts`.
