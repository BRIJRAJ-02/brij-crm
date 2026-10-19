# Bookings

A sidebar destination after Records, as Timefix's rail has it.

## Bookings (`/w/$slug/bookings`, the layout, as Captures)

- The frame, the TopBar and the underline strip **Calendar · List · Availability** (`BookingsTabs`, `tabs.ts`), each tab its own route drawn in the chosen panel.
- The tab's tools sit at the strip's end (`toolbarSlot.ts`: the screen portals them there), as Captures' search and New do.
- Bare `/bookings` goes to Calendar; an old `?view=list` link goes to List, keeping the rest of its address.
- Availability is `bookings.availability`, unchanged: its own WorkspacePage draws only its body inside the layout's frame (`WorkspacePage` knows when it is nested).

## Calendar (`/w/$slug/bookings/calendar`, BookingsCalendarScreen)

- **Purpose**: the week: bookings beside the member's own calendar events.
- **Main task**: see the week at a glance and open a booking or an event for its details.
- **Leaves out**: changing a booking from here (the actions come next), the new meeting dialog, team views and filing, and live arrival.
- The strip's end: the range, previous week, Today ("Today · 19 Oct" off this week), next week, Filter.
- The library's WeekCalendar: blocks by time, a booking's title and time with the guest on a third line, events quieter in their calendar's hue; today's column tinted with the now line in it; it opens an hour before now (8 AM outside the working day). Pressing a block opens its card beside it. "N bookings this week." under it. At phone width, the picked day under the seven day buttons.
- The address: `w` the week's Monday, `d` the picked day, `link` one booking page, `conn` the calendars shown.

## List (`/w/$slug/bookings/list`, BookingsListScreen)

- **Purpose**: every booking the member may see, Upcoming, Past or Canceled, paged.
- **Main task**: page through them and open one for its details.
- **Leaves out**: changing a booking (the actions come next), filters beyond the link, live arrival.
- The strip's end: Upcoming · Past · Canceled (a SegmentedControl), the sort, Filter.
- Each tab has its own empty state; Upcoming's links to Captures › Links and Availability. The library's BookingList draws the rows under day bands; Pagination (10, 25, 50 or 100) at the foot; a row's title opens its card in a Panel.
- The address: `tab` (`past`, `cancelled`), `page`, `per`, `sort`, `link`.

## Notes

- Laid out after the reference product's bookings page; the look is ours (tokens, `@crm/ui`), the spacing Captures' (`PageColumn width="full"`).
- **Filter** shows only what applies: Link (all, or one booking page) with two or more; Calendars (each connection) with two or more, and says so when none is chosen.
- **Calendar events**: calendar sync stores meetings with someone else (titles, times, links), not events the member is alone in, which sync skips (spec 0024, AC-605). Only the member's own connections' events show. A booking's own event is left out: one marked as the booking's, or synced back with the booking's host, start and end and its video link or visitor.
- **Data**: `data.bookings.view(workspace, tab)` and `data.bookings.calendar(workspace, from, to)` (`useBookings`, `useBookingsCalendar`), each read again whenever the window gets focus or the tab is shown again: bookings write no change event yet, and nothing polls.
