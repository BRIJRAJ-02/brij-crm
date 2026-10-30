# Notes

Spec 0019, milestones 3 and 4: notes on a record. The side panel's Notes tab waits for spec 0017's milestone 4 (the panel).

## A record's Notes tab (NotesTab)

- **Purpose**: what the team learned about this record.
- **Main task**: write a note and find it again.
- **Leaves out**: writing together in real time (#27), comments (#29), search over notes (#33).

## The note window (NoteWindow)

- **Purpose**: one note, on `?note=<id>` (or `?note=new`) over whichever tab opened it, written as a page (Notion's centre peek) and saving itself as it is typed.
- **Main task**: write what was learned, and trust that it's saved; link the other records it is about.
- **Leaves out**: versions and shared editing (#27), moving a note to another record (its own record stays and decides who sees it), a page of its own (so no "Open as full page": there is no note route).

## Log activity (LogActivityDialog)

- **Purpose**: log a call or a meeting on a record (parity with Attio, HubSpot and Twenty), or open one logged.
- **Main task**: two clicks and a save: Call is chosen and the time is now, so the common case is an outcome chip and ⌘↵.
- **Leaves out**: attendees and a calendar event (the calendar owns meetings ahead, so a time more than a day ahead is refused), a title, changing a call into a meeting, email and AI.

- A logged call or meeting is a note with a `kind` and the moment it happened (`occurred_at`, migration 0141), so it keeps linking to up to 20 records, mentions, access, the 30 day delete and the timeline. The record's Notes tab offers Log activity beside New note; ⌘K on a record offers "Log a call on <name>" and "Log a meeting on <name>" (`?log=call`, `?log=meeting`); `?log=new` opens it on Call and `?log=<id>` reopens an entry to edit.
- The dialog is one `Form` in a Modal, saved with ⌘↵ (Ctrl+Enter elsewhere) or the footer's Log call or Log meeting: Call or Meeting as two segments with icons, When as the Date picker (its typed row takes "yesterday") and a time list in five minute steps, Duration as chips (15 min, 30 min, 1 h, and Custom in a popover), Outcome as chips from the kind's own set (calls: Connected, No answer, Left message; meetings: Held, Cancelled, No show), then **Add: Notes, Records**, two dashed buttons that reveal the note editor and the linked records field (open already when the entry has them).
- A new entry stores nothing until Save; the save waits for the server (`data.notes.logActivity`), a refusal stays in the dialog as a danger Callout with everything typed, and a failed link step is a toast ("Logged, but the other records weren't linked") over an entry that is stored. A time more than a day ahead is said under When before anything is sent, and Log call is off.
- An entry reopened (`updateActivity`, from the version the dialog read) shows Delete in the title bar: one click, the dialog closes and "Call deleted" offers Undo. The kind is fixed for life. A person who may only read sees it all, read only, with Close.
- On the Notes tab and the workspace's Notes page a logged entry's row leads with the phone or people icon, reads "Call" or "Meeting" (its notes' start under it), tags its outcome and says "2 days ago · 30 min"; it sorts where it happened, a plain note by its last edit. On the Activity timeline it reads "logged a call" at the moment it happened, with the same facts; the filter has Calls, and Meetings reads calendar and logged meetings alike. Both open the same dialog.

## Notes

- Every list and the window read the data layer's notes store (`data.notes.forRecord`, `open`, `remove`, `restore`), never the network. The route's loader starts the record's notes with the page, so the tab's count arrives with it.
- With no notes, New note sits in the empty state, under "No notes yet" (as Attio and Twenty do), not above it; with notes, above the list. ⌘K on a record page offers "New note on <name>" and "New task on <name>", which open the same `?note=new` and `?task=new` on their tabs (`recordCommands` in `features/command/commands.ts`; the page sets its record through `useCommandMenu().setRecord` while the person may add to it).
- "New note" mints the note's id and opens the window on `?note=new`; nothing is stored until the title or the body holds text. The first save stores it, and the address then names it (replacing `new`, so Back still closes the window).
- The window is the Modal's peek (the owner's call, 21 October 2026, after Notion's new page and centre peek on Mobbin): a large panel with a quiet bar (the record's chip as the crumb; then the save state, More and Close) and the note as a page under it: its title in the note title type with "Untitled" as the placeholder, then the text, with no box or focus ring around either. A new note opens with focus in its title, one opened again at the start of its text; Enter in the title goes on to the text, the arrow up on the first line comes back.
- Writing tools are the editor's (`@crm/ui/editor`): the slash menu ("/" at a line's start: text, three headings, the three lists, quote, divider, code), the markdown shortcuts, the selection toolbar (bold, italic, strike, code, highlight, link) and @mentions of members.
- The window saves 300 ms after typing stops and at least every 2 seconds while it goes on (the session's own timers over the editor's `onChange`). Its bar says "Saving…", "Saved", "Not saved. Retrying…", or "Not saved." with Retry, and for a note opened again "Edited 3 hours ago" (the session's `updatedAt`; it ticks on without being announced). A refusal (too long, unavailable, read only) shows as a danger Callout over the page and the text stays for copying.
- When someone else saves the open note and nothing is unsaved here, the window shows their version (the editor starts again from it) with "<Name> edited this note, so it now shows their version."; with unsaved text here, the next save goes over theirs with "… Your version was saved over theirs." Each notice closes with Dismiss.
- The editor (`@crm/ui/editor`, Tiptap) loads in its own chunk (`editor.ts`) when the Notes tab first shows or a note first opens, never with the app; a skeleton stands in meanwhile.
- Esc closes an open list or the selection toolbar first, then the window, as a click outside does. Closing with a save pending closes at once; the save finishes in the data layer, and if it then fails a toast offers "Open note". While any note has unsaved changes, leaving the page asks first.
- "Delete note" in the window's More menu asks first (the owner's rule of 21 October 2026, since a deleted note can't come back from the Trash): "Delete <title>?" ("Delete this note?" untitled), Cancel or Esc changes nothing, and Delete note waits for the server, a refusal staying in the confirm with its reason. Once it lands, both close, the note leaves every list, and "Note deleted" offers Undo for 10 seconds (`delete.ts`).
- A note in the timeline reads "added a note" with its title ("Untitled note" when it has none) and the start of its text, which opens the window.
- A note links up to 19 other records besides its own (migration 0136). "Link record" in the More menu shows the Linked records field (the task dialog's Records field: chips with Remove, a picker over the objects the person may change) with its picker open; once a note links any, the field stays under the bar. Each linked record's Notes tab lists the note and its Activity reads "added a note" at the moment it was linked. Opened from a linked record, the bar's crumb names the note's own record, which still decides who may see and change it: a note linked to a record you can see from one you can't stays absent. Its own record can't be unlinked.
- Every string is in `strings.ts`.
