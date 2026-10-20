# 0028 · Booking page: the visitor's calendar on top

**Status**: Proposed
**Date**: 2026-10-20
**Feature**: Booking pages (spec 0025), polish phase 3, owner request of 20 October 2026

## Summary

A visitor on a public booking page can lay their own calendar over the host's open times, so the page shows only the times both of them are free and marks the best ones. Two ways in:

- **Signed in to Timefix** (the same browser has a session with us): the page knows them. Their name and email fill the form, and their connected calendar is laid over the times without a press, as cal.com does with `overlayCalendar`.
- **Anyone else**: a bar at the top of the page says "See when you're both free" with **Connect calendar** (Google). Connecting reads free and busy only, keeps nothing after the visit, and fills their name and email too.

The owner chose this on 20 October 2026: "like connect calendar, on top", "Hide clashes + mark best", and "also fill in data if I am a timefix user, from my sign in".

Timefix itself only recognises its own signed in users (a shared cookie on its domain) and has no connect button; the button follows SavvyCal ("Overlay my calendar") and Calendly. The Best tag follows Clockwise.

## Requirements

- **AC-720**: A visitor signed in to Timefix in the same browser is recognised on any booking page. The page shows their avatar and "Booking as {name}. Not you?" in the top bar, and the details step opens with their name and email filled. "Not you?" clears both and turns the overlay off for this visit. A host on their own page gets neither the overlay nor the prefill.
- **AC-721**: A visitor not signed in sees a bar above the headline: "See when you're both free", a Connect calendar button with the Google mark, and "Only free or busy is read, never what's on it." Connecting goes to Google and back to the same page, with the same length, month, day and zone chosen.
- **AC-722**: The connection asks Google for `openid email profile calendar.freebusy` only, with no lasting access (no refresh token). Its access token lives sealed in an http only cookie scoped to the public booking API for at most the token's own life (an hour). It is never written to the database or a log. Disconnect forgets it at once and asks Google to revoke it.
- **AC-723**: With a calendar on, every slots read also reads the visitor's busy times for that range on the server and answers which slots clash. Busy times never leave the server. A slot clashes when it overlaps a busy time; one that starts as a busy time ends does not.
- **AC-724**: By default the page hides clashing slots. A day with no shared time looks closed. The top bar says "Showing times you're both free" with a switch to show all times. When hiding leaves nothing in the range, the times area says "You're busy for every time {host} has open." with Show all times.
- **AC-725**: Up to three slots in the range are tagged **Best**: the soonest shared slots that sit between 9 AM and 6 PM in the visitor's zone and leave at least 15 minutes clear in the visitor's calendar before and after. When fewer than three pass, the soonest shared slots fill the rest. The month view marks a day holding a Best slot.
- **AC-726**: When the visitor's calendar can't be read (Google refuses, the token expired, the signed in visitor's connection needs reconnecting), the page shows every time with a quiet note, "Couldn't read your calendar. Showing all times.", and for a guest connection Connect again. The host's own slots never depend on it.
- **AC-727**: A slots answer that carries a visitor's overlay is `Cache-Control: private, no-store`, as every public answer already is.

## Decision

### Who the visitor is

- `GET /api/public/booking/:publicKey/viewer` (private, no store) answers `{ viewer: { name, email, source: 'account' | 'google', calendar: 'on' | 'none' | 'needs-reconnect' } }` or `{}` (`PublicViewerAnswer`). It reads the Better Auth session from the same origin cookie when there is one, else the guest cookie. It is per page so the host on their own page answers `{}`.
- **Signed in visitor's calendar**: their calendar connections across the workspaces they are an active member of (at most 10), each workspace entered through the member door and read with `listCalendarConnections`. The membership whose healthy connection matches their sign in email wins, else the one synced last. Busy times come through the existing `BusyReader` for that member (every connected calendar of theirs in that workspace), cached for its minute like a host's.
- **Host on their own page**: the page's host member belongs to the signed in user, so the overlay and prefill are skipped.

### The guest connection

- `GET /api/public/booking/:publicKey/connect?return=<path>` checks the page exists and `return` is a same origin booking page path, then redirects to Google with a state signed for 10 minutes (page key, return path, nonce). The nonce also goes into an http only cookie on the callback path, exactly like the member connect leg (spec 0024).
- `GET /api/public/booking/connect/callback` takes the state only with that cookie, exchanges the code online (no `access_type=offline`), checks `calendar.freebusy` was granted (the existing capability check), reads the verified email and name from userinfo, and sets `crm_guest_calendar`: the access token sealed with the calendar token key (bound to the guest's email), and the email and name, all signed for the token's life less a minute with a key derived from the token key. `HttpOnly`, `Secure` outside local, `SameSite=Lax`, `Path=/api/public/booking`, `Max-Age` the token's life. It then redirects to the return path with `?calendar=connected` (or `denied`, `scope`, `failed`).
- `POST /api/public/booking/connect/forget` clears the cookie and revokes the token at Google, best effort.
- Google needs one more authorised redirect URI: `{APP_URL}/api/public/booking/connect/callback`.

### Slots with the overlay

`PublicSlots` gains an optional `viewer: SlotsOverlay`, `{ calendar: 'ok' | 'unreachable', clashes: Timestamp[], best: Timestamp[] }`, present only when the request carries a recognised visitor with a calendar. `clashes` and `best` are slot starts. A pure core function `overlay(slots, busy, zone)` computes both and is unit tested; the route reads the visitor's busy times with a 3 second timeout and fails open.

### The page

Built in the phase 3 rebuild of the booking page on the library (`@crm/ui/public-booking`): a top bar holding the connect state, the Best tag on time buttons, the day mark, the both free switch and its empty state, the prefill and "Not you?".

## Build plan

1. Core: `overlay()` and its tests (clash edges, Best rule, zone, fewer than three).
2. API: viewer read (session, then guest cookie), the overlay on slots for a signed in visitor, tests including a visitor who is not a member anywhere and a host on their own page.
3. API: the guest connect, callback and forget routes, the sealed cookie, tests (state without cookie refused, return path outside booking refused, partial grant refused, expired cookie ignored).
4. Page: the top bar, prefill, hidden clashes with the switch, Best tags, day marks, the fail open note. Stories for every state, then the browser run.

## Consequences

- No new table. The guest's token lives only in their own browser, sealed, for an hour.
- One more redirect URI in the Google client; the consent screen already carries `calendar.freebusy`.
- Every slots read with an overlay costs one Google free and busy call; the per address rate limit already bounds it.

## Follow-up

- Microsoft calendars for guests, with Outlook sync (calendar sync milestone 4).
- Linking a booking to the signed in visitor's account (timefix's `guest_user_id`), for "your bookings" across hosts.
- The assistant's "works for both of us" answers, with the assistant (phase 3B).

## Rationale

The owner asked for timefix's overlap with a connect button on top and the form filled from their sign in. Hiding clashes is timefix's default; the Best tag and the connect button come from SavvyCal, Calendly and Clockwise, found on Mobbin. Keeping the guest's token in a sealed short cookie instead of a table means there is nothing to leak, expire or delete later, and the flow reuses the member connect leg's state and nonce pattern, which is already reviewed.
