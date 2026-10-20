# Notes

Spec 0019, milestones 3 and 4: notes on a record. The side panel's Notes tab waits for spec 0017's milestone 4 (the panel).

## A record's Notes tab (NotesTab)

- **Purpose**: what the team learned about this record.
- **Main task**: write a note and find it again.
- **Leaves out**: writing together in real time (#27), comments (#29), search over notes (#33).

## The note window (NoteWindow)

- **Purpose**: one note, on `?note=<id>` (or `?note=new`) over whichever tab opened it, saving itself as it is typed.
- **Main task**: write what was learned, and trust that it's saved.
- **Leaves out**: versions and shared editing (#27), moving a note to another record.

## Notes

- Every list and the window read the data layer's notes store (`data.notes.forRecord`, `open`, `remove`, `restore`), never the network. The route's loader starts the record's notes with the page, so the tab's count arrives with it.
- "New note" mints the note's id and opens the window on `?note=new`; nothing is stored until the title or the body holds text. The first save stores it, and the address then names it (replacing `new`, so Back still closes the window).
- The window saves 300 ms after typing stops and at least every 2 seconds while it goes on (the session's own timers over the editor's `onChange`). Its title bar says "Saving…", "Saved", "Not saved. Retrying…", or "Not saved." with Retry; a refusal (too long, unavailable, read only) shows as a danger Callout and the text stays for copying.
- When someone else saves the open note and nothing is unsaved here, the window shows their version (the editor starts again from it) with "<Name> edited this note, so it now shows their version."; with unsaved text here, the next save goes over theirs with "… Your version was saved over theirs." Each notice closes with Dismiss.
- The editor (`@crm/ui/editor`, Tiptap) loads in its own chunk when a note first opens, never with the app; a skeleton stands in meanwhile.
- Closing with a save pending closes at once; the save finishes in the data layer, and if it then fails a toast offers "Open note". While any note has unsaved changes, leaving the page asks first.
- "Delete note" in the window's More menu closes it, takes the note out of every list at once, and raises "Note deleted" with Undo for 10 seconds.
- A note in the timeline reads "added a note" with its title ("Untitled note" when it has none) and the start of its text, which opens the window.
- Every string is in `strings.ts`.
