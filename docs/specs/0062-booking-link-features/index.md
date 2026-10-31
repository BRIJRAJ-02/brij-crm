# 0062. Booking link features: the industry standard set

**Date**: 2026-10-31
**Status**: Proposed

## Summary

Booking links already do the hard parts (hours, limits, round robin, questions that file into the CRM, a guest page). This spec adds what people expect from Calendly and Cal.com and miss today: a redirect after booking, cancel and move cutoffs, bookings the host approves, one off links, your own reminder times and email words, an embed and stats for each page, more lengths, group bookings with seats, weekly repeats, and (once the owner adds the accounts) paid bookings, text message reminders and Zoom. Defaults stay exactly as today, so nothing changes for a page until its owner turns something on. "Powered by Timefix" stays everywhere.

## Requirements

**User stories**:
- As a host, I want to send people to my own thank you page, stop last minute cancels, and approve some bookings before they count.
- As a host, I want a link that works once for one person, so I can offer a time without opening my page to everyone.
- As a host, I want my own reminder times and my own words in the emails, without breaking the calendar file or the links.
- As a host, I want to put my page on my site and see how many people view it and book.
- As a host running a class or a webinar, I want several people in one slot, and repeating weekly sessions.
- As a host who charges, I want people to pay before the booking counts (once the owner connects Stripe).
- As a visitor, I want clear rules: what I can still change, whether my booking is confirmed or waiting, how many spots are left.

**Acceptance criteria** (numbered AC-6201 onward so they never collide with other specs):

