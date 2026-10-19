# Bookings

A sidebar destination after Records, as Timefix's rail has it.

## Bookings (`/w/$slug/bookings`, BookingsScreen)

- **Purpose**: every booking the member may see (their own pages' and the ones they host; everyone's for an admin), on three tabs: Upcoming, Past (`?tab=past`) and Canceled (`?tab=cancelled`).
- **Main task**: see what is coming up and open one for its details.
- **Leaves out**: Cancel and the Edit menu (Reschedule, Add guests) until the host's endpoints exist; filters and saved filter chips; live arrival.

## Notes

- Rows come from the library's BookingList, under day bands (Today, Tomorrow, then the date), per `0025-calcom-alignment.md` section 5: the date column (the day bold, the time muted, Join with the meeting's provider), the title, the visitor's note quoted and "You and <guest>", the guest linked to their person when the booking names one.
- Each tab has its own EmptyState; Upcoming's links to Captures › Links and Availability.
- Pressing a title opens the booking in a Panel: status, when, page, guest, email, guests, their zone, where, note, and why it was canceled.
- The lists come from `data.bookings.view(workspace, tab)` (`useBookings`), read again whenever the window gets focus or the tab is shown again: bookings write no change event yet, and nothing polls.
