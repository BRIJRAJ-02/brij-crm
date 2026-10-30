# 0059. Company logos and company from email domain

**Date**: 2026-10-31
**Status**: Proposed

**Numbering**: 0059 taken on 31 October 2026 (0058 is crm-b5's "Visual and short"). This spec owns AC-5901 to AC-5999. It touches spec 0017 (record display), 0014 (relationships), 0040 (import), 0023 (forms), 0025 (booking) and 0024 (calendar sync), and changes none of their rules beyond what is written here.

## Summary

Two parity items from the owner's 30 October list, both free and with no new vendor. First, a company with a domain shows its own logo everywhere it appears, fetched from the company's site by our server and served from our own address, so the browser never talks to the company's site. Second, a person with a work email (jane@acme.com) and no Company is linked to the company that holds acme.com, and when none does, "Acme" is created and linked. Free addresses (gmail.com) never do this, a Company someone set is never replaced, and the app offers Undo.

## Requirements

**User stories**

- As a member, I want companies to show their real logo, so I recognise them at a glance in tables, boards and chips.
- As a member, I want a person I add with a work email to be linked to their company without a second step, so my records stay connected.
- As a member, I want one click to undo a link or a company I did not want.

**Acceptance criteria**

*Logos*

- **AC-5901**: A company record whose Domains attribute holds at least one value shows that domain's site icon wherever its picture shows (record chip, record header, board card, record panel, relation cells, search, mentions) in place of its coloured initial. A company with no domain, or whose site gives no usable icon, keeps its coloured initial, with no broken image and no layout shift.
- **AC-5902**: The icon comes from the first Domains value (the value shown first). When that value changes, the next read shows the new domain's icon, because the picture's address names the domain.
- **AC-5903**: The browser loads the icon from our own origin only. The Content Security Policy (`img-src 'self' data: blob:`) is unchanged, and no request leaves the browser for the company's site.
- **AC-5904**: The server picks the best icon the site offers: the smallest icon the home page's head declares at 96 px or more, else the largest it declares (`apple-touch-icon` without `sizes` counts as 180 px, any other icon without `sizes` as 0, SVG skipped), else `/favicon.ico`. Every fetch goes through the one outside fetch door (spec 0055, AC-5531): https only, private and internal addresses refused before connecting and after each redirect, one shared 3 second deadline for the page and the images together (the link page fetch now shares it too), 128 kB at most, image types only.
- **AC-5905**: An icon is kept for 7 days in the browser and at the edge, so one domain costs at most one fetch per edge region per 7 days, whichever workspaces show it. The answer that a site has no icon is kept a day, and a timeout or network failure 5 minutes.
- **AC-5906**: Only a signed in user gets an icon fetched; without a session the route answers 404 unless the edge already holds the icon. A domain that is not a valid public host name, uses a special use TLD, is not in canonical lowercase form, or comes with a query string answers 404 without a fetch. The session is read without renewal, so a cacheable answer never carries `Set-Cookie`. A user may make at most 300 icon requests a minute; past that the route answers 429.
- **AC-5907**: Hidden means absent: when the reader cannot see a company's Domains attribute (a field rule hides it), the company's display carries no picture address, so the domain never reaches that reader.

*Company from email domain*

- **AC-5911**: When a person record is created, or its Email addresses change, and its Company is empty after the write, the first email address whose domain is not a free mail domain decides the company. If a live company holds that domain in Domains, the person is linked to it. If none does, a company is created and linked.
- **AC-5912**: Matching tries the email's host first (`eu.acme.com`), then its registrable domain (`acme.com`). A created company holds the registrable domain.
- **AC-5913**: A created company is named from its domain: the first label of the registrable domain, hyphens and underscores read as spaces, each word capitalised (`acme.com` gives "Acme", `big-corp.co.uk` gives "Big Corp"). Its Domains holds the registrable domain, and its Owner is the acting member when a member acts (none otherwise). When the Companies name attribute is not a text type, the name is left empty.
- **AC-5914**: Free mail domains never link or create: `isPublicEmailDomain` from `@crm/contracts` decides (the same list the workspace domain setting uses), so gmail.com, hotmail.se and yahoo.com.mx are all skipped.
- **AC-5915**: A Company already set is never replaced, and changing or removing an email never removes a link.
- **AC-5916**: Every way a person is written behaves the same: the app (create dialog, table cell, record page, paste, bulk edit), CSV import, forms, booking, calendar sync and the public API. A path that sets the Company itself (a form's or a booking's own company filing) keeps what it set.
- **AC-5917**: Two writes for the same new domain at the same moment create one company, and both people are linked to it.
- **AC-5918**: The created company, its values, the link, their value history, audit entries and change events are written in the same transaction as the person's write. If any part fails, the person's write fails as it would have anyway; filing never fails a write on its own (see AC-5919).
- **AC-5919**: Filing runs with the acting scope's access. Linking needs read on the company and write on the person's Company attribute; creating needs create on Companies. When the actor lacks any of these, nothing is filed and the person's write succeeds unchanged.
- **AC-5920**: In the app, after a create or edit that filed a company, a toast says "Linked to Acme" (an existing company) or "Added Acme and linked it" (a created one), with Undo. Undo clears the person's Company, and trashes the company when this write created it and nothing else links to it now. Undoing the person's create (⌘Z) undoes the filing too.
- **AC-5921**: Other tabs see the new company and the link live, through the change events of AC-5918, with no reload.

## Decision

**Chosen option**: Option 1 for logos (the company's own site, fetched by our server, cached at the edge, nothing stored), and Option 1 for filing (link or create inside the engine's record write, for every path).

Logos reuse the link page icon fetch (spec 0055's outside door and `@crm/core` favicon helpers) behind a new signed in route, keyed by domain; filing is one engine step inside `insertRecord` and `updateRecord`, reusing the booking visitor's match or make logic.

**Implementation skills**: `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `crm-design-system` (`.claude/skills/crm-design-system/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`)

## Feature design

**Data model sketch**

- No new table and no migration. Logos are not stored: the edge and the browser keep them (AC-5905).
- Uses existing standard attributes (`templates/standard-v1.ts`): People `email_addresses` (email, many, unique), People `company` (record reference to Companies, the `people.company` / `companies.team` relationship), Companies `domains` (domain, many, unique, so `values.unique_key` finds the one holder), Companies `name` (text, primary), Companies `owner` (actor reference).
- Filing finds attributes by the objects' `standard_key` (`people`, `companies`) and api slug, live only, as `booking/visitor.ts` and `calendar/match.ts` do. A workspace that archived or retyped one of them simply files nothing.

**API surface**

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/logos/:domain` | GET | `domain` (lowercase host, path) | image bytes, `content-type`, `cache-control: public, max-age=604800, s-maxage=604800` | signed in session (Better Auth cookie) | 404 no icon (`public, max-age=86400, s-maxage=86400`; a timeout or network failure 5 minutes), 404 invalid host or no session (`private, no-store`, so the edge is never poisoned), 429 over 300 a minute per user (`private, max-age=<retry after>`) |
| `records.create`, `records.update`, `records.setValues` (existing oRPC) | POST | unchanged | adds `filedCompany?: { recordId, name, made: boolean, linkVersionId }` | unchanged | unchanged |

**Value sourcing**

| Action | Value produced / displayed | Source |
|---|---|---|
| read records (`readRecords`, `engine/records.ts`) | company `imageSrc` | `/api/logos/<domain>`, where `<domain>` is the record's first current `domains` value (lowest position), lowercased; only when the reader can see `domains` (AC-5907) |
| logo route | which icon URL | home page `https://<domain>/` head via `declaredIcon`, with a `'logo'` preference (smallest at 96 px or more, else largest, per AC-5904); else `https://<domain>/favicon.ico` (`faviconSources`) |
| logo route | the user | Better Auth session (`deps.auth.session`), as `/api/files/:fileId` reads it |
| logo route | rate limit key | `logos:<userId>`, the api's existing limiter |
| filing | the email | the person's first current `email_addresses` value (lowest position) whose domain is not free |
| filing | host and registrable domain | derived: `domainOf(email)` (contracts, lowercase); registrable = last two labels, or last three when the second last is one of `co`, `com`, `net`, `org`, `ac`, `gov`, `edu`, `ltd`, `plc` and the last is a two letter country code |
| filing | free or not | `isPublicEmailDomain` (`@crm/contracts`, team.ts) |
| filing | the holder | live record whose `domains` value has `unique_key` equal to the host, then the registrable domain (`holderOf`) |
| filing | created company name | derived from the registrable domain (AC-5913) |
| filing | created company owner | the scope's actor when it is a member (`ownerValue`) |
| filing | concurrency | `pg_advisory_xact_lock` on a hash of `workspace_id` and the registrable domain, taken before the holder check |
| app toast | text and Undo | the write answer's `filedCompany` |

**Key invariants**

- Filing only ever adds a link to a person whose Company is empty after the write; it never edits, replaces or removes.
- At most one live company holds a domain (the attribute is unique; the lock covers the moment before the unique value exists).
- A free mail domain never decides a company.
- The logo route never fetches without a session, and never fetches an address the outside door refuses.
- No logo bytes are stored in Postgres or blob storage.

**Security model**

- Logo bytes are a public site's public icon, so edge caching shared across workspaces leaks nothing. The domain itself is tenant data, so it appears in a display only for a reader who can see Domains (AC-5907). The route needs a session only to stop anonymous use of our server as a fetcher; it does not check a workspace, because the answer is the same for everyone.
- The route is a server side fetch of a user chosen host: the outside door (spec 0055) is the SSRF guard, and the host must pass `isFaviconSite` and be a public host name (no IP literal, no port, no credentials).
- Filing acts as the write's own actor, through the same door and rules as the write (AC-5919). Import acts as the importer, forms as the form actor, booking and calendar sync as the system, exactly as their writes already do.
- The created company's audit entry and history name the same actor as the person's write.

**Configuration required**

None.

**Critical test scenarios**

- Happy path: a member creates Jane with jane@acme.com in a workspace with no Acme; Jane links a new "Acme" holding acme.com, the toast offers Undo, a second tab shows both live; verifies **AC-5911**, **AC-5913**, **AC-5920**, **AC-5921**
- Existing company: Bob at bob@eu.acme.com links the existing Acme (acme.com), no company is created; verifies **AC-5912**
- Free mail: sam@gmail.com and lea@hotmail.se file nothing; verifies **AC-5914**
- Set company kept: a person with Company "Initech" gets a work email at acme.com; Company stays Initech; verifies **AC-5915**
- Race: two transactions create people at newco.io at once; one company exists afterwards, both linked; verifies **AC-5917**
- No access: a member whose role cannot create Companies adds a person at newco.io; the person is created, nothing filed; verifies **AC-5919**
- Paths: a CSV import row, a form submission without a company question, and an API create each file the same way; verifies **AC-5916**
- Undo: Undo after "Added Acme and linked it" clears Company and trashes Acme; after "Linked to Acme" only clears Company; verifies **AC-5920**
- Logo: a company with domain example.org shows the route's image; a site with no icon keeps the initial; a request without a session gets 404; a hidden Domains attribute gives no `imageSrc`; verifies **AC-5901**, **AC-5906**, **AC-5907**
- Logo fetch: the route refuses `localhost`, `10.0.0.1`, `[::1]` and a host that redirects to a private address, without connecting; verifies **AC-5904**

## Build plan

Tracer Bullet: one thin thread for each half, end to end, then thicken.

1. Filing core: `fileCompanyFromEmail(tx, scope, personId)` in `packages/core/src/engine/` (or `records/`), with the registrable domain helper, the lock, the holder lookup, the create and the link, reusing `bySlug`, `holderOf` and `ownerValue` (move them from `booking/visitor.ts` to a shared module); called at the end of `insertRecord` and `updateRecord` for the standard People object when `email_addresses` was written; DB tests for the happy path, existing, free, kept, race and no access cases; satisfies **AC-5911** to **AC-5915**, **AC-5917** to **AC-5919**
2. Return `filedCompany` from `insertRecord` / `updateRecord` through `addRecord` / `editRecord` and the records router answers; contract field in `packages/contracts`; satisfies **AC-5920**
3. Paths: tests that import, forms (no company question), booking (its own company kept), calendar sync and the public API file through step 1; satisfies **AC-5916**
4. Data layer and screens: the create and edit paths read `filedCompany`, push one undo entry that clears the link (with `ifVersionId` = `linkVersionId`) and trashes a made company that nothing else links; the create dialog, cell edit and record page show the toast with Undo; browser tests; satisfies **AC-5920**, **AC-5921**
5. Logo route: `apps/api/src/logos.ts` on `createFaviconFetch` (extended to prefer the page's largest declared icon for this caller), session check, host check, limiter, cache headers; tests with a fake fetch and lookup; satisfies **AC-5903** to **AC-5906**
6. Display: `readRecords` reads the first `domains` value for company records the reader can see Domains on, and sets `imageSrc`; tests including a hidden Domains field; satisfies **AC-5901**, **AC-5902**, **AC-5907**
7. Check the screens: Avatar's square company shape with a real icon, light and dark, no layout shift while loading; a failed image falls back to the initial; design system and UX reviewers; satisfies **AC-5901**

## Consequences

**Positive**

- Companies look like themselves everywhere, at no cost and with no vendor.
- People arrive linked to their company from every path, which makes the Team section, deal association and reports useful from day one.

**Negative / tradeoffs**

- Favicons are often small and plain; some companies will show a blurry or generic icon. A logo API would look better and is the follow up if the owner wants it.
- Bulk paths (a 10,000 row import, calendar sync of many attendees) now create companies too. That is the point, but it can add many companies with names guessed from domains ("Acmecorp" rather than "Acme Corp").
- One more query per person write that touches emails (the holder lookup), and one advisory lock per new domain.
- The edge cache keeps a changed site icon for up to 7 days.

**Neutral**

- `booking/visitor.ts` keeps its own filing for a booking (it runs first and sets Company), so the engine step finds Company set and does nothing there.
- Calendar sync's "link only when exactly one company holds the domain" rule (spec 0024, AC-607) is now followed by the engine step creating one when none does.

## Follow-up

- [ ] Scope: no scope row covers this (feature #47 Enrichment is dropped). Enroll it with `/scope`, or note it beside the CRM parity list.
- [ ] Spec 0024 (calendar sync) and spec 0025 (booking) should gain a line pointing here for companies created from attendees and visitors.
- [ ] Risk to note: anyone can probe the shared edge cache to learn whether some user viewed a domain's logo in the last 7 days. Accepted with edge sharing; revisit if a customer objects.
- [ ] Declared icons and redirects may name any public https host, so the route is a weak GET reflector (300 a minute per user), the same as the link page icon route.
- [ ] Tables in `packages/data` do not read Domains, so another person's domain change does not refresh a table row's logo live.
- [ ] Look: transparent favicons on the dark mode hue tile may read poorly; a neutral plate under a loaded picture is the owner's call.
- [ ] A workspace switch to turn filing off was declined (owner, 31 October 2026); revisit only if someone asks.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
