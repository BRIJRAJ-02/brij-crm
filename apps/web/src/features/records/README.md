# Records

Spec 0017, milestones 1 and 2: a record's own page, and its timeline. It sits in `WorkspaceFrame` through `WorkspacePage`, laid out by the library's `RecordLayout`.

## The record page (`/w/$slug/objects/$object/$recordId/$tab`, RecordPage)

- **Purpose**: everything about one record in one place: its details, and what happened to it.
- **Main task**: read and edit its details in place, and see who changed what and when, live.
- **Leaves out**: deleting and restoring it (#22), presence (#26), related records (milestone 3), notes (#19 milestone 3), comments (#29). Tasks (#19 milestone 1) have their own tab and Overview block, `features/tasks`.

- **Stat strip** (13 Oct reference batch 4; owner's call 22 Oct: the tabs keep their counts, so the strip says only what they don't): the record's value (an attribute `value` of type currency, through its field display), `Entered <stage>` with how long ago (the first live status attribute; `records.stageSince`, read afresh when the stage changes), the next meeting (`calendar.meetings.forRecord`, the first one not yet over), and the last activity (`useLatestActivityAt`, opening Activity). `data.records.facts` holds the meeting and the stage age; `useRecordFacts` reads them.

## Details (RecordDetails)

- **Purpose**: a record's details, in the page's sidebar (and, from milestone 4, the side panel's Details tab).
- **Main task**: read every attribute and edit it in place, saved through the data layer, a refusal said under the value.
- **Leaves out**: relationship sections that hold many records (milestone 3) and attribute groups (#18).

## Overview (OverviewTab) and Activity (ActivityTab)

- **Purpose**: a record at a glance, and what happened to it, newest first.
- **Main task**: see the newest entries (Overview draws five in place, the library's `inline` layout), and go on to the whole timeline ("View all"), which pages as it scrolls and shows changes made anywhere within a second.
- **Leaves out**: Related cards (milestone 3), Highlights (#18), notes and comments in the feed (#19, #29), the record's own delete and restore (#36). Overview shows Open tasks above Recent activity, and the feed shows tasks (spec 0019).

## Notes

- `$tab` is `overview`, `activity` or `tasks` (spec 0019); anything else, and no tab at all, goes to `overview`. Switching tabs replaces the address, and focus stays on the tab (`isSamePage` in `features/navigation/focus.ts`). A reload reopens the same tab.
- The loader warms the record through `data.records.one` with the attributes Details lists (`detailAttributes` in `details.ts`, shared with the screen) and the timeline's first page (`data.activity.forRecord` and `recent`, one request), waiting at most 300 ms; it hands the screen subscriptions, never rows. A record the table already shows opens at once from the same store body.
- The header's name follows the primary attribute as the store holds it (`recordName`), so an edit in Details shows there and in the tab's title at once. "Copy link" writes the page's address (no search) and says "Link copied".
- States (AC-376): loading (the layout's skeletons), failed (Try again), unavailable (a missing id, a hidden record and an address that isn't an id: one EmptyState, "This record isn't available.", with "Back to <Plural>"), trashed (read only from `data.records.trashed`, with "This <singular> was deleted."), and no longer available (deleted or out of reach while open: the last record stays, read only, with "This <singular> is no longer available."). An object the person may only read shows every value with no editor. While live updates are paused a Callout says so.
- The timeline (`data.activity.forRecord` and `recent`, with the object's id so changes name their attribute) shows the creation (the create's own values folded into it), each value's change ("set", "changed", "cleared"), and what each write linked or unlinked on a side that holds many ("added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team"), each named record a link to its page (`timeline.ts`: `recordLinks` from the workspace's objects, kept per entry so an entry draws again only when it changes). A side that holds one reads as a change ("set Company").
- References and members are read only here until #15 brings the record picker ("You can't change this here yet."), as in the table.
- A record's name in the table opens its page (the grid's open action: a click on the name, or Space). The side panel (milestone 4) takes this over, with the name a real link for a new tab.
- Every string is in `strings.ts`.
