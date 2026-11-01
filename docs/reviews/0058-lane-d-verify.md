# /check verify: spec 0058, Lane D (visitor side) · FAIL (one gap)

Branch `wip/visual-visitor` at `1daa92cf5`, compared with the lane's base `395cedc57`. Run on 31 Oct 2026 against the real app: api on :3410 (with calendar sync on and a fake Google client, so the visitor's Connect link shows), web (Vite dev) on :5410, Postgres database `crm_vv`, one headless Chromium. Screenshots and the evidence ledgers are in the session scratchpad, `vv/shots/` (paths below are relative to it).

**7 of 8 criteria met. AC-19 is met for the plain thank you and the manage page, but not for a form that sends its visitor on to book.**

## Per criterion

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 Alignment | met, with a note | The alignment probe (`@crm/ui/alignment-probe`) passes on `/b/:key` desktop (204 elements) and phone (201), the manage page (70), and both form thank yous at both widths. Light and dark shots look right. The probe found no `data-probe` markers on these pages, so only its spacing check had anything to measure. With the Match dialog open, the probe reports a 11px right padding on the dialog's head ("Match with your calendar"). That is MatchCalendar's code, not this lane's, but this lane's link now opens it. |
| AC-2 Motion | met for this lane | The only new transition is `color` on the Powered by link's hover (allowed: hover is colour or lift), on `--duration-hover`. No new animation. With reduced motion, the pre-existing fades stay (receipt card 0.24s, thank you 0.24s, month and slot fades 0.2s): that is the library's "fades stay, movement goes" convention, older than this lane, and stricter than AC-2's wording. |
| AC-4 Accessibility | met | axe (WCAG 2.2 A and AA) clean in light and dark on `/b/:key`, the Match dialog, the manage page and both thank yous (`ledger-axe.json`). Tab reaches Time zone, Powered by, Claim, Connect your calendar, the clock switch, the view switch, the month and every time. Arrows switch 12h/24h (`09:00` became `9:00 AM`) and Month, List, Chat. Enter on Connect opens the dialog, Escape closes it and focus returns to the link. Focus rings are visible (`f-connect-focus.png`, `f-clock-focus.png`, `f-view-focus.png`). |
| AC-19 Summary first | **fail (partial)** | Plain thank you: the answers read back in a small sunken list, then one next step, Send another (`form-thanks-plain-desktop-light.png`, `form-thanks-plain-phone-dark.png`). Manage page: one card leads with the date chip, "Intro call with Ada Lovelace", the time and zone, then Add to calendar (`manage-welcome-desktop-light.png`, `manage-later-desktop-*.png`). **Gap:** a form whose After is "book a time" shows no read-back at all, and two actions (Book now, Stay here) (`form-thanks-book-desktop-dark.png`, `form-thanks-book-phone-*.png`). `SentAnswers` is only wired into `FormThanks`; `FormBooking` and the new `BookingFallback` don't render it. Fix: pass the same summary into `FormBooking`'s confirmation, or record in the spec that this variant is exempt. |
| AC-20 No new requests or origins | met | Every request on every page went to `localhost:5410` only. API calls are the existing ones: booking page, slots, viewer, book, manage, handles; form, ticket, submissions. `vercel.json`, `csp.ts`, `middleware.ts`, `apps/api` and `packages/data` are unchanged since the base. The only new code request is the same origin chunk for `FormBooking` (a dynamic `import()`), which needs no CSP change. A live network run of the base build was not done; the comparison is from the diff plus this run. Routes unchanged. CI is green at this sha. |
| AC-21 Warm and finished | met | Right after booking: "You’re booked" with "Ada Lovelace will see you then." (welcome only; a later visit says "Your booking" with no line). The card fades in, and with reduced motion the message is still there (`manage-welcome-reduced-*.png`). Nothing loops or blocks input. |
| AC-24 Compact controls | met | 12h/24h and Month/List/Chat sit side by side in the card's top right corner, on the "Choose a time" row (one parent, both 28px tall). The time zone stays visible in the rail ("Kolkata time GMT+5:30"). "Connect your calendar" is a small link above the card, 11px, opening the Match dialog first and never leaving for Google on its own (`c-desktop-light.png`, `c-desktop-dark.png`, `c-dialog-light.png`). No horizontal scroll at 390px. |
| AC-26 Powered by Timefix | met | "Powered by timefix" at the foot of `/b/:key` (rail, and the page's end on a phone), the manage page, the hosted form, both thank yous and the link page `/<handle>`, each linking to timefix.com tagged by page. Nothing in the code makes it optional. |

## Short of world class (not blocking, worth a pass)

- Form thank you that hands off to booking: no read-back (above), and the countdown row ("Taking you to book a time in 29 … Book now Stay here") is cramped onto one line.
- Manage page on a phone: Cancel booking wraps onto a row of its own, and the email breaks at its hyphen ("vera-" / "1c8a…").
- The receipt's small avatar: the check badge covers the second initial, so "AL" reads as "AI".
- Connect your calendar is 11px and light grey: it passes axe, but it is very quiet. Its tooltip is still fading over the clock switch when focus moves on.
- `/b/:key` on a phone: the two switches drop to their own row under "Choose a time", and there is a tall empty gap between the month and the day's times.
- The Match dialog's head has an off-scale 11px inset (MatchCalendar).

## What was not checked

- The base build was not run side by side for a live network diff (see AC-20).
- The `/b/:key` page as a known signed in visitor (the calendar overlay states) was not driven.
