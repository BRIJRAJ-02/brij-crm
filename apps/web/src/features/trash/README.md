# Trash

Spec 0022, milestones 1 to 4. The workspace's trash: a record deleted from a table waits here for 30 days, then the daily cleanup removes it for good.

## The trash (`/w/$slug/trash`, TrashScreen)

- **Purpose**: every record deleted in the last 30 days that the person may see, newest first.
- **Main task**: find a record deleted by mistake and restore it, seeing on its row why one can't come back; owners and admins also delete forever and empty the trash.
- **Leaves out**: opening or editing trashed records, and changing the 30 days.

## Notes

- "Trash" sits in the sidebar for every member, after Records, Bookings and Captures. The TopBar counts what the trash holds ("10,000+" past the cap); the toolbar's Object select ("All objects", then every object the person may see, archived ones marked) narrows it, kept in the address as `?object=<id>`.
- The list is the DataGrid, read only, fed by `data.trash.view` (windows by cursor, 100 a block, with the count), through `useTrash`. Its columns are synthetic attributes (`trash.ts`), so each value draws through its one field design: Name (a record reference, plain, never a link), Object (text), Deleted by (an actor: a member, "Someone removed from this workspace", "The system", "An API key"), Deleted (a timestamp) and Removed after (a date, 30 days on, in the browser's time zone). A name hidden from the person reads "Unnamed <singular>", like an empty one.
- Ticking rows shows the floating BulkActionBar with Restore. It is enabled when at least one selected record's object is one the person may change, else disabled with "You can view these records but not restore them." Restored rows leave at once; a refused one comes back with its reason on its Name cell (the grid's `cellErrors`, kept until the person leaves), and one toast sums it up ("Restored 46 records. 2 couldn’t be restored; each row says why."). Focus goes back to the grid where the first restored row was.
- States: the grid's loading rows, "The trash is empty. Deleted records stay here for 30 days.", "No deleted <plural>." for an object with none, and the grid's error state with Retry.
- Live: deletes, restores and purges anywhere settle the open trash 1.5 seconds after the last (spread 0 to 2 seconds). This tab's own deletes and undos settle it too, since their echoes never come back.
- More than 500, or "Select all N matching" (the trash of the object filter, less any left out), restore as a background change: counted ("1,200 records counted", with Review), confirmed ("Restore 1,200 records?"), with progress and Cancel in the bar. A restore or Delete forever that refuses some keeps those rows ticked, each with its reason on its Name cell.
- Owners and admins (`records.purge`) see Delete forever in the bar (a danger confirm, "Delete 48 records forever? This can't be undone.", inline up to 500, a counted job past that) and Empty trash in the TopBar (a quiet ghost button, the danger in its confirm; always a counted job: "Empty the trash? 1,234 records will be deleted forever.", or "Empty deleted deals", "Delete all deals in the trash forever?" and "12 deals will be deleted forever." while the filter names one object). Empty trash hands focus to the bar's Cancel as its job starts, says its refusal or a count of zero in a toast, and is off, saying why, while a change runs. Delete forever fails closed: a record of an object the person may only read stays, with its reason. Members never see either; the server refuses them 403 anyway.
