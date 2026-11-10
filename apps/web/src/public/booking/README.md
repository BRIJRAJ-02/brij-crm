# The public booking pages (spec 0025, 0025-experience.md)

`/b/<publicKey>` and its guest page `/b/<publicKey>/manage?t=<token>`, both served `book.html` (the second Vite input) by Vercel's rewrites and by `publicBookingPage()` in `vite.config.ts` locally.

Layout and behaviour follow the timefix booking page (the owner's calls on 19 and 20 October 2026); the look is the CRM's design system. Cal.com's study (`0025-calcom-alignment.md`) is used only where timefix has nothing.

## Drawn with the library

Since 20 October 2026 the pages draw with the component library through `@crm/ui/public-booking`, as the hosted form does through `@crm/ui/public-form` ("one input system everywhere"): BookingFrame, MonthTiles, DayStrip, SlotList, BookingDetails, BookingReceipt and BookingMessage, inside `BookingProvider`. These files hold the pages' state, reads and formatting only, with no stylesheet of their own. They reach the API only through `@crm/data/booking`; lint refuses `@crm/ui` and `@crm/data` themselves here.

## The visitor page (`BookingPage.tsx`)

- Wide: the host's rail (picture, name, the meeting as the page's `h1`, "30 min · Video call" (a length switch when the page offers several), and the time zone as a line of text that opens a search over every zone), with "Powered by Timefix" and "Claim your free page" pinned at its foot. Beside it one card: "Choose a time" with one compact group in its corner, as Cal.com's (spec 0058, AC-24): 12h or 24h, then Month, List or Book by chat (the host sets which one the page opens in; a view chosen on this page before wins over that, remembered per page in `prefs.ts`), the month beside the chosen day's times (which scroll inside their pane), and the Book bar across the foot. On a phone everything stacks, the times run two to four across, and Timefix moves to the page's end.
- A team page (spec 0037, AC-1339) heads the rail with up to 4 of its hosts' faces (initials only, a picture when our origin serves one) and "+N", named "Team of 6" for screen readers, in place of the picture, over the page's own title (its `h1`, and the tab title; the owner, 6 November 2026: "Team Link with Brij's workspace" read wrong); sentences say "the team" (`hostInWords`) and a page with nobody on it says so (`hasNoHosts`) rather than "no open times". No host's name shows before the confirmation. A personal page draws exactly as before (`host.ts`, `host.test.ts`).
- The first open day is chosen on arrival. Picking a time never moves on: the Book bar names it ("Book Tue, Oct 20 at 9:30 AM"); before that it reads "Book", disabled. 12h or 24h is remembered.
- The details step keeps the rail, now with the picked time, and the card holds Your name, Email, Add guests (up to 10), a number to call for a phone page, the note, then Back and Confirm booking. A taken time goes back to fresh times with "Someone just took that time. Pick another." A refusal on a field the step doesn't show says the server's sentence above the buttons, unless it is about the start or in the safety net's words, which name no field (`refusal.ts`); then the step says "That did not go through. Try again in a moment."
- States: skeletons while the page loads, no times, the host's calendar unreachable, a failed read with Try again, paused, not found.
- Timefix links: "Powered by Timefix" and "Claim your free page" go to www.timefix.com tagged `utm_source=timefix`, `utm_campaign=powered_by`, `utm_medium=booking_page` (at both addresses, framed or not) and `utm_content` `footer_logo` or `claim_link`, built by `@crm/contracts/brand` as every email's link is (`claimPageHref` here, the foot tags its own wordmark). The profile's are tagged `booking_profile`, the guest page's `booking_confirmation` or `booking_manage`.
- Prefill (`prefill.ts`): a form's signed hand off (`#p=<token>` in the fragment since 5 Nov 2026, `?p=` still read for older links; spec 0023 AC-1058, 24 hours). The page's reads send it in the `x-crm-handoff` header, never their own address. The page asks `GET /api/public/booking/:publicKey/prefill` for the name and email (never reading them from the address), shows "Booking as {name}. Not you?", and sends the token with the booking, which then stores the form's submission. No visual change.
- The visitor's own calendar (spec 0028), in VisitorBar on top: someone signed in to Timefix in this browser is known (their name and email fill the form, their connected calendar is laid over the times); anyone else sees a small secondary "Connect your calendar" link (spec 0058, AC-24) that opens Match with your calendar, which says what it reads and goes to Google for this visit only and back to the same length, day and zone (`visitor.ts` writes and reads the return address, then tidies it). Times that clash are hidden unless Show all times is on, up to three carry Best (and mark their day), every time clashing says so with Show all times, and a calendar that can't be read shows every time. Not you forgets them for the visit (a guest's calendar at the server too). The host on their own page and the editor's preview get no bar.

## Book by chat (`ChatPanel.tsx`)

The chat speaks as the host and does what the details step does (chat parity, 4 Nov 2026):
- The greeting shows the page's lengths as chips (two or more) and the zone as a "Dubai time · Change" chip, which opens the rail's picker.
- Once the time, name and email are in, the server's read back waits while the page asks its own questions: required ones one by one, choices as chips.
- Then one row: "Add a guest", "Add a note", each optional question, and "That's all".
- The page's own lines are `local`: never sent, so the server's replay never reads an answer as a time.
- Guests, the note and the answers go with each turn and are booked with the yes, checked as the form's are. A form's hand off goes too.

## The guest page (`ManagePage.tsx`)

BookingReceipt: the host with the state's mark, the title by state (You're booked, with "Ada will see you then." under it right after booking; Your booking, cancelled, passed), then one card that leads with the summary (spec 0058, AC-19): the date chip, what and who ("Intro call  with Ada Lovelace"), the range, the whole date and zone and how soon, then Join the call and Add to calendar (Google, Outlook, Apple / .ics) while it's ahead, or a link to book again; Who in full, Where and the note follow. "Powered by Timefix" sits at the foot.

