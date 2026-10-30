# Lists (spec 0048)

A list is a working set of one object's records (a Sales pipeline over Deals); each record in it is an entry with fields of its own. Every read and write goes through `data.lists` (the lists, a list's own fields, and the entries layer in `packages/data/src/lists/entries.ts`).

## Screens

| Screen                                              | Purpose                                  | Main task                                                                                                    | Leaves out                                                                                 |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `NewListModal` (sidebar Lists' "+")                 | Make a list over an object               | Name, Of, Blank or Pipeline, then Create list; the list opens                                                | Icon and hue (the list tile, gray; Settings › Lists changes them), "Each record once" (on) |
| `ListScreen` (`/w/$slug/lists/$list/views/$viewId`) | One list's entries as a table or a board | Add records, edit list fields in place, move cards between stages, take entries out with Undo                | Bulk Edit, the view menu (rename, duplicate, lock, default, delete), import                |
| `AddEntryModal`                                     | Put one record in a list                 | Find the record (one already in an "Each record once" list says so), fill a required list field, Add to list | Optional fields (edited in the row), making a new record here                              |

## Decisions made here (owner delegated UX calls)

- Name comes first in New list, so the dialog opens on what you type; Of starts on the object whose page is open.
- The sidebar's Lists section shows, empty, to whoever may make a list, so its "+" is where the first list is made. To anyone else it stays out until a list exists (AC-4804).
- One ticked entry goes at once with Undo; two or more ask first in a Modal (decision 9). The bulk bar is the row's Remove.
- A Pipeline's stages read grey, sky, blue, then green and red, as a pipeline does.
- A row's name opens the record's page (the record panel arrives with milestone 3's Lists section).

Milestones 3 and 4 (spec 0048):

| Screen                                                            | Purpose                              | Main task                                                                                            | Leaves out                                                              |
| ----------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `RecordLists` (the record page's Details sidebar)                 | The lists a record is in             | See each entry's fields, edit them in place, Add to list, Remove from list with Undo                 | The list's own table (Open list goes there)                             |
| `AddToListMenu` (record header and section, the table's bulk bar) | Put records in a list                | Pick a list; one record goes in at once (a required field asks first), many in one request with Undo | A search box, and "all matching" selections (ticked rows, up to 10,000) |
| `ArchivedList` (a list's address once archived)                   | Say the list is archived             | Restore it, for its managers                                                                         | Entries and settings                                                    |
| `ArchiveListDialog`                                               | Confirm archiving a list             | Read that entries are kept, Archive                                                                  | Deleting anything                                                       |
| `ListsScreen`, `ListSettingsScreen` (`features/settings`)         | Settings › Lists and one list's tabs | Open, make, archive and restore lists; General (name, look, Each record once), Fields                | Entries; who sees a list (it follows its object)                        |

## More decisions made here (owner delegated UX calls)

- Add to list is a Menu of the lists the member may write, not a searchable Combobox: a member's lists are few, and a Menu types ahead and shows "Already in" beside a list that holds the record.
- The list's Toolbar (filter, sort, Save, Save as new view) is the object view's own `ViewToolbar`; the draft lives in the page, not the address, so a link doesn't carry it.
- The record page's Lists section is left out when no list the member may read sits over the object.
- Not built: Import into a list (AC-4833), bulk jobs past 10,000 ticked rows or "all matching" (AC-4817, AC-4825), the record panel opening from a row (AC-4812), the view menu on a list.
