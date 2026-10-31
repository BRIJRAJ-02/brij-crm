# 0064. Public pages platform: custom domains, several link pages, webhooks, pixels and visitor language

**Date**: 2026-10-31
**Status**: Proposed

**Numbering**: 0064 is claimed with 0060 to 0063 by the links, booking and forms session (31 Oct 2026). This spec owns AC-6401 to AC-6499. Migrations carry placeholder numbers (`0xxa` to `0xxe`) and are renumbered after main's last migration at the final merge, as every chat agreed on 31 Oct.

## Summary

This is Phase 6 of the links, booking and forms plan, the platform layer under the public pages. You can put your link page, booking pages and forms on your own domain, with the DNS records shown plainly and the secure lock set up for you. You can run more than one link page, for example one for work and one for a side project. Bookings, form submissions and link page signups can be sent to your own systems (and to Zapier, Make or n8n) as signed webhooks, retried if your server is down. You can add your Google Analytics or Meta Pixel ID, and it loads only after a visitor agrees. Visitors read the pages in their own language. "Powered by Timefix" stays on every page.

Reasoning and the calls taken on the owner's behalf: [rationale.md](rationale.md). Checks: [verify.md](verify.md).

## Requirements

**User stories**:
- As a coach, I want my link page at `book.janedoe.com` so my own brand is what people see and share.
- As a person with a day job and a side project, I want two link pages, each with its own handle, look and numbers.
- As an admin, I want a new booking or form submission sent to our own system the moment it happens, signed so we know it came from Timefix.
- As a marketer, I want my Google Analytics and Meta Pixel to count visits and bookings, without breaking privacy law.
- As a visitor in Madrid, I want the booking page in Spanish without hunting for a switch.

**Acceptance criteria**

*Custom domains (slice 1)*
- **AC-6401**: In a link page's Sharing card, the owner can add one domain per link page (an apex like `janedoe.com` or a subdomain like `book.janedoe.com`). The host is normalised (lowercase, punycode, no port, no path) and refused, with a one line reason, if it is malformed, an IP address, or under one of our own hosts (`timefix.com`, `timefix.ai`, the app's host, the public origin's host, `vercel.app`).
- **AC-6402**: After adding, the owner sees the exact DNS records to set as a small table with a Copy button on every value: one TXT record `_timefix.<host>` holding a per domain token (proof of ownership), plus the records the host needs, taken from what Vercel's API returns for that domain (a CNAME for a subdomain, an A record for an apex). When Vercel asks for its own `_vercel` TXT record (the domain is in use on another Vercel account), that record is shown too.
- **AC-6403**: Status reads as one of four plain states with an icon: Waiting for records, Checking, Live (with a lock), Needs attention (with one line saying what is wrong, for example "The CNAME points somewhere else"). A Check now button runs a check at once (at most once every 10 seconds). Checks also run by themselves every 15 minutes while a domain is not Live, and once a day while it is Live.
- **AC-6404**: The domain is added to the Vercel project only after the TXT token is found, and it serves pages only once Vercel reports it configured. Vercel issues and renews the TLS certificate. An unverified, removed or unknown host answers our plain not found page and never shows anyone's content.
- **AC-6405**: When an apex is added, `www.<apex>` is added beside it and redirects (308) to the apex. A subdomain gets no extra host.
- **AC-6406**: On a Live domain, `/` is the link page, `/<slug>` is that person's booking page with that slug, and `/b/:key`, `/f/:key`, `/embed/`, `/api/public/` and the built files work exactly as on `timefix.com`. Every other path (sign in, the app, settings) answers not found on a custom domain.
- **AC-6407**: Once Live, the page's canonical URL, `og:url` and the share card point at the custom domain. `timefix.com/<handle>` keeps working with no redirect (shared links never break) and its canonical points at the custom domain. Links the owner copies in the app (Share, QR, Ready panel) use the custom domain. Emails and calendar files keep the `timefix.com` address, which always works.
- **AC-6408**: Removing a domain asks first in a Modal (one line, two buttons), removes it from the Vercel project at once, and frees the host. A domain pending for 7 days without its TXT token is marked failed with a Try again button. One host can be bound to one link page only; a second claim of a Live host is refused with "That domain is already in use."
- **AC-6409**: The feature is hidden, and the app still boots, when the Vercel domain settings are unset (`VERCEL_DOMAINS_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`). Every Vercel call goes through one wrapper module.