Slice 1, visitor flow rules:
- **AC-6201**: A page's "After booking" is Confirmation (default, today) or Redirect to an https address, checked by the forms rule `RedirectUrl` (`packages/contracts/src/forms/document.ts`; http only for localhost). An optional "Send booking details" switch, off by default, adds `name`, `email`, `start` (ISO UTC), `tz` and `page` (the slug) as query values. The redirect happens only after the booking commits; the confirmation shows "Taking you to {site}" with a link for 2 seconds (instant with reduced motion). The confirmation email and manage links go as usual.
- **AC-6202**: A page sets a cancel cutoff and a move cutoff, each 0 minutes to 14 days before the start (0 is today's behaviour and the default). Inside a cutoff the guest page shows Cancel or Move as unavailable with one line ("Too close to the meeting to change it here. Reply to your confirmation email.") and the server refuses with the new stable code `TOO_LATE`. Host side cancel and move ignore cutoffs.
- **AC-6203**: "Requires confirmation" (off by default). A booking starts `pending` and holds its slot. The visitor sees "Requested" and gets a "Request received" email. The assigned host, or anyone with Manage reach over that host (spec 0037), gets an email and an in app notice with Confirm and Decline. Confirm makes the calendar event and sends the usual confirmation. Decline frees the slot and emails the visitor, with an optional reason. A pending booking declines itself at the earlier of 24 hours after the request or 1 hour before the start, and the visitor is told.
- **AC-6204**: One off links. From the page editor a host makes a link with an optional label, a number of uses (1 by default, up to 50) and an optional expiry (a date up to 365 days ahead). The address is `/b/:key#o=<token>`: a 32 byte random token, stored as a SHA-256 hash, carried in the fragment so it never reaches server logs or a Referer. It books the page by its own rules, also when the page is Private; a Paused page refuses it. A use is counted when the booking commits, under the booking lock. A used up, expired or revoked link shows a calm "This link has been used" state. The list shows label, uses left, expiry, Copy and Revoke (Revoke confirms in a Modal, owner rule).

Slice 2, messages:
- **AC-6205**: A page has up to 3 reminders, each 10 minutes to 7 days before the start, on email (text message and WhatsApp arrive in slice 5). The default is today's 24 hours and 1 hour. A reminder already past at booking time is skipped. A move queues them again, a cancel or decline removes them. A change to a page's reminders applies to new bookings and to bookings moved after it. Reminder jobs already queued as `reminder_24h` or `reminder_1h` still send.
- **AC-6206**: The host can edit the subject (up to 150 characters) and body (up to 2,000 characters, plain text) of the confirmation, request received, reminder, cancelled, moved and follow up emails, with the closed variables `{visitor_name}`, `{visitor_first_name}`, `{event_title}`, `{start}`, `{host_name}`, `{location}`, `{manage_link}`, `{join_link}`. An unknown variable is refused on save (`VALUE_INVALID`, naming it). The text is escaped and drawn as paragraphs inside the existing branded layout; the calendar file, Join button, manage links and "Powered by Timefix" footer are always kept. Reset to default is one click. A live preview fills sample values.
- **AC-6207**: Hosts get a "New booking" email for each booking on their pages. It is a new email topic, `bookings_new`, on the email preferences page, on by default, which a member can turn off.
- **AC-6208**: An optional follow up email goes 15 minutes to 7 days after the meeting ends, skipped when the booking is cancelled, declined or marked no show. Its default words are a short thanks and a Book again link, editable by AC-6206.

Slice 3, reach:
- **AC-6209**: The page editor's Share area offers Inline, Popup and Floating button as tiles (spec 0058's `TileGrid` choice variant) with a copy snippet each, made by the existing `embedSnippet` with `kind: 'booking'` (`apps/web/src/features/forms/snippets.ts`) and served by the existing loader (`apps/web/embed/v1.js`). After a booking, the embedded page posts `{ type: 'booked', page, start }` (page key and ISO start only, never a name or email) and the loader fires a `timefix:booked` DOM event on the holder. The Content Security Policy does not change (`/b/:publicKey` already allows any frame ancestor).
- **AC-6210**: Each page counts views (one per visitor per UTC day by a daily keyed hash, no cookies, no IP stored, the way the link page counts), slot picks and bookings. The Links list shows views and bookings for 30 days per page. A Stats view per page shows the 30 days against the 30 before, a small daily chart and the top sources.
- **AC-6211**: A booking stores where it came from: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` and the referrer's host, read from the page address, or from the parent page when embedded (the loader passes them). Each value is plain text up to 200 characters. They show in the booking's details, in the bookings list export, and on the person's timeline entry for the booking.

Slice 4, capacity:
- **AC-6212**: A page offers up to 8 lengths (today 4). The public picker shows up to 4 as segments and more as a Select, aligned per spec 0058. The database check moves with it.
- **AC-6213**: Seats. A personal or collective page may set 2 to 100 seats per slot. A slot is offered until full, and "N spots left" shows when the host turns it on. Each attendee is a seat on one booking: the hosts get one calendar event, and each attendee gets their own email and calendar file and never sees another attendee's name or email. Each seat has its own manage link to cancel that seat; moving a seat means cancelling it and booking again (said in one line). A host cancel cancels every seat. Each seat files into the CRM as its own person. Seats can't be combined with round robin, requires confirmation, repeats or payment in this release (refused `CONFIG_INVALID`).
- **AC-6214**: Weekly repeats. A personal or collective page may offer weekly repeats up to 2 to 12 times, and the visitor picks how many. Every occurrence must be free (all or nothing), and a clash lists the dates that don't work. Each occurrence is its own booking sharing a `series_id`. The guest page offers "Cancel this one" and "Cancel all that are left". Repeats can't be combined with seats, payment or round robin.

Slice 5, paid bookings and channels (designed now, switched on by the owner's accounts):
- **AC-6215**: Paid bookings through Stripe Connect (Standard accounts). An admin connects the workspace's Stripe account in Settings. A page sets a price and currency. The booking is held as `pending_payment` for 15 minutes while the visitor pays in Stripe Checkout; a signed webhook confirms it, and an expired checkout frees the slot. A host cancel refunds in full; a visitor cancel outside the cancel cutoff refunds in full, inside it refunds nothing, and the page says so before paying. Without the Stripe settings the option is hidden and the app boots.
- **AC-6216**: Text message and WhatsApp reminders through Twilio, as reminder channels. They go only when the page asks for a phone number and the visitor ticks consent beside it. STOP is honoured (Twilio Messaging Service opt out). Each workspace has a monthly cap (default 500 messages) and each booking at most 3. Without the Twilio settings the channels are hidden.
- **AC-6217**: Zoom as a location. A member connects Zoom; each booking makes, moves and deletes its own Zoom meeting. Microsoft Teams needs no new integration: the existing video location on a connected Microsoft calendar makes a Teams link and is shown as "Microsoft Teams" by name. Without the Zoom settings, Zoom is hidden.

Across every slice:
- **AC-6218**: Every new screen, card and popup meets spec 0058's alignment, motion, less text, accessibility and delight rules (its AC-1 to AC-4 and AC-21). New settings live inside the editor's existing tabs. Only Stats is a new view. "Powered by Timefix" stays on every public page and email (spec 0058 AC-26).
- **AC-6219**: Every new table is a tenant table with forced row level security and a policy (the guard tests pass). Every host action (confirm, decline, links, stats, email words, payments, Zoom) passes the access door with spec 0037's reach. Public answers never reveal a member's email. Tokens are compared by hash.
- **AC-6220**: Old pages and bookings behave exactly as today until a setting is changed. Defaults equal today's behaviour, and the existing booking flows (`booking-journey`, `booking-edges`, `form-to-booking`, `booking-chat`) pass unchanged.

## Decision

**Chosen option**: Option 2: five slices in value order, each end to end, on today's booking engine, with paid bookings and channels behind optional settings.

Extend the existing page settings, booking states and mail jobs instead of adding a workflow engine. Each slice is a lane that lands on the previous one, and vendor features stay switched off until the owner adds their accounts.

**Implementation skills**: `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `crm-design-system` (`.claude/skills/crm-design-system/`) · `react-email` (`.claude/skills/react-email/`) · `resend` (`.claude/skills/resend/`) · `zod` (`.claude/skills/zod/`) · `security-and-hardening` (`.claude/skills/security-and-hardening/`) · `drizzle` (`.claude/skills/drizzle/`) · `interaction-design` (`.claude/skills/interaction-design/`) · `emil-design-eng` (`.claude/skills/emil-design-eng/`)

