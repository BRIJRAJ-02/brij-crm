# 0060. Brand kit and link page themes

**Date**: 2026-10-31
**Status**: Proposed

## Summary

Today every link page picks from the same five looks, so pages look alike. Booking pages and forms carry no brand at all. This spec adds two things. First, a brand kit for each workspace: a logo and an accent colour that booking pages and forms wear. Second, a much richer set of link page looks: a gallery of 14 ready looks, eight font packs, gradients, patterns and photo backgrounds, a cover image, avatar shapes, and a "follow the visitor" light or dark mode. Any accent colour is allowed, and an automatic contrast guard keeps text readable. Every look is still a set of names the stylesheet knows, so a thousand pages stay one tested stylesheet. "Powered by Timefix" stays on every page.

## Requirements

**User stories**:
- As a workspace admin, I want to upload our logo and pick our colour once, so every booking page and form looks like us.
- As a link page owner, I want to pick a look I like from a gallery and see it on my page at once, so my page feels like mine without design work.
- As a link page owner, I want my own accent colour and a cover photo, so my page stands out from everyone else's.
- As a visitor, I want every page to be easy to read in light or dark, whatever colour the owner chose.

**Acceptance criteria**:

Brand kit (workspace):
- **AC-1**: Settings › Brand (admins and owners only) holds the workspace logo and accent colour. Everyone else in the workspace sees it read only. It shows a live preview of a booking page and a form wearing the kit.
- **AC-2**: The logo takes a PNG, JPEG or WebP up to 4 MB. The browser redraws it (which drops location and camera data), the server checks type and first bytes, strips metadata again and stores it privately. It is served from our own origin only. Remove logo asks first in a Modal.
- **AC-3**: The accent takes any colour (a hex field, a swatch picker and the nine library hues as quick picks). Leaving it empty means the product's own accent.
- **AC-4**: Booking pages (team pages always, personal pages unless the owner set their own accent, see AC-14) and hosted forms show the workspace accent on buttons, the chosen day, links and focus rings, and show the logo in their header. Nothing they do changes: same steps, same fields, same requests apart from the stylesheet and logo below.

Contrast guard:
- **AC-5**: For any accent, the page draws a light and a dark version that meet WCAG AA: text on the accent at least 4.5:1, the accent as link text on the page surface at least 4.5:1, and the accent as a control edge or focus ring at least 3:1. The guard keeps the hue and changes only lightness (and chroma when needed to stay in gamut).
- **AC-6**: When the guard moves a colour noticeably (a colour difference above 10), the picker shows both swatches and one line: "Adjusted so text stays readable." The owner may set a separate dark accent under More, and the guard still applies to it.
- **AC-7**: The same pure function computes the colours for the editor preview and for the live page, so the preview is exactly what visitors see.

