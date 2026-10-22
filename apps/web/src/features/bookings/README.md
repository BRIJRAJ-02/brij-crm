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
- The library's WeekCalendar, flush with the page (PageColumn `flush`, no card and no gap, the owner's ask of 22 October 2026): blocks by time, a booking's title and time with the guest on a third line, events quieter in their calendar's hue; today's date a small accent circle with the now line in its column; all day events in a row of their own over the hours (by their dates, `allDayKeys`, never moved into the local zone); the hours outside the member's availability shaded (`openHoursOf`: the route's `bookings.hours` read, which it already makes, so no new request; nothing shaded when those hours are kept in another zone). It opens on the hour before now, else at the start of the member's day. Pressing a block or an all day chip opens its card beside it. An empty week says "No meetings this week" quietly in the grid; the count is for screen readers. At phone width, the picked day under the seven day buttons.
- **The member's zone** (Settings › Account › Preferences, read through the workspace frame's FormatScope, `useFormatSettings().timeZone`; the browser's only when they have none): the week's days and its read range, each block's day and hour, the now line and today's date, the drawn span and its times, closed time made from it, New meeting's start (`nextFreeSpan`), the List tab's day bands and times, and Reschedule's slot list all read instants on that clock (`week.ts`: `dayKeyOf`, `minuteOfDay`, `instantAt`, `weekRange`, `piecesOf`, each taking the zone). Rows are the clock's hours, so on a daylight saving day a meeting sits at its clock time. The loaders read the same zone (`memberZone`), so their held week is the one the screen holds. The corner over the hour axis names the zone ("GMT+5:30", read out as "Times in Kolkata time (GMT+5:30)"), since it may not be the device's clock. All day events stay by their dates.
- The address: `w` the week's Monday, `d` the picked day, `link` one booking page, `cal` the calendars the panel shows.

## List (`/w/$slug/bookings/list`, BookingsListScreen)

- **Purpose**: every meeting, Upcoming, Past or Canceled: the bookings the member may see and their own synced calendar events, as the week shows them (the owner's ask of 21 October 2026).
- **Main task**: read what is coming up and open one for its details.
- **Leaves out**: colleagues' calendar events (their time is Busy on the week only, spec 0037), live arrival.
- The strip: Upcoming · Past · Canceled, then the Calendars toggle and Filter, which holds Show (Everything, Bookings only, Calendar events only) and, with two or more links, one link (the owner, 22 October 2026: two segmented controls side by side were too heavy). The calendars panel beside the list picks the calendars whose events show, as on the week, so it stays here; it is the same slim panel without the month.
- Rows (the library's BookingList) under day bands that stick while the list scrolls (Today, Tomorrow, the date): each row its time (the band says the day; All day for an all day event, read by its date), then a booking titled by its page with its status tag (Confirmed, Canceled, Needs a host, No show) and "You and <guest>", the guest a link to their person as in round 6, and its other guests; a calendar event by its title, with its calendar's colour and name and its attendees. A row opens its card in a Panel.
- Pages of 50 by cursor (`bookings.meetings`, `data.bookings.meetings`, `useMeetings`); Show more reads the next. Each tab's empty state is the library's EmptyState centred in the list area (`layout="fill"`) with one line of help; Upcoming adds Share a booking page (to the booking links) and, with no calendar connected, Connect a calendar. Filtered, it says nothing matches, with Clear filters.
- The address: `tab` (`past`, `cancelled`), `src` (`bookings`, `calendar`), `link`, `cal`.
- The TopBar has no count: the list pages every meeting, so there is no total to show.

## A booking's card (both tabs)

- While a booking is ahead, its card ends with **Reschedule** (the page's free times for the next two weeks, days over times, and a commit that names the new time), **Copy guest link** (read only when pressed: it is the guest's key) and **Cancel booking** (asks first, naming the booking, with an optional reason the guest's email carries; the confirm stays busy until the server answers and keeps a refusal), in a row (`BookingActions.tsx`, `hostActions.ts`, spec 0025 AC-640). A change shows at once in every list and range, says so in a toast, and is undone on a refusal. On the week the card is a popover, which React Aria draws above any dialog, so Reschedule and Cancel booking close the card and the week draws the dialog itself (`BookingDialog`); Cancel or Esc opens the card again on the button that asked, and once the change goes through focus goes to its day. A closed time's Remove (Release for a hold, Remove every <weekday> for a weekly block) asks first the same way: "Remove the “Dentist” block?", what reopens, and that it can't be undone.

## Notes

- Laid out after the reference product's bookings page; the look is ours (tokens, `@crm/ui`), the spacing Captures' (`PageColumn`, full width like every page).
- **Calendars panel** (`CalendarsAside.tsx`, the library's AsideLayout and CalendarList): beside the week, as Google Calendar keeps it, a menu's width (`size-menu`, narrower than the sidebar). On the week a small month (the library's MonthCalendar) heads it, for jumping to a date. Then "My calendars": an account with one calendar is that calendar's row alone; two or more fold under the account's mark and address. Each calendar the view shows is a checkbox filled with its colour, picking what this view shows (`cal` in the address, never the calendar's own switches, which stay in Settings › Calendars). Each row's options (Show only this) show on hover or focus. Which calendar takes new bookings is a setting, so neither Default nor Make default is here; Settings › Calendars owns it. Show all follows the list while any is hidden. When the default moved off a stopped or removed calendar, a notice names both, with Dismiss. No calendar connected: one line linking to Settings › Calendars. The bar's Calendars button folds the panel (kept per browser); on a phone the panel is a sheet it opens.
- **Filter** is one link's bookings, with two or more links; filtered it reads "Filter · 1", with a quiet clear beside it.
- **Colours**: each event in its calendar's hue (the member's pick, else the provider's colour's nearest); before the list reads, its account's.
- **Calendar events**: calendar sync stores meetings with someone else (titles, times, links), not events the member is alone in, which sync skips (spec 0024, AC-605). Only the member's own connections' events show. A booking's own event is left out: one marked as the booking's, or synced back with the booking's host, start and end and its video link or visitor.
- **Data**: `data.bookings.view(workspace, tab)` and `data.bookings.calendar(workspace, from, to)` (`useBookings`, `useBookingsCalendar`), each read again whenever the window gets focus or the tab is shown again: bookings write no change event yet, and nothing polls.