## Feature design

**Boundary with spec 0037** (team scheduling, owned by the crm-6a session): fixed hosts, rotations, caps and creating collective pages are 0037 J13. Managed pages and templates are J15. Routing is J16 and J17. No show and its learning are J18. Out of office redirects are 0037 decision 16. This spec adds none of those. It only builds on them: a pending booking's Confirm uses 0037's Manage reach (J4), and seats and repeats apply to personal and collective pages as J13 defines them. See rationale.md.

**Data model sketch** (each slice has its own migration, placeholder numbers, renumbered at the final merge):

`0xxa_booking_flow_rules.sql` (slice 1):
- `booking_pages`: `after_booking jsonb not null default '{"kind":"confirmation"}'` (`{kind:'redirect', url, sendDetails}`), `cancel_notice_minutes int not null default 0`, `move_notice_minutes int not null default 0` (both 0 to 20160), `requires_confirmation boolean not null default false`.
- `bookings`: `status` check admits `pending` and `declined` beside today's values; `decided_at timestamptz`, `decided_by_member_id uuid`, `decline_reason text` (up to 500); `one_off_link_id uuid` (FK). The exclusion constraint's `where` becomes `status in ('confirmed','pending')`, and later `pending_payment`.
- New `booking_page_links`: `workspace_id`, `id`, `page_id` (FK, cascade), `label text` (up to 60), `token_hash text unique`, `max_uses smallint` (1 to 50), `uses smallint default 0`, `expires_at timestamptz`, `revoked_at timestamptz`, `created_by_member_id`, `created_at`. Index on `(workspace_id, page_id)`.

`0xxb_booking_messages.sql` (slice 2):
- `booking_pages`: `reminders jsonb not null default '[{"minutes":1440,"channel":"email"},{"minutes":60,"channel":"email"}]'`, `email_texts jsonb not null default '{}'` (keyed by email kind, `{subject, body}`), `follow_up jsonb` (null is off; `{minutesAfter}`).
- `crm_enqueue_booking_mail` takes the new kinds `requested`, `declined`, `reminder` (with its index, job key `booking:<id>:reminder:<n>`), `follow_up` and `host_new`. The old `reminder_24h` and `reminder_1h` stay readable for jobs already queued.

