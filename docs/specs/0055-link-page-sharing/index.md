# 0055. Sharing the link page

**Date**: 2026-10-25
**Status**: Proposed

**Numbering**: 0055 taken by the appearance and sharing lane on 25 October 2026, beside 0054 (the link page's appearance). 0052 is more link page blocks and 0053 is social links, both taken by the `spec-blocks` lane the same day. This spec owns AC-5501 to AC-5599.

## Summary

Spec 0051 gave the page a Share button and a Share modal, so passing it on is already one press. What is missing is the other end: when somebody pastes `timefix.com/<handle>` into a message, the person receiving it sees nothing, because the page is a single page app whose shell says the same thing for everybody and asks not to be indexed. This spec puts the real page's name, description and share card into the HTML a crawler reads, draws that card as a picture of the person, lets a link row carry the icon of the site it points at, and imports a Linktree page so somebody can move in one go. Every one of those last three means our server fetching a web address somebody typed, so the security rules for that fetching are half of this spec.

Reasoning, options and the calls taken on the owner's behalf: see [rationale.md](rationale.md). How to check it: [verify.md](verify.md).

## Requirements

**User stories**:

- As the owner of the page, I want my link to show my name, my photo and my address when I paste it into a message, so somebody knows what they are about to open.
- As the owner of the page, I want my page to be findable by my own name, so people who look me up land on it.
- As the owner of the page, I want to choose the picture people see when they share my page, so it is my picture and not one we drew.
- As the owner of the page, I want a link to my own website to carry that site's icon, so my page does not read as a column of letters.
- As a person moving from Linktree, I want my existing links brought across in one press, so I do not retype twenty rows.
- As a person moving from Linktree, I want to see what came across before anybody else does, so a half right import is never live.
- As the person who keeps this system running, I want every outside address we fetch to be bounded and checked, so a link page can never make our servers read something inside our own network.

**Acceptance criteria**

*The shell and its meta*

- **AC-5501**: `/<handle>` and `/<handle>/<slug>` are served by a Vercel Function in the web project, which answers the built shell with one block of meta tags written into its head. The body, the scripts, the styles and the client behaviour are exactly what the built shell holds today; the function adds tags and changes nothing else.
- **AC-5502**: For `/<handle>` the block holds `<title>` ("<Name> · Timefix"), `<meta name="description">` (the person's bio, trimmed to 160 characters, else "Links, contact details and a time to meet."), `og:type` (`profile`), `og:title`, `og:description`, `og:url` (the canonical address on the public origin), `og:image` with `og:image:width` 1200 and `og:image:height` 630 and `og:image:alt`, `twitter:card` (`summary_large_image`), a `<link rel="canonical">` and a `<meta name="robots">`. For `/<handle>/<slug>` the same block carries the booking page's own title and note and `og:type` `website`. Every value is escaped for HTML before it is written.
- **AC-5503**: The function reads the public profile through the api inside 800ms. On a timeout, a refusal, a failure of any kind, or an api that is down, it answers the built shell exactly as it stands today, with a 200 and the brand card, and logs the miss. A slow or broken read never shows a visitor an error and never holds the page.
- **AC-5504**: The function reads no cookie, answers the same bytes to everybody for one handle, and carries `cache-control: public, s-maxage=300, stale-while-revalidate=86400`. A signed in owner gets the same shell as a stranger, and the app's own read then draws the page.
- **AC-5505**: The headers the function answers are the headers the path gets today, value for value: the same content security policy, `X-Content-Type-Options`, `Referrer-Policy` and nothing new. A test compares them against `vercel.json`'s block for handle paths and fails on any difference.
- **AC-5506**: Settings › Profile gains one switch, "Let search engines show this page", on by default. On writes `index, follow`; off writes `noindex, follow`. `/b/:key` and `/f/:key` keep `noindex` and are not touched by this spec.
- **AC-5507**: This narrows spec 0051 AC-5131. `/b/:key` stays untouched, and the link page's client modules still never reach it. `/<handle>/<slug>` keeps its markup, its requests and its policy headers, and gains the meta block above, which adds no request and no client code. The guard test is rewritten to check exactly that, and fails if the booking page's shell changes at all.
- **AC-5508**: A handle nobody holds answers the shell with the brand card, the site's own title and description, a `noindex` and a 404 status, so a crawler does not index a dead address and a person still sees the page spec 0051 draws for an unknown handle.
- **AC-5509**: The shell writes the owner's theme (spec 0054) as the page root's attributes and `data-theme`, so the first paint is already the right colour and the step named in spec 0054 AC-5313 goes away. When the read missed, the shell carries no theme attributes and the page behaves as spec 0054 describes.

*The share card*

- **AC-5510**: `GET /api/public/handles/:handle/card.png` answers a 1200 by 630 PNG drawing, on the brand ground: the Timefix wordmark at the top left, the person's photo in a 140px circle ringed in white, their name, their address `timefix.com/<handle>`, and the product's one signature line as a pill. It is the card the owner approved in the design artifact, drawn in Inter, the family this repo ships.
- **AC-5511**: A person with no picture, or one who hid it, gets their initials on a hue tile in the same circle. A handle nobody holds, and any failure drawing a person's card, answers the brand card instead: the wordmark, the product line and the site address, never a broken image and never a card with an empty name.
- **AC-5512**: The photo inside the card comes through the existing picture fetch and nothing else: Google's picture hosts only, https only, at most two redirects each to such a host, 3 seconds, 1 MB, and only a JPEG, PNG, WebP or GIF whose first bytes say so. No new outside host is contacted to draw a card.
- **AC-5513**: A card is cacheable and versioned: its address carries a short version taken from the profile's `updated_at`, and it answers `public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800`. Changing a name or a picture changes the address, so a crawler that cached the old card fetches the new one.
- **AC-5514**: The card route is limited to 30 a minute per address and 300 a minute per handle, drops known machines from the counting but still answers them (a crawler is the point), and makes no request to any origin but Google's picture hosts.

*A custom share image*

- **AC-5515**: An owner may upload their own share image, which replaces the generated card. At most 5 MB, only PNG, JPEG or WebP, decided by the first bytes and never by the file name, at least 600 by 315, and re-encoded by us into a 1200 by 630 PNG before it is stored, so the bytes we serve are never the bytes somebody sent.
- **AC-5516**: The image is stored in R2 (#32) under a key we mint, in a bucket with no public address, and served only through `GET /api/public/handles/:handle/card.png` from our own origin. `img-src 'self' data: blob:` is unchanged and no page ever names an R2 address.
- **AC-5517**: Remove puts the generated card back in one press and deletes the stored object. It asks first in a Modal, because it destroys something the person uploaded.

*Favicons for link rows*

- **AC-5518**: A `link` block may carry the icon of the site it points at, served from `GET /api/public/icons/:id` on our own origin and drawn inside the tinted square every row already has (spec 0051 AC-5109). The policy is unchanged. When there is no icon, the row falls back exactly as spec 0051 AC-5110 says: the social mark, then the Lucide icon the owner picked, then the first letter in the block's hue.
- **AC-5519**: An icon is fetched by a background job, never inside a visitor's request and never once per visitor. A page read waits on nothing outside, and no site the page links to ever learns that somebody opened the page.
- **AC-5520**: The fetch is bounded and checked. Only `https`, only a host name (never a literal address), and the host's resolved addresses are checked before the connection and again after every redirect: any address in a private, loopback, link local, unique local, multicast or carrier grade NAT range refuses the fetch. At most two redirects, 3 seconds in total, 256 KB at most, no credentials and no cookies sent, and the request carries a named agent string and nothing about any visitor.
- **AC-5521**: Only PNG, ICO, JPEG and WebP are accepted, decided by the first bytes. SVG is refused, because an SVG can carry script and we would be serving it from our own origin. Whatever arrives is re-encoded into a 64 by 64 PNG before it is stored.
- **AC-5522**: An icon is stored in R2 keyed by a hash of the link's normalised origin, so two people linking to the same site share one object and one fetch. It is kept for 30 days and then fetched again. A failure is remembered for 7 days as "no icon", so a dead site is not fetched again on every save.
- **AC-5523**: An owner may turn an icon off for one block, through `iconOff` in that block's `data`, and go back to the icon they picked. Nothing is fetched for an item whose owner chose a Lucide icon or whose address matches a social network, because those already have a mark.

*Importing from Linktree*

- **AC-5524**: `profile.importLinks` takes one address and brings its rows across. Only a host on a short allow list of link in bio services is accepted (`linktr.ee`, `bio.link`, `lnk.bio`, `linktw.in`, `liinks.co`, `solo.to`, `beacons.ai`); anything else is refused with `CONFIG_INVALID`, "We can only bring links across from a link in bio page.", and nothing is fetched.
- **AC-5525**: The fetch obeys AC-5520's rules, with 1 MB and 5 seconds, and it reads the page once. It parses the rows it can find, keeps a title and an address for each, and never runs any script from the page it read.
- **AC-5526**: Every imported row lands as a hidden block (spec 0051 AC-5106 as amended: the switch off, the row in place reading "Hidden from the page", no separate list), in the order the page had them and in one section of their own named after the page they came from, and nothing is on the public page until the person turns a row's switch on or presses Show all. An import that is never reviewed changes nothing a visitor sees.
- **AC-5527**: A row the import cannot map (an embedded video, a payment block, a form, a row with no address) is listed with whatever it had and the reason, and the person may still add it as a plain link. Nothing is dropped without being shown.
- **AC-5528**: An import brings at most 40 rows and refuses an address that would take the person past spec 0051's limits, naming the limit. It is idempotent on the import's own id, so a retry of the same import adds nothing twice, and it is limited to 5 imports an hour per account.

*Across the whole spec*

- **AC-5529**: No content security policy anywhere in the product gains an origin because of this spec. Every picture a visitor's browser loads still comes from our own origin, a `data:` address or a `blob:` address.
- **AC-5530**: Nothing about a visitor reaches another origin. The card is drawn on our side, an icon is fetched by a job, and an import is a thing the owner asked for while signed in.
- **AC-5531**: Every outside fetch this spec adds goes through one module with one set of rules, and a lint rule fails the build if a `fetch` of a user supplied address is written anywhere else.
- **AC-5532**: The Share modal spec 0051 AC-5135 already draws is not replaced or duplicated. Its owner reading gains one line, "This is what people see when they share your page", with the card beside it; its visitor reading gains nothing, so the public bundle still carries no figures and no download.
- **AC-5533**: The public bundle grows by nothing this spec adds. The card is drawn on the server, the meta block is in the shell, an icon is an image address, and the import and the upload live only in the lazily loaded editor view. `pnpm size` passes.

## Decision

**Chosen option**: Option 2 in the rationale. One Vercel Function in the web project serves the handle shell to everybody with a meta block injected, the share card is drawn server side as a PNG by the api, and every outside fetch goes through one hardened module whose rules are the same ones the picture fetch already proves.

**Implementation skills**: the house skills `crm-api-backend` (the routes, the limits and the errors), `crm-data-model-access` (the icon and image records and the door), `crm-frontend-state` (the editor through the one data layer) and `crm-design-system` (the card and the editor screens); plus `security-and-hardening`, `cloudflare` (R2, from #32), `zod`, `vitest` and `playwright-cli`.

- **Where the HTML is rendered**: a Vercel Function in the web project, reached by changing the handle rewrites in `vercel.json` from `/book.html` to that function. It serves everybody the same bytes, so there is no crawler sniffing and nothing that could be read as cloaking, and the edge caches it per handle so the common case never runs the function at all.
- **What the crawler gets**: the same shell, plus a meta block. No server rendered body, no second rendering path and no markup that could drift from what React then draws.
- **How the card is drawn**: the api draws a 1200 by 630 PNG from the design artifact's card, in Inter, with the person's photo coming through the picture fetch that already exists.
- **Outside fetching**: one module, one set of rules, allow listed schemes, resolved addresses checked before and after every redirect, hard caps on time and size, and a type decided by bytes. The Linktree import narrows further to an allow list of hosts, because that is the only place an import makes sense and an allow list removes almost all of the risk at once.
- **Where fetched bytes go**: R2 (#32), privately, always re-encoded by us first, always served back through our own origin. No policy changes.
- **No silent publishing**: an import lands archived and the person decides, row by row or all at once.

## Feature design

**Data model** (one migration, `NNNN_profile_sharing`, at the next free number; `0097_social_links` is taken, and spec 0052 and spec 0054 each take one before this):

| Object | Schema | Key | Notes |
|---|---|---|---|
| `public_profiles` | `auth` | the person | adds `indexable boolean not null default true` and `share_image text` (null, the R2 key of an uploaded card). |
| `profile_items` | `auth` | the block | the `link` kind's entry in the `ProfileBlock` union gains `iconOff` inside the existing `data jsonb` (spec 0051 amendment 1, the registry). The fetched icon is not stored per block at all: it is looked up by the link's origin in `link_icons`, so two people linking to the same site share one object. |
| `link_icons` | `auth` | `origin_hash` (bytea, the hash of the normalised origin) | `r2_key` (null when the fetch failed), `state` (`ok`, `none`), `fetched_at`, `attempts`. One row per origin, shared by every person who links to it. |
| `link_imports` | `auth` | `id` (uuidv7, client minted) | `user_id`, `source` (the address), `rows` (jsonb, the parsed rows and the skipped ones), `created_at`. Kept 30 days, then swept. |

**State transitions**, an imported row: `parsed` → `archived item` (on import) → `live item` (the person presses Add to page) or `deleted` (the person presses Delete). Nothing moves to `live` without a press.

**State transitions**, an icon: `absent` → `queued` (a link is saved) → `ok` with an object, or `none` after a refusal or a failure → `absent` again 30 days later, which queues it once more.

**API surface**:

| Endpoint or procedure | Input | Output | Auth | Key errors |
|---|---|---|---|---|
| `GET /<handle>` and `/<handle>/<slug>` | the path | the shell with its meta block | public, cached at the edge | never an error: the plain shell on any miss |
| `GET /api/public/handles/:handle/card.png` | `v` (the version) | a 1200 by 630 PNG | public, limited | the brand card on any failure, never a 500 |
| `GET /api/public/icons/:id` | the item's public id | a 64 by 64 PNG | public, limited | 404 when there is no icon |
| `profile.setIndexable` | `{ indexable }` | `{ indexable }` | session, own account | |
| `profile.uploadShareImage` | the bytes | `{ card }` | session, own account | `CONFIG_INVALID` for type, size or dimensions |
| `profile.removeShareImage` | | `{ card }` | session, own account | |
| `profile.setItemIcon` | `{ id, off }` | `ProfileItem` | session, own account | `NOT_FOUND` |
| `profile.importLinks` | `{ id, source }` | `{ added, skipped }` | session, own account, 5 an hour | `CONFIG_INVALID` for a host off the list, `LIMIT_REACHED` past 40 |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Serve the shell | the name, bio and theme in the meta block | the api's public profile read, inside 800ms |
| Serve the shell | the canonical address | `BOOKING_PUBLIC_ORIGIN` plus the request's path, never the request's own host |
| Serve the shell | the robots value | the `indexable` column, `noindex, follow` for an unknown handle |
| Serve the shell | the booking page's title and note on `/<handle>/<slug>` | the existing booking page read, through the door as its `booking` actor |
| Serve the shell | the shell's own HTML | the built `book.html`, inlined into the function at build time, so the function reads no file at request time |
| Serve the shell | the theme attributes | spec 0054's six keys from the same read |
| Draw the card | the name and the address | the public profile read |
| Draw the card | the photo | `createPictureFetch` (`apps/api/src/public/picture.ts`), skipped when the person hid it |
| Draw the card | the initials and their hue | the person's name and spec 0012's hue rule, the same values the page's avatar uses |
| Draw the card | the wordmark and the product line | the repo's own brand asset and one string in `strings.ts`, never fetched |
| Draw the card | the typeface | `packages/tokens/fonts/Inter-Variable-latin.woff2`, read from the repo |
| Draw the card | the version in its address | the profile's `updated_at`, shortened |
| Serve an icon | the bytes | the R2 object named by `link_icons.r2_key`, found from the block's own address |
| Fetch an icon | which address to read | the link's normalised origin plus `/favicon.ico`, and the `icon` links in the origin's own HTML when that misses |
| Fetch an icon | whether the host is allowed | the resolved addresses, checked against the refused ranges before the connection and after each redirect |
| Import | which rows exist | the anchors in the fetched page, titles and addresses only |
| Import | where a row lands | an archived `profile_item` of kind `link`, by spec 0051's rules |
| Import | why a row was skipped | the parser's own reason, kept in `link_imports.rows` |

**Key invariants**:

- The shell a crawler gets and the shell a person gets are the same bytes.
- A fetch of an address a person supplied happens only inside the one hardened module, only over https, never to an address in a refused range, and never without a time and size cap.
- Bytes that came from outside are never served back as they arrived: every image is decoded and re-encoded by us first.
- No browser ever loads an image from an origin that is not ours.
- An imported row is never live until the person presses.
- An R2 object is reachable only through our api; the bucket has no public address.
- A failing outside call never changes what a visitor sees: the plain shell, the brand card, or the letter the page already draws.

**Security model**:

- **Read**: the shell, the card and an icon are public, because the page is. None of them carries a workspace id, a member id, an email or anything about a visitor.
- **Write**: only the signed in person, for their own account. The indexing switch, the share image and the import are all their own.
- **Server side request forgery**: this is the risk this spec adds, and the answer is in four parts. The scheme is allow listed (`https` only). The host must be a name, and its resolved addresses are checked against private, loopback, link local, unique local, multicast and carrier grade NAT ranges before the connection and again after each redirect, so a redirect to `169.254.169.254` or to a host that resolves inward is refused. Time, size and redirect count are capped. And the import, where an arbitrary address would be most useful to an attacker, is narrowed to an allow list of seven hosts. The picture fetch already proves this shape in this repo; this spec generalises it rather than inventing it.
- **Untrusted bytes**: a type is decided by the first bytes, never by a header and never by a name. SVG is refused everywhere. Everything is re-encoded before storage, with the decoder bounded by pixel count as well as by bytes, so a small file that decodes to a huge image is refused.
- **Untrusted text**: every value written into the meta block is HTML escaped, and the block holds no script and no attribute a person can influence beyond a quoted value.
- **Abuse**: every public route here is limited per address and per handle. The import is limited per account. A crawler is answered, never counted as a visitor.
- **Personal data**: the share image and the card are the person's own, published by them on purpose. Nothing about a visitor is stored by anything in this spec.

**Configuration required**:

- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: the private bucket holding share images and fetched icons. Needed by slices 4 and 5 only; slices 1 to 3 need none of them, and the app refuses to boot only when a slice that uses them is on.
- `BOOKING_PUBLIC_ORIGIN` and `APP_URL`: already set, read by the function for the canonical address.

**Critical test scenarios**:

- Happy path: paste `timefix.com/<handle>` into a message and the preview shows the person's name, their photo and the address; `curl` of the path shows the meta block, verifies AC-5501, AC-5502, AC-5510.
- Failure case: the api is stopped; the path still answers 200 with the built shell and the brand card, and the page still works once the api returns, verifies AC-5503.
- Failure case: a link's site redirects to `http://169.254.169.254/latest/meta-data/`; the fetch is refused after the redirect, the item keeps its letter, and nothing is stored, verifies AC-5520.
- Failure case: an uploaded share image is a PNG header on a 2 GB decode bomb; it is refused on pixel count before anything is stored, verifies AC-5515.
- Failure case: an import of a page with a video block and a payment block; both are listed as skipped with their reason and nothing is live, verifies AC-5526, AC-5527.
- Auth and permission: a signed in person calls `profile.uploadShareImage` while naming another person's handle; the handle is not an input, so their own card changes and the other person's does not, verifies the security model.
- Policy: the page, the card and an icon all load with no request to any outside origin and no console policy violation, verifies AC-5529.
- Tenancy: `/b/:key` is byte for byte what it was, verifies AC-5507.

## Build plan

Tracer Bullet: slice 1 is one thin thread through every layer, and each slice after it is shippable on its own. Slice 1 is the smallest thing that makes a shared link visibly better, which is the whole reason the owner asked, and it needs no object storage at all.

**Slice 1: a real preview when the link is pasted** (AC-5501, AC-5502, AC-5503, AC-5504, AC-5505, AC-5506, AC-5508, AC-5509, AC-5510, AC-5511, AC-5512, AC-5513, AC-5514, AC-5529, AC-5530)

1. The migration, part one: `indexable` on `auth.public_profiles`, and the definer that writes it.
2. `apps/api`: `GET /api/public/handles/:handle/card.png`, the person card and the brand card, drawn from the design artifact's design in Inter, with the photo through the existing picture fetch, its version, its cache headers and its limits.
3. `apps/web`: the handle shell function, the meta block, the 800ms read with its fall back to the plain shell, the theme attributes from spec 0054, and the handle rewrites pointed at it.
4. The header test comparing the function's answer to `vercel.json`'s block for handle paths.
5. `packages/data` plus the link page view: the indexing switch and a Share card panel showing the card as it will appear, both under Settings, beside the Appearance card of spec 0054.

**Slice 2: the booking page's own card** (AC-5507)

1. The meta block for `/<handle>/<slug>`, carrying the booking page's title and note through the existing read.
2. The rewritten guard test: `/b/:key` untouched, `/<handle>/<slug>` unchanged except for the meta block.

**Slice 3: bringing a Linktree page across** (AC-5524, AC-5525, AC-5526, AC-5527, AC-5528, AC-5531)

1. `packages/core/src/public/outside-fetch.ts`: the one hardened fetch, its address range checks, its caps and its tests, with the picture fetch moved onto it.
2. The lint rule that fails any other fetch of a user supplied address.
3. `link_imports`, `profile.importLinks`, the host allow list, the parser and the limits.
4. The editor: Import from another page in the link page view (Settings › Account › "Your link page"), the imported section's rows arriving hidden with their switches off, Show all, the skipped rows with their reasons, and the sweep after 30 days.

**Slice 4: favicons** (AC-5518, AC-5519, AC-5520, AC-5521, AC-5522, AC-5523), needs R2 (#32)

1. The R2 wrapper module and its environment, behind the one vendor wrapper rule.
2. `link_icons`, the Graphile Worker job that fetches, re-encodes and stores one origin's icon, its 30 day refresh and its 7 day failure memory.
3. `GET /api/public/icons/:id` and the page's fall back order.
4. The per item Use the site's icon switch.

**Slice 5: a custom share image** (AC-5515, AC-5516, AC-5517), needs R2 (#32)

1. `share_image`, the upload with its type, size and pixel checks, the re-encode and the private R2 key.
2. `card.png` answering the uploaded image when there is one.
3. Remove, behind a Modal, deleting the object.

## Consequences

**Positive**:

- A pasted link stops being a dead grey rectangle. That is the single most visible thing about a page whose whole job is being handed to somebody.
- The page becomes findable by name, which is what people expect of a page at their own address.
- The first paint gets the owner's colour, because the shell now knows it. The step spec 0054 had to accept goes away.
- One module owns every outside fetch in the product, with one set of rules and one place to review. The picture fetch joins it rather than sitting beside it.
- An import makes moving from Linktree a press rather than an evening, and it can never publish something the person has not seen.

**Negative / tradeoffs**:

- Every handle request now runs through a function on a cache miss. That is latency and cost the static shell did not have, bounded by a five minute edge cache and a shell that answers whether or not the read works.
- The product gains a real server side request forgery surface where it had almost none. The rules are strict and tested, but it is now a thing that has to stay strict forever, and every new outside fetch has to go through the same door.
- Two slices wait on R2 (#32), which is not built. They are written here so the shape is settled, and they will sit unbuilt until it lands.
- The handle rewrites in `vercel.json` move from a static file to a function, which is a deploy time change on the path that serves the most public pages in the product. A mistake there is visible to everybody at once.
- Making pages indexable by default is a real change in what the product does with somebody's name. The switch is there, but the default decides what most people get.

**Neutral**:

- Spec 0051 AC-5131 is narrowed by AC-5507. That is written down in both places rather than left to be noticed.
- The card drawing adds a dependency for turning a drawing into a PNG, pinned exactly in the catalog, running in the api. It is one more thing in the image, and it is the boring choice for this job.
- `auth` gains two columns on two tables and two small tables. The guard tests grow to match.

## Follow-up

Named, not built here:

- **A sitemap for handle pages**, once the pages are indexable and there are enough of them to be worth listing.
- **Structured data on the page** (a `Person` record a search engine can read), which is cheap once the meta block exists and worth measuring before adding.
- **Importing from a vCard or a LinkedIn export**, the other two shapes people arrive with.
- **Counting a share**: spec 0051's Share button and the system share sheet pass a page on, and nothing counts it. Worth doing once there is a reason to compare a share with a press.
- **An icon a person uploads for one row**, rather than the site's own. It is the share image's machinery at a smaller size.
- **The product line on the card** is a marketing string. It should come from one place the marketing site also reads, once there is one.

## Open for the owner

Decided here, and reversible by a word from the owner:

- **The card is drawn in Inter, the family this repo ships and self hosts.** The approved design uses Instrument Sans, which the repo does not have. Putting it in would mean a font file in the design system artifact and a tokens sync, which changes the bundle for every screen. Worth the owner's call.
- **The card says `timefix.com/<handle>`.** The approved design says `timefix.ai/brijraj`. The brand domain decision of 24 October 2026 is `.com` everywhere with `.ai` redirecting, so the card follows that; if the design meant otherwise, say so.
- **Handle pages are indexable by default.** A page at a person's own address, handed out on purpose, should be findable. The switch is there for anybody who disagrees, but the default is a product and privacy call worth confirming.
- **The import allow list names seven competitors.** Which services to name, and whether to name them in the product's copy at all, is an outward facing choice.
- **Whether a custom share image should be plan limited** once billing exists.
