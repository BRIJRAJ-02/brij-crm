# 0060 rationale: Brand kit and link page themes

## Context

The link page's look (spec 0054) is six names from closed sets: ground, hue, mode, shape, fill and font. That design is safe. The database holds no colour, nothing needs sanitising, and one stylesheet with one contrast test serves every page. But it allows roughly 5 × 4 × 3 × 4 × 2 combinations with only two fonts, so pages look alike, and the editor shows the choices as words. Booking pages and hosted forms have no brand at all. Forms offer light or dark and rounded or square, and booking pages offer nothing. `workspaces.logo_url` exists but has never been used.

The audits of 31 October 2026 rank this as the most visible gap against Linktree, Beacons, Calendly, Cal.com and Typeform, which all let a customer bring their colour and logo, and which all offer a visual gallery of themes. The owner asked for "good and better themes" and said to decide the details the industry standard way. The owner also said "Powered by Timefix" stays, with no removal.

Constraints: public pages run under `style-src 'self'` (no inline style, hashed React Aria style aside), `img-src 'self' data: blob:` and `font-src 'self'`, and the owner froze new origins. Public first load budgets are tight and a raise is a spec change. `auth.public_profiles` is written only through definer functions on the identity login. Another session owns the booking editor and team scheduling files, so this spec avoids them.

## Options considered

### Option 1: More presets only

Add more named presets and two or three fonts, keep everything else.

**Pros**:
- Smallest change, nothing new to secure.

**Cons**:
- No customer colour or logo, which is what every competitor offers and what makes booking pages and forms feel like the customer's.
- Booking pages and forms stay unbranded.

### Option 2: Widen the closed names, add one checked accent per kit, deliver it as a stylesheet from our origin

Keep the look as names. Add a single free value, an accent colour, stored in its own checked column, turned into contrast safe variables by one pure function, and served as a small versioned stylesheet from our own origin.

**Pros**:
- Any colour, as customers expect, with readability guaranteed by code.
- No inline style and no new origin, so the security policy is untouched.
- One stylesheet and one test still cover every look.

**Cons**:
- One extra small request per public page.
- A pure colour function to build and prove.

### Option 3: Free form theme JSON (any colours, fonts, sizes)

Store a theme object with raw values, like Carrd or a page builder.

**Pros**:
- Maximum freedom.

**Cons**:
- Breaks the closed design and its tests; needs CSS sanitising and inline styles the policy refuses.
- Lets owners make unreadable pages, which visitors then blame on the product.

## Rationale

Option 2 gives customers the two things that matter most for brand (their colour and their logo) while keeping the property that made spec 0054 safe: everything that reaches CSS is either a known name or a value the server checked and computed. The accent sits in its own column with a strict pattern in Zod and in Postgres, so the theme record stays names only. A stylesheet from our own origin is the only way to carry a per page value under `style-src 'self'` without inline styles, and versioned paths with edge caching make its cost close to nothing.

Decisions made the industry standard way, without asking:
- **Any accent colour with a guard**, not a fixed palette. Calendly, Cal.com and Linktree all take any colour. The guard keeps the hue and moves lightness until AA holds, and shows a note when it moves it noticeably, which is what Cal.com's brand colour warning does.
- **Two levels: workspace kit and personal look.** Calendly and Cal.com brand at account or team level, Linktree per page. The workspace kit brands team pages and forms. A person's link page follows it by default and may set its own accent, and their personal booking pages follow their page, so a visitor moving from link page to booking sees one look.
- **Self hosted open licence fonts, one pack per page.** Typeform and Linktree offer curated fonts. Loading only the page's own pack, preloading its heading file and using fallback metrics keeps speed and stops text jumping.
- **Photo backgrounds always behind solid cards and a scrim.** Linktree and Beacons let text sit on photos, which often fails contrast. Cards plus scrim keep AA true whatever the photo.
- **Follow visitor mode added.** Common across modern link pages. The owner still chooses light or dark when they want.
- **Logo formats PNG, JPEG and WebP.** SVG needs a sanitiser to be safe, so it waits for demand.
- **Gallery thumbnails drawn live by the real stylesheet**, not screenshots, so a thumbnail can never disagree with the page.
- **"Powered by Timefix" stays** (owner, 31 October), styled to sit quietly in each look.

## References

**Project sources** (verifiable, in this repo):
- Spec 0051 (link page), 0054 (look, referenced by `page-theme.ts`), 0055 (sharing, share image, outside fetch), 0056 (link page per workspace), 0058 (visual and short)
- `packages/contracts/src/booking/page-theme.ts`, `packages/ui/src/modules/LinkPage/README.md`, `page-theme.test.ts`
- `packages/db/src/schema/auth.ts` (`public_profiles`), `packages/db/src/schema/workspaces.ts` (`logo_url`)
- `apps/api/src/me-picture.ts`, `apps/api/src/public/picture.ts`, `apps/api/src/storage/blob.ts`
- `apps/web/vercel.json` (the public pages' security policy), `apps/web/.size-limit.js`

**Practices & standards**:
- WCAG 2.2 AA contrast (4.5:1 text, 3:1 non text)
- OKLCH lightness adjustment to keep hue while fixing contrast
- Content Security Policy without `unsafe-inline`
- `font-display: swap` with fallback metric overrides to avoid layout shift
