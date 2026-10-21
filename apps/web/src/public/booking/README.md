# The public booking pages (spec 0025, 0025-experience.md)

`/b/<publicKey>` and its guest page `/b/<publicKey>/manage?t=<token>`, both served `book.html` (the second Vite input) by Vercel's rewrites and by `publicBookingPage()` in `vite.config.ts` locally.

Layout and behaviour follow the timefix booking page (the owner's calls on 19 and 20 October 2026); the look is the CRM's design system. Cal.com's study (`0025-calcom-alignment.md`) is used only where timefix has nothing.

## Drawn with the library

Since 20 October 2026 the pages draw with the component library through `@crm/ui/public-booking`, as the hosted form does through `@crm/ui/public-form` ("one input system everywhere"): BookingFrame, MonthTiles, DayStrip, SlotList, BookingDetails, BookingReceipt and BookingMessage, inside `BookingProvider`. These files hold the pages' state, reads and formatting only, with no stylesheet of their own. They reach the API only through `@crm/data/booking`; lint refuses `@crm/ui` and `@crm/data` themselves here.

## The visitor page (`BookingPage.tsx`)

- Wide: the host's rail (picture, name, the meeting as the page's `h1`, "30 min · Video call" (a length switch when the page offers several), and the time zone as a line of text that opens a search over every zone), with "Powered by Timefix" and "Claim your free page" pinned at its foot. Beside it one card: "Choose a time" with Month or List (remembered, `prefs.ts`), the month beside the chosen day's times (which scroll inside their pane), and the Book bar across the foot. On a phone everything stacks, the times run two to four across, and Timefix moves to the page's end.
- A team page (spec 0037, AC-1339) heads the rail with up to 4 of its hosts' faces (initials only, a picture when our origin serves one) and "+N", named "Team of 6" for screen readers, in place of the picture, over the line "Intro call with Acme" (the page's `h1`); the workspace's name stands where the host's would in the tab title ("Intro call with Acme") and in the unreachable and no times notes. No host's name shows before the confirmation. A personal page draws exactly as before (`host.ts`, `host.test.ts`).
- The first open day is chosen on arrival. Picking a time never moves on: the Book bar names it ("Book Tue, Oct 20 at 9:30 AM"); before that it reads "Book", disabled. 12h or 24h is remembered.
- The details step keeps the rail, now with the picked time, and the card holds Your name, Email, Add guests (up to 10), a number to call for a phone page, the note, then Back and Confirm booking. A taken time goes back to fresh times with "Someone just took that time. Pick another."
- States: skeletons while the page loads, no times, the host's calendar unreachable, a failed read with Try again, paused, not found.
- Prefill (`prefill.ts`): the seam for a form's signed, two hour, single use link, with "Booking as {name}. Not you?"; a stub until milestone 3.
- The visitor's own calendar (spec 0028), in VisitorBar on top: someone signed in to Timefix in this browser is known (their name and email fill the form, their connected calendar is laid over the times); anyone else sees "See when you're both free" and Connect calendar, which goes to Google for this visit only and back to the same length, day and zone (`visitor.ts` writes and reads the return address, then tidies it). Times that clash are hidden unless Show all times is on, up to three carry Best (and mark their day), every time clashing says so with Show all times, and a calendar that can't be read shows every time. Not you forgets them for the visit (a guest's calendar at the server too). The host on their own page and the editor's preview get no bar.

## The guest page (`ManagePage.tsx`)

BookingReceipt: the host with the state's mark, the title by state (You're booked, Your booking, cancelled, passed), then one card: the date chip, the range, the whole date and zone and how soon; What, Who and Where; Join the call and Add to calendar (Google, Outlook, Apple / .ics) while it's ahead, or a link to book again. Timefix sits at the foot.

While it's ahead, the card ends with BookingChanges (milestone 2): **Move to another time** (the page's free times for three weeks in the zone they booked in, through the booking page's own DayStrip and SlotList, unchanged, and a commit that names the new time), **Guests** (the list with Remove, one email field whose Add or Enter invites, the count) and **Cancel booking** (asks first, with an optional reason). Each answer redraws the receipt (Moved. or Cancelled. over it, read out, the heading focused). The guest page loads in its own chunk (`main.tsx`), so the booking page's first load carries none of it. The token is the only key; the API limits changes per address and per booking.
