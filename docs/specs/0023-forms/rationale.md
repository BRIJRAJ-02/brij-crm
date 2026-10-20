# 0023. Forms: rationale

## Context

Leads and requests reach a company through its website: a contact form, a demo request, an event sign up, a job application, a support request. Today a member would retype each one into the CRM. Forms close that gap, and they are the front door for most new records, so they decide how clean the data stays: a form that creates a duplicate person for every submission, overwrites what a salesperson typed, or lets bots in, does more harm than having no form.

The CRM is generic (any object, any attribute, relationships between objects), multi tenant, and built for a million records per workspace. Forms must work on every object through the same engine, the same field set and the same validation rules, or a form could store a value the CRM itself would refuse. A submission usually touches several linked records at once: the person, their company found by the email's domain, maybe a deal or a pipeline entry. Each of those may already exist, and two submissions for the same new person can arrive in the same second.

Forms are also the CRM's first public, unauthenticated surface. Anyone on the internet can post to them, from any site, at any rate. They run on customers' websites, inside pages we don't control, styled by CSS we didn't write. Visitors expect them to be fast and never lose what they typed, even when our API is mid deploy. Customers expect HubSpot and Apollo style reach: a hosted link, an inline embed, popups, capturing the forms they already have, and analytics on views, drop off, sources and what submissions became.

