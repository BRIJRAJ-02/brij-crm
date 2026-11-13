# share

Not a screen: the one share sheet (the library's ShareSheet, spec 0074) loaded apart from the screens that open it on a press.

- `LazyShareSheet.tsx`: `lazyShareSheet(() => import('../share/share-sheet.ts'))` gives a screen `ShareSheet` (the same props as the library's), which mounts its code only once first opened, and `usePreload()`, which loads it on the browser's first idle moment after the screen draws, so a first Share rarely waits. Both come from `lazyOnOpen`, which a dialog of the app's own can use too (a booking page's share sheet, `booking/BookingShareSheet.tsx`, whose body is its own chunk). The screen passes the import itself, so the import sits in the screen's route chunk; the sheet's own code (`share-sheet.ts` and the library's ShareSheet) is a chunk of its own, loaded on first open or when idle.
- `LazyShareColumn.tsx`: `lazyShareColumn(() => import('../share/share-sheet.ts'))` gives a Share tab `ShareColumn` (the same props), drawn once its code lands, the column's shape in its place until then (after the loading delay, the slot marked busy). A Share tab is never an editor's first view, so the column stays off the editor's first load; the editor's `usePreload` usually has it in before the tab opens.
- `share-sheet.ts`: the chunk itself, a re-export of ShareSheet and ShareColumn from `@crm/ui`.

The link page's Share, the Menus screen (its publish and Share), the business page, team pages, a booking page's Share (the editor's header and each card's ⋯) and a form's live dialog use it; the form's and booking page's Share tabs draw the column through `lazyShareColumn`.
