# Bookings

The first page under the sidebar's Scheduling section (spec 0034), before Availability, Booking pages and Forms.

## Bookings (`/w/$slug/bookings`, the layout, in People's chrome as Booking pages and Forms are)

- The frame, the TopBar (`BookingsTopBar`: the scheduling tile, the upcoming count, and New, named New meeting, which opens New meeting at the next free half hour of the week on screen inside the member's hours, `free.ts`; off with the reason until a booking page is on) and the bar **Calendar · List** (`BookingsTabs`, Tabs' `bar` variant in the row People's ViewBar takes, `tabs.ts`), each tab its own route drawn in the chosen panel. The layout owns New, so it keeps one place and one width on every tab.
- The tab's tools sit at the strip's end (`toolbarSlot.ts`: the screen portals them there), as Booking pages' and Forms' search does.
- Bare `/bookings` goes to Calendar; an old `?view=list` link goes to List, keeping the rest of its address. The sidebar links to `/bookings/calendar` itself, so a pointer resting on it preloads that page.
- Availability was a third tab; it is a page of its own at `/w/$slug/availability` since spec 0034, and `/bookings/availability` redirects there (AC-929).

## Calendar (`/w/$slug/bookings/calendar`, BookingsCalendarScreen)

- **Purpose**: the week: bookings beside the member's own calendar events.
- **Main task**: see the week at a glance and open a booking or an event for its details.
- **Leaves out**: team views and filing, and live arrival.
- The strip's end: the range, previous week, Today ("Today · 19 Oct" off this week), next week, Filter.
- The library's WeekCalendar: blocks by time, a booking's title and time with the guest on a third line, events quieter in their calendar's hue; today's column tinted with the now line in it; it opens an hour before now (8 AM outside the working day). Pressing a block opens its card beside it. "N bookings this week." under it. At phone width, the picked day under the seven day buttons.
- The address: `w` the week's Monday, `d` the picked day, `link` one booking page, `conn` the calendars shown.

## List (`/w/$slug/bookings/list`, BookingsListScreen)

- **Purpose**: every booking the member may see, Upcoming, Past or Canceled, paged.
- **Main task**: page through them and open one for its details.
- **Leaves out**: filters beyond the link, live arrival.
- The strip's end: Upcoming · Past · Canceled (a SegmentedControl), the sort, Filter.
- Each tab has its own empty state; Upcoming's links to Captures › Links and Availability. The library's BookingList draws the rows under day bands; Pagination (10, 25, 50 or 100) at the foot; a row's title opens its card in a Panel.
- The address: `tab` (`past`, `cancelled`), `page`, `per`, `sort`, `link`.

## A booking's card (both tabs)

- While a booking is ahead, its card ends with **Reschedule** (the page's free times for the next two weeks, days over times, and a commit that names the new time), **Copy guest link** (read only when pressed: it is the guest's key) and **Cancel booking** (asks first, naming the booking, with an optional reason the guest's email carries; the confirm stays busy until the server answers and keeps a refusal), in a row (`BookingActions.tsx`, `hostActions.ts`, spec 0025 AC-640). A change shows at once in every list and range, says so in a toast, and is undone on a refusal. On the week the card is a popover, which React Aria draws above any dialog, so Reschedule and Cancel booking close the card and the week draws the dialog itself (`BookingDialog`); Cancel or Esc opens the card again on the button that asked, and once the change goes through focus goes to its day. A closed time's Remove (Release for a hold, Remove every <weekday> for a weekly block) asks first the same way: "Remove the “Dentist” block?", what reopens, and that it can't be undone.

## Notes

- Laid out after the reference product's bookings page; the look is ours (tokens, `@crm/ui`), the spacing Captures' (`PageColumn`, full width like every page).
- **Filter** shows only what applies: Link (all, or one booking page) with two or more; Calendars (each connection) with two or more, and says so when none is chosen.
- **Calendar events**: calendar sync stores meetings with someone else (titles, times, links), not events the member is alone in, which sync skips (spec 0024, AC-605). Only the member's own connections' events show. A booking's own event is left out: one marked as the booking's, or synced back with the booking's host, start and end and its video link or visitor.
- **Data**: `data.bookings.view(workspace, tab)` and `data.bookings.calendar(workspace, from, to)` (`useBookings`, `useBookingsCalendar`), each read again whenever the window gets focus or the tab is shown again: bookings write no change event yet, and nothing polls.