Link page looks:
- **AC-8**: The link page Design panel opens on a gallery of 14 looks (the five existing ones plus nine new), each a live thumbnail drawn by the real stylesheet, not a picture. Picking one changes the preview at once and saves.
- **AC-9**: Under the gallery, Customise has six rows of visual choices, each a tile grid or swatch row: Colour, Background, Font, Buttons, Header and Mode. A tile shows the choice itself (a gradient, a pattern, "Aa" in the font, a button shape), not a word alone.
- **AC-10**: Backgrounds: plain, paper, tint (nine hues), ink, eight curated gradients, four patterns (dots, grid, lines, waves), and an uploaded photo. Gradients and patterns are built from tokens only and have a light and a dark form.
- **AC-11**: With a photo background, blocks always sit on a solid card and the hero text sits on a scrim, so no text is ever drawn straight on the photo, and the contrast of AC-5 holds in both modes.
- **AC-12**: Eight font packs, each a heading font and a body font: Modern (Inter), Mono (JetBrains Mono), Grotesk (Host Grotesk with Inter), Editorial (Fraunces with Inter), Classic (Newsreader), Friendly (Bricolage Grotesque with Inter), Geometric (Outfit) and Display (Instrument Serif with Inter). All are open licence fonts we host ourselves. A page loads only its own pack.
- **AC-13**: Header has three forms: centred (today), cover (a cover photo band with the avatar overlapping its lower edge) and left (avatar left, name and bio beside it). Avatar shape is circle, rounded square or hidden. Cover takes a photo upload with the same checks as AC-2, cropped to 3:1 in the browser.
- **AC-14**: Colour on the link page follows the workspace accent by default. The owner may set their own accent with the same picker and guard. A personal booking page uses its owner's own accent when one is set, so the link page and the pages it links to match.
- **AC-15**: Mode is light, dark or "Follow visitor", which uses the visitor's system setting. Every ground, gradient, pattern and pack has both forms.
- **AC-16**: The draft preview (the editor's "How it looks" for one block) and the phone preview both use the page's look, not the app's colours.
- **AC-17**: Every existing page keeps its exact look after the change: old looks gain the new keys with defaults that draw what they drew before (centred header, circle avatar, its own font, no gradient, pattern or photo).

Quality bar (by reference to spec 0058):
- **AC-18**: Every screen and popup this spec adds or changes meets 0058's AC-1 (alignment), AC-2 (motion), AC-3 (less text), AC-4 (accessibility) and AC-21 (delight). Picking a look or tile cross fades the preview with token motion only, and reduced motion swaps it instantly.
- **AC-19**: "Powered by Timefix" stays on every link page, booking page and form, drawn in the page's own look so it sits quietly and aligned at the foot. No setting removes it.

Speed and safety:
- **AC-20**: Public pages load no font, image or stylesheet from another origin. The Content Security Policy is unchanged (`style-src 'self'`, `img-src 'self' data: blob:`, `font-src 'self'`). No page ships an inline style.
- **AC-21**: First load budgets: the JavaScript of the link page, booking page and form grows by at most 1 kB gzipped each. The shared stylesheet grows by at most 4 kB gzipped. A page's own look stylesheet is under 1 kB and cached at the edge. Its heading font is preloaded and draws with `font-display: swap` and fallback metrics, so the text does not jump (layout shift under 0.05).
- **AC-22**: The look stylesheet and every image route are built only from checked values (a hex that matched `^#[0-9a-f]{6}$` in the contract and again in the database, and paths the server made). No text a person typed ever reaches CSS.
- **AC-23**: Only the page owner changes their link page look, accent and images. Only workspace admins and owners change the brand kit. Every write goes through the access door. Another workspace's brand never reaches a page (a cross workspace read returns nothing).

Marketing:
- **AC-24**: The Timefix marketing site's link page section shows the new looks (three or four pages in different looks, real screenshots in light and dark), and its All features sheet lists the brand kit and themes, checked against shipped code.

## Decision

**Chosen option**: Option 2: Keep the closed set of look names, widen it, and add one checked colour per kit, drawn through a small stylesheet served from our own origin.

The look stays a record of names the stylesheet knows. The only free value is an accent colour, kept in its own checked column, turned into contrast safe variables by one pure function, and delivered as a cached stylesheet from our origin, so nothing inline and nothing from elsewhere is ever needed.

**Implementation skills**: `crm-design-system` (`.claude/skills/crm-design-system/`) · `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `drizzle` (`.claude/skills/drizzle/`) · `zod` (`.claude/skills/zod/`) · `security-and-hardening` (`.claude/skills/security-and-hardening/`) · `interaction-design` (`.claude/skills/interaction-design/`) · `emil-design-eng` (`.claude/skills/emil-design-eng/`) · `impeccable` (`.claude/skills/impeccable/`)

## Feature design

**Data model sketch** (one migration, placeholder number `0xxx`, renumbered after main's last migration at the final merge, its journal `when` stamped then):

`workspace_brands` (new tenant table, schema public, forced row level security, the plain workspace policy):
| Column | Type | Rule |
|---|---|---|
| `workspace_id` | uuid, primary key | references `workspaces`, cascade on delete |
| `accent` | text, nullable | check `^#[0-9a-f]{6}$`; null means the product accent |
| `accent_dark` | text, nullable | same check; null means derived from `accent` |
| `logo_path` | text, nullable | Blob pathname the server made, `logos/<workspace id>/<random>.<ext>` |
| `logo_type` | text, nullable | `image/png`, `image/jpeg` or `image/webp` |
| `logo_version` | text, nullable | short version for the served path |
| `updated_at` | timestamptz | |
| `updated_by` | uuid | the member who saved |

Check: `logo_path`, `logo_type` and `logo_version` are all set or all null. The unused `workspaces.logo_url` column stays untouched (contract later, once no code reads it).

`auth.public_profiles` (existing, spec 0056) gains:
| Column | Type | Rule |
|---|---|---|
| `accent` | text, nullable | check `^#[0-9a-f]{6}$`; null follows the workspace |
| `accent_dark` | text, nullable | same check |
| `cover_path`, `cover_type`, `cover_version` | text, nullable | all or none; `profile-images/<user>/<workspace>/<random>.<ext>` |
| `ground_path`, `ground_type`, `ground_version` | text, nullable | all or none; same folder |

`theme` jsonb widens. The migration first backfills every row with the new keys at their defaults, then replaces `public_profiles_theme` with the wider check (widening, so no row can fail). Keys after this spec:
| Key | Values | Default |
|---|---|---|
| `ground` | plain, paper, tint, ink, gradient, pattern, image | plain |
| `hue` | the nine hues | blue |
| `gradient` | dawn, dusk, mint, ocean, peach, grape, sand, graphite | dawn |
| `pattern` | dots, grid, lines, waves | dots |
| `mode` | light, dark, system | light |
| `shape` | soft, pill, square | soft |
| `fill` | plain, soft, outline, solid | plain |
| `font` | sans, mono, grotesk, editorial, classic, friendly, geometric, display | sans |
| `header` | centred, cover, left | centred |
| `avatar` | circle, rounded, none | circle |

`ground = image` with no `ground_path` draws as `plain`. `header = cover` with no `cover_path` draws as `centred`. The record stays strict and stored whole.

**Looks** (`PAGE_THEME_PRESETS`, names never stored): Plain, Paper, Bold, Ink, Quiet (unchanged), plus Dawn (dawn gradient, pill, soft fill, friendly), Ocean (ocean gradient, solid, geometric), Mint (mint gradient, soft, outline, grotesk), Studio (grid pattern, square, outline, grotesk), Editorial (paper, left header, plain fill, editorial), Night (ink, dark, display, outline), Peach (peach gradient, pill, solid, friendly), Graphite (graphite gradient, dark, mono), Gallery (photo ground, cover header, rounded avatar, classic). Gallery shows only once a photo is uploaded, else it opens the upload.

**State**: none beyond saved values. Saves are optimistic with rollback through `packages/data`, like the current Appearance card.

**API surface** (contracts in `packages/contracts`; procedures on `member`, writes through `commitWrite` and listed in `WRITES`):
| Surface | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `brand.get` | rpc | `workspaceId` | `{ accent?, accentDark?, logo?: { version } }` | member | `NOT_FOUND` |
| `brand.save` | rpc | `workspaceId`, `accent: Hex \| null`, `accentDark: Hex \| null`, `mutationId` | the brand | member with admin power | `FORBIDDEN`, `INPUT_INVALID` |
| `/api/brand/logo` | POST, DELETE | body image, `x-crm-workspace` | `{ version }` | session, member, admin power, Origin check | 403, 413, 415, 429 |
| `profile.saveTheme` | rpc | widened `PageTheme` | `PageTheme` | member, own page | `INPUT_INVALID` |
| `profile.saveAccent` | rpc | `workspaceId`, `accent: Hex \| null`, `accentDark: Hex \| null`, `mutationId` | `{ accent, accentDark }` | member, own page | `INPUT_INVALID` |
| `/api/me/link-page/cover`, `/api/me/link-page/ground` | POST, DELETE | body image, `x-crm-workspace` | `{ version }` | session, member, own page, Origin check | 403, 413, 415, 429 |
| `/api/public/handles/:handle/look.css?v=` | GET | handle, version | CSS | public | 404 `no-store` on an old version |
| `/api/public/handles/:handle/cover?v=`, `.../ground?v=` | GET | handle, version | image | public | 404 |
| `/api/public/booking/:key/brand.css?v=`, `/api/public/forms/:key/brand.css?v=` | GET | key, version | CSS | public | 404 |
| `/api/public/booking/:key/logo?v=`, `/api/public/forms/:key/logo?v=` | GET | key, version | image | public | 404 |

Public reads go through new definer functions in the style of `crm_profile_share_image` (ids in, checked values out, nothing about members). Image routes follow `picture.ts`: nosniff, same origin only, `public, max-age=3600, s-maxage=3600`, only the current version answers, 60 a minute per address and 600 per page. Uploads follow `me-picture.ts`: 10 an hour per person, 4 MB, the type allowlist, first bytes checked, metadata stripped (`picture-strip.ts`), stored private through `storage/blob.ts`, the older file deleted after the new one is saved.

**How the look reaches a page** (no inline style, no other origin):
- The shells that already write a page's head (`apps/web/handle-shell.ts` and `handle-meta.ts` for `/<handle>`, the middleware for `/b/:key` and `/f/:key`) add one `<link rel="stylesheet">` to the page's look or brand stylesheet when it has one, and one `<link rel="preload" as="font" crossorigin>` for its heading font.
- The look stylesheet holds only custom properties for the accent pair (light and dark) and, for a photo ground or cover, a `url()` to our own image route. Everything else is the shared stylesheet's blocks, selected by the `data-page-*` attributes as today.
- In the app (editor previews), the same variables are set through the CSSOM on the preview's root (allowed under the app's policy), from the same pure function.

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Page look stylesheet | accent light and dark variables | `public_profiles.accent` and `accent_dark`, else `workspace_brands.accent` and `accent_dark`, through `brandVariables()` in `packages/core/src/brand/` |
| Booking or form brand stylesheet | accent variables | the page's owner's `public_profiles.accent` for a personal booking page when set, else `workspace_brands` of the page's or form's workspace |
| Header logo | image path | `workspace_brands.logo_version` through the booking or form key route |
| Look version in the path `?v=` | short version | a hash of the accent pair and image versions, computed by the definer read |
| Gallery thumbnails | look | `PAGE_THEME_PRESETS` in contracts |
| Font preload | file path | the pack's file name from a fixed map in `packages/tokens` keyed by `font` |
| Contrast adjustment note | "adjusted" and the colour difference | the `adjusted` and `delta` fields `brandVariables()` returns |
| Who may edit the kit | admin power | the access door (spec 0009, 0032) |

