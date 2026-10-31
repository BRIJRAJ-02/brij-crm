# /check verify: spec 0058, Lane D (visitor side), final · not ready: one must fix (look only)

Branch `wip/visual-visitor` at `12f303f2c` (CI run 41167172112 green). Run on 31 Oct 2026 against the real app: api on :3330 and worker on :3331 (calendar sync on, a fake Google client, so the visitor's Connect action shows), web (Vite dev) on :5330, Postgres database `crm_vdfin` (dropped after), one headless Chromium. The data was seeded through the app itself: a new person signed in through Mailpit, walked first run, then a booking page, a plain form and a form whose After is "book a time" (30 second countdown), and one real booking. Screenshots are in the session scratchpad, `vdfin/shots/` (paths below are relative to it). Each shot exists in `-light` and `-dark`.

**Every fix from the first verify is in, and every criterion is met. One thing is owed before landing, and it is look only: the neighbouring month's dates on `/b/:key` read like closed days (fix 5 below).**

## The six fixes

| # | Fix | Verdict | Evidence |
|---|---|---|---|
| 1 | AC-19: the hand off to booking reads back the answers, Book a time primary, Stay here quiet, countdown on its own row, held only on the buttons | met | `form-thanks-book-desktop-*.png`, `form-thanks-book-phone-*.png`: the heading, then a sunken list (Your name, Work email), then Book a time (filled accent) and Stay here (ghost, no fill), then "Taking you to book a time in (30) …" on its own line below. The count, read every 2.1 s: pointer away 29 to 27, on the heading 27 to 25, on the answers 25 to 23, on Stay here 23 to 23 (held, `form-thanks-book-held-*.png`), on Book a time 23 to 23, off again 23 to 21, keyboard focus on Stay here 21 to 21. Stay here keeps the visitor on `/f/<key>`, drops the line, and focus lands on Book a time (`form-thanks-book-stayed-*.png`). Same at 1440 and 390. |
| 2 | Manage page on a phone: actions stacked full width, Cancel last, email on its own line | met | `manage-welcome-phone-*.png`, `manage-later-phone-*.png`: Move to another time, Add guests, Cancel booking, each full width, Cancel last in the danger outline. The email `ada-lovelace-87637f@example.com` sits on its own line under the name and does not break at its hyphens. Desktop keeps the one row with Cancel at the end (`manage-later-desktop-*.png`). |
| 3 | The receipt's badge clear of the initials | met | `receipt-mark-light.png`, `receipt-mark-dark.png` (4x): the 16px check hangs off the avatar's lower right corner; "AL" reads whole in both themes. |
| 4 | Connect your calendar at body size; a keyboard opened tooltip goes at once | met | Computed 13px on 20px, the same as the body (13px on this branch), in `text-secondary`. Tab onto it opens the tooltip ("See when you're both free…", `connect-tip-kbd-desktop-*.png`); one more Tab and the tooltip is gone from the DOM by the next frame, with nothing fading over the clock switch (`connect-tip-after-tab-desktop-*.png`). Enter opens Match with your calendar; Escape returns focus to the action. |
| 5 | `/b/:key` keeps six weeks, neighbouring dates fill the spare cells | built, **look owed** | `b-phone-*.png`, `b-desktop-*.png`. The gap on the phone is gone and the card holds its height. But the neighbouring dates read like closed days. Measured: a neighbouring date is `text-tertiary` at 11px; a closed day in the month (Sat 7 Nov) is `text-tertiary` at 13px. Same colour, two pixels smaller, both plain numbers with no tile. After "30", the row "1 2 3 4 5" and then "6 … 12" look exactly like a run of closed weekdays, which tells a visitor "nothing free in early December" when the page is only showing November. See Must fix. |
| 6 | Powered by Timefix on every public page (AC-26) | met | One "Powered by timefix" link on `/b/:key` (rail on desktop, page foot on a phone), the manage page, the handle link page `/ada-lovelace`, the hosted form, the plain thank you and the hand off thank you. Each links to `www.timefix.com` with its own `utm_medium` (`booking_page`, `booking_confirmation`, `booking_profile`, `form`). Nothing in the page's settings turns it off. |

## Findings from the first verify, checked again

| First verify said | Now |
|---|---|
| AC-19 fail: the hand off thank you had no read-back | fixed (fix 1) |
| The countdown row was cramped on one line | fixed: the buttons on one row, the countdown on the next |
| Manage page phone: Cancel wrapped alone, the email broke at its hyphen | fixed (fix 2) |
| Receipt badge covered the second initial | fixed (fix 3) |
| Connect your calendar 11px and very quiet; its tooltip still fading over the clock switch | fixed (fix 4) |
| `/b/:key` phone: the switches drop to their own row under "Choose a time" | unchanged, and fine: they sit right aligned under the title, nothing scrolls sideways (scroll width 390) |
| `/b/:key` phone: tall empty gap between the month and the times | fixed by fix 5, with the look issue above |
| Match dialog head off the scale (MatchCalendar) | still there, not this lane's code: the alignment probe says the title starts 22px in from the body's content (the icon before it) and the close button has 1px block padding |

## Per criterion

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 Alignment | met | Alignment probe clean on `/b/:key` (206 elements at 1440, 206 at 390), the manage page (71), the plain thank you and the hand off thank you at both widths. Only the Match dialog fails it, as above, in MatchCalendar. |
| AC-2 Motion | met | Nothing new moves. The new rule only takes the keyboard tooltip's exit animation away. The countdown ring drains over its full time and holds with the count. |
| AC-4 Accessibility | met for this lane | axe (WCAG 2.2 A and AA) clean in light and dark at both widths on `/b/:key` (month, list, chat, the details step), the Match dialog, the manage page (welcome and later), the handle link page, the hosted form, both thank yous. Two popovers flag `scrollable-region-focusable` on the searchable list (time zone picker on `/b/:key`, country code picker on the form), in light and dark, at both widths. That list is the library Select, which this lane only touched for its trigger's padding; it is older than the lane. Worth its own fix later, not a block here. |
| AC-19 Summary first | met | Fix 1, plus the plain thank you (`form-thanks-plain-*`) and the manage page as before. |
| AC-20 No new requests or origins | met | Across `/b/:key`, manage, the handle page and the form, the only origin was `localhost:5330` and the only calls were the existing ones: booking, slots, viewer, manage, handles, form and its ticket. |
| AC-21 Warm and finished | met | "You're booked" with "Ada Lovelace will see you then." right after booking (`manage-welcome-*`), "Your booking" on a later visit (`manage-later-*`). |
| AC-24 Compact controls | met | 12h/24h and Month/List/Book by chat sit together top right on desktop; zone stays in the rail; Connect is a quiet ghost action that opens the dialog first. |
| AC-26 Powered by Timefix | met | Fix 6. |

## Must fix before landing

1. **`/b/:key` neighbouring dates read as closed days** (`b-phone-light.png`, `b-phone-dark.png`, `b-desktop-light.png`). `/b/:key` behaviour is frozen, but this is look only, in `MonthTiles.module.css` `.outside`. Two options, both what Calendly and Cal.com do:
   - Keep the dates but make them plainly a different kind of thing from a closed day: a fainter colour than `text-tertiary` (for example `--border-strong`, which is fine for an `aria-hidden` decoration that is never a control), at the same label size. A closed day then stays the darker grey and the neighbours sit clearly behind it.
   - Or leave the cells blank, as Calendly does. The six week grid still holds the card's height; the cost is the empty row the first verify called out on a phone.

   The first option keeps what fix 5 won, so it is the better choice. Update the MonthTiles README line and the baselines with it.

## Not blocking, worth a pass

- The hosted form and the handle link page stay light when the visitor's system is dark. That is by design (the page draws in its owner's chosen look, `data-theme` pinned on the root), but worth knowing when you read the `-dark` shots for those pages.
- The handle link page shows a full width button holding only a share icon, above the booking rows. It is older than this lane and looks unfinished.
- The searchable list's axe hit, above.
- In a quick automated hand off, the browser logged a rejected view transition ("Transition was skipped" / "aborted because of invalid state"). It did nothing visible. Worth catching the rejection so it never reaches Sentry.

## What was not checked

- `/b/:key` as a known signed in visitor (the calendar overlay states).
- A live network run of the base build side by side (AC-20 is judged from this run plus the diff).
