# WorkspacePreview

A sketch of the app as it will look, drawn live from what a first run step has typed: the sidebar with the workspace's initials tile and name at its head, a few quiet rows, the person's avatar and name at its foot, and a table beside it, cut off by its frame. The part the step is about is ringed.

## Why it exists

New (spec 0036). First run shows the workspace taking shape as the person types (as Attio's onboarding does), in the right half of AuthLayout's split card (its `preview`). Rule 5, in order:

1. **Reuse**: nothing in the library draws a miniature of the app. The real `Sidebar` is a navigation landmark full of links, a workspace menu, sections that load their own items, and the app's full size; put in a preview, it would announce a second navigation, take Tab stops, and need data the first run doesn't have.
2. **A variant**: a "sketch" mode on `Sidebar` (no landmark, no links, rows as bars) would add a preview only branch to the most used module in the app, for one screen, and the table beside it would still need drawing.
3. **New**: so it is a small decorative module drawn from existing atoms: `Avatar` (the workspace's square tile, the person's circle), `Icon` (the rows' glyphs and the objects' hue tiles) and `Skeleton` (its `isStill` variant, so the bars never pulse and read as loading). It adds only the window and its layout.

## Use

```tsx
<AuthLayout preview={<WorkspacePreview workspaceName={name} workspaceId={id} personName={you} personId={user.id} focus="workspace" />} …>
```

- `workspaceName` and `personName` are what the person has typed; while one is empty, a bar stands in for it (and a tile or a circle for its avatar).
- `workspaceId` and `personId` seed the avatars' hues, so a colour holds while the name changes, and the person keeps the hue they have everywhere else.
- `sample` fills the sketch with a believable workspace (Halcyon Labs, Maya Chen, a People table of names and companies) wherever nothing is typed: sign in, verify, two factor, join and invite (where the workspace's own name still shows). First run leaves it off, so the sketch is what the person types. The sidebar rows always carry the app's own labels (Home, Inbox, Tasks, Calendar, Records: People, Companies, Deals).
- `focus` rings the part the step is about: `person` (Your name), `areas` (About you), `workspace` (Your workspace) or `calendar` (Connect your calendar).
- `areas` adds a sidebar row for each part of the product picked on About you (first run no longer asks since 22 October 2026, so the app passes none; kept for a later step that knows the areas) (`booking` a calendar clock, `forms` a clipboard), under the calendar row, so the sketch shows the app shaped by the answers; the sketch with none picked is the calm one first run and sign in start with. The ring eases from one part to the next in `duration-move`; under reduced motion it moves at once.
- It is decoration: hidden from assistive technology, since every word in it is something the person just typed and the form beside it already holds. It takes no focus.
- It fills its slot, with a window anchored twice `space-32` in from the top and the start that bleeds `space-32` past the end and the foot at any width (at least twice `size-panel` wide), so both edges cut it on purpose; only its visible top start corner is round, with `shadow-lg`. Its sidebar is the app's `size-sidebar`. Give it a slot at least as tall as `size-panel` plus three `space-32` (it asks for that much itself).

## States

Sample, empty (bars for both names), the person named, the workspace named, both named, a long name (cut with an ellipsis), with areas picked, and each `focus`: person, areas, workspace, calendar, or none. Light and dark. Loading, error, read only and disabled don't apply: it has no data of its own and takes no input.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
