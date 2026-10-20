# The public booking pages (spec 0025, 0025-experience.md)

`/b/<publicKey>` and its guest page `/b/<publicKey>/manage?t=<token>`, both served `book.html` (the second Vite input) by Vercel's rewrites and by `publicBookingPage()` in `vite.config.ts` locally.

Layout and behaviour follow the timefix booking page (the owner's call on 19 October 2026); the look is the CRM's tokens. Cal.com's study (`0025-calcom-alignment.md`) is used only where timefix has nothing.

## Why it has its own stylesheet

Spec 0023's visitor rules: public pages use plain HTML with the design tokens compiled in (`@crm/tokens/tokens.css`), never the component library or the CRM's field editors, so a visitor downloads a small page and nothing of the app. `booking.module.css` styles that markup with tokens only (motion included), drawing its inputs, buttons and segments the way the library's Field, Button and SegmentedControl look. Lint lets only `src/public/**` carry a stylesheet and `className`, and refuses `@crm/ui` and `@crm/data` there (the pages reach the API only through `@crm/data/booking`). The hosted form is different since 19 October 2026: it draws with the library itself, through `@crm/ui/public-form`.

## The visitor page (`BookingPage.tsx`)

- Wide: one centred unit. The rail (240px) holds the host's initials and name, the title as the page's `h1`, the description, the length, the place and the time zone as compact icon rows, and the Timefix card ("Powered by" and the wordmark) pinned to its foot, with no workspace name (the visitor books the host; the owner's call on 20 October 2026). The booking card sits beside it. On a phone everything stacks and Timefix moves to the page's end.
- Step 1 (`Picker.tsx`): "Choose a time" with Month or List (remembered, `prefs.ts`). The first open day is chosen on arrival. Month: the grid beside its times, which take the month's height and scroll inside it with a fade at the foot; a new month slides in from the side it came from. List: a strip of the days with times, the chosen one scrolled into view, over a grid of times. 12h or 24h is remembered. Picking a time never moves on: the commit bar under the picker turns blue and reads "Book Tue, Oct 20 at 9:30 AM"; before that it reads "Pick a time to book", disabled. The month grid has one tabbable day; arrows move between open days, Up and Down a week, Home and End. A status line says how many times a day has.
- The time zone (`ZoneMenu.tsx`): one line, "Dubai time (GMT+4)" with a chevron, ellipsised with the whole name as its tooltip. Its list searches every zone by every typed word ("asia sing", "+8"), the current zone first, each row with its offset and a tick on the current one; arrows, Enter, Esc, focus back to the row.
- Step 2 (`Details.tsx`): a header band with Change time (back keeps the day and focuses it), the slot and the zone; Your name, Email with "+ Add guest" (rows with a remove and an add after each, up to 10; removing the last folds them away and focuses "+ Add guest"), a number to call for a phone page, the note, Confirm booking. Errors under their field with the first focused; anything else in one reserved line above the button. A taken time goes back to fresh times with "Someone just took that time. Pick another."
- States: a skeleton the size of the month, no times, the host's calendar unreachable, paused, not found, each with Timefix at the foot.
- Prefill (`prefill.ts`): the seam for a form's signed, two hour, single use link, with "Booking as {name}. Not you?"; a stub until milestone 3.

## The guest page (`ManagePage.tsx`)

A centred header (the host's initials with a state badge: a green tick, a red cross once cancelled, a grey clock once passed) and the title by state (You're booked, Your booking, cancelled, passed). One facts card: the time band (a date chip, filled blue while the booking is live; the range, struck through once cancelled or passed; the whole date and zone; a relative line), then What, Who (the host marked, the visitor and their email, "Also invited"), Where (when there is no join link) and the note, then Add to calendar (Google, Outlook, Apple / .ics) or, once cancelled or passed, a link to book again. Timefix sits at the foot.

Move, Add guests and Cancel are left out: the public API has no endpoints for them yet (`apps/api/src/public/booking.ts` serves the page, slots, book, the guest read and its .ics only).
