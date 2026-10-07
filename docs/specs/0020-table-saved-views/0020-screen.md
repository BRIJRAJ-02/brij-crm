# 0020. The view screen and the views store

## Summary

One screen shows any view of any object: the three bars from the library (TopBar, ViewBar, Toolbar) above the DataGrid. The ViewBar holds the switcher and the view's menu; the Toolbar holds the sorts and filters and, while there is a draft, Discard and Save. Every piece is an existing library component, so this feature adds no component and no variant (the grid's row note comes from spec 0006). Views reach the screen only through `data.views`.

Brief (the three lines the house rule asks for): **Purpose**: slice one object the way you work and keep it. **Main task**: filter and sort the table, then save it. **Leaves out**: grouping inside the table, view search, charts, sharing outside the workspace.

## Route (`apps/web/src/routes`)

| Route | Does |
|---|---|
| `w.$slug.objects.$object.tsx` (exists) | becomes a redirect: loads `views.list` through `data.views` and replaces the URL with the chosen view (AC-462). While it loads, the object page skeleton shows |
| `w.$slug.objects.$object.views.$viewId.tsx` (new) | the view screen. `validateSearch` parses `draft` (and spec 0014's `record` for the panel). The loader warms `data.views.get(viewId)` and the window for the effective query (count and first block), as spec 0005's loader does; it never hands rows to the screen |

Feature code lives in `apps/web/src/features/views/` (new): `ViewScreen.tsx` (replaces `features/workspace/ObjectScreen.tsx`, which keeps only the object level states), `ViewSwitcher.tsx`, `ViewMenu.tsx`, `CreateViewDialog.tsx`, `ViewChangedDialog.tsx`, `strings.ts`, `README.md` (the brief above).

## The bars

**TopBar**: the object's icon tile and plural name, "New <singular>" (spec 0005's create dialog), the count as `meta` ("124 people", "10,000+ people").

