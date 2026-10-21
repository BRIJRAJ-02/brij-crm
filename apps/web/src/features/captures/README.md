# Booking pages and Forms (the Captures chrome)

Captures was a sidebar destination with two tabs, Links and Forms. Spec 0034 (AC-928) made each a page of its own under the sidebar's Scheduling section, beside Bookings and Availability: Booking pages (`/w/$slug/booking-pages`) and Forms (`/w/$slug/forms`). This folder holds what the two pages share. Every old `/captures` address redirects (AC-929, `workspace/moved.ts`).

## Booking pages and Forms (`/w/$slug/booking-pages`, `/w/$slug/forms`, each a layout route with `CapturesLayout`)

- **Purpose**: the ways people reach the workspace from outside: booking pages and forms, one page each.
- **Main task**: see how many there are, find one with the search, open it, or make a new one with New.
- **Leaves out**: what each list shows (`booking/LinksScreen.tsx`, `forms/FormsScreen.tsx`) and the editors (routes of their own, outside the layout).

## Notes

- Routes: `routes/w.$slug.booking-pages.tsx` and `routes/w.$slug.forms.tsx` are the layouts. Each draws `CapturesLayout` around an `Outlet`: the frame, `CapturesTopBar` (the scheduling tile, the page's title, its count and New, as People's TopBar has) and the bar People's views take (the library's `ViewBar` with no view switcher), whose end holds the page's search. `CapturesCreateProvider` (`create.tsx`) owns New and the New booking page dialog for the whole page, so New keeps one place and one width while the list loads under it; it reads New, named New booking page or New form. `routes/w.$slug.booking-pages.index.tsx` and `routes/w.$slug.forms.index.tsx` load the lists; the editors are `w.$slug.booking-pages_.$pageId` and `w.$slug.forms_.$formId` (and its `preview`), outside the layouts.
- `pages.ts` holds the two pages' keys and addresses (`linksHref`, `formsHref`, `capturePageHref`); link to them through it.
- Both lists draw `CapturesList`: LinkGrid's cards across the whole view, the search portalled into the bar's end (`toolbarSlot.ts`), or with none the empty state centred in a `PageColumn`, with New.
- `EditorPending` is an editor's loading state in the editor's own shape; it names the sidebar item its list page marks.
- The owner asked for these pages in People's chrome "to reduce page shifts" (21 October 2026): the TopBar and the bar under it stand where People's do, so nothing moves from page to page (`e2e/switching.flow.ts` checks it).