**Key invariants**:
- No colour, size, font stack or URL typed by a person reaches CSS. Only `^#[0-9a-f]{6}$` hexes (checked in Zod and in Postgres) and server made paths do.
- Every accent pair drawn meets AC-5 in both modes.
- `public_profiles.theme` always holds every key (backfilled, then checked).
- A public route answers only the current version of an image or stylesheet.

**Security model**: `workspace_brands` is a tenant table with forced row level security and a plain policy, read and written only inside `withWorkspace()`. Link page columns in `auth.public_profiles` change only through definer functions the identity login runs, as today. Admin power is checked by the door for the brand kit, and ownership for the link page. Uploads keep the Origin check, size limit, type allowlist, byte check, metadata strip and private storage. SVG logos are refused in this spec.

**Configuration required**: none new. Blob uses the existing store token (`BLOB_READ_WRITE_TOKEN`, already set where uploads work).

**Critical test scenarios**:
- Happy path: an admin sets an accent and logo, a booking page and a form show both, verifies **AC-1, AC-4**
- Contrast: a property test over thousands of random hexes, every pair meets AC-5 in both modes, verifies **AC-5**
- Old pages: every existing preset and a sample of stored themes draw identically before and after (screenshot diff), verifies **AC-17**
- Injection: a hex with CSS in it, a path with `..`, an old version, all refused, verifies **AC-22**
- Access: a member without admin power gets `FORBIDDEN` on `brand.save`, another workspace's brand never appears, verifies **AC-23**
- Speed: size budgets pass and layout shift on a page with a display font stays under 0.05, verifies **AC-21**

