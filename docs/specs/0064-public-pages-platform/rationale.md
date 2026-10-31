# 0064 rationale: Public pages platform

## Context

The 31 Oct 2026 audit of the link page, booking links and forms found the platform gaps the market already treats as standard. Pages live only at `timefix.com/<handle>`; Carrd, Lnk.bio, Taplink, Stan and Cal.com offer your own domain. A person has one link page per workspace (spec 0056); Lnk.bio, Taplink and Carrd let you run several. Nothing reaches the customer's own systems: the role powers already name `webhooks.manage`, but no outbound webhook exists. There are no analytics pixels, so owners cannot measure campaigns the way they do everywhere else. Forms speak eight languages, but the link page and the booking page speak only English.

The owner asked for all phases to be completed and said to decide the details the industry standard way without asking. Two owner rules shape this spec: "Powered by Timefix" stays on every page (31 Oct), and the brand domain is `timefix.com` (apex for handle pages, `www` for marketing, `.ai` redirects).

The current platform sets the constraints. The web app and the api run on Vercel (spec 0045), brij-crm on Hobby and Timefix on Pro, with jobs run by a bounded drain instead of a long running worker. `middleware.ts` runs at the edge and may import only `@vercel/functions`. The Content Security Policy is static in `vercel.json`, per path. The handle shell is served by one function and cached at the edge. Profile tables are keyed by (`user_id`, `workspace_id`). The house rules want one wrapper per vendor, forced row level security on tenant tables, and every app to boot without optional settings.

## Options considered

### Slice 1: custom domains

**Option 1: Vercel's Domains API on our existing project, with our own TXT ownership proof (chosen).** The owner sets a TXT token and the CNAME or A record Vercel asks for. We add the host to the project after the TXT proof, and Vercel issues the certificate.
- Pros: no new host or service; certificates handled; one deployment serves every domain; the records shown come from Vercel, so they stay correct.
- Cons: tied to Vercel and to each plan's domain limits; Vercel's API is one more vendor wrapper.

**Option 2: A separate proxy in front (Cloudflare for SaaS custom hostnames).** Industry standard at large scale.
- Pros: built for thousands of customer domains.
- Cons: a new vendor, a paid plan, and new origins; more than we need now.

**Option 3: Wildcard subdomains only (`jane.timefix.com`).**
- Pros: simple.
- Cons: not the owner's own domain, which is the whole point.

### Slice 2: several link pages

**Option 1: Give each page its own id and key everything by it (chosen).**
- Pros: each page is a real thing with its own handle, look, numbers and domain; future pages features attach cleanly.
- Cons: a careful migration of the profile tables and many queries.

**Option 2: Several handles pointing at one page with filters.**
- Pros: smaller change.
- Cons: not what people mean by two pages; look and numbers cannot differ.

### Slice 3: webhooks

**Option 1: Stripe style signed webhooks, queued in the write's transaction, delivered by Graphile Worker with backoff (chosen).**
- Pros: the pattern every developer and Zapier, Make and n8n already know; no lost or phantom events; retries and a log built in; no new vendor.
- Cons: retries depend on the drain cadence on Hobby.

**Option 2: A hosted webhook service (for example Svix).**
- Pros: retries, portal and logs out of the box.
- Cons: a new vendor and cost, and personal data leaves through a third party.

**Option 3: Read the outbox and fan out.**
- Cons: the outbox holds ids only and its relay is off on Vercel (spec 0045), so it cannot carry payloads today.

### Slice 4: pixels

**Option 1: GA4 and Meta Pixel IDs, loaded only after consent, with a static policy on public paths (chosen).**
- Pros: what Linktree, Calendly and Typeform offer; lawful in the EU and UK; app pages untouched.
- Cons: the public page policy grows by a few origins.

**Option 2: Arbitrary custom script or tag manager containers.**
- Cons: any script on our pages, an open door for abuse and a policy that allows everything.

### Slice 5: visitor language

**Option 1: Per language catalogues with English fallback, loaded on demand, Automatic by default (chosen).** The same shape forms already use.
- Pros: one pattern across forms, booking and link pages; small first load.
- Cons: copy to keep in step in eight languages.

**Option 2: Machine translation at request time.**
- Cons: a new vendor, slower pages, and wording we cannot review.

## Rationale

Each slice takes the option that matches what the market does and what our platform already runs. Custom domains on Vercel's own API avoid a new service, and the TXT token before binding is the standard guard against domain takeover, the attack where someone points a host at a platform and another account claims it. Keeping `timefix.com/<handle>` alive with a canonical to the custom domain means no shared link ever breaks, which matters more than a tidy redirect. Emails keep the `timefix.com` address because it is always valid, even while a custom domain is being fixed.

Several link pages need a real page id; anything less turns into special cases in every query, and domains, pixels and language all hang off a page. Webhooks follow the Stripe shape (timestamped HMAC signature, stable event id, exponential backoff, a delivery log, secret rotation with overlap) because receivers and automation tools already handle it. Queuing in the write's transaction is what makes them trustworthy. The address checks at every send, connecting to the checked address, are the standard answer to server side request forgery, including DNS rebinding.

Pixels load only after consent with equal Allow and Decline because that is what EU and UK law requires and what users now expect; a tag manager or custom script slot was refused because it would let any script run on our public pages. Language reuses the forms pattern so one approach covers every public page.

Choices made without asking, by industry standard:
- One domain per link page, `www` added and redirected for an apex.
- Domains pending 7 days fail with a Try again; checks every 15 minutes, daily when live.
- Up to 5 link pages per person per workspace (Lnk.bio and Taplink range), one primary.
- Webhook retries over about 1.5 days, endpoints turned off after 3 days of failure, logs kept 30 days, at most 10 endpoints, payloads at most 64 KB.
- Consent remembered 6 months; Google consent mode default denied.
- Visitor emails in the language the visitor booked in.
- "Powered by Timefix" stays on custom domains too (owner rule).

## References

**Project sources** (verifiable, in this repo):
- `AGENTS.md` house rules, `crm-api-backend` and `crm-data-model-access` skills
- Spec 0045 (api on Vercel, the drain and its cadence), 0051 (link page), 0055 (handle shell and meta), 0056 (link page per workspace), 0058 (visual rules), 0008 (background jobs)
- `apps/web/middleware.ts`, `apps/web/vercel.json`, `apps/web/csp.ts`, `apps/web/handle-shell.ts`, `apps/web/handle-meta.ts`
- `packages/db/src/schema/auth.ts` (profile and handle tables), `packages/contracts/src/forms/public.ts` and `forms/strings.ts` (languages and catalogues), `packages/contracts/src/access.ts` (`webhooks.manage`)

**Practices & standards**:
- Domain ownership proof by DNS TXT before binding (domain takeover prevention)
- Timestamped HMAC SHA256 webhook signatures, idempotent event ids, exponential backoff with jitter
- OWASP server side request forgery prevention, including DNS rebinding
- GDPR and ePrivacy consent before non essential cookies and trackers; Google consent mode v2
- Transactional enqueue of side effects