**ViewBar**:
- Switcher: the current view's name (a lock icon when locked); its menu lists, in order, the default view, the other shared views, a "Private" section (MenuLabel) with the member's private views, a separator and "Create view". The current view is checked.
- `children`, in order: the Table and Board SegmentedControl (#21 wires it; in #20 it shows only when spec 0021 milestone 1 has landed), "View settings" (Button, opens a Popover with ViewSettings), the view menu (an icon Button "More view actions" opening a Menu), and on a locked view a LockReason "Locked by <Name>".

**Toolbar** (`label` "View options"):
- Start: a SortChip per the first sort ("+N" for the rest), or a dashed "Sort" Button when there are none; a FilterChip per top level condition (a nested group shows as one chip "N conditions"); a dashed "Filter" Button.
- `end` while a draft exists: "Discard changes" (ghost) and a SplitButton "Save" with the menu item "Save as new view". On a locked view without `views.manage`, only a Button "Save as new view".
- Below the Toolbar, when `effectiveQuery` skipped archived attributes: a Callout (info) with AC-480's text. When a draft lost conditions (AC-467): a Callout (warning) with that text, closable.

**The grid**: spec 0006's DataGrid feed (`records.view` with the effective filter, sorts and the shown column ids), `columns` and `pinnedCount` from `effectiveColumns`, `onColumnsChange` → `data.views.setLayout`, `onSort` → the draft's sorts, `onFilter` → opens the Filter Popover with a new condition on that attribute, row notes and cell errors as spec 0006.

## The view menu (item, who sees it enabled, and the disabled reason)

| Item | Enabled when | Disabled reason shown |
|---|---|---|
| Rename | may edit (rules table in [index.md](index.md)) | "This view is locked." |
| Duplicate | always | |
| Copy link | always, unless the draft is over 6,000 characters | "This filter is too long for a link. Save it as a view to share it." |
| Move up, Move down | may edit, and not already first or last in its group; never on the default view | "The default view is always first." |
| Share with everyone | a private view, its creator | |
| Make private | a shared view, its creator, unlocked, not the default, not seeded | "The default view is shared with everyone." or "This view was made by the workspace, so it stays shared." or "Unlock it first." |
| Lock, Unlock | a shared view, `views.manage` | hidden for members |
| Set as default | a shared view that isn't the default, `views.manage` | hidden for members |
| Delete | may edit, not the default view | "This is the default view for <plural>. Make another view the default first." |

Rename opens a Modal with one Field (same rules and refusals as create). Copy link copies `location.href` (the draft included) and shows the toast "Link copied". Delete opens a Modal (confirm, danger tone) with AC-474's text and "Delete view".

## Dialogs

- **Create view** (Modal + Form): Name (Field, required, 100 characters, counter), Type (SegmentedControl Table and Board; Board only once spec 0021 milestone 1 has landed), "Who can see it" (RadioGroup: "Only me", "Everyone in the workspace"), "Start from this view's columns and filters" (Checkbox, on). "Create view" shows busy until the server answers; `NAME_TAKEN` on the name field, `LIMIT_REACHED` as the form's banner. On success the dialog closes and the route goes to the new view.
- **Save as new view**: the same dialog, the checkbox hidden and on, the name empty.
- **View changed** (Modal): AC-469's text with "Replace", "Save as new view" and "Cancel"; focus starts on "Cancel".
- Every dialog returns focus to the control that opened it.

## Screen states

| State | When | Shows |
|---|---|---|
| loading | `views.get` or the first block pending past the loading delay | TopBar `isLoading`, ViewBar `isLoading`, the grid's loading state |
| not found | `views.get` answers `NOT_FOUND`, or the view leaves `views.list` while open | EmptyState: "This view doesn't exist or isn't shared with you." and a Link "Go to <Default name>" (if the view disappeared while open, the screen goes there directly with AC-474's toast) |
| error | `views.get` or the first block fails otherwise | the grid's error state with Retry (the bars stay when the view loaded) |
| empty object | count 0 and no effective filter | the grid's empty state: "No <plural> yet" and "New <singular>" |
| no matches | count 0 with an effective filter | the grid's empty state: "No <plural> match these filters" and "Discard changes" (draft) or "Edit filters" (saved; opens the Filter Popover) |
| locked | the view is locked and the member lacks `views.manage` | the LockReason line; Save limited as AC-476 |
| archived object | the object is archived | spec 0012's archived page |
| read only object (#24) | object level `read` | the grid's read only cells (spec 0009); filters, sorts and layout still work |

## `data.views` (`packages/data/src/views/`)

```ts
data.views(workspace) → {
  list(objectId): Store<{ status, views: ViewSummary[], defaultViewId, lastOpenedViewId? }>,
  get(viewId): Store<{ status: 'loading' | 'ready' | 'not-found' | 'error', view?: View, retry }>,
  create(input): Promise<View>,                                  // server confirmed
  update(viewId, { name?, visibility? }): Promise<View>,          // server confirmed
  setLayout(viewId, layout): void,                                // optimistic, 500 ms debounce, rollback with a toast
  saveQuery(viewId, query, { baseQueryVersion, force? }): Promise<View>, // server confirmed; rejects VIEW_CHANGED with its data
  move(viewId, direction), setLocked(viewId, locked), setDefault(objectId, viewId), remove(viewId): Promise<…>,
  markOpened(viewId): void,                                       // fire and forget, at most once per view per 10 seconds
}
```

- One body per view id; lists hold ids. A `views` event refetches `list` for its object (at most once per second per object, leading and trailing) and `get` for each named view the store holds. A body is replaced only by a read with a `version` at least the held one (spec 0006's revision rule, for views).
- Layout on a locked view, for a member without `views.manage`: `setLayout` keeps a local layer for this view and sends nothing; the layer is dropped when the screen leaves the view.
- The layer clears with the rest of the store on sign out and workspace switch (spec 0006 AC-64).
- `@crm/data/react`: `useViews(objectId)`, `useView(viewId)`, `useViewDraft(viewId)` (the route's search param joined with the saved query, returning `{ query, isDraft, set, discard, baseQueryVersion }`).

## Scale shapes (AC-483)

Seed: #12's `crm` profile. Each row is one view's first page of 100 rows (`records.query`) and its count (`records.count`) sent together, judged at p95 end to end.

| # | Object | Filter | Sorts | Judged |
|---|---|---|---|---|
| 1 | People | Owner is me | Created at, newest first | yes |
| 2 | Deals | Stage is any of (two stages, about 20%) | Created at, newest first | yes |
| 3 | Deals | Name contains a rare word (3+ letters) and Value between two amounts and Stage is one stage | Close date, then Name | yes |
| 4 | People | Company › Industry is Software | Name | yes |
| 5 | Deals | Next step is empty | Stage | yes |
| 6 | Deals | none | Value (currency), the page at row 150,000 | yes |
| 7 | Deals | Probability between 41 and 42 | Name | yes |
| 8 | People | none | Company (a one side, spec 0014 AC-302) | yes once spec 0014 task 16 lands, else recorded |
| 9 | Deals | none | Owner (a member's name) | recorded only (best effort, spec 0004) |

## Tests

- Fake API (Vitest): the redirect choice; the draft param round trip and its drops; Save, `VIEW_CHANGED` and Replace; layout debounce and rollback; locked local layer; the event refetch and the version rule; a view disappearing while open.
- Real API against Postgres: each procedure's rules row by row, limits under concurrent creates, `NAME_TAKEN` on both indexes, the outbox row per write and none for `markOpened`.
- Playwright: AC-489's flows; keyboard only runs of the switcher, menus, Popovers and dialogs; axe and contrast in both themes.
