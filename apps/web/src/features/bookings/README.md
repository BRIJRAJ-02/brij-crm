# Bookings

A sidebar destination after Records, as Timefix's rail has it.

## Bookings (`/w/$slug/bookings`, BookingsScreen)

- **Purpose**: every booking the member may see (their own pages' and the ones they host; everyone's for an admin), as a week calendar beside their own calendar events, or as a list.
- **Main task**: see the week at a glance, open a booking or an event for its details, or page through the list.
- **Leaves out**: changing a booking from here (the actions come next), the new meeting dialog, team views and filing, and live arrival.

## Notes

- Laid out after the reference product's bookings page; the look is ours (tokens, `@crm/ui`).
- The address holds the state:
  - `view` is `week` (the default) or `list`;
  - `w` is the week's Monday and `d` the picked day;
  - `tab` is `past` or `cancelled` (Upcoming has none);
  - `page` and `per` page the list (10, 25, 50 or 100);
  - `sort` is `asc` or `desc`;
  - `link` shows one booking page's bookings;
  - `conn` lists the calendars shown, comma separated.
- **Week**: Calendar | List, the range as the section's heading, then previous week, Today ("Today · 19 Oct" off this week) and next week, and Filter.
  - The library's WeekCalendar draws bookings and the member's own calendar events (spec 0024's synced meetings, one hue per connection) by time.
  - It has a now line, and pressing a block opens its card beside it.
  - Under it: "N bookings this week."
  - At phone width the grid shows the picked day, with the seven days above it.
- **List**: Calendar | List and Filter, then Upcoming, Past and Canceled.
  - Each tab has its own empty state; Upcoming's links to Captures › Links and Availability.
  - "Soonest first" or "Latest first" (Past: "Most recent first" or "Oldest first") flips the order.
  - The library's BookingList draws the rows under day bands; Pagination sits at the foot.
  - A row's title opens its card in a Panel.
- **Filter** shows only what applies:
  - Link: all, or one booking page, when the member has two or more;
  - Calendars: each connection, when two or more; none chosen says so.
- **Calendar events**: calendar sync stores meetings with someone else (titles, times, links), not events the member is alone in, which sync skips (spec 0024, AC-605).
  - Only the member's own connections' events show, never another member's.
  - Events a booking made are left out, so a booking never shows twice.
- **Data**: `data.bookings.view(workspace, tab)` and `data.bookings.calendar(workspace, from, to)` (`useBookings`, `useBookingsCalendar`). Each is read again whenever the window gets focus or the tab is shown again: bookings write no change event yet, and nothing polls.