*Several link pages (slice 2)*
- **AC-6413**: A person can have up to 5 link pages in one workspace, each with its own handle, private name (for example "Side project"), look, blocks, search setting, share image, domain and numbers. The handle rules of spec 0056 hold (unique everywhere, at most 20 handles per person in all, an old handle still finds its page).
- **AC-6414**: The link page screen shows a page switcher at the top (the pages as tiles with name, handle and a small thumbnail) and a New link page tile, which asks only for a handle and a name and opens the new page with the 0058 Ready panel.
- **AC-6415**: The first page is the primary page: Home's link page card and the first run show it, and a small line says "2 more pages" with a link to the switcher. The owner can make another page primary.
- **AC-6416**: Deleting a link page asks first in a Modal, keeps its handle reserved to the person (spec 0056), and never deletes the primary page while it is the only one.
- **AC-6417**: Views, presses and every number shown are per page. Existing data moves to the person's existing page in each workspace with no change to what any visitor sees.

*Webhooks (slice 3)*
- **AC-6419**: Settings › Webhooks (owners and admins, the existing `webhooks.manage` power) lists endpoints with their URL, the events they get, a status dot and the last delivery. Add endpoint asks for an https URL, a short description, and the events as chips: `booking.created`, `booking.rescheduled`, `booking.cancelled`, `booking.no_show`, `form.submitted`, `link_page.signup`. At most 10 endpoints per workspace.
- **AC-6420**: Each endpoint has a signing secret (`whsec_` plus 32 random bytes in base64url), shown once at creation with Copy, then only as its last 4 characters. Rotate secret asks first in a Modal and keeps the old secret valid for 24 hours, during which both signatures are sent.
- **AC-6421**: Every delivery is a POST with a JSON body `{ id, type, created_at, workspace_id, data }` and the headers `Timefix-Event-Id`, `Timefix-Event-Type`, `Timefix-Delivery-Attempt`, `User-Agent: Timefix-Webhooks/1`, and `Timefix-Signature: t=<unix seconds>,v1=<hex HMAC SHA256 of "<t>.<raw body>">`. The event id is stable across retries, so a receiver can drop duplicates.
- **AC-6422**: An event is queued in the same database transaction as the write that caused it, so a delivery never describes a change that rolled back and never misses one that committed. Writes never wait for a delivery.
- **AC-6423**: A delivery succeeds on any 2xx within 10 seconds. Anything else is retried after about 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours (with jitter), then marked gave up. No redirect is followed. After 3 days with every delivery failing, the endpoint is turned off and the workspace's owners and admins get an email and an in app notice; turning it back on is one switch.
- **AC-6424**: Targets are safe: https on port 443 only, no IP literal hosts, and the host's addresses are resolved and checked at every send (loopback, private, link local, carrier grade NAT, multicast, the cloud metadata address and their IPv6 forms are refused). The connection goes to the checked address, so a DNS change between check and send cannot reach an inside address.
- **AC-6425**: Each endpoint has a delivery log (newest first, 30 days): event, status code, time taken, attempt, and the first 1 KB of the response, with a Resend button. A Send test event button sends a `ping` event at once and shows the result inline.
- **AC-6426**: Payloads hold what a receiver needs and nothing more: for bookings, the booking id, page, host, start and end in UTC with the time zone, location kind, status, the invitee's name, email and answers; for forms, the submission id, form, answers by question key, and source details (UTM, referrer); for signups, the email and the link page handle. No secrets, tokens or internal ids beyond the ones named. Each body is at most 64 KB.

*Analytics pixels and consent (slice 4)*
- **AC-6431**: The owner can add a Google Analytics 4 measurement ID (`G-` plus letters and digits) and a Meta Pixel ID (digits) to a link page. Admins can add the same two for the workspace's booking pages and forms, in Settings › Public pages. Bad formats are refused with a one line hint.
- **AC-6432**: When a page has a pixel, a small consent bar shows at the bottom with Allow and Decline as equal buttons and an optional link to the owner's privacy page. No pixel script loads and no pixel request is sent before Allow. The choice is remembered on that site for 6 months and can be changed from a small Cookie settings link beside "Powered by Timefix".
- **AC-6433**: After Allow, the page sends a page view, and these events: a link press (`click` with the link title) on the link page, a confirmed booking (`Schedule` for Meta, `book_meeting` for GA4) and a sent form (`Lead` for Meta, `generate_lead` for GA4). Google's consent mode starts as denied and is updated only on Allow.
- **AC-6434**: The Content Security Policy allows the pixel origins only on public page paths (handle pages, `/b/`, `/f/`), never on app pages, and lists them exactly (see Feature design). A test fails if an app page's policy gains any of them.

