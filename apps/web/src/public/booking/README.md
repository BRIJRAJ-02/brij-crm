# The public booking pages (spec 0025, 0025-experience.md)

`/b/<publicKey>` and its guest page `/b/<publicKey>/manage?t=<token>`, both served `book.html` (the second Vite input) by Vercel's rewrites and by `publicBookingPage()` in `vite.config.ts` locally.

## Why it has its own stylesheet

Spec 0023's visitor rules: public pages use plain HTML with the design tokens compiled in (`@crm/tokens/tokens.css`), never the component library or the CRM's field editors, so a visitor downloads a small page and nothing of the app. `booking.module.css` styles that markup with tokens only (motion included); lint lets only `src/public/**` carry a stylesheet and `className`, and refuses `@crm/ui` and `@crm/data` there (the pages reach the API only through `@crm/data/booking`).

## The visitor page (`BookingPage.tsx`)

- A sticky rail (host, What with the location's icon, the time zone row) beside the headline and the card; stacked on a phone, with the foot at the page's end.
- Step 1 (`Picker.tsx`): Month or List (remembered, `prefs.ts`), the first open day chosen on arrival, times beside the month (a scrolling column with a fade) or under the day chips, 12h or 24h (remembered), and the commit bar that names the picked time. The month grid has one tabbable day; arrows move between open days, Up and Down a week, Home and End. A status line says how many times a day has.
- The time zone (`ZoneMenu.tsx`): "Dubai time (GMT+4)", a searchable list; arrows, Enter, Esc, focus back to the row.
- Step 2 (`Details.tsx`): the slot with Change time (back keeps the day and focuses it), Your name, Email with + Add guest (up to 10), a number to call for a phone page, the note, Confirm booking. Errors under their field with the first focused; anything else in one reserved line above the button. A taken time goes back to fresh times with "Someone just took that time. Pick another."
- States: a skeleton the size of the month, no times, the host's calendar unreachable, paused, not found.
- Prefill (`prefill.ts`): the seam for a form's signed, two hour, single use link, with "Booking as {name}. Not you?"; a stub until milestone 3.

## The guest page (`ManagePage.tsx`)

The title by state (You're booked, Your booking, cancelled, passed) with its mark, the time card (date block, range, the whole date and zone, a relative line), What, Who (the host marked, the visitor, guests), Where and the note, and Add to calendar (Google, Outlook, Apple / .ics). Move, Add guests and Cancel arrive with milestone 2's endpoints.
