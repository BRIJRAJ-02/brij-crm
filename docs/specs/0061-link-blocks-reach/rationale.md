# 0061 rationale: Link page blocks and reach

## Context

The link page (spec 0051, built as blocks, then per workspace in spec 0056) holds eight kinds: link, heading, booking page, contact card, writing, questions, form and testimonial. Every one draws as the same row card in one centred column. A link's picture is a mark, an icon, the site's icon or a letter, all served from our origin so the public policy (`img-src 'self' data: blob:`) never widened. Insights are page views, visitors and per block presses by day, counted with a daily HMAC visitor and no address (spec 0047's rule).

The 31 October 2026 audit set this against Linktree, Beacons, Bento, Carrd, Stan, Lnk.bio and Taplink. The biggest gaps were pictures (thumbnails, images, galleries), media (video and music), a grid layout, a social icons row, scheduled links and a banner, a sensitive content notice, a way to book from the page itself, and insights that say where visitors come from. Search engines only see the shell's meta tags. The QR is a plain PNG and share links carry no tracking.

The owner asked for every phase to be built, decided the industry standard way without questions, with "Powered by Timefix" kept. The house rules stay in force: tokens and library components only, no new origin without a reason written down, forced access through `crm_handle` definers for anything under `auth`, privacy first counting, and the public bundle's first load budget is a spec change to raise.

## Options considered

### Option 1: New kinds in the existing block list, served from our origin, with click to load media

Add each feature as a block kind or a field in `data`. Store pictures in the existing private file store under a `link-page/` prefix and serve them through the api after a live block check. Load media only when the visitor presses Play. Extend the day rollups for insights.

**Pros**:
- Matches how the page already works (one schema, one renderer, one editor per kind).
- Keeps every picture on our origin, so the image policy stays as it is.
- Privacy holds: nothing outside loads unless the visitor chooses it.

**Cons**:
- The frame policy gains five provider origins.
- Picture storage and a daily sweep to maintain.

### Option 2: A free layout document (a page builder model)

Replace the ordered list with a layout tree (rows, columns, nested sections) like Carrd.

**Pros**:
- The most freedom.

**Cons**:
- A rewrite of the editor, the public read, the import and the counters, all for a use (a mini website) the product doesn't aim at.
- Free layouts break reading and focus order easily, which our accessibility baseline forbids.

### Option 3: Direct embeds and hotlinked pictures

Put provider iframes and outside image addresses straight on the page.

**Pros**:
- Least server work.

**Cons**:
- Every visitor is tracked by YouTube and others on page load, and the image policy must open to the whole web.
- Slow first load; a hotlinked picture can change or disappear under the owner.

## Rationale

Option 1 gives owners what the leading link tools give them while keeping the two promises this page already makes: it is fast, and it is private by default. The ordered list stays the one model, so the editor, import, search and counters keep working and each new kind is a contained addition. Option 2 trades our accessibility rule and months of work for freedom few owners need. Option 3 breaks the privacy promise on the very first paint.

Choices made without asking, by industry standard:
- **Facade before play** (YouTube's own recommendation, and what privacy aware link tools do). YouTube plays from `youtube-nocookie.com`.
- **Pictures stored, not hotlinked**: owners expect a picture to stay as they saw it, and the policy stays narrow.
- **Downscale in the browser, strip metadata on the server**: phones produce 5 to 12 MB photos with GPS inside; making them 1600 pixels before upload is what Instagram and Linktree do, and the server removes the metadata whatever arrives.
- **Grid without dense packing**: Bento packs tiles freely, but packing reorders what you see against the reading and focus order. We keep the order and let the owner pick sizes.
- **Next open times instead of a full embedded picker**: the full booking picker on the link page would cost the first load budget. Chips that open the booking page at that time give the two tap booking Calendly embeds give, at a fraction of the weight.
- **Sensitive content and age notices are self declared**, as on Linktree. No identity check.
- **Several contact cards** (up to 3) for people with a work and a personal card, keeping the old single card address working.
- **Insights by fact, not by visitor**: referrer host, `utm_source`, country and device class are what Linktree's paid insights show. We roll them up by day and never store an address, a user agent or a cookie, so no consent banner is needed.
- **Bookings in the funnel** are counted from the booking request's `via`, checked against the handle's live blocks, and never stored on the booking, so the booking record stays the same.
- **Structured data and crawler text** in the shell instead of full server rendering: the page is client drawn by design (spec 0051), and search engines index JSON-LD and the shell's text without a second renderer to maintain.
- **QR on a light background only**, with a contrast floor of 4.5 to 1 and the highest error correction under a centre picture, because a stylish code that doesn't scan is worse than a plain one.
- **New public routes under `/api/public/profiles/:handle/`**, because `/api/public/handles/:handle/:slug` already names a booking page.
- **Reuse the existing private file store** with a prefix, so no new account or token is needed from the owner.

## References

**Project sources**:
- Specs 0047 (site visits and the daily visitor), 0051 (link page), 0052 (writing, questions, forms, testimonials), 0054 (folders), 0055 (import, the outside fetch door), 0056 (per workspace), 0058 (look and feel rules)
- `packages/contracts/src/booking/link-page.ts`, `link-page-rules.ts`, `apps/api/src/public/booking.ts`, `apps/api/src/public/favicon.ts`, `apps/api/src/public/outside.ts`, `apps/api/src/storage/blob.ts`, `apps/api/src/edge.ts`, `apps/web/handle-meta.ts`, `apps/web/vercel.json`, `apps/web/.size-limit.js`
- Migrations 0098 (profile items) and 0100 (profile counts)

**Practices & standards**:
- Click to load facades for third party media
- OWASP SSRF prevention (resolve, check ranges, recheck on redirect, cap size and time)
- CSV injection guard (leading `'`)
- Schema.org `ProfilePage` and `Person`
- WCAG 2.2 AA (focus order matches visual order, named controls, contrast)
