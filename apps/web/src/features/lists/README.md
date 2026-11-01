# Lists (spec 0048)

A list is a working set of one object's records (a Sales pipeline over Deals); each record in it is an entry with fields of its own. Every read and write goes through `data.lists` (the lists, a list's own fields, and the entries layer in `packages/data/src/lists/entries.ts`).

## Screens

| Screen                                              | Purpose                                  | Main task                                                                                                    | Leaves out                                                                                 |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `NewListModal` (sidebar Lists' "+")                 | Make a list over an object               | Name, Of, Blank or Pipeline, then Create list; the list opens                                                | Icon and hue (the list tile, gray; Settings › Lists changes them), "Each record once" (on) |
| `ListScreen` (`/w/$slug/lists/$list/views/$viewId`) | One list's entries as a table or a board | Add records, edit list fields in place, move cards between stages, take entries out with Undo                | Several fields in one bulk Edit (Edit changes one list or record field of the ticked rows) |
| `AddEntryModal`                                     | Put one record in a list                 | Find the record (one already in an "Each record once" list says so), fill a required list field, Add to list | Optional fields (edited in the row), making a new record here                              |

## Decisions made here (owner delegated UX calls)

- Name comes first in New list, so the dialog opens on what you type; Of starts on the object whose page is open.
- The sidebar's Lists section shows, empty, to whoever may make a list, so its "+" is where the first list is made. To anyone else it stays out until a list exists (AC-4804).
- Up to 500 ticked entries go at once with Undo, no confirm (owner, 30 Oct: Undo over a confirm; decision 9 asked first). More, or all matching, run as a counted job: Review shows the exact number, and the finish toast has Undo.
- A Pipeline's stages read grey, sky, blue, then green and red, as a pipeline does.
- A row's name opens the record's page (the record panel arrives with milestone 3's Lists section).

Milestones 3 and 4 (spec 0048):

| Screen                                                            | Purpose                              | Main task                                                                                            | Leaves out                                                              |
| ----------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `RecordLists` (the record page's Details sidebar)                 | The lists a record is in             | See each entry's fields, edit them in place, Add to list, Remove from list with Undo                 | The list's own table (Open list goes there)                             |
| `AddToListMenu` (record header and section, the table's bulk bar) | Put records in a list                | Pick a list; one record goes in at once (a required field asks first), many in one request with Undo | A search box; more than 500 or all matching go to the bulk bar's counted job (`onChooseMany`) |
| `ArchivedList` (a list's address once archived)                   | Say the list is archived             | Restore it, for its managers                                                                         | Entries and settings                                                    |
| `ArchiveListDialog`                                               | Confirm archiving a list             | Read that entries are kept, Archive                                                                  | Deleting anything                                                       |
| `ListsScreen`, `ListSettingsScreen` (`features/settings`)         | Settings › Lists and one list's tabs | Open, make, archive and restore lists; General (name, look, Each record once), Fields                | Entries; who sees a list (it follows its object)                        |

## More decisions made here (owner delegated UX calls)

- Add to list is a Menu of the lists the member may write, not a searchable Combobox: a member's lists are few, and a Menu types ahead and shows "Already in" beside a list that holds the record.
- The list's Toolbar (filter, sort, Save, Save as new view) is the object view's own `ViewToolbar`; the draft lives in the page, not the address, so a link doesn't carry it.
- The record page's Lists section is left out when no list the member may read sits over the object.
- Not built: the record panel opening from a row (AC-4812). Bulk Edit takes a list field (`entries.updateMany`, one Undo through `entries.setValuesBatch`) or a record field (`records.updateMany`), one field an Apply.

The lists3 lane:

- A list view has the object views' menu (`useViewMenu` with `listId`): Rename, Duplicate (opens the private copy), Copy link, who can see it, Set as default and Delete; Open trash is left out (a list has no trash).
- Import (AC-4833) is spec 0040's page at `/w/$slug/lists/$list/import`, from the list's top bar and its empty state: the list's fields come first in the column picker as "<List>: <Field>", records are found only by one of their own unique fields, and each row adds its record (or updates its entry in an "Each record once" list). Undo takes out the entries it added; entry values it changed stay.
- A card added from the record page shows at once and leaves on a refusal.
- A list whose object is archived says so ("<Object> is archived too. Restoring it brings this list back.") with no Restore.
- "Each record once" lost its hint (it repeated the label); a refusal stays under the switch until the next change.