`0xxc_booking_reach.sql` (slice 3):
- `bookings.source jsonb not null default '{}'`.
- New `booking_page_views` (`workspace_id`, `page_id`, `day date`, `visitor_hash bytea`, unique on all four, kept 90 days) and `booking_page_counts` (`workspace_id`, `page_id`, `day`, `views`, `picks`, `bookings`), the same pattern as `0100_profile_counts.sql`.

`0xxd_booking_capacity.sql` (slice 4):
- `booking_pages_durations` check allows up to 8 entries.
- `booking_pages`: `seats smallint` (null is one visitor; 2 to 100), `show_seats_left boolean default false`, `repeat_max smallint` (null is off; 2 to 12).
- New `booking_seats`: `workspace_id`, `id`, `booking_id` (FK, cascade), `name`, `email`, `time_zone`, `answers jsonb`, `manage_token_hash text unique`, `status` (`confirmed`, `cancelled`), `person_record_id`, `source jsonb`, `created_at`. Unique `(booking_id, lower(email))` while confirmed. On a seated page the `bookings` row is the slot (its visitor fields are the first attendee's) and every attendee, the first included, has a seat row.
- `bookings.series_id uuid` (null unless repeated), index `(workspace_id, series_id)`.

`0xxe_booking_paid_channels.sql` (slice 5):
- `booking_pages`: `price_amount int` (minor units, null is free), `price_currency text` (ISO 4217).
- `bookings`: `status` admits `pending_payment`; `checkout_session_id text unique`, `paid_amount int`, `refund_id text`.
- New `workspace_stripe_accounts` (`workspace_id` unique, `account_id`, `charges_enabled`, `connected_at`), `stripe_events` (`event_id` primary key, `received_at`) for idempotency, `member_zoom_connections` (`workspace_id`, `member_id` unique, encrypted tokens the way calendar tokens are stored), `workspace_message_usage` (`workspace_id`, `month`, `sent`).
- `booking_pages.reminders` channel admits `sms` and `whatsapp`; `BookingLocation` admits `{type:'zoom'}`.

**State transitions** (a booking):
- `confirmed` (today) → `cancelled`.
- `pending` → `confirmed` (Confirm) · `declined` (Decline, or the expiry job).
- `pending_payment` → `confirmed` (paid webhook) · `cancelled` (checkout expired, 15 minutes).
- A seat: `confirmed` → `cancelled`. A booking with seats is cancelled when the host cancels it or its last seat is cancelled.

**API surface** (oRPC unless marked REST):
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `bookingPages.update` (changed) | rpc | the new settings | page view | page editor (as today) | `CONFIG_INVALID`, `VALUE_INVALID` |
| `bookings.confirm` | rpc | `bookingId`, `mutationId` | booking view | assigned host or Manage reach | `NOT_FOUND`, `STALE` (not pending) |
| `bookings.decline` | rpc | `bookingId`, `reason?`, `mutationId` | booking view | same | `NOT_FOUND`, `STALE` |
| `bookingLinks.list` / `create` / `revoke` | rpc | `pageId`, `label?`, `maxUses`, `expiresAt?` | links (create returns the token once) | page editor | `NOT_FOUND`, `VALUE_INVALID` |
| `bookingPages.stats` | rpc | `pageId`, `days` (30) | daily counts, totals, sources | See reach over the page | `NOT_FOUND` |
| `bookingPages.previewEmail` | rpc | `pageId`, `kind`, `subject`, `body` | rendered html and text | page editor | `VALUE_INVALID` |
| `GET /api/public/booking/:publicKey` (changed, REST) | GET | `o?` (one off token hash check) | page facts plus `seatsLeft?`, `repeatMax?`, `price?`, `linkState?` | public | `LINK_USED` |
| `POST /api/public/booking/:publicKey` (changed, REST) | POST | `oneOffToken?`, `source?`, `repeat?`, phone consent | `{ status: 'confirmed' \| 'pending' \| 'payment', redirectUrl?, checkoutUrl? }` | public, existing checks | `SLOT_TAKEN`, `LINK_USED`, `REPEAT_CLASH` (with dates) |
| `POST /api/public/booking/:publicKey/view` (new, REST) | POST | `pick?` | 204 | public, rate limited | none |
| manage cancel and move (changed, REST) | POST | token, `series?: 'one' \| 'rest'` | as today | manage token | `TOO_LATE` |
| `payments.connectStart`, `GET /api/public/stripe/return` | rpc, REST | none | Stripe OAuth address | an admin (`workspace.manage`) | `NOT_CONFIGURED` |
| `POST /api/public/stripe/webhook` (REST) | POST | raw body, `Stripe-Signature` | 200 | Stripe signature | 400 on a bad signature |
| `zoom.connect`, `GET /api/public/zoom/return` | rpc, REST | none | Zoom OAuth address | the member | `NOT_CONFIGURED` |

**Jobs** (Graphile Worker, keyed so a move replaces them):
- `crm_booking_mail` with the new kinds; a `reminder` job reads the page's current reminder list at send time only for the channel and words, never for the time it was queued.
- `crm_booking_pending_expire` keyed `booking:<id>:pending`, at the earlier of 24 hours or 1 hour before the start.
- `crm_booking_payment_expire` keyed `booking:<id>:payment`, 15 minutes.
- `crm_booking_message` (text and WhatsApp), with the monthly cap checked in the same transaction that counts the send.
- `crm_booking_counts` rolls views into `booking_page_counts` nightly and prunes `booking_page_views` past 90 days.

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Redirect | the address and its query values | `booking_pages.after_booking`; `name`, `email`, `start`, `tz` from the booking just committed; `page` is the slug |
| Cutoff check | "now" and the start | the server clock at the request; `bookings.starts_at` |
| Pending expiry time | the earlier of two times | `bookings.created_at + 24h`, `starts_at − 1h` |
| One off link state | uses left, expired | `booking_page_links` row by `token_hash` of the fragment token the page sends |
| Reminder times | offsets | `booking_pages.reminders` at booking or move time |
| Email words | subject and body | `booking_pages.email_texts[kind]`, else the default strings in `packages/emails` |
| `{start}` in an email | the time in the reader's zone | the visitor's `visitor_time_zone` (seat: the seat's `time_zone`); the host's email uses the host's schedule zone |
| Views and conversion | counts | `booking_page_counts`; conversion is bookings over views for the same days |
| Source | UTM and referrer host | the page address, or the parent address the loader passes as `data` in its first message |
| Seats left | number | `seats` minus confirmed seat rows of the slot's booking |
| Price shown | amount and currency | `booking_pages.price_amount`, `price_currency`, formatted with the existing currency helper |
| Refund amount | full or none | cancel time against `cancel_notice_minutes`; full `paid_amount` |
| Zoom link | join address | the Zoom meeting made at booking, stored in `bookings.video_url` as today's video link |

**Key invariants**:
- A slot is held by at most one confirmed, pending or awaiting payment booking per host (the exclusion constraint), and a seated booking holds no more seats than `seats`.
- A one off link never books more than `max_uses` times, even under concurrency (the count is taken under the booking lock).
- The email words can never remove the calendar file, the manage links, the Join button or the footer.
- No vendor feature runs without its settings, and the app boots without them.
- Defaults reproduce today's behaviour.

**Security model**:
- Tenancy: every new table carries `workspace_id`, forced row level security and a policy, and is read through `withWorkspace()`.
- Access: host actions go through the access door with spec 0037 reach (Manage for confirm, decline, links and email words; See for stats).
- Tokens: one off and seat tokens are 32 random bytes, stored as SHA-256, compared by hash, sent only in a URL fragment or an email.
- Stripe: the webhook verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` over the raw body, stores `event.id` first (idempotent), and trusts only the session it made (matching `checkout_session_id` and workspace). The Stripe and Zoom OAuth returns carry a signed state bound to the workspace and member.
- Twilio: consent is stored with the booking; the monthly cap stops abuse; no inbound webhook is needed (the Messaging Service handles STOP).
- Redirects go only to the address the host saved (no open redirect from visitor input). Booking details are sent only when the host turns that on.
- The embed message carries no personal data.
- Vendor SDKs live in one wrapper each (`apps/api/src/payments/stripe.ts`, `apps/api/src/messages/twilio.ts`, `apps/api/src/video/zoom.ts`), named in the API's `vendorWrappers`.

**Configuration required** (all optional; each feature hides itself when its settings are missing):
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`: paid bookings.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WHATSAPP_FROM`: text message and WhatsApp reminders.
- `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`: the Zoom location.

**Lanes and the files each owns** (each lane rebases on the one before it, so shared files change in one order):
| Lane | Slice | New files it owns | Shared files it changes | Waits for |
|---|---|---|---|---|
| L1 Flow rules | 1 | `packages/core/src/booking/{one-off-links,decide}.ts`, `apps/web/src/features/booking/{AfterBookingCard,OneOffLinksCard,PendingActions}.tsx`, migration `0xxa` | `packages/contracts/src/booking/{settings,pages,public}.ts`, `packages/db/src/schema/booking.ts`, `packages/core/src/booking/{engine,change,mail-queue,public}.ts`, `apps/api/src/public/booking.ts`, `apps/api/src/modules/booking/router.ts`, `apps/web/src/features/booking/{PageEditor,LimitsCard,pageDraft,strings}.tsx/ts`, `apps/web/src/public/booking/{BookingPage,ManagePage,strings,refusal}.ts(x)`, `packages/ui/src/public-booking/booking.ts`, `packages/contracts/src/codes.ts` | crm-6a's go on `features/booking`; spec 0058 lanes A and D landed |
| L2 Messages | 2 | `apps/web/src/features/booking/{RemindersCard,EmailWordsDialog}.tsx`, `packages/emails/src/templates/booking-words.ts`, migration `0xxb` | `packages/core/src/booking/{mail,mail-queue}.ts`, `apps/api/src/jobs/booking-mail.ts`, `apps/api/src/mail/booking.ts`, `packages/emails/src/templates/booking.ts`, `packages/contracts/src/emails.ts`, `PageEditor.tsx`, `pageDraft.ts` | L1 |
| L3 Reach | 3 | `apps/web/src/features/booking/{ShareEmbedCard,PageStats}.tsx`, `packages/core/src/booking/counts.ts`, migration `0xxc` | `apps/web/embed/v1.js` (the `booked` message and the parent's address), `apps/web/src/features/forms/snippets.ts` (only if a booking word is missing), `LinksScreen.tsx`, `BookingPage.tsx` (view beacon, source), `apps/api/src/public/booking.ts` | L1 (may run beside L2: different shared files except `public/booking.ts`, merged in order) |
| L4 Capacity | 4 | `packages/core/src/booking/{seats,repeats}.ts`, `apps/web/src/features/booking/CapacityCard.tsx`, migration `0xxd` | `settings.ts` (`BOOKING_DURATIONS_MAX`), `durations.ts`, `engine.ts`, `slots.ts`, `BookingPage.tsx`, `ManagePage.tsx`, `packages/ui/src/public-booking/*` | L2 and L3 |
| L5 Paid and channels | 5 | `apps/api/src/payments/stripe.ts`, `apps/api/src/messages/twilio.ts`, `apps/api/src/video/zoom.ts`, `apps/web/src/features/booking/PriceCard.tsx`, `apps/web/src/features/settings/PaymentsCard.tsx`, migration `0xxe` | `apps/api/src/env.ts` (optional settings), `apps/api/eslint.config.js` (`vendorWrappers`), `settings.ts` (`BookingLocation`), engine, `BookingPage.tsx` | L4; owner's accounts only to switch it on, not to build it |

Every lane touches `apps/web/src/features/booking`, so every lane waits for crm-6a's go and for spec 0058's booking and visitor lanes (A and D) to land. None touches crm-6a's files: `apps/web/src/features/bookings/*`, `packages/ui/src/modules/{TeamWeek,HoursEditor}`, `TeamWeekScreen.tsx`, the roster's CopyWeek and UsualHours modals, or the Bookings tabs. If a lane finds it must, it stops and asks.

**Critical test scenarios**:
- Happy path: book a redirect page, land on the host's address with the details only when switched on, verifies **AC-6201**.
- Failure case: cancel inside the cutoff, refused `TOO_LATE`, host cancel still works, verifies **AC-6202**.
- Concurrency: two visitors race the last use of a one off link, exactly one books, verifies **AC-6204**.
- Concurrency: two visitors race the last seat, exactly one gets it, verifies **AC-6213**.
- Expiry: a pending booking left alone declines itself and frees the slot, verifies **AC-6203**.
- Words: an unknown variable is refused; a body with markup arrives escaped; the calendar file is still attached, verifies **AC-6206**.
- Embed: the parent page receives `timefix:booked` with no name or email, verifies **AC-6209**.
- Stripe: a webhook with a bad signature is refused; the same event twice confirms once, verifies **AC-6215, AC-6219**.
- Access: a member without reach can't confirm, decline or read stats (403), verifies **AC-6219**.
- Regression: the four booking flows pass unchanged with every new setting at its default, verifies **AC-6220**.

## Build plan

Approach: Tracer Bullet. Each slice is thin and end to end (migration, contract, core, API, editor card, public page, email), then the next slice thickens it.

1. L1: migration `0xxa`, settings and status changes, `TOO_LATE`, redirect after booking end to end, satisfies **AC-6201, AC-6202, AC-6220**
2. L1: requires confirmation with Confirm and Decline, the expiry job and its emails, satisfies **AC-6203, AC-6219**
3. L1: one off links (table, tokens in the fragment, the counted use, the list card), satisfies **AC-6204, AC-6219**
4. L2: migration `0xxb`, the reminder list and keyed reminder jobs, keeping old queued jobs, satisfies **AC-6205, AC-6220**
5. L2: email words with variables, preview and reset; the `bookings_new` topic; the follow up email, satisfies **AC-6206, AC-6207, AC-6208**
6. L3: Share card with embed tiles, the `booked` message, satisfies **AC-6209**
7. L3: migration `0xxc`, view beacon, counts job, Links list numbers, Stats view, source capture, satisfies **AC-6210, AC-6211**
8. L4: up to 8 lengths, satisfies **AC-6212**
9. L4: migration `0xxd`, seats end to end, then weekly repeats, satisfies **AC-6213, AC-6214**
10. L5: migration `0xxe`, Stripe Connect behind its settings, then Twilio channels, then Zoom, satisfies **AC-6215, AC-6216, AC-6217**
11. Every lane, before handing back: the spec 0058 design pass (alignment probe, motion, screenshots light and dark), `security-access-reviewer`, `state-performance-reviewer`, `design-system-guardian`, `ux-interaction-reviewer`, satisfies **AC-6218, AC-6219**

## Consequences

**Positive**:
- Booking links reach parity with the common Calendly and Cal.com feature set while keeping Timefix's edge (CRM filing, the visitor's own calendar).
- No new workflow engine to maintain: everything rides on the existing settings, states and jobs.
- Paid bookings, text messages and Zoom are built and tested, ready the day the owner adds accounts.

**Negative / tradeoffs**:
- The booking engine gains states (`pending`, `pending_payment`) and seats, so the slot and lock code grows. The concurrency tests must stay strict.
- Editable email words add a support surface; the kept parts (calendar file, links, footer) limit the damage.
- Five lanes in a strict order take longer than parallel lanes, but they share the same core files.

**Neutral**:
- Five migrations with placeholder numbers, renumbered at the final merge.
- New stable codes: `TOO_LATE`, `LINK_USED`, `REPEAT_CLASH`, `NOT_CONFIGURED`.

## Follow-up

- [ ] Owner: a Stripe account with Connect enabled and its three keys; a Twilio account with a Messaging Service (and a WhatsApp sender approved by Meta); a Zoom Marketplace OAuth app. Until then slice 5 ships hidden.
- [ ] Meeting polls (Calendly style "find a time" across options): later.
- [ ] Workflow style automations beyond reminders and the follow up (for example "on no show, send…"): after spec 0037 J18 lands No show learning.
- [ ] Per page conflict calendar choice: not planned; spec 0024 and 0037 AC-1313 already union every member's conflict calendars.
- [ ] The booking page editor's tabs grow: run `subtractive-design` at the end of L5 and fold anything that crept in.

## Rationale

Short pointer: see [rationale.md](rationale.md) for the context, options, the boundary with spec 0037 and every choice made without asking.
