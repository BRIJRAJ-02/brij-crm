# 0061 verify: Link page blocks and reach

How `/check verify` proves each criterion on the real app. Screenshots are taken in every spec 0060 look, light and dark, at 390 and 1280 wide, inside the real layout, with the editor's popovers open where they exist. The verifying agent looks at every screenshot before a lane lands.

## Network and policy checks

- A Playwright run on a page with every new kind records the network log. Before Play is pressed, every request is to our own origin (AC-6106, AC-6127). After Play, exactly one provider origin from the AC-6107 list appears.
- `apps/web/csp.test.ts` pins the handle policies' `frame-src` to the five origins, and pins the app, `/b/` and `/f/` policies unchanged (AC-6107, AC-6131).
- No `Set-Cookie` on any handle response; session storage holds only the two allowed keys (AC-6127).

## Per criterion

| AC | How it is checked |
|---|---|
| AC-6101 | Browser test: upload a thumbnail, it draws in the row and the grid tile; "Use the site's picture" against a test server with `og:image` stores one; a failing site falls back to the icon order. The picture's address is on our origin with a version. |
| AC-6102 | Browser test: a fourth featured link is refused; featured draws larger; no animation on first paint (computed style). |
| AC-6103 | Browser test: grid at 390 has 2 columns and at 1280 has 4; sizes draw as set; full row kinds span; keyboard Tab order equals DOM order equals visual order (compare box positions). |
| AC-6104 | Story and browser test: socials row draws the person's links with accessible names; a second socials block is refused. |
| AC-6105 | Unit tests in `packages/core/src/profile/embeds.test.ts` for each provider's accepted and refused links, including look alike hosts and extra query text. |
| AC-6106 | Browser test: facade first, Play swaps in the player at the same size, focus moves into it; the frame `src` matches the template for the parsed id. |
| AC-6107 | CSP test as above. |
| AC-6108 | Browser test: a 6 MB photo is made at most 1600 pixels and at most 1.5 MB; alt is required; caption and link work. Server test: a file whose first bytes are not JPEG, PNG or WebP answers 415. |
| AC-6109 | Browser test: gallery row snaps; the viewer opens, arrows move, Escape closes and focus returns. |
| AC-6110 | Browser test: chips show up to 6 times in the visitor's zone; a chip opens the booking page with that time chosen; a taken time shows the "just taken" line; no times shows the empty line. Read is cached 60 seconds (headers). |
| AC-6111 | Core test: blocks outside their window are left out of the public read; editor chips read right; "Hide after" before "Show from" is refused. |
| AC-6112 | Browser test: banner sits above the card, closes for the session, a second live banner is refused. |
| AC-6113 | Browser test: notice sheet, Continue opens and counts, Go back does neither, remembered for the session; noticed links are `nofollow` and absent from JSON-LD and the crawler text. |
| AC-6114 | API test: `contact.vcf?card=<id>` answers that card; no `card` answers the first; an id from another page answers 404. |
| AC-6115 | Contract tests for every limit and its sentence; the Add grid disables a full kind. |
| AC-6116 | API test: the view stores the four facts only; a bad `src` or `ref` is dropped, never stored raw; owner and machine views do not count. Schema check: no column holds an address or user agent. |
| AC-6117 | DB test: two views from one visitor on one day add one visitor and two views per value; the 51st value of a day lands in "Other". |
| AC-6118 | Browser test: Insights chart, top values, presses; the table alternative is in the accessibility tree; empty state line. |
| AC-6119 | Flow test: view, press, book through `/<handle>/<slug>`; the funnel shows 1, 1, 1; a `via` naming a page not on that handle adds nothing; the booking row has no new column. |
| AC-6120 | API test: CSV rows, a 366 day range refused, a title starting with `=` written with `'`. |
| AC-6121 | Shell test: JSON-LD present and valid for an indexable page, absent when not indexable, `<` escaped. Validated with the Schema.org validator rules in the test. |
| AC-6122 | Shell test: names, bio and link titles in the root as text, escaped, noticed links absent. Browser test: layout shift on mount at most 0.05. |
| AC-6123 | API test: sitemap lists only public, indexable pages with a live block; index file past 50,000 (test with a small split size); robots names it. |
| AC-6124 | Test decodes the styled QR (PNG and SVG) back to the address with a decoder in the test; low contrast colour is refused. |
| AC-6125 | Browser test: each preset link carries its `utm_source` and `utm_medium`; the builder escapes values; a visit through one shows under Sources. |
| AC-6126 | `pnpm size` on CI: booking page budgets unchanged. Build test: media, image, gallery, times and notice code are separate chunks and absent from the first load. |
| AC-6128 | API tests with a fake resolver: private, loopback, link local and metadata addresses refused before connect and after a redirect; 3 second cap; 64 kB and 1 MB caps; SVG refused. Metadata test: a JPEG with GPS EXIF comes back without it. Rate limit test. |
| AC-6129 | Guard tests: `crm_app` cannot select the new tables; definers owned by `crm_handle` with a fixed `search_path`; an image id of another page answers 404. |
| AC-6130 | Spec 0058's alignment probe and motion check on every new block and editor piece, in every look, light and dark. |
| AC-6131 | Existing flows pass on CI (`booking-journey`, `booking-edges`, `form-to-booking`); the booking page answers `at` and `len` and nothing else changed (network diff on `/b/:key`). |

## Before landing a lane

1. Design skills pass (`crm-design-system`, `interaction-design`, `emil-design-eng`, `interface-affordances`, `subtractive-design`), then `design-system-guardian` and `ux-interaction-reviewer` for R3 and R4.
2. `security-access-reviewer` for R1 and R2, `state-performance-reviewer` for R2, R4 and R5.
3. Heavy suites on CI through the lane push script; only single test files locally, behind the load gate.
