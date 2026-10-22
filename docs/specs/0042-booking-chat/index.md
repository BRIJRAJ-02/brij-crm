# 0042. Book by chat on the public booking page

**Date**: 2026-10-21
**Status**: Proposed
**Numbering**: the next free spec number on 21 October 2026 (0037 to 0040 are taken on lane branches). This spec owns AC-1501 to AC-1530, above the highest AC in use (AC-1450); the coordinator may renumber.

## Summary

The owner's ask (21 October 2026): "the chat bot to book the calendar meet on the front booking link". A visitor on `/b/<publicKey>` can switch the card from the month or list picker to **Chat** and book by typing ("next Tuesday afternoon", "the second one", "Ada, ada@example.com", "yes"). The chat is a port of timefix's booking assistant (`timefixmarketing/src/lib/booking-agent.ts`): rule based, with no LLM and nothing sent to any outside service. It reads times through the same slots service the picker reads and books through the same booking service the form books through, so there is one booking path and one integrity check.

The public page stays frozen apart from this: one more segment in the existing view switch, and the panel it opens.

Reasoning and options: see [rationale.md](rationale.md). Checks: [verify.md](verify.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0025 booking pages | `readPublicSlots`, `bookPublicSlot`, the page door `enterBookingPage`, `BOOKING_LIMITS`, the guest page and its token | hard prerequisite (landed) |
| The central limits module (`apps/api/src/limits.ts`) | `PublicLimiter`, one table of rules per surface | hard prerequisite (landed) |
| `luxon` (already in the catalog, used by core's slot engine) | zone math for "tomorrow", "next Tuesday", dayparts | none: no new dependency |

## Requirements

**User stories**:
- As a visitor, I want to say roughly when suits me and get a few real times back, instead of paging through a month.
- As a visitor on a phone or using a screen reader, I want a booking path that is one text field and a few buttons.
- As a host, I want to see what a visitor said when they booked by chat, beside the booking.

**Acceptance criteria** (AC-1501 to AC-1524 used; the rest are spare):

*The panel*
- **AC-1501**: The card's view switch on `/b/<publicKey>` offers Month, List and Chat. Chat replaces the picker inside the same card; the rail (host, meeting, length, time zone) stays. The choice is remembered like Month and List. Nothing else on the page changes.
- **AC-1502**: The chat opens with one greeting that names the meeting and its length ("I can book your 30 minute Intro call with Ada. When works for you?", owner's wording fix of 23 Oct 2026) and offers the soonest times as buttons, drawn as the picker draws them (SlotList), grouped under their day, plus up to two suggestions as buttons ("Something later", "Next week"). The greeting needs no request: it is drawn from the slots the page already holds; the first request goes on the visitor's first message.
- **AC-1503**: A visitor types in one labelled field ("Message", at most 500 characters) and sends with Enter or the Send button. A time button or a suggestion sends its own words as the visitor's message, so a tap and typing go through one parser.
- **AC-1504**: The panel's code loads in its own chunk when Chat is first chosen, never in the page's first load (`pnpm size` holds).

*What the chat understands* (all in the visitor's chosen time zone and 12 or 24 hour setting, taken from the rail)
- **AC-1505**: Days: today, tomorrow, weekday names ("Tuesday", "next Tuesday", "this Friday"), dates ("25 Oct", "Oct 25", "the 25th", "25/10" is not read), this week, next week, "asap", "earliest", "anytime".
- **AC-1506**: Times: "3pm", "15:00", "3:30", "at 4" (a bare hour 1 to 11 with no am or pm that misses in the morning is tried in the afternoon), dayparts (morning 8 to 12, afternoon 12 to 17, evening 17 to 21, lunchtime 11 to 14), ranges ("between 2 and 4pm").
- **AC-1507**: An exact time that is open is held ("Tuesday at 3:00 PM it is"); one that isn't answers with the nearest open times. A window answers with up to six open times inside it, or, when it has none, "Nothing then. Closest I have is …" with the nearest six.
- **AC-1508**: Picking among offers: "the first", "the second one", "the last", "3pm" when one offer is at 3pm, or tapping a time.
- **AC-1509**: "No", "something later" or "another" offers the next six after the last offered; "what's open?" offers the soonest six.
- **AC-1510**: Length: when the page offers more than one, "60 minutes", "an hour" or "half an hour" switches to that length if offered (the rail follows), and is refused in words if not ("This page offers 15, 30 or 60 minutes."). Each page is one meeting type, so picking a meeting type means picking its length.
- **AC-1511**: Questions it answers without booking: how long it is, where it is (video link comes with the confirmation, phone, or the address), and whether a booking can be moved or cancelled (every confirmation carries a link that does both). A question never books anything.
- **AC-1512**: Anything it can't read gets "Sorry, I didn't catch a time in that. Try something like 'Thursday morning', or tap one of these." with the soonest times.

*Booking*
- **AC-1513**: Once a time is held, the chat asks for a name and an email (and a phone number when the page's location is a phone call). It reads "I'm Ada", "Ada Lovelace", any email address, and a number of 7 to 20 digits, in any order and in one message or several.
- **AC-1514**: With a time, a name and an email, the chat reads them back, with the date, and waits for a yes: "Tuesday 27 Oct at 3:00 PM, 30 minutes, for Ada Lovelace (ada@example.com). Shall I book it?" with Yes, book it and Something else. Only a yes to that question books. A booking emails two people, so nothing is written before the visitor has seen exactly what will be.
- **AC-1515**: The booking goes through `bookPublicSlot` unchanged: the same live slot check, lock, race guard, person match and emails as the form. Its idempotency key is derived from the conversation alone, so a conversation books once and a retried yes answers the booking it made (the time it booked is no longer open, so the replay alone can't find it); a time lost to a race leaves no row, so the next yes books afresh. A booking turn passes the form's bot checks (the fill ticket or the page's load time).
- **AC-1516**: On success the reply says "Done. You're booked for … The details are on their way to …" and the page opens the guest page, exactly as the form does, where the visitor can move or cancel. A time taken meanwhile answers "Someone just took that time. Closest I have now is …" with fresh offers.
- **AC-1517**: Every turn re-derives the conversation by replaying the visitor's own messages against the times open right now. The server keeps no conversation state, and nothing the assistant said earlier is trusted.

*Privacy, limits and the transcript*
- **AC-1518**: The chat never reads People, Companies or any CRM record, and never recognises a visitor. A typed email that matches a contact gets exactly the reply a new email gets (a test proves byte equality). The only CRM effect is the one the form already has: the booking's person match.
- **AC-1519**: Replies name only open start times, the page's own facts and what the visitor typed. They never mention another booking, a busy time, a member's email or why a time is unavailable.
- **AC-1520**: `POST /api/public/booking/:publicKey/chat` is limited through the central module: 30 turns a minute per client address, 600 a minute per page, and each turn counts as a slots read too (it reads the host's calendar); a turn that books also counts against the booking limits (5 a minute per address, 50 per page). A refusal is 429 with `Retry-After`, and the panel says "That was a lot at once. Give it a few seconds and try again." The page sends only the visitor's own lines; the body is at most 128 KB: at most 40 lines of at most 500 characters.
- **AC-1521**: The transcript is kept only when the chat books, on that booking (`answers.chat`: the visitor's own lines, at most 40 of at most 500 characters), and lives and is deleted with the booking. Assistant lines are never stored: they would come from the client, and nothing vouches for them. A conversation that never books is not stored anywhere, and no log line carries what anyone typed.
- **AC-1522**: Members who can see a booking see "Booked: By chat on the booking page" on its card in Bookings, with what the visitor wrote behind a Chat disclosure. The guest page never shows it.

*Access and layout*
- **AC-1523**: The thread is a log region that announces each new reply politely; each reply's times are a labelled group of buttons ("Times on Tuesday 28 Oct"); focus stays in the message field after sending, and every control works from the keyboard. Contrast meets WCAG AA in light and dark.
- **AC-1524**: At 390 pixels wide the panel fills the card, the thread scrolls inside it with the field and Send pinned at its foot, and time buttons wrap two or three across. Nothing scrolls sideways.

## Decision

A rule based agent in `packages/core` (pure parsing and replay, no I/O), behind one public endpoint beside the booking page's others, drawn by one new library component. No LLM and no new dependency: luxon already does the zone math, and a small parser written for exactly the phrases above replaces chrono-node.

## Feature design

### Core (`packages/core/src/booking/chat/`)

- `parse.ts`: pure readers over one message: `readTime(text, zone, now)` (a point or a window, with the phrase to say back), `readEmail`, `readName`, `readPhone`, `readLength`, `readSelection`, and the yes, no, thanks, duration, location and change questions. Luxon only.
- `agent.ts`: `replay({ messages, slots, zone, now, page, hour12 })` folds the visitor's messages into a state (offered, held, chosen, name, email, phone, length, intent) and `reply(state)` words the answer (text, offers, suggestions). Pure, so it is tested with a list of slots and some sentences.
- `public.ts` gains `chatTurn(entry, deps, input)`: reads the page and its slots for the page's window (at most 62 days, the slots read's own cap) through `readPublicSlots`, replays, and, when the replay ends on a confirmed booking, calls `bookPublicSlot` with the derived idempotency key and `answers.chat`. `bookPublicSlot` takes an optional `chat` transcript to store; nothing else about it changes.

### Contracts (`packages/contracts/src/booking/public.ts`)

`PublicChatInput` `{ conversationId: Uuid, duration, timeZone, hour12, messages: [{ role: 'visitor' | 'assistant', text }] (1 to 40, last is the visitor's) }` and `PublicChatReply` `{ text, offers: Timestamp[], suggestions: string[], intent, duration, booked?: { manageToken } }`. The assistant's earlier lines travel only so the stored transcript can include them; the agent never reads them.

### API (`apps/api/src/public/booking.ts`)

`POST /public/booking/:publicKey/chat`: body limit, the limits in AC-1520 (new `chatPerAddress` and `chatPerPage` rules in `BOOKING_LIMITS`), parse, `enterBookingPage`, `chatTurn`, and on a booking the relay's wake. Same origin only (the app's Origin check on writes). A refusal from the booking service that the chat can say in words (`SLOT_TAKEN`) becomes a reply; anything else keeps the standard error shape.

### Data layer and page

`@crm/data/booking` gains `chat(publicKey, input)`. `BookingPage.tsx` gains the third segment and renders `BookingChat` (lazy) in the card's body, passing the zone, the 12 hour setting, the length, the page facts and `onBooked`; a length the chat switches to updates the rail.

### Library (`packages/ui/src/public-booking/chat/`)

`BookingChat`: the thread (visitor lines on one side, replies on the other), a reply's times as buttons grouped by day, suggestions as quiet buttons, a typing state while a turn is out, an error line with Try again, the message field and Send. Built from the library's Button, TextField and the public booking tokens; its own CSS module only for the thread layout. Stories for empty, a few turns, offers, waiting, error and booked; screenshots at 1280 and 390, light and dark.

### Bookings in the CRM

The booking list's read passes `chat` from `answers`; the card shows "Booked by chat" and a Show chat disclosure.

## Build plan

1. Core parser and agent with Vitest tables (the timefix case list, adapted).
2. Contracts, `chatTurn`, the endpoint, its limits, and API tests against a real Postgres (a booking by chat, a replay that doesn't double book, the privacy equality, the 429).
3. Library component with stories; the page's segment; the CRM card's disclosure.
4. A flow: open `/b/<key>`, choose Chat, book by typing, land on the guest page.
5. Reviews: security-access-reviewer, ux-interaction-reviewer, design-system-guardian.

## Consequences

- Each chat turn computes the page's slots for up to 62 days and reads the host's calendar, as one slots read of the picker does; the per address limit keeps that bounded.
- The transcript is personal data the host already receives in other forms (name, email, note); it is stored only on a booking and goes with it.
- The page's view preference gains a third value; an old saved value still reads.

## Follow-up

- The 12 or 24 hour switch lives in the picker's time list; Chat uses the remembered choice (or the language's) and has no switch of its own in v1.

- Voice booking (timefix's `voice-booking.tsx`, the browser's speech recognition): left out of v1. It is cheap on top of this endpoint but needs a microphone permission prompt and copy for unsupported browsers; owner to decide.
- The visitor's own calendar overlay (spec 0028) in the chat ("only when we're both free"): left out of v1 so the chat never recognises anyone.
- Booking for a team page's chosen member, and guests and notes by chat.
- A shared store for the limiter before a second API instance (spec 0023 follow-up, #41).

## Rationale

See [rationale.md](rationale.md).
