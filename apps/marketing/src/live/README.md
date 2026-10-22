# The live demo

A working Timefix inside the home page's first fold, built from the app's own components (`@crm/ui`) with a made up workspace. The owner asked for it on 23 October 2026 ("build it with the real components … looks and feels like Twenty").

- `LiveDemo.tsx`: the window, its own `UiProvider` (links switch screens, toasts rise in the window), the Sidebar and the screens, and the demo's state: meetings, people and deals, so what a visitor does carries through.
- `data.ts`: the workspace. The companies are well known, as Twenty's demo shows them; every person, meeting and deal is made up. Its week is the one around `time.ts`'s frozen "now" (Thursday 22 October 2026, 9:40 in New York).
- `BookingsView/`, `BookView/`, `RecordsView/`, `DealsView/`, `ViewHeader/`: the screens, each a thin layer over library components.

The page is rendered on the server and hydrated, so the first screen (Bookings) draws before any script runs; everything in the demo must render the same on the server and in the browser (no reading the clock, the window or storage while rendering).

## LiveDemo

### Why it exists

The owner asked for the hero to be "clickable" like Twenty's, built "with the real components as we have those ready" (23 October 2026). Every screen is the library's own (WeekCalendar, MeetingCard, MonthTiles, SlotList, Table, Board, Sidebar), so the demo looks and behaves exactly like the app, and a visitor can try the product's promise: book a time on the booking page and watch the meeting land in Bookings and the guest in People.

### Use

```tsx
<LiveDemo />
```

It needs a size container around it (the first fold's demo slot): it is as wide as the container and as tall as the space it is given, never taller than a 16:10 screen under its bar.

### States

- **Screens:** the sidebar's current item; the window's address follows (the booking page shows its public address).
- **Narrow:** under 760px the sidebar folds to its rail, as the app's does on a small screen; under 480px the bar's hint goes.
- **Toasts:** a booking and a moved deal each say so in the app's own toast, inside the window.
- **Links in:** the footer's product links (`/#bookings`, `/#pipeline` …) open the screen for that area.
