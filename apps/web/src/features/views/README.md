# Views

One screen shows any view of any object (spec 0020): the TopBar, the ViewBar with the switcher, the Toolbar with the view's sorts and filters, and the table.

## Brief

- **Purpose**: slice one object the way you work and keep it.
- **Main task**: filter and sort the table, then save it.
- **Leaves out**: grouping inside the table, view search, charts, sharing outside the workspace. Until milestone 2: creating and managing views, and saving columns.

## Files

| File                    | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ViewScreen.tsx`        | The view: its saved body and the object's views from `data.views`, the draft, what runs (`runningQuery`, archived and unknown attributes left out, newest first when it has no sorts), Save with its version check and the clash dialog, the live toast when someone else saves, the link's notices, and `RecordsScreen` running the effective query                                                                                |
| `ViewToolbar.tsx`       | The Toolbar: a SortChip (or the dashed Sort) opening SortBuilder, a ConditionChip per top level filter item and the dashed Filter opening FilterBuilder, each in a Popover; Discard changes and Save while there is a draft. An operand typed applies 300 ms after the last keystroke (`FILTER_EDIT_MS`); an attribute, operator, group or removal at once; the first change of a Popover adds a history entry, the rest replace it |
| `useViewDraft.ts`       | The draft over the route's `draft` search param (base64url of its canonical JSON), or only in memory past 6,000 characters; equal to the saved query it is no draft; it keeps the view's query version from when it began                                                                                                                                                                                                           |
| `ViewChangedDialog.tsx` | "This view changed" (AC-469): Cancel first, then Replace                                                                                                                                                                                                                                                                                                                                                                            |
| `query.ts`              | Plain helpers the route's loader shares: the saved query, what runs, what Save writes, a reference's far object (spec 0014's relationship block, once attributes carry it), and which view an object's address opens                                                                                                                                                                                                                |
| `strings.ts`            | The copy                                                                                                                                                                                                                                                                                                                                                                                                                            |

## States

Loading (the object page's skeleton bars), not found (`viewNotFoundPage`, never saying why), no view available (`noViewsPage`), error with Retry (the route's error page, or the grid's own when its rows fail), an object with no records, a filter matching nothing ("No people match these filters" with Discard changes on a draft or Edit filters on a saved view), and an archived object (spec 0012's page).
