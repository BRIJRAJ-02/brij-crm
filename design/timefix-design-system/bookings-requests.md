# Bookings: owner requests and where each stands (10 Nov 2026)

Every request from the design session, checked in the prototype (light and dark) before this commit.

| Request | Done |
| --- | --- |
| Popovers never stack over a dialog (inbox, week event, reschedule) | yes |
| Reschedule: AM/PM times, "1 guest", day then time | yes |
| "UI looks bad": no hierarchy, too much on one page | Next up card, tiled rows, one toolbar row, status only when it matters |
| Rethink the whole thing; no tab system | sidebar pages: Meetings, Booking pages, Availability, Roster (team), Routing |
| New booking popup simple, no preview | one column: name, length, where, when |
| Drag on the calendar opens a small menu (Week and Team day) | yes |
| Roster as its own page, then a relook | 7-day shift grid, edit a day in place, per-person drawer |
| Calendars and Availability as one page | yes |
| Times wrap; meetings need a background | start over end; each meeting on a tile |
| Proper spacing, containers, colours, stronger borders | card sections everywhere, solid edges |
| Routing proper UI; rail lines overlapping | flow with numbered rail, outcome band, Try panel |
| Several links per social network | yes |
| Dark guest look unusable; Geist / Geist Mono only; professional looks | yes (Calm, Ink, Slate, Night) |
| Editor sections as tabs; then rows instead of stacked fields | yes |
| Guest page centred; length choice inside the card; Add guests | yes |
| Embed dialog cleaner | code under its own Copy header |
| Timefix icon in the tab | yes |
| Segmented control sliver on the left | fixed at the measuring hook |
| After booking and Questions less crowded | settings rows; six booking question types |
| Features on main missing from the prototype | roster overrides, copy week, usual hours, totals, search, zones, access; limits; time-off reason and cover; routing outcomes, tags, hidden fields, results; round robin modes, caps, count window; managed copies; page editors; emails; best times; team faces; booking as; add to calendar; profile page; list view; needs-a-host strip |
| Guest page: Month, List and Chat like live, all in the same box | yes; List uses the day strip; pages choose which opens first |
| Connect calendar: better overlap design | a Compare card (Google, Outlook); busy times hatched; Best marked; a live status line |
| Success, error, booking, rescheduling all covered | green success moment; "Someone just booked that time" with Pick another time; manage, moved, cancelled, request sent |
| Adding a guest | email chips with checks (format, not you, not twice, ten at most) |
| Public side relook, less cramped, taller | details panel, headed main side, 52px days, 48px times, roomier small cards |
| Powered by Timefix on every guest screen | yes |
| Chat asks for name and email before booking | yes, with an email check |
| List times in a grid; form full width; chat full height | yes |
| Compare calendar at the top right, no providers, no "nothing is shared" | yes |
| Plus to add a guest; add guests, reschedule and cancel after booking | yes, all in the same card |
| Smoother booking page | views and days settle in, times arrive one after another, presses ease |
| Invite to create your own page beside Powered by | on every guest screen |
| Timefix mark on bookings in the dashboard calendar | Week and Team day |
| Bookings analytics | Insights page: five numbers, trend, funnel, sources, each page or host, when people book, how meetings ended |
| Phone layout for the guest pages | compact header, one row of controls, a month that fits, two times a row |
| Phone layout for the dashboard | tab bar of the Bookings pages instead of the sidebar, icon-only top bar buttons, two-row toolbars, meeting rows with actions underneath, Week scrolls sideways, routing and insights fold to fit |
| Smoother add guest | opens in place, paste several at once, Backspace removes the last, a wrong address shakes, chips fold away; the same chips after booking, with Done on its own line |
| Powered by Timefix, better message and look | a card at the foot of the details panel: mark, "Powered by Timefix", "Get a free booking page"; a pill on the other guest screens |
| Chat full height, UI fixes | the chat fills the card and its composer sits at the bottom; smaller suggestion chips; the booked card matches the success screen |
| Card height | back to a fixed height (the full-window height was too tall) |
| Blank "When" after keeping the old time | fixed: the booked time is kept while you look for a new one |
| Chat booking goes to the success screen | yes, the same screen as a calendar booking |
| Check every feature against main (10 Nov audit) | built: draft, publish and versions; link-only pages and booking inside held time; "can't be booked" warnings; start-time interval; guest cancel and move cut-offs with a message; round robin host on reschedule; QR code, email, WhatsApp and system share; workspace and team links; calendar-stopped-syncing banner, teammate calendar health and Ask to reconnect; email to a teammate when someone else changes their hours; live toast when a guest books; Insights export, view-only share link and Insights per page; filing answers to People, Companies or Deals; routing on CRM record fields |
| Left for their own products | business booking (services, staff, business page, reservations) and the onboarding steps |

Not built: shifts with roles or places, labour cost and painting cells by drag (main doesn't have them either).
