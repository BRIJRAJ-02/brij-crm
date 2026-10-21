# Notes

Spec 0019, milestones 3 and 4: notes on a record. The side panel's Notes tab waits for spec 0017's milestone 4 (the panel).

## A record's Notes tab (NotesTab)

- **Purpose**: what the team learned about this record.
- **Main task**: write a note and find it again.
- **Leaves out**: writing together in real time (#27), comments (#29), search over notes (#33).

## The note window (NoteWindow)

- **Purpose**: one note, on `?note=<id>` (or `?note=new`) over whichever tab opened it, written as a page (Notion's centre peek) and saving itself as it is typed.
- **Main task**: write what was learned, and trust that it's saved.
- **Leaves out**: versions and shared editing (#27), moving a note to another record, a page of its own (so no "Open as full page": there is no note route).

## Notes

- Every list and the window read the data layer's notes store (`data.notes.forRecord`, `open`, `remove`, `restore`), never the network. The route's loader starts the record's notes with the page, so the tab's count arrives with it.
- "New note" mints the note's id and opens the window on `?note=new`; nothing is stored until the title or the body holds text. The first save stores it, and the address then names it (replacing `new`, so Back still closes the window).
- The window is the Modal's peek (the owner's call, 21 October 2026, after Notion's new page and centre peek on Mobbin): a large panel with a quiet bar (the record's chip as the crumb; then the save state, More and Close) and the note as a page under it: its title in the note title type with "Untitled" as the placeholder, then the text, with no box or focus ring around either. A new note opens with focus in its title, one opened again at the start of its text; Enter in the title goes on to the text, the arrow up on the first line comes back.
- Writing tools are the editor's (`@crm/ui/editor`): the slash menu ("/" at a line's start: text, three headings, the three lists, quote, divider, code), the markdown shortcuts, the selection toolbar (bold, italic, strike, code, highlight, link) and @mentions of members.
- The window saves 300 ms after typing stops and at least every 2 seconds while it goes on (the session's own timers over the editor's `onChange`). Its bar says "Saving…", "Saved", "Not saved. Retrying…", or "Not saved." with Retry, and for a note opened again "Edited 3 hours ago" (the session's `updatedAt`; it ticks on without being announced). A refusal (too long, unavailable, read only) shows as a danger Callout over the page and the text stays for copying.
- When someone else saves the open note and nothing is unsaved here, the window shows their version (the editor starts again from it) with "<Name> edited this note, so it now shows their version."; with unsaved text here, the next save goes over theirs with "… Your version was saved over theirs." Each notice closes with Dismiss.
- The editor (`@crm/ui/editor`, Tiptap) loads in its own chunk (`editor.ts`) when the Notes tab first shows or a note first opens, never with the app; a skeleton stands in meanwhile.
- Esc closes an open list or the selection toolbar first, then the window, as a click outside does. Closing with a save pending closes at once; the save finishes in the data layer, and if it then fails a toast offers "Open note". While any note has unsaved changes, leaving the page asks first.
- "Delete note" in the window's More menu asks first (the owner's rule of 21 October 2026, since a deleted note can't come back from the Trash): "Delete <title>?" ("Delete this note?" untitled), Cancel or Esc changes nothing, and Delete note waits for the server, a refusal staying in the confirm with its reason. Once it lands, both close, the note leaves every list, and "Note deleted" offers Undo for 10 seconds (`delete.ts`).
- A note in the timeline reads "added a note" with its title ("Untitled note" when it has none) and the start of its text, which opens the window.
- Every string is in `strings.ts`.
