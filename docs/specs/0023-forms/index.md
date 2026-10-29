# 0023. Forms: public forms that feed the CRM

**Date**: 2026-10-15 (revised 2026-10-19: the builder, the visitor page and the bot checks follow [0023-experience.md](0023-experience.md); revised 2026-10-20: layouts, show when, more question types, filing, notices and routing follow [0023-types-and-logic.md](0023-types-and-logic.md))
**Status**: Proposed

## Summary

A member builds a form from an object's attributes, publishes it, and shares it as a hosted link, an inline embed, a popup, or by capturing a website's own HTML forms. Each submission is stored first, then a background job turns it into linked records (the person matched on email, their company matched on domain, and optionally a deal or a list entry), fills only empty values unless a question says otherwise, gives new records an owner (a fixed member or round robin, #58), notifies people, and can send the visitor straight to a booking page (#59). Bots are stopped by an invisible challenge, a honeypot, timing and rate limits, and doubtful submissions wait in a spam folder. Forms report a funnel (views, starts, drop off per question, sources, and what submissions became), and a site can track a consenting visitor's page views onto their person's timeline.

## Structure

- [0023-experience.md](0023-experience.md): the builder, the visitor page and after submit: screens, interactions, copy, answer types and the contract changes they need. **Where it and this file differ, it wins.**
- [0023-types-and-logic.md](0023-types-and-logic.md): the 20 October revision: layouts (Classic, Steps, One at a time), show when rules, more question types and prefill, company by domain, deal and list filing, notices, routing to a booking page and an owner, anonymous analytics, consent and retention, each marked now, Release 1, Release 2 or later. AC-1031 to AC-1054. **Where it and the experience file differ on those subjects, it wins.**
- 0023-form-design.md (branch `wip/formdesign`, landing with its lane): the visitor's page design, the field checker, and the three layouts drawn as stories.
- [0023-public-surface.md](0023-public-surface.md): everything a visitor's browser touches: the hosted page, the embed script (inline, popup, slide in), capturing a site's own forms, the bot checks, the browser retry, the counters and consented tracking.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

All of these come earlier in the build order (forms sit in Slice 15).

| Feature | What this spec needs | When it is missing |
|---|---|---|
| #13 objects and attributes (spec 0012) | attributes, unique attributes, the field set (one editor and display per type), the definitions store | hard prerequisite |
| #14 validation (spec 0013) | `checkRules` in contracts, run in the browser and on the server against the published version | hard prerequisite |
| #15 relations (spec 0014) | the relationship between People and Companies (and Deals), link writes | hard prerequisite |
| #8 background jobs (spec 0008) | the light lane, retries, the daily cleanup (`maintenance.daily`) to which this spec adds phases | hard prerequisite |
| #9 and #24 access (spec 0009) | the access door, the `forms.manage` permission added here, field visibility for raw answers | hard prerequisite |
| #28 notifications | in app and email notices, the daily digest | milestone 2 waits for it |
| #22 trash (spec 0022) | moving records a spam submission created to the trash | milestone 2 waits for it |
| #31 duplicate detection | the merge flow for records this spec flags as ambiguous matches | needs review is handled here; merging stays in #31 |
| #32 file attachments | the file attribute type, size and type limits, virus scan | file questions wait for it (milestone 3) |
| #38 plans and limits | form count, monthly submissions, branding removal and custom domain flags in `limits.ts` | milestone 2 waits for it |
| #58 round robin (spec to come) | `assignOwner(rotationId, record)` returning a member and a reason | owner rules fall back to a fixed member until it lands |
| #59 booking pages (spec to come) | a booking page id and a way to open it prefilled with the submission's answers and `submissionId`, so a meeting links back to its submission | routing to booking waits for it |
| #36 audit and privacy | erasing a person also erases their submissions, consents, visitor and page views | this spec adds the erasure hooks |
| #17 record page (spec 0017) | `ACTIVITY_SOURCES`, to which this spec adds submission and page view entries | hard prerequisite |

## Requirements

**User stories**:
- As a member, I want to build a form from my objects' attributes and publish it, so leads and requests land in the CRM without retyping.
- As a member, I want a submission to create or update the person, their company and a deal, linked together, without overwriting what my team typed.
- As a member, I want new leads given an owner and someone told, so nothing sits unanswered.
- As a member, I want qualified visitors sent straight to a booking page, so a lead becomes a meeting in one go.
- As a member, I want to put a form on our website inline, as a popup, or by capturing the forms we already have.
- As a member, I want to see how each form performs: views, starts, where people drop off, which sources convert, and what submissions became.
- As an admin, I want bots kept out and consent recorded, so the CRM stays clean and lawful.
- As a visitor, I want a fast form that never loses what I typed, and a clear next step after I send it.

**Acceptance criteria** (this spec owns AC-545 to AC-596):

*Building and publishing*
- **AC-545**: A member with `forms.manage` creates a form on any object (People by default). Each question is either an attribute of a target record, using that attribute type's one editor and its validation rules, or a form only question kept on the submission. Layout blocks (heading, text, divider) and consent blocks can be added anywhere.
- **AC-546**: A builder can only map questions to objects and attributes they can write; the publish is refused with the attribute named otherwise.
- **AC-547**: A form can be split into steps, and any question, block or step can be shown or hidden by conditions on earlier answers, using the same condition shape as validation rules. (Revised 20 October 2026: replaced by AC-1031 to AC-1039 in [0023-types-and-logic.md](0023-types-and-logic.md), with the simpler Show when rule shape.)
- **AC-548**: Edits stay in a draft. Publish freezes the draft as a new numbered version and makes it live everywhere the form appears; each submission records its version.
- **AC-549**: A form is draft, live, paused or archived. Paused shows a "not taking responses" message at its link; archived refuses submissions and is hidden from the list until restored.
- **AC-550**: A member previews the draft exactly as visitors will see it, at desktop and phone widths, without creating a submission.
- **AC-551**: A mapped attribute renamed after publishing keeps working. One archived, deleted or changed in type is no longer written: the answer stays on the submission, and the form shows a warning to its editors until republished.
- **AC-552**: Each form has a public key used in every link and embed; internal ids never appear publicly. Rotating the key stops old embeds on purpose.

*Submitting*
- **AC-553**: The submit endpoint checks the public key, the form being live, the Origin against the site's domains (or our hosted page), the bot checks (AC-583 to AC-586) and the rate limits, then validates the answers against the published version: required questions, the attribute's type and validation rules, conditions (answers to hidden questions are ignored), and unknown fields dropped.
- **AC-554**: A valid submission is stored as `received` with its raw answers, hidden fields and version in one insert, and the visitor gets the thank you (or next step) at once. Processing happens in a background job.
- **AC-555**: An idempotency key minted by the browser per attempt is stored once; retries of the same attempt never create a second submission. A genuine second submission is kept as its own submission.
- **AC-556**: Answers that fail validation return field errors to the visitor, in the form's language, and nothing is stored.

*Processing into records*
- **AC-557**: Processing matches the main record on its object's unique attribute the form names as its match key (email for People). No match creates the record; a match updates it.
- **AC-558**: By default an answer only fills an empty value. A question set to "always update" overwrites. Every value written shows in history as set by the form.
- **AC-559**: For People, the company is matched on the email's domain (Companies' unique domain attribute) and created when missing, then linked to the person. Free email providers (the maintained list plus the workspace's own additions) get no company, unless the form asks for a company name, which is then used to match or create it by name.
- **AC-560**: A form can also create or update a deal linked to the person and company, and add the main record to a list with entry values (such as a stage).
- **AC-561**: Each record a submission touched is listed on it with what happened (created, updated, matched, linked) and its role (main, person, company, deal, list entry), and the submission appears on each of those records' timelines.
- **AC-562**: Two submissions for the same new email processed at the same moment create one person, not two.
- **AC-563**: An ambiguous match (the key matches more than one record) links to the oldest, marks the submission `needs review`, and a member picks the right record, which reprocesses it.
- **AC-564**: Records and values written by a submission name the form as their actor ("Created by Contact us form").
- **AC-565**: A value refused at processing time (a rule changed after the visitor submitted) is skipped, the rest is written, and the submission records the refused field and why.
- **AC-566**: A processing failure is retried by the job; after the last try the submission is `failed`, shows its reason, and a member can retry it.

*Ownership, notices and next steps*
- **AC-567**: A matched record keeps its owner. A new main record (and its company and deal, when created) gets the form's owner choice: a fixed member, a round robin rotation (#58), or nobody; each submission records who was assigned and why.
- **AC-568**: The new owner and the form's listed members get an in app notice for each submission, and an email unless they turned it off; a member can choose one daily digest email instead.
- **AC-569**: The visitor can get an optional confirmation email with a copy of their answers, sent from the workspace's sending setup.
- **AC-570**: After submitting, the visitor sees the form's thank you message, is sent to a web address, or is sent to a booking page (#59), chosen by rules on their answers with a default; the booking opens prefilled and the meeting links back to the submission.
- **AC-571**: A missing booking page falls back to the thank you message, and an empty rotation falls back to the form's fallback owner; the form warns its editors and the submission records why.

*Submissions screen*
- **AC-572**: Each form lists its submissions, newest first, filterable by state (processed, spam, held, needs review, failed), with the records each created or touched.
- **AC-573**: A member who can read a submission's main record can see the submission. Raw answers to attributes they can't see are hidden, the same rule as everywhere else.
- **AC-574**: Releasing a spam submission processes it. Marking a processed submission as spam offers to move the records it created (not ones it matched) to the trash; values it wrote on matched records stay.
- **AC-575**: A member can delete a submission. Erasing a person (#36) erases their submissions, consent records, visitor and page views.

*Limits*
- **AC-576**: Plans cap live forms and monthly submissions (counted when stored, spam excluded, by month in the workspace's forms time zone). Over the monthly cap, submissions are still stored as `held` and processed in order when room returns or the plan grows; the visitor never sees a difference.
- **AC-577**: Branding removal and custom domains are plan flags; without them the form shows "Made with" and uses our domain.

*Consent*
- **AC-578**: A consent block shows its exact wording. Its answer, the wording, its version and the time are stored as a consent record on the person, with the submission as its source.
- **AC-579**: A person's consent attribute for a purpose (such as marketing email) reflects their latest consent record for it. A member can record a withdrawal, which adds a record rather than editing the old one.

*Analytics*
- **AC-580**: Each form shows views, starts, submissions and conversion over time, by embed location and by page.
- **AC-581**: Each form shows drop off per step and question: how many reached it and how many left there.
- **AC-582**: Each form shows submissions and conversion by UTM source, medium and campaign and by referring site, and outcomes: people and companies created, meetings booked, deals created and deals won.

*Bots and abuse* (built in [0023-public-surface.md](0023-public-surface.md))
- **AC-583**: The browser sends a reCAPTCHA v3 token; the server verifies it. A missing token or a score below the threshold sends the submission to the spam folder rather than rejecting it.
- **AC-584**: A filled honeypot field or a submission faster than the minimum fill time goes to the spam folder.
- **AC-585**: Rate limits per form and client address, per client address across the workspace, per normalised email per form, and per instance answer 429 to the browser beyond their limit (the monthly plan cap never shows to visitors, AC-576).
- **AC-586**: Spam submissions create no records and send no notices.

*Where a form appears* (built in the child spec)
- **AC-587**: The hosted page at `/f/<publicKey>` loads without the CRM app, shows the workspace's logo and colours, sends noindex unless the form turns indexing on, and then carries a title, description and social image.
- **AC-588**: One script tag embeds a form inline on any site, unaffected by the site's CSS, and resizes itself.
- **AC-589**: The same script opens a form as a popup or slide in, triggered by a button, a delay, scroll depth or exit intent, at most once per visitor per form per day unless the button opens it.
- **AC-590**: The script can capture a site's own HTML form: on submit it reads the named inputs (never password or card fields), lets the site's submit carry on untouched, and posts them to the capture form, whose mapping turns input names into attributes.
- **AC-591**: Hidden fields record the UTM tags, the page and the referrer, and any question can be prefilled from the link's query.
- **AC-592**: If the submit endpoint can't be reached, the browser shows the thank you, keeps the submission locally and retries for 24 hours with the same idempotency key.
- **AC-593**: A form can be served at a customer's own domain once its DNS is verified.

*Visitor tracking* (built in the child spec)
- **AC-594**: Only after consent (a consent block, or the site calling the script's consent function from its own cookie banner) does the script set a first party visitor cookie and send page views.
- **AC-595**: Once a consenting visitor submits, their earlier and later page views appear on their person's timeline. Page views are kept 13 months.
- **AC-596**: Withdrawing tracking consent (the site calling the consent function with false, or a member recording it) stops tracking, deletes the cookie, and erases that visitor's page views.

## Decision

The owner accepted every recommendation in this spec, including its open questions, on 20 October 2026: Help shows keyboard shortcuts until a help centre exists; a page with its own hours becomes a schedule named after the page; only `booking.admin` edits a colleague's schedules; an Outlook personal account books without a Teams link and the host is told; steps go live in release 1 and one at a time in release 2; the form layout data change is accepted; sidebar changes reach the member's other tabs through the workspace `nav` event.

**Chosen option**: Option 1: store first, process in a job, one versioned form document, served by a small public bundle on the existing host.

A form is a row plus versioned JSON documents; the public surface is a small separate build on the existing Vercel project with a REST endpoint on the API; each submission is stored in one insert and turned into records by a background job that writes through the engine as a form actor.

**Implementation skills**: `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `crm-design-system` (`.claude/skills/crm-design-system/`) · `zod` (`.claude/skills/zod/`) · `security-and-hardening` (`.claude/skills/security-and-hardening/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (every table has `workspace_id`, forced row level security and the plain policy, the audit columns, and indexes that lead with `workspace_id`):

| Table | Fields | Keys and constraints |
|---|---|---|
| `sites` | `id`, `name` (required), `domains text[]` (required, at least one, lowercased hosts), `public_key` (required, random), `tracking_enabled bool` (default false), `capture_enabled bool` (default false), `custom_domain text` (nullable), `custom_domain_state` (`pending`, `verified`, `failed`, nullable), `branding jsonb` (logo file id, colours), `archived_at` | unique `(public_key)`; unique `(custom_domain)` where not null |
| `forms` | `id`, `site_id` (nullable: a hosted only form), `kind` (`built`, `capture`), `status` (`draft`, `live`, `paused`, `archived`), `name` (required), `main_object_id` (required), `public_key` (required, random), `draft_version_id`, `live_version_id` (nullable until first publish), `published_by` (member, nullable), `drift jsonb` (the warnings of AC-551, nullable), `slug text` (nullable, for a custom domain's short path), `archived_at` | unique `(public_key)`; unique `(workspace_id, site_id, slug)` where slug not null, slug `^[a-z0-9]+(?:[a-z0-9]|-[a-z0-9])*$`, at most 40, not one of `f`, `api`, `embed`, `assets`; FK `main_object_id` to `objects` |
| `form_versions` | `id`, `form_id`, `number` (1, 2, …; the draft is the highest, unpublished), `document jsonb` (required, `FormDocument` below), `published_at`, `published_by` (nullable while draft) | unique `(form_id, number)`; a published version is never updated |
| `form_submissions` | `id`, `form_id`, `version_id`, `idempotency_key` (required), `state` (see below), `answers jsonb` (raw, as sent), `hidden jsonb` (UTM, page, referrer, prefill), `spam jsonb` (score, signals, verdict), `visitor_id` (nullable, only with tracking consent), `main_record_id` (nullable until processed), `assignment jsonb` (who and why), `outcome jsonb` (refused fields, fallbacks), `failure text`, `received_at`, `processed_at`, `ip_hash` (salted, for rate limits and abuse review) | unique `(form_id, idempotency_key)`; index `(workspace_id, form_id, received_at desc)`; index `(workspace_id, state)` where state not in (`processed`) |
| `form_submission_records` | `submission_id`, `object_id`, `record_id`, `action` (`created`, `updated`, `matched`, `linked`), `role` (`main`, `person`, `company`, `deal`, `entry`) | PK `(submission_id, record_id, role)`; index `(workspace_id, record_id)` for timelines |
| `consent_records` | `id`, `person_record_id`, `purpose` (`marketing_email`, `tracking`, or a workspace defined key), `granted bool`, `wording text`, `wording_version int`, `source_type` (`submission`, `member`, `site`), `source_id`, `at` | index `(workspace_id, person_record_id, purpose, at desc)`; rows are only ever inserted |
| `form_stats` | `form_id`, `bucket timestamptz` (hour for 90 days, then day), `grain` (`hour`, `day`), `step int` (null for form level), `source text` (capped), `location text` (capped), `views`, `starts`, `reached`, `left` (visitors whose last touched question or step was this one and who never submitted, from the `field` event), `submits` | PK `(workspace_id, form_id, grain, bucket, step, source, location)` |
| `site_visitors` | `id` (the random cookie value's hash), `site_id`, `consented_at`, `first_seen`, `last_seen`, `person_record_id` (nullable) | index `(workspace_id, person_record_id)` |
| `site_page_views` | `id`, `visitor_id`, `url` (no query except UTM), `title`, `referrer`, `at` | index `(workspace_id, visitor_id, at desc)`; deleted after 13 months |
| `form_settings` | one row per workspace: `extra_free_domains text[]`, `time_zone text` (IANA, set from the first admin's browser, editable; used for the monthly cap's month and the digest), `digest_hour int` (local hour, default 8) | PK `(workspace_id)` (a small addition to the confirmed model, for AC-559, AC-568 and AC-576) |
| `form_usage` | `month date` (the first day, in `form_settings.time_zone`), `counted int` | PK `(workspace_id, month)`; incremented in the submit transaction for every non spam submission (AC-576) |

The enum `actor_type` gains `form`; a form actor is `{ type: 'form', id: <form id> }` (AC-564).

**`FormDocument`** (a Zod schema in `packages/contracts/src/forms/`, one name for schema and type):
- `steps[]`: each with `id`, `title`, `blocks[]`, optional `showWhen` (a `FilterGroup` over earlier answers).
- `blocks[]`: `question` (`id`, `label`, `help`, `required`, `target`: `{ role, attributeId }` or `{ formOnly: true, type }`, `update: 'fill' | 'always'`, `prefillKey`, `showWhen`), `heading`, `text`, `divider`, `consent` (`id`, `purpose`, `wording`, `wordingVersion`, `required`, `setsAttributeId`).
- `targets`: `main` (`objectId`, `matchAttributeId`, must be unique), optional `person` and `company` (when main is not People, each with the relationship attribute on the main object that links it, named by attribute id), optional `deal` (`objectId`, `relationshipAttributeIds` to person and company, `match: 'open' | 'always'` (default `open`: reuse the person's most recent deal whose status stage outcome is `open`, else create), `startValues` (attribute id to a fixed value, including the status stage)), optional `listEntry` (`listId`, entry values, `ifPresent: 'update' | 'skip'`, default `update`).
- `capture` (capture forms only): `pagePattern` (a path with `*`), `selector` (default the form element's `id`), `fields` (input name to question id).
- `owner`: `{ kind: 'member', memberId } | { kind: 'rotation', rotationId, fallbackMemberId? } | { kind: 'none' }`.
- `notify`: `memberIds[]`, `confirmVisitor: { enabled, subject, body }`.
- `after`: `{ kind: 'message', text } | { kind: 'redirect', url } | { kind: 'booking', rules: [{ when: FilterGroup, bookingPageId }], defaultBookingPageId }`.
- `style`: colours, logo, button text, `language` (BCP 47 tag), `indexing: { enabled, title, description, imageFileId }`, `branding: boolean`.
- `spam`: `minFillMs` (default 2,500), `scoreThreshold` (default 0.3).
- `consent` wording versions: when a consent block's wording changes between publishes, publish bumps its `wordingVersion` itself.

**State transitions**:
- Form: `draft → live` (first publish); `live ↔ paused`; `draft | live | paused → archived`; `archived → paused` (restore). Publishing again keeps `live`.
- Submission: `received → processing → processed`; `received → spam` (bot checks); `spam → received` (release); `processed → spam` (re flag, AC-574); `received → held` (over the cap) `→ received` (room returns); `processing → needs_review` (ambiguous) `→ received` (a member picks); `processing → failed` (last retry) `→ received` (retry).

**API surface**

Members (oRPC, signed in, through the access door):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `forms.list` | status filter, cursor | forms with counts | read | |
| `forms.get` | `formId` | form, draft and live documents, drift | read | 404 |
| `forms.create` | `id` (client minted), `name`, `mainObjectId`, `siteId?`, `kind` | form | `forms.manage` | 409 `ID_TAKEN`, 422 |
| `forms.saveDraft` | `formId`, `document`, `expectedNumber` | draft version | `forms.manage` | 409 stale draft, 422 field errors |
| `forms.publish` | `formId`, `expectedNumber` | live version | `forms.manage` plus write on every mapped attribute | 403 naming the attribute, 422, plan limit |
| `forms.setStatus` | `formId`, `status` | form | `forms.manage` | 409 invalid transition |
| `forms.rotateKey` | `formId` | new public key | `forms.manage` | |
| `forms.duplicate` | `formId`, new `id` | form | `forms.manage` | |
| `forms.stats` | `formId`, range, group by | series and breakdowns | read | |
| `submissions.list` | `formId`, state, cursor | submissions (answers filtered by visibility) | read on the main record | |
| `submissions.get` | `submissionId` | submission, its records, consent rows | read on the main record | 404 |
| `submissions.release` | `submissionId` | state `received` | `forms.manage` | 409 |
| `submissions.markSpam` | `submissionId`, `trashCreated: boolean` | state `spam` | `forms.manage` | |
| `submissions.resolve` | `submissionId`, `recordId` | state `received` | `forms.manage` | 422 record not a candidate |
| `submissions.retry` | `submissionId` | state `received` | `forms.manage` | 409 |
| `submissions.delete` | `submissionId` | | `forms.manage` | |
| `sites.list`, `sites.create`, `sites.update`, `sites.archive` | name, domains, settings | site | `forms.manage` | 422 bad domain |
| `sites.setCustomDomain`, `sites.checkCustomDomain` | `siteId`, host | DNS records to add, state | `forms.manage` plus plan flag | 409 taken, plan limit |
| `consent.list`, `consent.withdraw` | `personRecordId`, `purpose` | records | read the person; write to withdraw | |
| `formSettings.get`, `formSettings.update` | extra free domains, digest hour | settings | read; `forms.manage` to update | |

Public (REST under `/api/public`, no session; detail in the child spec):

| Endpoint | Method | Key inputs | Key outputs | Trust | Key errors |
|---|---|---|---|---|---|
| `/api/public/forms/:publicKey` | GET | | live document (questions, logic, style; no mappings beyond what rendering needs), reCAPTCHA site key | public key; cached 60 s | 404, 410 paused or archived |
| `/api/public/forms/:publicKey/submissions` | POST | `idempotencyKey`, `answers`, `hidden`, `captcha`, `honeypot`, `startedAt` (advisory only, client controlled), `versionNumber`, `visitorId?`, `consents` | `{ next: message | redirect | booking }` | key, Origin, challenge, rate limits | 404, 410, 422 field errors, 429 |
| `/api/public/events` | POST (beacon) | batch of `{ publicKey, kind, step?, source?, location? }` | 204 | key, Origin, rate limit | 204 always (drops bad events) |
| `/api/public/track` | POST (beacon) | `siteKey`, `visitorId`, page view | 204 | site key, Origin, tracking enabled | 204 always |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| submit | which version validates the answers | `forms.live_version_id` at the time of the request |
| submit | allowed origins | `sites.domains` of the form's site, plus our hosted origin (`APP_URL`), plus the verified `sites.custom_domain` |
| submit | rules and types to validate against | the published `FormDocument` plus `attributes` rows and `checkRules` (spec 0013) as of the request |
| submit | captcha score | Google's verify response, with `RECAPTCHA_SECRET_KEY` |
| submit | the visitor's address for rate limits | the edge's forwarded client address header, hashed with `FORMS_IP_SALT` |
| process | match key attribute | `FormDocument.targets.main.matchAttributeId` (People: the email attribute) |
| process | company domain | the part after `@` of the submitted email, lowercased, unless in the package list or `form_settings.extra_free_domains` |
| process | fill or overwrite | the question's `update` |
| process | owner | `FormDocument.owner`; for a rotation, `assignOwner` from #58; a matched record's current owner attribute |
| process | actor on writes | `{ type: 'form', id: forms.id }` |
| submit | over the cap or not | `form_usage.counted` for the current month (in `form_settings.time_zone`) against the plan's monthly limit (#38); spam never counts |
| notify | who | the assigned owner plus `FormDocument.notify.memberIds`, each member's notice preference (#28) |
| digest | when | `form_settings.digest_hour` in `form_settings.time_zone` (members have no stored time zone) |
| digest | contents | per form: the count since the last digest and the 20 newest submissions (main record name, owner, link); none sent when there is nothing new; one per member per day (idempotency key `digest:<member>:<date>`) |
| confirmation email | subject, body, answers shown | `notify.confirmVisitor` (defaults: "We got your message" and the form's thank you text); only form only and attribute answers the form marks `showInConfirmation`; never hidden fields or consent rows; skipped and recorded in `outcome` when the workspace has no sending setup |
| process | candidates for review | `outcome.candidates` (record ids, at most 10) stored when a match is ambiguous; `submissions.resolve` accepts only those |
| process | the visitor to link | `visitorId` in the body, present when the cookie existed before submit or the submit carries a `tracking` consent (the script sets the cookie first, then sends its id) |
| hosted page | text in the visitor's language | `style.language` from a fixed set (English, Spanish, French, German, Portuguese, Italian, Dutch, Hindi), message catalogue in `packages/contracts/src/forms/strings`, English for anything missing |
| after submit | booking page | the first `after.rules` whose `when` matches the answers, else `defaultBookingPageId` |
| stats | outcomes: meetings booked | bookings (#59) carrying this `submissionId` |
| stats | outcomes: deals won | deals in `form_submission_records` whose status attribute's stage outcome is `won` |
| stats | source of a view | `utm_source` on the page, else the referrer's host, else `direct`; capped to the 50 most common per form per day, the rest `other` |
| hosted page | logo and colours | `FormDocument.style`, else the site's `branding` |
| tracking | visitor identity | a random id in the first party cookie `crm_vid` on the site's domain, set only after consent |

**Rules the build follows** (closing the cross check's gaps):

*Abuse and trust*
- The client address is the first value of `x-forwarded-for` as set by Vercel's Routing Middleware, trusted only on requests that carry the edge secret header (`EDGE_SECRET`, as every proxied API request already does); without it the address is the socket's. Rate limits key on that address's salted hash.
- Order on submit: public key and status, Origin, cheap rate limits, body size, honeypot and timing, then the reCAPTCHA call. At most 20 reCAPTCHA verifies run at once per API instance; beyond that the submission is stored as `received` with `spam.verdict = 'unchecked'`. A global cap of 50 submits a second per instance answers 429 beyond it.
- Emails are normalised for limits and matching: lowercased, trimmed; for the rate limit only, a `+tag` in the local part is dropped.
- A false 429 from a shared office address is accepted as the cost of the per address limit; the per form limit (10 a minute) is generous enough for an office.
- The visitor confirmation email is sent only for a submission that passed the bot checks (never `spam` or `unchecked`), at most 3 a day per recipient address across all workspaces (counted by salted hash), and never again for the same submission. Marketing consent can require double opt in: the consent block's `doubleOptIn` sends a confirm link, and the consent record is written only when it is clicked.
- Spam submissions never count toward the monthly cap, and the `held` queue is capped at 10,000 per workspace; beyond that submissions are stored as `spam` with the signal `held_overflow`.
- `/api/public/events` and `/api/public/track` accept `text/plain` bodies (as `sendBeacon` sends them) and still enforce Origin. Form stats are labelled approximate on screen, since anyone can send view events.
- Key rotation takes effect at once: the edge cache keys on the public key, and the old key answers 404 from a 5 minute negative cache entry.
- Site domains match exactly; a `*.example.com` entry allows subdomains. The reCAPTCHA hostname must match the same list.

*Processing*
- `processSubmission` runs in one transaction. It takes advisory locks on every target's normalised match key (main, person, company, deal) in sorted order before matching, so two jobs never deadlock. Lock keys include the object and attribute.
- It is repeatable: a retry first reads `form_submission_records` and `assignment`, reuses records already created and an owner already chosen (round robin is called once, and its result stored in `assignment` before records are written), and writes notices as outbox rows in the same transaction, so they are sent once after commit.
- Job retries: the light lane's default, 5 tries with backoff from 10 seconds to 10 minutes, then `failed`.
- A matched main record with no owner gets the form's owner choice. A removed member in `notify.memberIds` is skipped; a removed fixed owner or rotation fallback falls back to nobody, and the form shows a warning to its editors.
- Company by name (free email domains with a company question): exact match on the name ignoring case and surrounding spaces; several matches follow the ambiguity flow (AC-563). Ambiguity applies to every target, not just main.
- A consent block needs a person among the targets; publish is refused otherwise. The job writes the consent record and the person's consent attribute (a checkbox attribute named by `setsAttributeId`) in the same transaction; the attribute takes the latest record per purpose by `at`.
- A publisher who later loses write access or leaves keeps their published mapping working; the check runs again at the next publish (AC-546).
- Capture forms validate softly: a value that fails its attribute's type or rules is dropped and recorded in `outcome`, never rejected, since the site's own form already took the submission.
- The free email domain list is the `free-email-domains` package, pinned in the catalog and refreshed monthly by a dependency update.
- Version tolerance: the submit body names `versionNumber`; when it is one behind the live version, answers are validated against the live version, unknown fields are dropped, and missing newly required answers are accepted as empty. Two or more behind answers 409 and the script reloads the form.

*Limits, retention and lifecycle*
- Plan caps are checked at publish, at unpause and at restore (live forms), and at submit (monthly).
- `held` submissions are processed in order by a sweep job every minute (100 at a time) whenever the month's count is below the cap, and at once when the plan changes.
- Spam submissions are deleted after 30 days; failed ones are kept until retried or deleted; processed answers are kept until a member deletes the submission or the person is erased. Deleting a submission leaves the records it created.
- `forms.duplicate` copies the draft document only, into a new draft form with a new public key, the same site, status `draft`.
- `forms.get` returns mappings and owner rules to any member who can read the form; only `forms.manage` can change them.
- Preview renders the draft document with the same public renderer and a flag that blocks submit and counters.
- The 50 sources and 50 locations per form per day are the first 50 seen that day; later ones count as `other`.
- Tracking cookies set by script are capped at 7 days by Safari; the 13 month lifetime holds elsewhere. The registrable domain comes from the public suffix list bundled in the script build.
- The browser retry queue in `localStorage` is cleared as soon as a stored attempt succeeds, and on expiry after 24 hours.
- Outcome numbers are computed from `form_submission_records` on demand up to 10,000 submissions per form; beyond that a nightly rollup into `form_stats` (outcome columns) serves them.

**Key invariants**:
- A published version is never edited; submissions always point at the version they answered.
- A submission is stored before any record is written; no record is ever written by the request itself.
- One `(form_id, idempotency_key)` per submission.
- Processing a submission holds a transaction advisory lock on each match key (`workspace, object, normalised key value`) before matching, so concurrent submissions for one new email create one record (AC-562).
- A form writes only attributes its published mapping names, and only those its publisher could write at publish time; the door checks the form actor against that list.
- Consent records are only inserted, never updated or deleted, except by erasure.
- No personal data in `form_stats`; page views exist only for consenting visitors.
- Spam, held and needs review submissions write no records and send no notices.

**Security model**:
- `forms.manage` is a new permission: admins have it; roles may grant it (spec 0009's flat permission list). It covers forms, submissions actions, sites, custom domains and form settings.
- Reading a submission needs read on its main record; raw answers for hidden attributes are removed in the same filter the API uses for records.
- The form actor's writes go through the engine and the access door with a scope built from the published mapping (the attributes listed, write only); it can't read anything beyond what matching needs.
- Public endpoints trust only: the public key, the Origin allow list, the bot checks, the rate limits and server side validation. They never return record data, never confirm whether an email exists, and answer the same way for a matched or a new person.
- Personal data: submissions, consent and page views are personal data under GDPR. Erasure (#36) removes them; page views are kept 13 months; the stored client address is a salted hash.
- Audit: publishing, key rotation, site and domain changes, and consent withdrawals are written to the audit log (#36).

**Configuration required**:
- `RECAPTCHA_SITE_KEY` (public, sent to browsers) and `RECAPTCHA_SECRET_KEY` (api only).
- `FORMS_IP_SALT`: the salt for hashed client addresses (rotating it only resets rate limit history).
- `FORMS_VISITOR_SALT`: a separate salt for hashed visitor cookie values (rotating it forgets every tracked visitor).
- Local and test environments use Google's published reCAPTCHA test keys.
- `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`: for custom domains (api only, milestone 3).
- `FORMS_PUBLIC_ORIGIN`: the origin of hosted pages when it differs from `APP_URL` (defaults to `APP_URL`).

**Critical test scenarios**:
- Happy path: publish a People form, submit from the hosted page, the job creates the person and company (by domain), links them, assigns round robin, notifies the owner, routes to booking; verifies **AC-548**, **AC-554**, **AC-557**, **AC-559**, **AC-567**, **AC-570**.
- Fill blanks: a matched person with a typed phone keeps it; a question set to always update overwrites; history names the form; verifies **AC-558**, **AC-564**.
- Concurrency: two submissions for one new email at once make one person; verifies **AC-562**.
- Idempotency: the same attempt posted three times is one submission; verifies **AC-555**.
- Outage: the endpoint unreachable, the browser retries later and one submission arrives; verifies **AC-592**.
- Bots: no token, low score, honeypot, too fast, each lands in spam with no records and no notices; verifies **AC-583** to **AC-586**.
- Permission: a builder without write on an attribute can't publish a mapping to it; a member without read on the main record can't see the submission; hidden attribute answers are absent; verifies **AC-546**, **AC-573**.
- Public safety: a wrong Origin is refused; answers to hidden questions and unknown fields are ignored; responses never reveal whether an email exists; verifies **AC-553**.
- Drift: archive a mapped attribute, submit, the answer stays on the submission only and editors see the warning; verifies **AC-551**.
- Limits: over the monthly cap, submissions are held then processed in order after an upgrade; verifies **AC-576**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 starts after #58 and #59 are built (Slice 12) and the first release; milestone 2 needs #22, #28 and #38; milestone 3 needs #32 for file questions.

**Milestone 1: a hosted form makes a person** (one thread through every layer)
1. Migration: `forms`, `form_versions`, `form_submissions`, `form_submission_records`, `actor_type` gains `form`, `forms.manage` in the permission list; guard tests extended to the new tables, satisfies **AC-545**, **AC-548**, **AC-555**
2. Contracts: `FormDocument` (questions, blocks, steps without conditions yet, targets with `main` only, `owner` member or none, `after` message or redirect), the public submit and get shapes, the shared answer validation (types, required, `checkRules`), satisfies **AC-545**, **AC-553**, **AC-556**
3. Engine and core: `processSubmission` (match on the key with the advisory lock, create or update with fill or always, the form actor, `form_submission_records`), the `forms.process` job kind on the light lane with retries, satisfies **AC-557**, **AC-558**, **AC-561**, **AC-562**, **AC-564**, **AC-565**, **AC-566**
4. API: member procedures for forms (create, saveDraft, publish, setStatus, rotateKey) and submissions (list, get, retry, delete); the public get and submit endpoints with key, Origin (hosted origin only for now), validation, idempotency, reCAPTCHA, honeypot, timing and in memory rate limits, satisfies **AC-546**, **AC-548**, **AC-549**, **AC-552**, **AC-553**, **AC-554**, **AC-583** to **AC-586**
5. Public bundle: the hosted page renderer at `/f/<publicKey>` (one step forms), noindex, the browser idempotency key, satisfies **AC-587**
6. Library and screens, as [0023-experience.md](0023-experience.md) designs them: the forms list, the editor (status line, questions as cards, the live preview, the publish check and the first publish dialog), the Settings, Install and Submissions tabs, timeline entries for submissions on records; stories, guardian, satisfies **AC-545**, **AC-550**, **AC-561**, **AC-572**, **AC-573**, **AC-649** to **AC-664**
7. Deploy; Playwright: build, publish, submit from a second browser, see the person and the timeline entry; `security-access-reviewer`, `state-performance-reviewer`, `ux-interaction-reviewer`, satisfies **AC-545** to **AC-566** (the parts above)

**Milestone 2: linked records, owners, notices, routing and consent**
8. Migration: `consent_records`, `form_settings`, `form_usage`, `forms.slug`; the held sweep job and spam expiry in the daily cleanup; satisfies **AC-578**, **AC-559**
9. Contracts and core: targets `person`, `company`, `deal`, `listEntry`; the free domain list (pinned package plus workspace additions); company by name when asked; owner rotation through #58 with fallbacks; steps and `showWhen` conditions evaluated by one shared function on both sides; consent blocks writing consent records and the consent attribute; drift detection on publish and on attribute changes, satisfies **AC-547**, **AC-551**, **AC-559**, **AC-560**, **AC-567**, **AC-571**, **AC-578**, **AC-579**
10. Notices and email: submission notices through #28, the daily digest, the visitor confirmation email, satisfies **AC-568**, **AC-569**
11. After submit routing: booking rules, the prefilled booking page and `submissionId` handed to #59, fallbacks, satisfies **AC-570**, **AC-571**
12. Review and spam flows: needs review with candidate picking, release, re flag with the offer to trash created records (#22), satisfies **AC-563**, **AC-574**
13. Plans: live form and monthly submission caps with `held` and ordered catch up, the branding flag, satisfies **AC-576**, **AC-577**
14. Privacy: erasure hooks for submissions, consent records; deleting a submission, satisfies **AC-575**
15. Builder: steps, conditions, targets, owner, notify, after submit and consent panels; deploy; Playwright for a People form that creates a person, company and deal, assigns round robin, routes to booking; reviews, satisfies **AC-547** to **AC-579** (the parts above)

**Milestone 3: forms on any website** (child spec [0023-public-surface.md](0023-public-surface.md))
16. Migration: `sites`; Origin checks against site domains, satisfies **AC-553**
17. The embed script: inline in shadow DOM, popup and slide in with triggers, hidden fields and prefill, multi step rendering, the browser retry queue, satisfies **AC-588**, **AC-589**, **AC-591**, **AC-592**
18. Capture forms: `kind: 'capture'`, mapping input names, the script's capture listener, satisfies **AC-590**
19. File questions once #32 exists, satisfies **AC-545**
20. Custom domains through Vercel project domains, verification and the hosted page on them; indexing settings, satisfies **AC-587**, **AC-593**
21. Deploy; Playwright on a test site page (inline, popup, capture, offline retry); reviews, satisfies **AC-587** to **AC-593**

**Milestone 4: analytics and consented tracking** (child spec)
22. Migration: `form_stats`, `site_visitors`, `site_page_views`; the daily cleanup phases (hourly to daily after 90 days, page views after 13 months), satisfies **AC-580**, **AC-595**
23. Counters: the script's view, start, step and submit beacons, the API's per minute batched upsert, source and location capping, satisfies **AC-580**, **AC-581**, **AC-582**
24. Tracking: the consent function, the visitor cookie, page view beacons, linking a visitor to a person on submit, page views on the timeline, withdrawal and erasure, satisfies **AC-594**, **AC-595**, **AC-596**
25. The analytics screen: funnel, drop off, sources, outcomes (meetings from #59, deals won); stories; deploy; reviews, satisfies **AC-580**, **AC-581**, **AC-582**

## Consequences

**Positive**:
- Leads arrive as clean, linked, owned records with a full trail of where they came from.
- A form never loses a submission: the request only stores, the job retries, and the browser retries when we're down.
- One form engine serves hosted pages, embeds, popups and captured site forms, so every improvement lands everywhere.
- Questions reuse the field set and validation rules, so a form can't put a value in the CRM that the CRM itself would refuse.

**Negative / tradeoffs**:
- A new public, unauthenticated surface: bots, abuse and load from customers' websites now reach our API, and we carry reCAPTCHA (visitor data goes to Google, which needs a line in customers' privacy notices).
- Rate limits held in the API's memory are only right while there is one API instance; scaling out (#41) needs a shared store.
- Processing in a job means a submission takes a second or two to appear as a record, not instantly.
- Consented tracking makes the workspace a data controller for page views; customers need their cookie banner to call our consent function.
- Custom domains depend on the Vercel plan's domain limits; many customers on their own domains may need Cloudflare for SaaS later.
- The versioned document is opaque to SQL: finding every form that maps one attribute means reading documents (we keep a small index of mapped attribute ids per published version for drift checks).

**Neutral**:
- `actor_type` gains a value, and the access table gains `forms.manage`.
- The web app gains a second build entry (the public renderer and script) with its own size budget.
- The daily cleanup gains three phases (stats rollup, page view expiry, held submission catch up).

## Follow-up

- [ ] Write the specs for #58 round robin and #59 booking pages. Hard requirements from this spec: `assignOwner(rotationId, { objectId, recordId })` called inside the processing transaction after the record exists, returning `{ memberId, reason }`; and a booking hand off `bookingLink({ bookingPageId, prefill: { attributeId: value }, submissionId })` returning the address the submit response sends the visitor to, with the meeting carrying `submissionId` so form stats can count meetings booked.
- [ ] Measure the submit endpoint and the counters on the load harness (#12) with a busy site before milestone 4 ships.
- [ ] Rate limits move to a shared store when the API runs more than one instance (#41).
- [ ] Translations of a form into several languages (later).
- [x] Steps and show when conditions (AC-547): brought back by the 20 October revision as AC-1031 to AC-1039 ([0023-types-and-logic.md](0023-types-and-logic.md)). Layout blocks stay out.
- [ ] The popup and slide in (AC-589): still later (Release 3).
- [ ] Decide whether site visitor tracking grows into its own feature (anonymous company identification, page scoring); it stays here, consented only, for now.
- [ ] The free email domain list is the `free-email-domains` package (maintained, MIT), pinned in the catalog. Discovery found no credible Agent Skills or MCP servers for reCAPTCHA v3 or the domain list; record that as declined in `AGENTS.md` at the next `/sync`.
- [ ] Spam checker (20 October 2026, the owner's "spam checker" request), built on the bot checks above. Each call below is pending owner confirmation; the conservative option was taken:
  - Fill ticket: the minimum fill time is measured on the server's clock. `GET /api/public/forms/:publicKey/ticket` (and `/api/public/booking/:publicKey/ticket`), never cached, returns `{ ticket }`, an HMAC signed `t1.<issued at>.<nonce>.<mac>` bound to that public key, good for 24 hours and 5 submits; the page sends it back as `ticket`. Its key is derived from `FORMS_IP_SALT`, so no new variable (runner up: a separate `FORMS_TICKET_SECRET`). A separate endpoint, because the form read is cached for 60 s.
  - A submit with neither a ticket nor `fillMs` is no longer spam: unsigned, it scores 3 (`no_timing`, Needs review alone); signed by a site's server, nothing. A ticket that isn't ours, is for another address, or is spent also scores 3. A valid ticket's time wins over the page's `fillMs`.
  - Content score, in `packages/core/src/forms/spam.ts`: markup links 3; links 1 for 2, 2 for 3 or 4, 4 for 5 or more; a link in a name 3; a disposable email domain 2; a gibberish name 2 (plain Latin letters only, never another script); the same answers on the same form within 24 hours 2 for one or two earlier, 4 for three or more. Needs review from 3, spam from 6. Fixed constants, not per form settings.
  - Disposable email domains: no spec names a list, so a pinned seed of 24 common throwaway domains lives in code. Adopting a maintained package (such as `disposable-email-domains`) in the catalog waits for the owner.
  - A doubtful submission is stored as `needs_review` with `spam.verdict = 'review'` (no job, no records, no notices; the visitor sees success). `submissions.resolve` takes `resolution: { kind: 'not_spam' } | { kind: 'spam' }` (`forms.manage`): not spam queues processing, spam moves it to spam where Release still works. The AC-563 record pick joins the same union as `{ kind: 'record', recordId }`, instead of the table's bare `recordId`.
  - Rate limits follow AC-585, in the central limits module (`apps/api/src/limits.ts`, one limiter per surface: forms, booking, ticket issue, ticket uses): 5 a minute per address, 30 an hour per address within a workspace, 120 an hour per form, 50 a second per instance; tickets 30 a minute per address and 200 a second per instance. The per form and email limit (5 an hour, normalised, hashed with the salt) is a spam sign (`email_limit`, 3) rather than AC-585's 429, so nobody can lock a person out of a form by sending junk with their email.
  - Repeats: `form_submissions.answers_hash` (HMAC-SHA256 of the checked answers in key order with the form id, under a key derived from `FORMS_IP_SALT`), indexed `(workspace_id, form_id, answers_hash, received_at)` (migration 0046), counted over the form's last 24 hours.
  - Booking pages use the ticket only for their minimum fill time; a booking that looks like a bot is still refused (422) as before, not stored silently, and gets no content score.
  - Owner rule (20 October 2026): every setting lives in Settings. The spam checker ships with no workspace setting (the bands, weights and limits are constants; reCAPTCHA is on by its environment keys; `FormSpam` stays per form in the document). When any becomes a setting, it goes on a full width page under Settings › Scheduling named "Spam protection", stored in spec 0023's `form_settings` row (`formSettings.get` and `update`, `forms.manage`); the Needs review queue stays in each form's Submissions tab.
- [ ] Submissions backend and the tab relook (the owner's asks, 20 and 21 October 2026, built in `wip/forms-track`). Each call below is pending owner confirmation; the conservative option was taken:
  - **Add to CRM** files a submission that isn't in the CRM (failed, or processed with no live record) with the form's live mapping, as the member, through their own access, in one `forms.file` job (heavy lane, cancellable, 20 a batch, at most 500 a call). Spam and Needs review are left out; a record the member can't open is refused on that submission, never named.
  - **Sync old records** previews over the newest 2,000 submissions in scope (`unfiled`: failed or processed with no live record; `all`: every failed and processed one), then files them in a `forms.sync` job whose snapshot stops at its start. Filing again finds the record and writes only what is new, so a second run changes nothing. It is offered after a publish that changed where answers are filed, and from Submissions' menu.
  - **CSV export** is a `forms.export` job (the filter or up to 1,000 named submissions, at most 100,000 rows): answers as columns by question key (the newest wording first), then the CRM link and where it came from, every text cell guarded against spreadsheet formulas. Only its starter downloads it, for 7 days, under the access it was written with; a member keeps at most 5. Files live in Postgres (`exports`, `export_chunks`, migration 0052) until R2 arrives.
  - **Keep submissions only** (the owner's "what if I don't need to map"): a form's object is optional (`forms.main_object_id` nullable, migration 0053; `FormDocument.targets.main` optional, and a filed question needs it). Its submissions pass the spam checks, save, show in Submissions as Received and export; nothing is written to the CRM, and Add to CRM and Sync answer that it keeps its submissions only. The first publish offers "Don't add to the CRM" after the objects; Settings has "Add each submission to the CRM", which on a published form changes the draft and goes live on publish. Each version files with its own target, so nothing already sent moves; turning it on files the starting questions as a new form's are (email on the match, name on the primary attribute, phone on the first phone) and the publish after offers Sync for the earlier submissions. A form with no object is visible only to members with `forms.manage`, since no object rule reaches it (fail closed).
  - **Book a meeting after sending** (AC-1055 to AC-1059) ships with the hosted form's countdown in the next job, not here: its contract lives with the hosted form, and the old offer field the editor wrote was never read, so the option would have done nothing.
  - **One word**: the editor, its tabs and the forms list say "submission" (the tab's name and the owner's word) where they said enquiry or response.
  - **Access, after the security review of 21 October 2026** (all fail closed):
    - Add to CRM, Sync old records and its preview take, count and name only submissions the member may see, as Submissions shows them: with no record, or one their rules show them, live or in the trash. Each member's job runs under that member's rules (the worker's `APP_RULES`).
    - The preview compares only fields the member may write, so a hidden field's value is never read. A submission already in the CRM on another object than the form files onto now is left as it is (the run skips it and says why; the preview counts it unchanged).
    - A form is visible only to a member who can see every object its draft and its live version file onto; a version that keeps its submissions only needs `forms.manage`, as before.
    - An export is read and written under its starter's access key: their data policy, whether they manage forms, and their teams. Losing any of it (a demotion included) loses the file. A replay of an export's id makes every check a download makes.
    - Export limits: at most 5 kept per member, counted under a lock and leaving out ones whose job failed or was cancelled; a file that grows past 100,000 submissions or 100 MB while it is written stops with a clear message instead of ending cut short.
    - An export is a snapshot: a record deleted forever after it was written stays named in the file until the export expires (7 days). Pending the owner: whether an erasure should also delete the exports that name the record.

## Calls made fixing late traps, 27 to 30 October 2026 (shipped, main 82fbc760f)

A late trap is a change that saves fine, then breaks something later somewhere else, without anyone being told. Each line says what the product does now, and the trap it closes (numbers from the late trap audit). The owner asked for each to follow industry practice and delegated the product calls.

- Each processed or failed submission emails the member its lead went to and the member who made the form (`form_submission`), each holding only the answers that member may see (the submission as they would open it; nothing for one who can't). The email says why they got it, and says when the submission couldn't be added to the CRM. Each member turns these off with the email's preferences link (topic `form_submissions`). Choosing who is told per form, and the daily digest, are still milestone 3 (AC-1047) (#19).
- Settings › Owner shows "Former member" when the fixed owner has left, with a hint to pick another, and the removal dialog counts the forms that name them (#88). The editor's loading state draws the same tabs as the loaded editor.
- Settings is reachable before the first publish (#47). A publish that would make an attribute unique says so first (#36); a field the builder couldn't create is named (#37); changing the object on a live form says the change waits for Publish (#39); changing a question's type lets go of a field it can no longer fill (#46). Publish refusal wording names the non unique email and, without `schema.manage`, says to ask an admin (#17).
- A Needs review submission is released through `submissions.resolve` (#49). Answers not saved to the record are shown on the submission (#33, #51). A submission judged spam keeps its files for a capped window and says when they go (#52). An after submit page or redirect that stopped working shows a banner on every tab (#53).
- A form's old address keeps working (migration 0120, as booking page slugs do) (#54). A site's own form is lenient about questions its HTML never sent (#55). A visitor on an older version is reloaded in place instead of left stuck (#18). The hosted form read is not cached past a change and has its own rate limit (#67, #69). New form works for a member who can read People but not write it (#16).
