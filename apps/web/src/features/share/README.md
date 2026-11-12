# share

Not a screen: the one share sheet (the library's ShareSheet, spec 0074) loaded apart from the screens that open it on a press.

- `LazyShareSheet.tsx`: `lazyShareSheet(() => import('../share/share-sheet.ts'))` gives a screen `ShareSheet` (the same props as the library's), which mounts its code only once first opened, and `usePreload()`, which loads it on the browser's first idle moment after the screen draws, so a first Share rarely waits. The screen passes the import itself, so it lives in the screen's route chunk.
- `share-sheet.ts`: the chunk itself, a re-export from `@crm/ui`.

The link page's Share and a menu's publish and Share use it. A Share tab that draws the column inline (a form's, a booking page's) imports `ShareColumn` from `@crm/ui` directly, since it shows on the tab's first paint.
