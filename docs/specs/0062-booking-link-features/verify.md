# 0062 verify: Booking link features

How `/check verify` proves each criterion. Heavy suites (flows, stories, visual) run on CI through the lane push; locally only single test files, behind the load gate. Every screen is also checked by spec 0058's alignment probe and motion check, in light and dark inside the real layout.

## Per criterion

| AC | How it is checked |
|---|---|
| AC-6201 | Integration test: a redirect page's booking answers `redirectUrl`; with details off the address has no query values added, with details on it has exactly `name`, `email`, `start`, `tz`, `page`. Contract test: an http address (not localhost) is refused. Browser test: the confirmation shows "Taking you to" and a link, instant under reduced motion. |
| AC-6202 | Integration tests: a guest cancel and a guest move inside their cutoffs answer `TOO_LATE`; the host's cancel and move at the same moment succeed; a cutoff of 0 behaves as today. Browser test: the guest page shows the one line and disabled actions. |
| AC-6203 | Integration tests: a pending booking blocks the slot for a second visitor; Confirm makes the calendar event and queues `confirmed`; Decline frees the slot and queues `declined`; the expiry job declines at the earlier time (clock injected). Access test: a member without Manage reach gets 403. |
| AC-6204 | Integration tests: a link with 1 use books once; 20 parallel bookings on a 3 use link make exactly 3; expired and revoked links answer `LINK_USED`; a Paused page refuses it; a Private page accepts it. Source scan: the token never appears in a query string or a server log line. |
| AC-6205 | Job tests: a page with 3 reminders queues 3 keyed jobs; a past reminder is skipped; a move replaces them; a cancel removes them; a `reminder_24h` job queued before the migration still sends. |
| AC-6206 | Contract test: an unknown variable is refused with its name. Render test: markup in the body arrives escaped; the calendar file, Join button, manage links and footer are present in every kind. Browser test: preview fills sample values; Reset restores the default. |
| AC-6207 | Integration test: a host gets "New booking"; with the `bookings_new` topic off they don't. The preferences page lists the topic. |
| AC-6208 | Job tests: the follow up goes at the offset after the end; it is skipped for cancelled, declined and no show bookings. |
| AC-6209 | Unit test on `embedSnippet` for the three modes with `kind: 'booking'`. Embed flow (CI): a parent page receives `timefix:booked` with page and start only. `apps/web/csp.test.ts` unchanged and green. |
| AC-6210 | Integration tests: two views by one visitor on one day count once; a pick and a booking count; no cookie is set and no IP is stored (schema scan). Browser test: the Links list numbers and the Stats view render. |
| AC-6211 | Integration test: UTM values and the referrer host from the page address land on `bookings.source`, cut to 200 characters; from an embed, the parent's values land instead. Browser test: they show in the booking's details and the export. |
| AC-6212 | Contract test: 8 lengths accepted, 9 refused. Browser test: 4 show as segments, more as a Select. |
| AC-6213 | Integration tests: a 3 seat slot takes 3 attendees and then stops offering the slot; 10 parallel bookings for the last seat make exactly 1; a seat cancel frees one seat; a host cancel cancels all; attendee emails never contain another attendee's name or email; combinations with round robin, confirmation, repeats or price are refused `CONFIG_INVALID`. |
| AC-6214 | Integration tests: 4 weekly occurrences book as 4 bookings with one `series_id`; one clash refuses all with `REPEAT_CLASH` listing the date; "Cancel all that are left" cancels only future ones. |
| AC-6215 | With Stripe test keys on CI: a paid booking holds `pending_payment`; a signed `checkout.session.completed` confirms it; the same event twice confirms once; a bad signature answers 400; an expired session frees the slot after 15 minutes (clock injected); refunds follow the cutoff. Without keys: the price option is absent and the API boots (env test). |
| AC-6216 | With a stubbed Twilio wrapper: a text reminder needs a phone and consent; the monthly cap stops the 501st message; at most 3 per booking. Without keys: channels absent, the API boots. |
| AC-6217 | With a stubbed Zoom wrapper: booking, move and cancel make, move and delete the meeting; a Microsoft calendar's video location is labelled Microsoft Teams. Without keys: Zoom absent. |
| AC-6218 | Spec 0058's alignment probe and motion check on every new card, dialog and the Stats view; a reviewer reads every string against the less text limits; screenshots in light and dark. |
| AC-6219 | The two guard tests (every tenant table forces row level security with a policy; a cross workspace read returns nothing) cover the new tables; access tests per host action; a public payload scan finds no member email. |
| AC-6220 | `booking-journey`, `booking-edges`, `form-to-booking` and `booking-chat` flows on CI unchanged and green; a snapshot of a page's settings with every new field at its default equals today's behaviour in the engine tests. |

## Before landing a lane

1. The spec 0058 design pass and its skills.
2. `security-access-reviewer` and `state-performance-reviewer` (every lane touches the API and jobs), then `design-system-guardian` and `ux-interaction-reviewer`.
3. The lane's CI run green, cited in its handoff.
4. Confirm with crm-6a that no file of theirs changed.