*Visitor language (slice 5)*
- **AC-6437**: A link page and a booking page each have a Language setting: Automatic (the default) or one of the languages forms speak today (`en`, `es`, `fr`, `de`, `pt`, `it`, `nl`, `hi`). Automatic picks the visitor's first browser language that is supported, else English.
- **AC-6438**: Every word a visitor reads on the link page, the booking page, the manage page, the consent bar and the not found pages comes from a per language catalogue with English for any missing line. Dates, times, weekdays and numbers use `Intl` with that language, and the page's `lang` attribute is set.
- **AC-6439**: The language a visitor booked in is stored on the booking, and the visitor's confirmation, reminder, change and cancel emails use it. The host's emails stay in the host's own language.
- **AC-6440**: Only the chosen language's catalogue is loaded (English is in the main bundle, others load on demand), and the public pages stay inside the first load size budget (`pnpm size`).

*Quality and brand (all slices)*
- **AC-6442**: Every new screen, popup, tile and bar meets spec 0058's rules: AC-1 alignment, AC-2 motion, AC-3 less text, AC-4 accessibility and AC-21 delight (for example a Live domain gets one short success check and a lock).
- **AC-6443**: "Powered by Timefix" stays on every public page on every domain (owner, 31 Oct), aligned at the foot of the page as spec 0058 AC-26 sets.

## Decision

**Chosen option**: Option 1 for each slice, recorded in [rationale.md](rationale.md): Vercel's Domains API on our existing project with our own TXT ownership proof; link pages keyed by their own id; Stripe style signed webhooks queued in the write's transaction and delivered by Graphile Worker; GA4 and Meta loaded only after consent with a static policy on public paths; per language catalogues with English fallback.