While it's ahead, the card ends with BookingChanges (milestone 2): **Move to another time** (the page's free times for three weeks in the zone they booked in, through the booking page's own DayStrip and SlotList, unchanged, and a commit that names the new time), **Guests** (the list with Remove, one email field whose Add or Enter invites, the count) and **Cancel booking** (asks first, with an optional reason). Each answer redraws the receipt (Moved. or Cancelled. over it, read out, the heading focused). The guest page loads in its own chunk (`main.tsx`), so the booking page's first load carries none of it. The token is the only key; the API limits changes per address and per booking.

## The business page (`BusinessPublicPage.tsx`, spec 0066 B4 lite)

`/<company-handle>` and `/<company-handle>/<place-slug>` draw `BusinessPage` from `@crm/ui/public-booking` with the published page `@crm/data/business-page` reads. The handle shell (`business-shell.ts`) answers a business when the handle names no person (or the slug no booking page), with its meta block, JSON-LD and crawler text and a `business` boot block, so the page draws at once; without a shell (locally, or a missed read) `ProfilePage`'s `isBusiness` and the address lookup's not found ask the business read before the not found card. The brand's accent comes through `/api/public/business/<handle>/look/brand.css?v=`; the foot is tagged `business_page`.

## The v5 mock (10 November 2026, lane 5.5)

- The time zone picker: its search ("Search a city or GMT+4") with the 12h / 24h switch beside it, Suggested (the zone in use, and the visitor's own when that is another) over All time zones, each row's city, offset and the time there now, the chosen one filled and ticked. Every row is built only while the list is open.
- The details step is BookingDetails' `paired` arrangement: Name and Email side by side, the page's questions, the guests one email a row ("Guests (up to 10)", Add guests, Add another guest), then the note, with Back and Confirm in one foot band (held to a phone's foot).
- Booked on the page itself, the booked moment takes the whole page (ManagePage at `placement="page"`, `isWelcome`): the check lands over "You're booked", who will see you and where the details went, then the card. Inside a site's embed it stays the card's last step. The guest page opened later draws the same card as "Your booking", without the check.
- The guest page's Guests lists who is invited with Remove, then "Invite more (up to N)" as the same rows, sent at once by Invite / "Invite 2".
- The link page's booking page rows carry their next open time (the same read a next times block makes, which the access door now opens for a page block too), Share and Save contact are an equal pair, the networks sit under the bio, no address pill (Share passes the address on, and copies it where there is no share sheet), and a search shows past 5 rows.
