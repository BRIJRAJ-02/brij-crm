# Lists (spec 0048)

A list is a working set of one object's records (a Sales pipeline over Deals); each record in it is an entry with fields of its own. Every read and write goes through `data.lists` (the lists, a list's own fields, and the entries layer in `packages/data/src/lists/entries.ts`).

## Screens

| Screen | Purpose | Main task | Leaves out |
|---|---|---|---|
| `NewListModal` (sidebar Lists' "+") | Make a list over an object | Name, Of, Blank or Pipeline, then Create list; the list opens | Icon and hue (the list tile, gray), "Each record once" (on), fields (the list's "+") |
| `ListScreen` (`/w/$slug/lists/$list/views/$viewId`) | One list's entries as a table or a board | Add records, edit list fields in place, move cards between stages, take entries out with Undo | Filters and saved sorts, bulk Edit, settings, archive, import |
| `AddEntryModal` | Put one record in a list | Find the record (one already in an "Each record once" list says so), fill a required list field, Add to list | Optional fields (edited in the row), making a new record here |

## Decisions made here (owner delegated UX calls)

- Name comes first in New list, so the dialog opens on what you type; Of starts on the object whose page is open.
- The sidebar's Lists section shows, empty, to whoever may make a list, so its "+" is where the first list is made. To anyone else it stays out until a list exists (AC-4804).
- One ticked entry goes at once with Undo; two or more ask first in a Modal (decision 9). The bulk bar is the row's Remove.
- A Pipeline's stages read grey, sky, blue, then green and red, as a pipeline does.
- A row's name opens the record's page (the record panel arrives with milestone 3's Lists section).
