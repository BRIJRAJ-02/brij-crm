# 0023. Forms: the public surface

## Summary

This is everything a visitor's browser touches: the hosted form page, the one embed script (inline, popup and slide in), capturing a site's own HTML forms, the bot checks, keeping a submission safe when we're unreachable, the anonymous counters behind form analytics, and consented visitor tracking. It is a small separate build on the existing web host, so public traffic never loads the CRM app, and it talks to four public endpoints on the API. Milestones 3 and 4 of [index.md](index.md) build it; milestone 1 builds the hosted page and the submit path.

## Requirements

This child builds **AC-553**, **AC-554**, **AC-555**, **AC-583** to **AC-596** of [index.md](index.md), and the browser half of **AC-547** (steps and conditions) and **AC-580** to **AC-582** (the events behind analytics).

## Design

### One public bundle, two entry points

- A second Vite build entry in `apps/web` (`src/public/`), sharing nothing with the app shell. It holds a small renderer for `FormDocument` (questions, steps, conditions, consent blocks, the field editors' public variants), the submit and retry logic, the event beacon and the tracker.
- `GET /f/<publicKey>`: a static HTML shell plus the renderer, styled from the form's style. It is served by Vercel with the API's `GET /api/public/forms/:publicKey` answer inlined at the edge when cached, so the first paint has the form. Response headers: `X-Robots-Tag: noindex` unless the form turns indexing on, then a title, description, canonical URL and social card from `style.indexing`.
- `GET /embed.js`: the loader, under 15 kB gzipped, cached one hour with a versioned file it loads behind it (`/embed.<hash>.js`, cached a year), so a fix reaches every site within the hour without customers changing their snippet.
- Size budget: the renderer stays under 40 kB gzipped and runs without the CRM's React app. It may use Preact or plain DOM; the library's design tokens are compiled into its stylesheet so it looks like the product.
- The public field editors are thin versions of the field set's editors (text, long text, email, phone, number, currency, date, select, multi select, checkbox, rating, url, file once #32 exists), with the same validation through `checkRules`, the same labels and error wording, keyboard support and WCAG AA contrast. Types that make no sense publicly (record reference, actor reference, interaction) can't be form questions.

### The embed script

The snippet a member copies:

```html
<script async src="https://<host>/embed.js" data-site="<siteKey>"></script>
<div data-crm-form="<formKey>"></div>
```

- **Inline:** every element with `data-crm-form` becomes a `<crm-form>` custom element with an open shadow root. The site's CSS can't reach in and ours can't reach out; the element grows with its content.
- **Popup and slide in:** `data-crm-popup="<formKey>"` with `data-trigger` (`click` on a selector, `delay` in seconds, `scroll` percent, `exit` intent on desktop). Automatic triggers show at most once per visitor, per form, per day (remembered in `localStorage`, which is not tracking: it holds no id and sends nothing). A click always opens. Focus moves into the dialog, Esc closes it, focus returns to the trigger.
- **Hidden fields:** on load the script reads `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` from the page address, the page's address without other query values, and `document.referrer`, and sends them as `hidden`. Questions with a `prefillKey` are filled from the page's query (`?email=` and so on); prefilled values stay editable.
- **Rendering states:** loading (a skeleton the size of the form), paused or archived (the form's message), not found (nothing rendered, one console warning), offline.
- **Origin rule:** the script refuses to run when the page's host isn't one of the site's `domains` (and logs one console warning), so a copied snippet does nothing elsewhere; the API enforces the same rule.

### Capturing a site's own forms

- A capture form (`kind: 'capture'`) names a page pattern (a path, with `*`) and a selector (default: the form element's `id`), and maps input `name`s to attributes or form only fields.
- With `capture_enabled` on the site, the script attaches a `submit` listener (capture phase) to matching forms. On submit it reads the named inputs, never inputs of type `password`, `hidden` with names that look like tokens (`csrf`, `token`, `_wpnonce`), or any field whose `autocomplete` starts with `cc-`, and posts them with `navigator.sendBeacon` (falling back to `fetch` with `keepalive`), then lets the site's own submit continue untouched. It never calls `preventDefault`.
- Bot checks for captured forms rely on the reCAPTCHA token the script fetches on page load and refreshes before it expires, plus the honeypot it adds to the form (an off screen input named `crm_hp`), plus timing from the first interaction.

### Submitting and the browser retry

- The browser mints an `idempotencyKey` (a UUID v7) when the visitor first presses Submit and keeps it for every retry of that attempt.
- It validates first with the same shared function the server uses (types, required, `checkRules`, conditions), shows field errors inline, and only then posts.
- On a network failure or a 5xx, it shows the form's next step at once (thank you, redirect, or booking), stores the attempt in `localStorage` under the form key (at most 5 attempts per form, each at most 64 kB), and retries with backoff (5 s, 30 s, 2 min, 10 min, then every 30 min) while any page with the script is open on that site, for 24 hours. A redirect or booking next step waits up to 3 s for the first try before going. Field errors (422) and rate limits (429) are not retried; 422 shows the errors.
- The server answers `{ next }` from the published version, so routing rules are evaluated server side on the validated answers; a stored retry that succeeds later sends no second redirect.

### Bot checks (server side, in order)

1. Public key known and the form live; Origin in the allow list.
2. Rate limits, in memory token buckets in the API process (one instance today; Follow-up in index.md): 10 a minute per form and client address, 30 an hour per client address across the workspace, 5 an hour per form and email. Beyond them, 429.
3. Honeypot filled, or less than `spam.minFillMs` between first interaction and submit: stored as `spam` with the signal.
4. reCAPTCHA v3 token verified with Google (`action` must equal `form_submit`, hostname must be one of the allowed origins); missing, invalid, or a score below `spam.scoreThreshold` (default 0.3): stored as `spam`. A Google outage (verify request fails or times out after 2 s) stores the submission as `received` with `spam.verdict = 'unchecked'`, and processing continues; the submissions list marks it.
5. Field validation against the published version (422 on failure; nothing stored).

Spam submissions write no records, send no notices, and the visitor sees the normal thank you, so a bot learns nothing.

### Anonymous counters

- Events: `view` (the form is at least half on screen for one second), `start` (first focus or input), `step` (a step reached, with its index), `submit` (a stored submission, counted on the server, not from the beacon).
- The script batches events and sends them with `sendBeacon` to `/api/public/events` at most every 5 s and on page hide. Each event carries the form key, the kind, the step, a source (`utm_source`, else the referrer's host, else `direct`) and a location (the page path, without query). No cookie, no id, no client address stored.
- The API sums them in memory per `(workspace, form, hour, step, source, location)` and writes one upsert per key per minute into `form_stats`, plus on shutdown. Sources and locations beyond the 50 most common per form per day become `other`.
- Drop off per question comes from `step` events plus a `field` event (the last question touched before leaving, sent on page hide when a form was started and not submitted), counted the same way.
- The daily cleanup rolls hourly rows older than 90 days into daily rows and deletes daily rows older than two years.
- Outcomes are not counted here: the analytics screen joins submissions, `form_submission_records`, deals and bookings (#59) for its outcome numbers.

### Consented visitor tracking

- Off unless the site turns `tracking_enabled` on.
- Consent comes from either a consent block with purpose `tracking` that the visitor ticks, or the site's own cookie banner calling `window.crm('consent', { tracking: true })` (and `false` to withdraw). Without consent the script sets no cookie and sends no page views.
- On consent the script sets a first party cookie `crm_vid` (a random 128 bit value, `SameSite=Lax`, `Secure`, 13 months) on the site's registrable domain, and sends a page view (address without query except UTM, title, referrer) to `/api/public/track` on each page load and on single page app route changes (`history.pushState` and `popstate`).
- The API stores the visitor (the cookie value hashed with `FORMS_IP_SALT`, never the raw value) and the page view. A submission from a consenting browser carries the visitor id; processing links the visitor to the person, and their page views appear on the person's timeline (a new `ACTIVITY_SOURCES` entry, "Visited <title>", grouped per visit).
- A consent from a submission also writes a `consent_records` row on the person. A withdrawal (the site's call, or a member recording it) deletes the cookie, deletes the visitor's page views, unlinks the visitor and writes a withdrawal row.
- Page views older than 13 months are deleted by the daily cleanup.

### Custom domains

- A member enters a host (`forms.acme.com`); the API adds it to the Vercel project through the domains API and returns the DNS record to add (a CNAME to Vercel). `sites.checkCustomDomain` polls Vercel's verification; on success the site's `custom_domain_state` becomes `verified` and hosted forms answer on it at `/f/<publicKey>` and `/<slug>` (a form may set a short slug for its custom domain).
- The hosted page resolves the host to a site through a cached lookup at the edge, and refuses a host that isn't verified.
- Removing a domain removes it from Vercel. Plan flag required (AC-577).

### Public endpoint details

- CORS: the response's `Access-Control-Allow-Origin` echoes the request Origin only when it is allowed for that form's site (or our hosted origin); no credentials. Preflight cached 10 minutes.
- All four endpoints answer quickly: the submit endpoint does its checks and one insert in one transaction and queues the processing job in the same transaction; target p95 under 300 ms excluding Google's verify call (which is capped at 2 s).
- Request bodies are capped (submission 64 kB, events 16 kB, track 4 kB).
- `GET /api/public/forms/:publicKey` returns only what rendering needs: questions with labels, types, options (labels and colours of select options), required flags, conditions, consent wording, style, the reCAPTCHA site key and the language. It never returns attribute ids, mappings, owners, notify lists or booking rules.

## Build order

Milestone 1 of [index.md](index.md) builds the hosted page and the submit path with its bot checks (single step, hosted origin only). Milestone 3 builds the embed script, capture, the browser retry and custom domains. Milestone 4 builds the counters and tracking. Each milestone ends with a Playwright run against a small test site page served locally on a second origin, with two browsers where a timeline must update.

## Short rationale

- **Shadow DOM over an iframe:** the form needs the page's address for UTM tags and prefill, should feel native, and must autofill well; shadow DOM gives CSS isolation without the resize handshake and message passing an iframe needs. The cost is that a hostile site's scripts can read the form's inputs, which an iframe would block; we accept it because the site owner installed the script.
- **Store first, retry in the browser:** one insert is the smallest thing that can fail, and the browser retry covers our outages without a new queue provider. The cost: a visitor who closes every page of the site within the 24 hours and never returns loses a submission made during an outage.
- **reCAPTCHA v3:** chosen by the engineer for its familiarity and invisible scoring. It sends visitor data to Google, so customers must mention it in their privacy notice; we show that line on forms by default, as Google requires when the badge is hidden.
- **Counters batched in the API:** no new provider and no per event write; a crash loses at most a minute of anonymous counts, never a submission.
</content>
</invoke>
