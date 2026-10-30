# 0062 rationale: Booking link features

## Context

The 31 October 2026 audit of booking links found a strong core (round robin, limits, questions filed into the CRM, the visitor's own calendar overlay, a guest page, reminders) and a list of features every scheduling tool now has: a redirect after booking, cancel cutoffs, bookings that need approval, one off links, custom reminder times and email words, an embed, analytics, more lengths, group bookings, repeats, paid bookings, text reminders and Zoom. Spec 0025 named paid bookings and group events as "later" (its Follow-up), and `/b/:key` was frozen, which blocked the visitor side changes.

On 31 October the owner said to do everything the industry standard way and to decide without asking, with one exception: "Powered by Timefix" stays. That lifts the `/b/:key` freeze for these features. Other sessions are active: crm-6a owns team scheduling (spec 0037) and its files until its lanes freeze, every session now carries placeholder migration numbers renumbered at the final merge, and the owner deploys everything together at the end.

What already exists and is reused: page settings in `packages/contracts/src/booking/settings.ts`, the booking engine and mail queue in `packages/core/src/booking/` (`BOOKING_MAIL_KINDS` with `reminder_24h` and `reminder_1h`), the `crm_booking_mail` task, the manage token pattern (SHA-256 hash), the forms `RedirectUrl` rule, the forms and booking embed loader (`apps/web/embed/v1.js` already takes `data-timefix-booking`), `embedSnippet` with `kind: 'booking'`, the link page's privacy friendly counts (`0100_profile_counts.sql`), the email topics list, the vendor wrapper lint rule, and a Content Security Policy that already lets anyone frame `/b/:publicKey`.

## Options considered

### Option 1: A workflow engine (Cal.com Workflows style)

Triggers (booked, cancelled, before start, after end) with actions (email, text, webhook), built once, with reminders and follow ups as workflows.

**Pros**:
- One general model for every future automation.
- Matches Cal.com's paid tier.

**Cons**:
- A large new subsystem before any visible value.
- Most hosts only want "remind me at these times" and "send a thank you".
- Overlaps spec 0037 J18's outcomes work and the forms follow ups.

### Option 2: Five slices on today's engine, vendor features behind optional settings

Extend the page settings, booking states and keyed mail jobs. Order the slices by value. Build paid bookings, text messages and Zoom now but keep them hidden until the owner adds accounts.

**Pros**:
- Each slice ships something a host can see.
- Reuses the engine, jobs, tokens, embed loader and counts that already work.
- Defaults equal today, so nothing changes for anyone who doesn't opt in.

**Cons**:
- Lanes must run in order because they share core files.
- Automations beyond reminders wait for later.

### Option 3: Visitor polish only, features later

Keep the frozen behaviour and only restyle.

**Pros**:
- No risk.

**Cons**:
- The owner explicitly asked for the industry standard features.

## Rationale

Option 2 gives hosts the features they ask for soonest, on code that is already tested, and keeps the riskiest parts (money and text messages) behind settings that only the owner can switch on. A workflow engine is the right shape later, once No show learning (spec 0037 J18) and form follow ups give it more than two triggers; until then it would be weight without users.

### Boundary with spec 0037

Spec 0037 (team scheduling and access, on `wip/specs-teamsched`, built by the crm-6a session) already plans:
- **J13 Round robin beyond**: fixed hosts plus up to 3 rotations, Even, weekly caps, team rotations, last host, adjustments, Distribution. Making a collective page is a page with fixed hosts and no rotation, so "collective as a creatable kind" belongs to J13 and is left out of 0062.
- **J15 Managed booking pages**: templates, member pages, locks and propagation. Left out of 0062.
- **J16 and J17 Routing**: routing forms, CRM facts, ranking, form leads. 0062 adds no routing.
- **J18 Outcomes**: No show and its learning. 0062's follow up email only reads the existing no show mark.
- **Decision 16**: out of office redirects on a personal page. Left to 0037 now that the freeze is lifted.
- **J4 reach**: 0062 uses Manage and See reach for confirm, decline, links, words and stats, and does not add permissions.

0062 builds on 0037 in two places: Confirm and Decline follow 0037's reach, and seats and repeats apply to personal pages and to collective pages as J13 defines them (never round robin in this release). If crm-6a's map of what is left moves any of these, this section follows it.

### Choices made without asking (industry standard)

- **Redirect after booking**: Calendly and Cal.com both offer it, with booking details passed only on request. Details are off by default because an email address in a query string reaches a third party's logs.
- **Cutoffs**: Calendly and SavvyCal let hosts block late cancels and moves. One window each, 0 to 14 days, matching the existing minimum notice range. The guest is pointed to reply to their email, which reaches the host.
- **Requires confirmation**: Cal.com's model. A pending booking holds its slot (Cal.com's default), so two people can't request the same time. Auto decline at 24 hours, or 1 hour before the start, so no visitor waits forever.
- **One off links**: Calendly's single use links and Cal.com's private links, merged: uses (1 to 50) and an optional expiry. The token rides in the URL fragment so servers, logs and Referer headers never see it.
- **Reminders**: up to 3, any offset from 10 minutes to 7 days, matching what Calendly offers on paid plans. Changes apply to new and moved bookings only, as Cal.com workflows do, so a host editing a page never reschedules hundreds of jobs.
- **Email words**: plain text with a closed set of variables, never HTML, so a host can't break the layout or inject markup. The calendar file, links and footer are fixed parts, as in Calendly's editor.
- **Host new booking email as a topic**: the existing email preferences page is where members already turn emails off.
- **Embed**: the loader already supports booking pages; only the UI and a `booked` event were missing. The event carries no personal data, unlike Calendly's which exposes invitee URIs, because a parent site doesn't need them.
- **Analytics**: the link page's cookie free daily counting, so no consent banner is needed. Cal.com and Calendly show views and bookings per event type.
- **UTM capture**: Calendly passes UTM values onto the invitee and into integrations; here they land on the booking and the person's timeline, where a CRM user looks.
- **8 lengths**: Cal.com allows many; 8 keeps the picker readable with segments for 4 and a Select past that.
- **Seats as one booking with seat rows**: Cal.com's seats model. It keeps the exclusion constraint (one booking per host per slot) intact and lets each attendee manage only their own seat. Attendees never see each other, which is Cal.com's "hide attendees" default for privacy.
- **Repeats all or nothing**: Cal.com books every occurrence or none. Listing the clashing dates tells the visitor exactly what to change.
- **Stripe Connect Standard**: the standard way to let hosts get paid into their own account (Calendly and Cal.com both use Stripe). Standard accounts leave compliance and payouts with Stripe. The owner's own SaaS billing is a separate decision (Paddle or Lemon Squeezy) and does not use this.
- **Twilio for text and WhatsApp**: the default for scheduling tools (Cal.com and Calendly both use it), one vendor for both channels, and its Messaging Service handles STOP and opt out by law without our own inbound endpoint.
- **Zoom by OAuth, Teams through the Microsoft calendar**: Cal.com and Calendly connect Zoom per member. Teams links come from Microsoft Graph when the host's Outlook calendar is connected, so no second Microsoft integration is needed.
- **Left out on purpose**: per page conflict calendars (already the union of a member's conflict calendars), a separate "minimum gap" (the buffers already do it), meeting polls (later).

## References

**Project sources**:
- Spec 0025 (booking pages, its "later" list), 0028 (visitor calendar), 0029 (round robin), 0035 (schedules), 0042 (booking chat), 0057 (booking questions), 0058 (visual and short), 0037 on `wip/specs-teamsched`
- `packages/contracts/src/booking/settings.ts`, `packages/core/src/booking/mail-queue.ts`, `packages/db/src/schema/booking.ts`, `apps/web/embed/v1.js`, `apps/web/src/features/forms/snippets.ts`, `apps/web/csp.test.ts`, `packages/config/eslint.js` (vendor wrappers)
- The 31 October 2026 booking audit (this session)

**Practices & standards**:
- Webhook signature verification over the raw body and event id idempotency (Stripe's documented practice)
- Secrets in URL fragments, not query strings, to keep them out of logs and Referer headers
- Cookie free, hashed daily visitor counts for analytics without consent banners
- Explicit opt in consent for text messages, with STOP handling (TCPA and similar rules)