## Build plan

Approach: Tracer Bullet. One thin thread first (an accent colour from Settings to a live booking page), then thicken.

1. Lane 1 thread: `brandVariables()` with its property test, `workspace_brands` table and policy, `brand.get` and `brand.save`, the booking brand stylesheet route and the shell link, a bare accent field in Settings › Brand, satisfies **AC-3, AC-4, AC-5, AC-7, AC-20, AC-22, AC-23**
2. Lane 1: logo upload and routes, form brand stylesheet and logo, satisfies **AC-1, AC-2, AC-4**
3. Lane 1: widen `PageTheme`, backfill and the new check, `public_profiles` accent and image columns, `profile.saveAccent`, cover and ground uploads, the look stylesheet route, satisfies **AC-10, AC-13, AC-14, AC-17, AC-22**
4. Lane 2: `LinkPage` stylesheet blocks for the new keys, header and avatar forms, scrim, system mode, the `LookSwatch` thumbnail, font packs in `packages/tokens` with fallback metrics, extended `page-theme.test.ts` (gradients and patterns may use token only functions), satisfies **AC-10, AC-11, AC-12, AC-13, AC-15, AC-17, AC-21**
5. Lane 2: public booking and form components read the brand variables and draw the logo slot, satisfies **AC-4, AC-19**
6. Lane 3: Settings › Brand screen with previews, the link page Design panel (gallery, Customise rows, accent picker with the adjusted note, uploads), draft preview using the look, satisfies **AC-1, AC-6, AC-8, AC-9, AC-14, AC-16, AC-18**
7. Lane 4: shells and middleware add the stylesheet and font preload, size budgets checked, CSP test unchanged, satisfies **AC-20, AC-21**
8. Lane 5, after 1 to 4: marketing site looks section and All features, satisfies **AC-24**
9. Verify pass: 0058 alignment probe and motion checks on every new screen, contrast property test, screenshots in light, dark and follow visitor, satisfies **AC-18, AC-19**

