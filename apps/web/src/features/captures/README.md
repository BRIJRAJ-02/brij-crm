# Captures

A sidebar destination after Bookings, as Timefix's rail has it: the booking links and the lead capture forms, one tab each.

## Captures (`/w/$slug/captures`, the layout route, with CapturesTabs)

- **Purpose**: the ways people reach the workspace from outside: booking links and forms.
- **Main task**: switch between Links and Forms, each with its own address.
- **Leaves out**: each tab's content, which its child route renders into the chosen panel.

## Notes

- Routes: `routes/w.$slug.captures.tsx` (the layout: the frame, the TopBar and `CapturesTabs` around an `Outlet`), `routes/w.$slug.captures.index.tsx` (bare `/captures` redirects to `/links`), `routes/w.$slug.captures.links.tsx` and `routes/w.$slug.captures.forms.tsx` (the tabs).
- `tabs.ts` holds the tab ids and their addresses (`linksHref`, `formsHref`, `captureTabOf`); link to a tab through it.
- Each tab shows `CapturePlaceholder` until the booking and forms lanes move their screens into the tab's route file.
