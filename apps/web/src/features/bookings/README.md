# Bookings

A sidebar destination after Records, as Timefix's rail has it.

## Bookings (`/w/$slug/bookings`, the layout, as Captures)

- The frame, the TopBar (`BookingsTopBar`: the scheduling tile, the upcoming count, and New, named New meeting, which opens New meeting at the next free half hour of the week on screen inside the member's hours, `free.ts`; off with the reason until a booking page is on) and the bar **Calendar · List · Availability** (`BookingsTabs`, Tabs' `bar` variant in the row People's ViewBar takes, `tabs.ts`), each tab its own route drawn in the chosen panel. The layout owns New, so it keeps one place and one width on every tab.
- The tab's tools sit at the strip's end (`toolbarSlot.ts`: the screen portals them there), as Captures' search and New do.
- Bare `/bookings` goes to Calendar; an old `?view=list` link goes to List, keeping the rest of its address.
- Availability is `bookings.availability`, unchanged: its own WorkspacePage draws only its body inside the layout's frame (`WorkspacePage` knows when it is nested).

## Calendar (`/w/$slug/bookings/calendar`, BookingsCalendarScreen)

- **Purpose**: the week: bookings beside the member's own calendar events.
- **Main task**: see the week at a glance and open a booking or an event for its details.
- **Leaves out**: team views and filing, and live arrival.
- The strip's end: the range, previous week, Today ("Today · 19 Oct" off this week), next week, Filter.
- The library's WeekCalendar: blocks by time, a booking's title and time with the guest on a third line, events quieter in their calendar's hue; today's column tinted with the now line in it; it opens an hour before now (8 AM outside the working day). Pressing a block opens its card beside it. "N bookings this week." under it. At phone width, the picked day under the seven day buttons.
- The address: `w` the week's Monday, `d` the picked day, `link` one booking page, `cal` the calendars the panel shows.

## List (`/w/$slug/bookings/list`, BookingsListScreen)

- **Purpose**: every meeting, Upcoming, Past or Canceled: the bookings the member may see and their own synced calendar events, as the week shows them (the owner's ask of 21 October 2026).
- **Main task**: read what is coming up and open one for its details.
- **Leaves out**: colleagues' calendar events (their time is Busy on the week only, spec 0037), live arrival.
- The strip: Upcoming · Past · Canceled, then All · Bookings · Calendar, the Calendars toggle and Filter (one link). The calendars panel beside the list picks the calendars, as on the week.
- Rows (the library's BookingList) under day bands (Today, Tomorrow, the date): a booking titled by its page with "You and <guest>", the guest a link to their person as in round 6, and its other guests; a calendar event by its title, with its calendar's colour and name and its attendees as chips (six, then "+N"). A row opens its card in a Panel.
- Pages of 50 by cursor (`bookings.meetings`, `data.bookings.meetings`, `useMeetings`); Show more reads the next. Each tab's empty state is one line; with no calendar connected it says so and links to Settings › Calendars.
- The address: `tab` (`past`, `cancelled`), `src` (`bookings`, `calendar`), `link`, `cal`.
- The TopBar has no count: the list pages every meeting, so there is no total to show.

## A booking's card (both tabs)

- While a booking is ahead, its card ends with **Reschedule** (the page's free times for the next two weeks, days over times, and a commit that names the new time), **Copy guest link** (read only when pressed: it is the guest's key) and **Cancel booking** (asks first, naming the booking, with an optional reason the guest's email carries; the confirm stays busy until the server answers and keeps a refusal), in a row (`BookingActions.tsx`, `hostActions.ts`, spec 0025 AC-640). A change shows at once in every list and range, says so in a toast, and is undone on a refusal. On the week the card is a popover, which React Aria draws above any dialog, so Reschedule and Cancel booking close the card and the week draws the dialog itself (`BookingDialog`); Cancel or Esc opens the card again on the button that asked, and once the change goes through focus goes to its day. A closed time's Remove (Release for a hold, Remove every <weekday> for a weekly block) asks first the same way: "Remove the “Dentist” block?", what reopens, and that it can't be undone.

## Notes

- Laid out after the reference product's bookings page; the look is ours (tokens, `@crm/ui`), the spacing Captures' (`PageColumn`, full width like every page).
- **Calendars panel** (`CalendarsAside.tsx`, the library's AsideLayout and CalendarList): beside the week, as Google Calendar keeps it. Each account folds under its mark and address; each calendar the week shows is a checkbox in its colour, picking what this view shows (`cal` in the address, never the calendar's own switches, which stay in Settings › Calendars). Each row's options: Show only this, and Make default on a calendar that can take bookings (`calendar.destination.set`, at once, put back with a toast). Default marks where new bookings go. Show all heads the list while any is hidden. When the default moved off a stopped or removed calendar, a notice names both, with Dismiss. No calendar connected: one line linking to Settings › Calendars. The bar's Calendars button folds the panel (kept per browser); on a phone the panel is a sheet it opens.
- **Filter** is one link's bookings, with two or more links; filtered it reads "Filter · 1", with a quiet clear beside it.
- **Colours**: each event in its calendar's hue (the member's pick, else the provider's colour's nearest); before the list reads, its account's.
- **Calendar events**: calendar sync stores meetings with someone else (titles, times, links), not events the member is alone in, which sync skips (spec 0024, AC-605). Only the member's own connections' events show. A booking's own event is left out: one marked as the booking's, or synced back with the booking's host, start and end and its video link or visitor.
- **Data**: `data.bookings.view(workspace, tab)` and `data.bookings.calendar(workspace, from, to)` (`useBookings`, `useBookingsCalendar`), each read again whenever the window gets focus or the tab is shown again: bookings write no change event yet, and nothing polls.