**Lanes and owned files** (none touches `apps/web/src/features/booking`, `features/bookings`, `packages/ui/src/modules/TeamWeek` or `HoursEditor`, which another session owns):
| Lane | Owns |
|---|---|
| 1 Data and server | `packages/contracts/src/booking/page-theme.ts`, `packages/contracts/src/profile.ts`, new `packages/contracts/src/workspace-brand.ts`, `packages/db/src/schema/auth.ts` (`publicProfiles` only), new `packages/db/src/schema/brand.ts`, the migration, `packages/core/src/brand/`, `apps/api/src/modules/brand/`, `apps/api/src/brand-logo.ts`, `apps/api/src/link-page-images.ts`, new routes in `apps/api/src/public/` (`look.ts`, `brand-css.ts`) |
| 2 Library | `packages/ui/src/modules/LinkPage/`, new `packages/ui/src/molecules/LookSwatch/`, `packages/ui/src/public-booking/` (brand variables and logo slot only), `packages/ui/src/public-form/` (same), `packages/tokens/fonts/` and the pack stylesheets |
| 3 Editors | `apps/web/src/features/link-page/` (Design panel), new `apps/web/src/features/settings/BrandScreen.tsx` and its route, `packages/data/src/link-page/` and new `packages/data/src/brand/` |
| 4 Shells | `apps/web/handle-shell.ts`, `apps/web/handle-meta.ts`, `apps/web/middleware.ts`, `apps/web/.size-limit.js`, `apps/web/src/public/booking/boot.ts` (brand link only) |
| 5 Marketing | `apps/marketing/` only |

## Consequences

**Positive**:
- Pages look varied and personal, and booking pages and forms finally carry the customer's brand.
- One checked colour, one pure function and one stylesheet keep every page readable and testable.
- The brand kit becomes the place later specs read (emails, embeds, custom domains).

**Negative / tradeoffs**:
- One more request per public page (a tiny cached stylesheet), which is why it is versioned and edge cached.
- Six new font files to host and keep in budget.
- The look record is wider, and the drift test must learn gradients and patterns.

**Neutral**:
- `workspaces.logo_url` stays unused until a later contract step removes it.
- Brand emails (logo and accent in booking and form emails) are left for a later spec.

## Follow-up

- [ ] Brand kit in emails (booking confirmations, form notices) once this lands.
- [ ] SVG logos with a sanitiser, if customers ask.
- [ ] Remove `workspaces.logo_url` once no code reads it.
- [ ] Grid and bento block layouts belong to spec 0061 (blocks), which reads these looks.

## Rationale

See [rationale.md](rationale.md) for the context, options and reasoning.