**Implementation skills**: `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-design-system` (`.claude/skills/crm-design-system/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `security-and-hardening` (`.claude/skills/security-and-hardening/`) · `zod` (`.claude/skills/zod/`) · `vitest` (`.claude/skills/vitest/`) · `turborepo` (`.claude/skills/turborepo/`) · `interaction-design` (`.claude/skills/interaction-design/`)

## Feature design

**Data model sketch** (placeholder migration numbers, renumbered at merge):

`0xxa_several_link_pages` (slice 2, lands first because slice 1 points at a page):
| Table | Change |
|---|---|
| `auth.public_profiles` | gains `id uuid` (new primary key, backfilled), `name text not null default ''` (at most 40 characters, private), `is_primary boolean not null default false`, `position smallint`. The (`user_id`, `workspace_id`) primary key becomes an index. A partial unique index keeps one primary page per (`user_id`, `workspace_id`). A check plus the write path keep at most 5 pages per (`user_id`, `workspace_id`). |
| `auth.profile_items` | gains `profile_id uuid not null` (backfilled from the person's page in that workspace), with a foreign key to `public_profiles(id)` on delete cascade. The "once" unique indexes move from (`user_id`, `workspace_id`, ...) to (`profile_id`, ...). |
| `auth.profile_views`, `auth.profile_item_presses`, `auth.profile_view_days`, `auth.profile_item_press_days` | gain `profile_id`, backfilled, and become keyed by it. |
| `auth.public_handles` | gains `profile_id uuid` (nullable for released handles), so each handle finds its page. |

Safe sequence: add the columns nullable, backfill, add the constraints and keys, then switch reads and writes. Existing pages become their person's primary page.

`0xxb_public_domains` (slice 1):
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | primary key |
| `host` | text not null | lowercase punycode, unique among rows not removed |
| `profile_id` | uuid not null | the link page it serves; one active domain per page |
| `user_id`, `workspace_id` | uuid not null | the owner, for access checks |
| `kind` | text | `apex` or `subdomain` |
| `status` | text | `waiting`, `checking`, `live`, `attention`, `failed`, `removed` |
| `verify_token` | text not null | 32 random hex characters, shown in the TXT record |
| `dns_records` | jsonb | the records Vercel asked for, as last read |
| `verified_at`, `live_at`, `last_checked_at`, `removed_at` | timestamptz | |
| `problem` | text | the one line shown in Needs attention |
| `created_at`, `updated_at` | timestamptz | |

`0xxc_webhooks` (slice 3, workspace tenant tables with forced row level security and a policy, like every tenant table):
| Table | Key columns |
|---|---|
| `webhook_endpoints` | `id`, `workspace_id`, `url`, `description` (at most 120 characters), `events text[]`, `secret_sealed bytea`, `previous_secret_sealed bytea`, `previous_secret_until timestamptz`, `status` (`active`, `off`), `off_reason`, `failing_since timestamptz`, `created_by_member_id`, timestamps |
| `webhook_deliveries` | `id`, `workspace_id`, `endpoint_id`, `event_id uuid`, `event_type`, `payload jsonb` (at most 64 KB), `attempt smallint`, `state` (`pending`, `sent`, `failed`, `gave_up`), `response_status`, `response_ms`, `response_excerpt` (at most 1 KB), `next_attempt_at`, `created_at`, `sent_at`. Index on (`endpoint_id`, `created_at desc`). Rows older than 30 days are deleted by the daily cleanup. |

`0xxd_public_tracking` (slice 4): `public_tracking` with `workspace_id`, `profile_id` (null for the workspace's booking pages and forms), `ga4_id`, `meta_pixel_id`, `privacy_url`, timestamps. Unique on (`workspace_id`, `profile_id`) with nulls not distinct. Checks: `ga4_id ~ '^G-[A-Z0-9]{4,16}$'`, `meta_pixel_id ~ '^[0-9]{8,20}$'`, `privacy_url` https only.

`0xxe_visitor_language` (slice 5): `auth.public_profiles.language` and `booking_pages.language` (`auto` or a `FORM_LANGUAGES` value, default `auto`), and `bookings.visitor_language` (nullable, a `FORM_LANGUAGES` value).

**How a custom domain request is served**:
1. `middleware.ts` sees a host that is not the app's, the public origin's, or a Vercel preview host. For `/` and `/<slug>` it rewrites to `/api/handle?host=<host>&slug=<slug>`. `/b/`, `/f/`, `/embed/`, `/api/public/` and the built files pass on unchanged. Anything else rewrites to the not found shell. The middleware still imports nothing but `@vercel/functions` (its test enforces that).
2. `handle-shell.ts` resolves the host through `GET /api/public/domains/:host` (an answer cached at the edge for 60 seconds), which returns the page's handle only when the domain is `live`. A miss answers the plain not found shell, as AC-5504 already does for a missing handle.
3. The shell renders as for `/<handle>`, with the custom domain as the origin in `handle-meta.ts` for canonical, `og:url` and the share card.

**API surface** (oRPC procedures unless marked public):
| Procedure | Auth | Inputs | Outputs | Key errors |
|---|---|---|---|---|
| `domains.add` | page owner | `profileId`, `host` | domain with records and status | `CONFIG_INVALID` (bad or our own host), `CONFLICT` (in use), `RATE_LIMITED` (10 adds a day per person) |
| `domains.check` | page owner | `domainId` | domain | `RATE_LIMITED` (10 seconds) |
| `domains.remove` | page owner | `domainId` | ok | `NOT_FOUND` |
| `domains.get` | page owner | `profileId` | domain or none | |
| public `GET /api/public/domains/:host` | none | host | `{ handle }` when live | 404 otherwise, same body for every miss |
| `profile.pages.list`, `profile.pages.create`, `profile.pages.rename`, `profile.pages.setPrimary`, `profile.pages.delete` | the person | `profileId`, `handle`, `name` | pages | `CONFIG_INVALID` (limit of 5), `CONFLICT` (handle taken) |
| Existing `profile.*` reads and writes | the person | gain `profileId` | unchanged shapes | |
| `webhooks.list`, `webhooks.create`, `webhooks.update`, `webhooks.rotateSecret`, `webhooks.delete`, `webhooks.test`, `webhooks.deliveries`, `webhooks.resend` | `webhooks.manage` | endpoint fields, `endpointId`, `deliveryId` | endpoints (secret only on create and rotate), deliveries | `CONFIG_INVALID` (not https, port, IP literal, private address), `RATE_LIMITED` (test and resend 10 a minute per endpoint) |
| `tracking.get`, `tracking.set` | page owner for a link page, admin for the workspace | `profileId` or none, IDs, privacy URL | settings | `CONFIG_INVALID` |
| Public reads of the link page, booking page and form | none | unchanged | gain `tracking` (`ga4Id`, `metaPixelId`, `privacyUrl`) and `language` | |

**Jobs** (Graphile Worker, run by the drain on Vercel per spec 0045):
- `domains_check`: per domain; TXT lookup through `node:dns/promises`, then Vercel's domain and config reads; reschedules itself every 15 minutes while not live (until 7 days, then `failed`) and daily while live.
- `webhook_deliver`: one per (event, endpoint), keyed by `event_id` and `endpoint_id` so it is queued once; sends, records the delivery, and on failure queues the next attempt at the next backoff step.
- On brij-crm (Vercel Hobby) a job due later runs on the next drain turn, which can be up to about an hour late when nobody uses the app (spec 0045). Retries can therefore run late there; on Timefix the 15 minute cron keeps them close to schedule.

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Show DNS records | CNAME or A values, `_vercel` TXT | Vercel's project domain and domain config reads, stored in `dns_records` |
| Show TXT record | token | `public_domains.verify_token`, made on add |
| Serve a custom host | which page | `public_domains` (`live`) to `profile_id` to `public_profiles.handle` |
| Canonical and share links | origin | `https://<host>` of the page's live domain, else `BOOKING_PUBLIC_ORIGIN` |
| Webhook signature | secret, timestamp | the endpoint's sealed secret opened with `WEBHOOK_SECRET_KEY`; the send time in Unix seconds |
| Webhook event id | id | a UUID v7 made when the event is queued, stored on every delivery of it |
| Booking payload | invitee, times, answers | the booking row and its answers in the same transaction |
| Form payload | answers, source | the submission row (answers by question key, UTM, referrer) |
| Signup payload | email, handle | the signup form submission and the link page it came from |
| Pixel IDs on a page | ids | `public_tracking` for that page, else the workspace row for booking pages and forms |
| Visitor language | language | `language` on the page; `auto` resolves from `navigator.languages`; stored on the booking as `visitor_language` |
| Email language | language | `bookings.visitor_language`, else English |

**Key invariants**:
- A host serves content only when its row is `live`. Every miss reads the same.
- One live domain per host and per link page.
- At most 5 link pages per person per workspace, exactly one primary.
- A webhook delivery exists only for an event whose write committed; each (event, endpoint) is queued once.
- No pixel script or request before consent. Pixel origins never appear on app pages.
- Every visitor string has an English line.

**Security model**:
- Domains: only the page's owner manages its domain. Ownership is proved by the TXT token before the host is bound or added to Vercel, so nobody can point someone else's domain at their page or hijack a host left pointing at Vercel. Removing a domain removes it from the Vercel project at once, so no stale record serves another page.
- Webhooks: `webhooks.manage` only. Secrets are sealed at rest with `WEBHOOK_SECRET_KEY` (32 bytes, the pattern of `CALENDAR_TOKEN_KEY`), shown once, never logged. Targets pass the address checks of AC-6424 at add time and at every send. Payloads carry personal data (invitee name, email, answers), so the endpoint list and log are admin only and the log keeps 30 days.
- Pixels: privacy law (GDPR, ePrivacy, CCPA) is handled by consent before load and equal Allow and Decline. The owner is the controller for their pixels; the settings line says so in one line.
- Rate limits as in the API table. Public domain reads are cached and answer one shape for every miss.

**Configuration required** (all optional; each feature is hidden when its settings are unset):
- `VERCEL_DOMAINS_TOKEN`: a Vercel access token scoped to the project's team, for the Domains API.
- `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`: which project custom domains are added to (one per production).
- `WEBHOOK_SECRET_KEY`: 32 bytes in base64, to seal webhook secrets.

**Content Security Policy additions, public page paths only** (handle pages, `/b/`, `/f/`):
- `script-src`: `https://www.googletagmanager.com` `https://connect.facebook.net`
- `connect-src`: `https://*.google-analytics.com` `https://*.analytics.google.com` `https://*.googletagmanager.com` `https://www.facebook.com`
- `img-src`: `https://*.google-analytics.com` `https://*.googletagmanager.com` `https://www.facebook.com`

The lane checks these against the vendors' current CSP guidance before shipping and records the date checked in the test.

**Observability**:
- Logs: `domains.check` (host, status, problem), `webhooks.delivery` (endpoint id, event type, status code, ms, attempt; never the body or secret), `webhooks.endpoint_off`. Sentry for anything unexpected.
- The operator console (spec 0047) shows counts of domains by status and deliveries failing in the last day.

**Lanes** (each owns its files; lane branches never edit `docs/specs/`):
| Lane | Owns | Delivers | Waits for |
|---|---|---|---|
| P1 Several link pages | `packages/db/src/schema/auth.ts` (profile tables), migration `0xxa`, `packages/contracts/src/profile.ts` and `booking/link-page.ts`, `apps/api/src/modules/profile/`, the public link page read in `apps/api/src/public/`, `apps/web/src/features/link-page/` page switcher | AC-6413 to 6417 | spec 0058 Lane C landed (it owns link page files today) |
| P2 Custom domains | migration `0xxb`, `packages/db/src/schema/domains.ts` (new), `packages/contracts/src/domains.ts`, `packages/core/src/domains/` (host rules, status), `apps/api/src/vendors/vercel-domains.ts` (the one Vercel wrapper), `apps/api/src/modules/domains/`, `apps/api/src/public/domains.ts`, `apps/api/src/jobs/domains-check.ts`, `apps/web/middleware.ts`, `handle-shell.ts`, `handle-meta.ts` and their tests, `apps/web/src/features/link-page/DomainCard.tsx` | AC-6401 to 6409 | P1 |
| P3 Webhooks | migration `0xxc`, `packages/db/src/schema/webhooks.ts`, `packages/contracts/src/webhooks.ts`, `packages/core/src/webhooks/` (payloads, signing, address rules), `apps/api/src/jobs/webhook-deliver.ts`, `apps/api/src/modules/webhooks/`, `apps/web/src/features/settings/WebhooksScreen.tsx`, route `w.$slug.settings.webhooks.tsx`, plus one enqueue call each in the booking and form write paths in `packages/core` | AC-6419 to 6426 | crm-6a's go for the booking write path lines |
| P4 Pixels and consent | migration `0xxd`, `packages/contracts/src/tracking.ts`, `apps/api/src/modules/tracking/`, the public reads' `tracking` field, `apps/web/vercel.json` CSP and `csp.test.ts`, `apps/web/src/public/tracking/` (loader, consent bar), `packages/ui` consent bar molecule, `features/settings/PublicPagesScreen.tsx`, a Tracking card in `features/link-page/` | AC-6431 to 6434 | P1 |
| P5 Visitor language | migration `0xxe`, visitor catalogues in `packages/contracts/src/booking/visitor-strings/`, `apps/web/src/public/booking/strings.ts`, `packages/emails/src/templates/booking.ts`, the Language field on the link page and booking page editors | AC-6437 to 6440 | spec 0058 Lane D landed; the booking page editor field waits for crm-6a to free `features/booking` |

Every lane also meets AC-6442 and AC-6443 and owns the tests beside its files. Lanes avoid `apps/web/src/features/booking`, `features/bookings`, `TeamWeek` and `HoursEditor` unless crm-6a says they are free.

**Critical test scenarios**:
- Happy path: add `book.example.test`, publish the TXT and CNAME in a fake resolver and a fake Vercel client, the job marks it live, and `/` on that host renders the page with its canonical, verifies **AC-6402 to AC-6407**.
- Failure case: a host with no TXT stays waiting and serves not found; after 7 days it is failed, verifies **AC-6404, AC-6408**.
- Security: a second person adding a live host gets `CONFLICT`; an unknown host gets the same not found as a missing handle, verifies **AC-6404, AC-6408**.
- Happy path: a booking creates one delivery, the receiver checks the signature with the shown secret, verifies **AC-6421, AC-6422**.
- Failure case: a receiver answering 500 sees retries at the backoff steps and a gave up state; a rolled back booking queues nothing, verifies **AC-6422, AC-6423**.
- Security: endpoints at `http://`, `https://10.0.0.5`, a host resolving to `169.254.169.254`, and a host that resolves public on add then private on send are all refused, verifies **AC-6424**.
- Auth: a member without `webhooks.manage` is refused every `webhooks.*` call, verifies **AC-6419**.
- Privacy: with a pixel set and no consent, the network log shows no request to Google or Meta; after Allow it does, verifies **AC-6432, AC-6433**.
- Guard: no app page's CSP lists a pixel origin, verifies **AC-6434**.
- Language: a browser set to Spanish sees the booking page and its emails in Spanish; a missing line falls back to English, verifies **AC-6437 to AC-6439**.
- Migration: existing link pages, items, views and presses read the same after `0xxa`, verifies **AC-6417**.
- Tenancy: the guard tests prove the new tenant tables force row level security and a cross workspace read returns nothing.

## Build plan

Approach: Tracer Bullet, one slice at a time end to end. Slices 3 and 5 can run beside 1 and 2 because they touch different files.

1. P1: migration `0xxa` with the safe sequence and backfill, then `profileId` through contracts, API and the public read, satisfies **AC-6417**
2. P1: page switcher, New link page tile with the Ready panel, primary page, delete, limit of 5, satisfies **AC-6413 to AC-6416, AC-6442**
3. P3 (beside P1): migration `0xxc`, address rules and signing in core with unit tests, satisfies **AC-6421, AC-6424**
4. P3: enqueue in the booking and form write transactions, the `webhook_deliver` job with backoff and turning off, satisfies **AC-6422, AC-6423, AC-6426**
5. P3: Settings › Webhooks screen, secret shown once, rotation, delivery log, test and resend, satisfies **AC-6419, AC-6420, AC-6425, AC-6442**
6. P2: migration `0xxb`, host rules in core, the Vercel wrapper, `domains.*` procedures and the `domains_check` job, satisfies **AC-6401, AC-6402, AC-6404, AC-6405, AC-6408, AC-6409**
7. P2: middleware routing, the domain read, shell and meta with the custom origin, copy links on the custom domain, satisfies **AC-6406, AC-6407**
8. P2: Domain card with records table, Copy buttons, status states and Check now, satisfies **AC-6402, AC-6403, AC-6442**
9. P4: migration `0xxd`, settings, CSP on public paths and its guard test, consent bar, loader and events, satisfies **AC-6431 to AC-6434, AC-6442, AC-6443**
10. P5: migration `0xxe`, catalogues with English fallback and lazy loading, `Intl` formatting, `lang`, emails in the visitor's language, the Language fields, satisfies **AC-6437 to AC-6440**
11. Verify pass across all slices with screenshots in light and dark, satisfies **AC-6442, AC-6443**

## Consequences

**Positive**:
- Owners can brand, measure and connect their public pages the way the market expects, with privacy and security handled for them.
- Webhooks open every automation tool without us building each integration.
- Visitors outside English speaking countries book in their own language.

**Negative / tradeoffs**:
- Custom domains depend on Vercel's API and its plan limits for each production project.
- Several link pages change the key of the profile tables, a careful migration across many queries.
- On brij-crm (Hobby) webhook retries and domain checks can run up to about an hour late when the app is idle.
- Seven more languages of visitor copy must be kept in step with English.

**Neutral**:
- The public page policy grows by the pixel origins; app pages are unchanged.
- Emails and calendar files keep `timefix.com` links even when a custom domain is live.

## Follow-up

- [ ] Owner: check each Vercel project's custom domain limit (brij-crm is on Hobby, Timefix on Pro) and create a project scoped token for each production (`VERCEL_DOMAINS_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`).
- [ ] Owner: set `WEBHOOK_SECRET_KEY` (32 random bytes) in both productions.
- [ ] Owner: update the privacy policy and terms to cover customer pixels on public pages and webhooks sending visitor data to customer systems.
- [ ] Owner: a native speaker review of the seven non English catalogues (drafted by the lane, English fallback until reviewed).
- [ ] Later: an official Zapier app on top of these webhooks, and webhooks for records and deals.
- [ ] Later: custom domains for a workspace's booking pages and forms without a link page.

## Rationale

See [rationale.md](rationale.md).
