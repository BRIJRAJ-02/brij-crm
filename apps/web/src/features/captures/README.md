# Captures

A sidebar destination after Bookings, as Timefix's rail has it: the booking links and the lead capture forms, one tab each.

## Captures (`/w/$slug/captures`, the layout route, with CapturesTabs)

- **Purpose**: the ways people reach the workspace from outside: booking links and forms.
- **Main task**: switch between Links and Forms, each with its own address.
- **Leaves out**: each tab's content, which its child route renders into the chosen panel.

## Notes

- Routes: `routes/w.$slug.captures.tsx` (the layout: the frame, `CapturesTopBar` (the scheduling tile, the chosen tab's count and New, as People's TopBar has), and `CapturesTabs` (the tabs as the page's second bar, Tabs' `bar` variant, in the row People's ViewBar takes) around an `Outlet`, all inside `CapturesCreateProvider` (`create.tsx`), which owns New and the New booking page dialog, so New keeps one place and one width on both tabs; it reads New, named New booking page or New form), `routes/w.$slug.captures.index.tsx` (bare `/captures` redirects to `/links`), `routes/w.$slug.captures.links.index.tsx` and `routes/w.$slug.captures.forms.index.tsx` (the tabs; each one's editor is a sibling route outside the layout, `w.$slug.captures_.…`).
- `tabs.ts` holds the tab ids and their addresses (`linksHref`, `formsHref`, `captureTabOf`); link to a tab through it.
- Each tab's route renders its screen (`booking/LinksScreen.tsx`, `forms/FormsScreen.tsx`), and both draw `CapturesList`: LinkList's compact rows (`density="compact"`) edge to edge under the strip, the records area's one line rows with the page gutter inside them, and the search and New in the strip's end (`toolbarSlot.ts`). With no rows, the empty state sits centred in a `PageColumn`.
