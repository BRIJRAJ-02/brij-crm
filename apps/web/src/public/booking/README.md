# The public booking pages (spec 0025, 0025-experience.md)

`/b/<publicKey>` and its guest page `/b/<publicKey>/manage?t=<token>`, both served `book.html` (the second Vite input) by Vercel's rewrites and by `publicBookingPage()` in `vite.config.ts` locally.

Layout and behaviour follow the timefix booking page (the owner's calls on 19 and 20 October 2026); the look is the CRM's design system. Cal.com's study (`0025-calcom-alignment.md`) is used only where timefix has nothing.

## Drawn with the library

Since 20 October 2026 the pages draw with the component library through `@crm/ui/public-booking`, as the hosted form does through `@crm/ui/public-form` ("one input system everywhere"): BookingFrame, MonthTiles, DayStrip, SlotList, BookingDetails, BookingReceipt and BookingMessage, inside `BookingProvider`. These files hold the pages' state, reads and formatting only, with no stylesheet of their own. They reach the API only through `@crm/data/booking`; lint refuses `@crm/ui` and `@crm/data` themselves here.

## The visitor page (`BookingPage.tsx`)

- Wide: the host's rail (picture, name, the meeting as the page's `h1`, "30 min · Video call" (a length switch when the page offers several), and the time zone as a line of text that opens a search over every zone), with "Powered by Timefix" and "Claim your free page" pinned at its foot. Beside it one card: "Choose a time" with Month or List (remembered, `prefs.ts`), the month beside the chosen day's times (which scroll inside their pane), and the Book bar across the foot. On a phone everything stacks, the times run two to four across, and Timefix moves to the page's end.
- The first open day is chosen on arrival. Picking a time never moves on: the Book bar names it ("Book Tue, Oct 20 at 9:30 AM"); before that it reads "Book", disabled. 12h or 24h is remembered.
- The details step keeps the rail, now with the picked time, and the card holds Your name, Email, Add guests (up to 10), a number to call for a phone page, the note, then Back and Confirm booking. A taken time goes back to fresh times with "Someone just took that time. Pick another."
- States: skeletons while the page loads, no times, the host's calendar unreachable, a failed read with Try again, paused, not found.
- Prefill (`prefill.ts`): the seam for a form's signed, two hour, single use link, with "Booking as {name}. Not you?"; a stub until milestone 3. The visitor's own sign in and calendar (spec 0028) arrive next.

## The guest page (`ManagePage.tsx`)

BookingReceipt: the host with the state's mark, the title by state (You're booked, Your booking, cancelled, passed), then one card: the date chip, the range, the whole date and zone and how soon; What, Who and Where; Join the call and Add to calendar (Google, Outlook, Apple / .ics) while it's ahead, or a link to book again. Timefix sits at the foot.

Move, Add guests and Cancel are left out: the public API has no endpoints for them yet (`apps/api/src/public/booking.ts` serves the page, slots, book, the guest read and its .ics only).