Compliance: submissions, consent records, visitor ids and page views are personal data under GDPR (and similar laws). Consent must be recorded with its exact wording, withdrawable, and erasable with the person; tracking needs prior consent. The audit log (#36) records publishing, key rotation, domain changes and consent withdrawals.

The build order puts forms in Slice 15, after round robin (#58) and booking pages (#59), notifications (#28), trash (#22), duplicates (#31), files (#32), the public API (#34), audit and privacy (#36) and plans (#38), so each of those exists when forms are built.

## Options considered

### Option 1: store first, process in a job, a versioned form document, a small public bundle on the existing host

The submit request validates and stores one row, then a background job turns it into records through the engine as a form actor. A form's questions, steps, logic and mappings are one checked JSON document per version. The hosted page and embed script are a separate small build on the existing Vercel project, calling a small REST surface on the API.

**Pros**:
- The public request does the least possible work, so it is fast and rarely fails; the job retries; the browser retries when the request can't reach us.
- Matching, linking and assignment run in one place with one lock discipline, so concurrent submissions can't create duplicates.
- Versioning is trivial: publish freezes a document; every submission knows exactly what the visitor saw.
- Nothing new to host or operate.

**Cons**:
- A submission becomes a record a second or two later, not in the request.
- The document is opaque to SQL (drift checks need a small index of mapped attribute ids).
- Rate limits held in the API's memory are only right while there is one API instance.

### Option 2: write records in the request

The submit endpoint matches and writes the records directly and answers with the result.

**Pros**:
- The record exists the moment the visitor sees the thank you.
- One less moving part (no processing job).

**Cons**:
- Every visitor request takes the matching locks and writes several rows, so a burst of submissions contends with members' edits and slows the public endpoint.
- Any database or engine failure is visible to the visitor, who may give up: the lead is lost.
- Routing and assignment (round robin) run under public traffic, harder to retry safely.

### Option 3: normalised form tables and a separate forms app

Forms, steps, questions and logic rules as rows; the public pages and script as their own app on their own domain and host.

**Pros**:
- A single question can be queried across forms with SQL.
- The public surface is fully isolated from the CRM's deploys.

**Cons**:
- Versioning means copying many rows on every publish, and a submission's version is harder to reconstruct.
- A second app, deploy pipeline, domain and monitoring to run, for a team that runs one.

### Option 4: an external form service

Embed a third party form builder and receive its webhooks.

**Pros**:
- Mature builders, little to build.

**Cons**:
- Questions can't use the CRM's field set or validation rules, so the data drifts from the CRM's types.
- Another vendor per customer, another bill, and visitor data in a third place; captured site forms, routing to booking and outcome analytics would still have to be built here.

## Rationale

Option 1 fits the forces best. Forms are the first public surface and the front door for new records, so the request that faces the internet must be small and hard to break, and the work that must be right (matching, linking, owners, notices) must run where it can be retried and serialised. Storing first and processing in the existing background job runner (#8) gives both, with no new infrastructure, which matters for a small team running everything on Railway, Neon and Vercel.

Writing records in the request (Option 2) feels simpler but puts the hardest, most contended work on the least trusted traffic, and turns every internal failure into a lost lead. The visitor never needs the record id; they need a fast thank you and a next step, which the published version and the validated answers already decide.

The versioned document follows from draft and publish: the form a visitor answered must be reconstructible forever, and one frozen document per version is the simplest exact record of it. The small public bundle on the existing host keeps visitors off the CRM's app bundle without a second deployment, and shadow DOM gives the CSS isolation customers' sites need while still reading the page's UTM tags and prefill. The engineer chose reCAPTCHA v3 for its familiarity and invisible scoring over Cloudflare Turnstile (which was recommended for privacy and cost); it works, but it sends visitor data to Google and needs a line in each customer's privacy notice, which the forms show by default. Consented visitor tracking was chosen to stay inside this spec as its last milestone; it is the part with the heaviest privacy obligations, so it is gated on consent at every step, hashed at rest, and erased with the person.

Calls made in this spec without a separate question, each with its runner up:
- Rate limits as in memory token buckets in the API (runner up: a Postgres table), because there is one API instance today and a table would add a write per request; moving to a shared store is a Follow-up for #41.
- A transaction advisory lock per normalised match key during processing (runner up: rely on unique constraints and retry on conflict), because multi value attributes such as several emails can't carry a plain unique index across values.
- reCAPTCHA failures at Google (timeout) process the submission as unchecked rather than spam (runner up: treat as spam), so a Google outage never silently drops real leads.
- Score threshold 0.3 and minimum fill time 2.5 s as defaults, settable per form.
- `form_settings` as a one row per workspace table for extra free domains and the digest hour, a small addition to the confirmed model.
- The visitor cookie value is stored only as a salted hash.
</content>
</invoke>

## Revision, 19 October 2026

The owner asked for forms to follow the model of their earlier scheduling product, whose forms ran in production: questions in plain words with an optional filing per question, one deliberate Publish with a status line that always says what is live, one page for the visitor with no captcha, and a thank you that hands the visitor to a booking. The data model, the store first rule and the processing job stay. What changed and why is in [0023-experience.md](0023-experience.md). Calls made without a question, each with its runner up:
- The draft is still saved on the server, quietly (runner up: an in memory draft with Publish as the only write, as the earlier product did), because a CRM has teammates and a closed tab must lose nothing; the status line still never says "Saved".
- reCAPTCHA becomes optional (runner up: keep it required), since the honeypot, timing, rate limits and idempotency held up without it and it sends visitor data to Google.
- The embed is an iframe sized by the script (runner up: shadow DOM), so the form looks the same on every site and the hosted page is the only renderer.
- Steps, conditions and popups are deferred (runner up: keep them in milestone 2): one page converts and is simpler to build well.

## Revision of 20 October 2026: types, logic and routing

The owner's roadmap decisions of 20 October 2026 reopened what the 19 October revision had closed: the visitor page may have several layouts ("different types of forms if needed"), and steps and conditions come back as a simple "show when" with no flow canvas. The research pass (Typeform, Tally, Fillout, HubSpot, Chili Piper, Cal.com routing forms) found that most lead forms need four things beyond Classic: a few more answer types, prefill from the link, a company found from the work email, and routing to the right person's calendar. A lane (`wip/formdesign`) is redesigning Classic now and drew Steps and Conversational as stories.

Options weighed:
- **Show when rules on questions and steps, one rule shape reused by routing (chosen).** Small, testable, readable as a sentence on the closed card.
- **A logic canvas (Typeform jumps).** Powerful, but the owner turned it down, and it is hard to check at publish.
- **Routing as its own object shared by forms (Cal.com Routing forms, Chili Piper).** Deferred: one form per routing need is the common case, and the rule shape can move to a shared object later without changing the visitor's side.

Calls made without a question: Classic stays default; Steps ships before One at a time (it reuses the Classic card); deal filing names deals "<company or person> from <form name>"; notices default to each submission with a digest opt in; retention defaults to forever with spam deleted after 30 days; anonymous counters before any visitor tracking. Details and the build order: [0023-types-and-logic.md](0023-types-and-logic.md).

