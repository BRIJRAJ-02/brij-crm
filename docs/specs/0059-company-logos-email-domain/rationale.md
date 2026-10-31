# 0059. Company logos and company from email domain: rationale

## Context

Companies show a coloured initial everywhere, and a person added with a work email stays unlinked until someone sets their Company by hand. Every CRM on the owner's parity list (Attio, HubSpot, Pipedrive, Folk) shows company logos and links people to companies by email domain. The owner put both on the 30 October 2026 list as small "alongside" items, after dropping paid enrichment (#47) on 23 October because it needs a paid provider.

The forces:

- **No paid vendor, no new key.** Enrichment was dropped for cost.
- **The app's Content Security Policy** allows images from our own origin only (`img-src 'self' data: blob:`), so a logo hosted elsewhere cannot be shown as is.
- **Neon stays on its current plan** (owner, 12 October), so storing image bytes per domain in Postgres would grow without bound against a small quota.
- **One engine path for writes** (crm-api-backend): people arrive through the app, CSV import, forms, booking, calendar sync and the public API. A rule that lives in one screen drifts from the others.
- **Hidden means absent** (crm-data-model-access): a domain a reader may not see must not reach them, even inside an image address.
- **Simpler, dumb proof flows** (owner, 30 October): default and act, Undo over confirm, fewer settings.
- The pieces exist already: spec 0055's outside fetch door and the link page favicon fetch (`apps/api/src/public/favicon.ts`, `packages/core/src/booking/favicon.ts`), the booking visitor's match or make company (`booking/visitor.ts`), and the `imageSrc` field every company picture already renders.

## Options considered

### Logos

**Option 1: the company's own site, fetched by our server, cached at the edge (chosen).** A signed in route fetches the site's icon through the outside door and answers it with a long public cache, so the edge serves repeats.

- Pros: free, no vendor, no customer data leaves to a third party, CSP unchanged, reuses tested SSRF guards.
- Cons: favicons are often small; first view of a domain costs up to 3 seconds of fetching; a changed icon lingers up to 7 days.

**Option 2: a free icon service (Google's or DuckDuckGo's favicon endpoint).**

- Pros: one request, no parsing, fast.
- Cons: tells a third party every domain in every customer's CRM; icons are the same small favicons; terms can change without notice; still needs our proxy for the CSP.

**Option 3: a logo API with a key (logo.dev and similar).**

- Pros: proper square logos, the best look.
- Cons: a new vendor, a key to manage, free tier limits, the cost question that dropped enrichment.

**Storage sub choice:** store bytes in a `domain_logos` table (one fetch per domain per month across all regions) versus edge cache only. Storing was planned (migration 0137) and dropped: bytes per domain grow without bound on a free Neon quota, while the edge already shares one copy per region.

### Filing

**Option 1: link or create inside the engine's record write, every path (chosen).**

- Pros: the same result whichever way a person arrives; one implementation; written in the person's own transaction with history, audit and events.
- Cons: bulk paths create many companies with guessed names; one more lookup per email write.

**Option 2: link existing companies only.** Safer, but most people would stay unlinked in a new workspace, which is the gap the owner wants closed.

**Option 3: suggest, don't act.** A "Link to Acme?" chip. Nothing surprises anyone, but it adds a step to every person, against the owner's "default and act" rule.

**Option 4: in the app only.** Leaves imports and the API behaving differently from the screen, which crm-api-backend rules out.

## Rationale

The owner chose, on 31 October 2026: the company's own site for logos, link or create for filing, every write path, and no workspace setting.

For logos, the decisive forces are cost and privacy: Option 1 is the only free choice that sends nobody else the customers' domains, and the outside door already answers the SSRF risk that a server side fetch of a user chosen host brings. Not storing bytes keeps Neon flat; the edge cache gives almost the same saving. A session is required only so anonymous callers cannot use our server as a fetcher; the bytes are public, so the route needs no workspace check, and hidden Domains are handled where the address is made, not where it is served.

For filing, putting the step inside `insertRecord` and `updateRecord` is what makes "every way" true without touching each path. The rule "only fill an empty Company, never replace" keeps it safe next to paths that already file (forms, booking), and running with the actor's own access keeps it inside the access door. Undo in the app answers the owner's "Undo over confirm"; matching on the registrable domain stops `eu.acme.com` from making a second Acme. A heuristic list of second level labels stands in for the full public suffix list, which would be a new dependency for a rare case (runner up: the `psl` data set, if wrong splits show up).

Picking the largest declared icon, not `/favicon.ico` first as the link page does, trades one extra request on a cache miss for a sharper picture, which matters more on a record header than on a link row.

## References

**Project sources**

- `AGENTS.md` (repo root), the rules on one write path, tokens and the house skills
- Spec 0055 (outside fetch door, AC-5531) and the link page icon route (`apps/api/src/public/favicon.ts`)
- `packages/core/src/booking/visitor.ts` (match or make a company by domain), `packages/core/src/calendar/people.ts`
- `packages/contracts/src/team.ts` (`isPublicEmailDomain`), `packages/contracts/src/values/options.ts` (`RecordRefDisplay.imageSrc`)
- Scope feature #47 (Enrichment, dropped 23 October 2026)

**Practices & standards**

- OWASP server side request forgery prevention (allow public hosts only, check after every redirect)
- Hidden means absent (house rule, crm-data-model-access)
