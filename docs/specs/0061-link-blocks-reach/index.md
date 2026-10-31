# 0061. Link page blocks and reach

**Date**: 2026-10-31
**Status**: Proposed
**Numbering**: 0061 claimed by the links, booking and forms chat on 31 October 2026 (0058 and 0060 to 0064 are this chat's, 0059 is crm-28's). This spec owns AC-6101 to AC-6199.

## Summary

Today every block on a link page is the same plain row, the page can't show a picture, a video or a song, and the owner only sees a count of views. This spec adds the blocks people expect from Linktree, Beacons and Bento: thumbnails and featured links, a grid layout, a social icons row, media you tap to play, images and galleries, a "next open times" block, scheduled links, a banner, a sensitive content notice and several contact cards. It also tells the owner where visitors come from and how many go on to book, makes the page readable by search engines, and lets the QR code and share links carry the owner's style and tracking. Nothing from another site loads until a visitor taps it, no cookie is set and no address is stored, and "Powered by Timefix" stays.

## Requirements

**User stories**:
- As a link page owner, I want pictures, videos, music and a grid, so my page looks like me and not like a list.
- As an owner who books meetings, I want my next open times right on the page, so a visitor books in two taps.
- As an owner, I want to schedule links and add a banner, so a launch or an offer shows up and ends on time.
- As an owner, I want to see where visitors come from and how many book, so I know which channel works.
- As a visitor, I want the page fast and private, with nothing from another site until I choose to play it.
- As someone searching for this person, I want their page to show up with their name, bio and links.

**Acceptance criteria**:

Blocks and layout:
- **AC-6101**: A link may carry a thumbnail: one the owner uploads, or one fetched from the site's `og:image` when the owner presses "Use the site's picture" (offered on add when the site has one). It draws left of the title in a row and as the tile picture in a grid. It is always served from our origin on a versioned path with a day of cache. With none, or when it fails, the link falls back to today's order (mark, icon, the site's icon, the letter).
- **AC-6102**: A link may be `featured`: a larger card with its thumbnail across the top and its title and note under it. At most 3 links are featured. Emphasis comes from size and place only, with no animation on the public page's first paint.
- **AC-6103**: When the page's layout (spec 0060) is `grid`, blocks draw as tiles on a 2 column grid under 768 wide and a 4 column grid from 768. A block is `small` (1 by 1), `wide` (2 by 1) or `large` (2 by 2), picked in the editor from three tiles. Headings, writing, questions, forms, contact cards, testimonials, the banner, next times and the socials row always span the full row. Tiles keep the list order exactly, with no dense packing, so the reading order, the focus order and what you see always match.
- **AC-6104**: A socials row block draws the person's social links (the ten from `auth.social_links`) as a row of marks, each a real link named by its network for screen readers. At most 1 per page, placed wherever the owner puts it.
- **AC-6105**: A media block takes a share link from YouTube, Vimeo, Spotify, SoundCloud or Apple Music. The server reads it into a provider and an id with strict patterns; anything else is refused with "Paste a link from YouTube, Vimeo, Spotify, SoundCloud or Apple Music." Its title defaults to the provider's own (read once on save) and the owner may change it. At most 10.
- **AC-6106**: A visitor first sees a facade: the poster (fetched once on save and served from our origin), the title, the provider's name, a Play button and the line "Plays from YouTube" (or the provider). Nothing is requested from the provider until Play is pressed. Then the provider's player replaces the facade in place, with the same size so nothing jumps, and focus moves into it. YouTube plays from `youtube-nocookie.com`. The frame's address is built only from the parsed provider and id, never from what was pasted.
- **AC-6107**: The two policies vercel.json sends for handle addresses gain exactly one directive: `frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com https://w.soundcloud.com https://embed.music.apple.com`. No other directive changes, the app, `/b/` and `/f/` policies are untouched, and `apps/web/csp.test.ts` pins it.
- **AC-6108**: An image block holds one picture (JPEG, PNG or WebP, up to 10 MB picked, made at most 1600 pixels on its long side in the browser before upload, at most 1.5 MB stored), alt text (required: "Describe the picture for people who can't see it."), an optional caption up to 120 characters and an optional link. At most 10.
- **AC-6109**: A gallery block holds 2 to 12 pictures, each with its own alt text, drawn as a swipe row (scroll snap, with Previous and Next buttons on wide screens) or a grid, as the owner picks. Pressing a picture opens it large in a viewer that works with the arrow keys, Escape and a swipe, and returns focus to the picture on close. At most 3.
- **AC-6110**: A next times block names one of the person's booking pages in this link page's workspace. It draws the page's title and up to 6 next open times as chips, for its first length, in the visitor's time zone, and a "More times" link. The times load when the block nears the screen, from a light read cached for 60 seconds. A chip opens `/<handle>/<slug>?at=<start>&len=<minutes>`; the booking page opens on that day with that time chosen and the details form ready, or, if the time is gone, on that day with "That time was just taken. Here are the others." With no open times in 14 days it says "No open times in the next two weeks" and keeps "More times". The page's own rules (Public, live) decide whether the block shows, exactly as a booking page block. At most 3.
- **AC-6111**: Every block except a heading may carry "Show from" and "Hide after" (a date and time in the owner's time zone, stored in UTC). The public read leaves out a block outside its window. The editor shows a chip ("Starts 3 Nov, 09:00", "Ends 10 Nov", "Ended"). "Hide after" must come after "Show from".
- **AC-6112**: A banner block is one line up to 80 characters with an optional link, drawn at the very top of the page above the person's card. At most 1 live. A visitor may close it for the tab's session.
- **AC-6113**: A link may carry a notice: `sensitive`, `18` or `21`. Pressing it opens a small sheet ("This link may show sensitive content." or "You need to be 18 or older to open this.") with Continue and Go back. Continue opens the link and is remembered for that link for the tab's session. A press is counted only on Continue. Noticed links carry `rel="nofollow"` and are left out of the structured data and the crawler text.
- **AC-6114**: A page holds up to 3 contact cards, each with its own Save contact. `contact.vcf?card=<id>` answers that card; with no `card` it answers the first live card, so every link already shared keeps working. The wallet pass keeps using the first card.
- **AC-6115**: New kinds have limits beside the old ones: socials 1, media 10, image 10, gallery 3, next times 3, banner 1 live, contact 3 (was 1), featured links 3. The page total stays 60. A full kind is disabled in the Add grid with its sentence, as today.

Insights:
- **AC-6116**: Each counted view carries four facts and nothing else: the referring site's host (from `document.referrer`, the host only, up to 120 characters, "Direct" when empty or our own origin), the `utm_source` (lower case, up to 60 characters, letters, digits, `_`, `-` and `.`), the country (two letters from `x-vercel-ip-country`) and a device class (mobile, tablet or desktop, worked out from the user agent at request time). No address, no user agent and no cookie is stored. The owner's own views and known machines are still not counted.
- **AC-6117**: Views and visitors are rolled up per day, per fact and per value in the same statement that counts the view. A visitor counts once per day per value (the first view of their day decides). Past the top 50 values of a fact in a day, the rest fold into "Other", so a read stays small.
- **AC-6118**: The editor's Insights shows views and visitors per day over 7, 30 or 90 days, with the period before as the comparison, then the top 5 referrers, sources, countries and devices (and "Other"), then each block's presses. Every chart can be read as a table by a screen reader. Empty: "No visits yet. Share your page to see where people come from."
- **AC-6119**: Insights shows a funnel for the period: views, then presses, then bookings, with counts and rates. A booking counts when it is made at `/<handle>/<slug>` or from a next times chip: the booking request carries `via: { handle }`, the server checks that page is a live block on that handle's page and adds one to that day. Nothing about it is stored on the booking itself.
- **AC-6120**: "Download CSV" saves `<handle>-insights-<from>-<to>.csv` for up to 365 days, one row per day, metric and key (views, visitors, presses per block, bookings, each fact's values). A cell starting with `=`, `+`, `-` or `@` is written with a leading `'` so a spreadsheet never runs it.

Search and sharing:
- **AC-6121**: An indexable page's shell carries one `application/ld+json` block: a `ProfilePage` whose `mainEntity` is a `Person` with name, description (the bio), image (the picture, when it is shown), url and `sameAs` (the social links). Every `<` in it is written as `<`. A page set not to index carries none.
- **AC-6122**: The handle shell writes the person's name, bio and their live links' titles and addresses (up to 60, in order, plain text, escaped) as simple HTML inside the page root. The app replaces it on mount with no visible jump (layout shift at most 0.05). Noticed links are left out.
- **AC-6123**: `<public origin>/sitemap-handles.xml` lists every public, indexable link page with at least one live block, with its last change, split at 50,000 with an index file. `robots.txt` on the public origin names it and disallows the app and api paths. Both are cached for an hour.
- **AC-6124**: The share QR may take a module colour (refused with a hint when its contrast with the light background falls under 4.5 to 1), an optional centre picture (the person's picture or an upload, at most 20% of the code, with the highest error correction), and an optional frame with a label up to 20 characters ("Scan me"). It downloads as a 1024 PNG and as SVG. The choices are saved per page. The background always stays light, because not every scanner reads an inverted code.
- **AC-6125**: Share offers ready links per place (Instagram, TikTok, LinkedIn, X, an email signature, the QR), each adding `utm_source=<place>` and `utm_medium` (social, email or print), plus a small builder for source, medium and campaign. These are what Insights shows under Sources.

Quality and rails:
- **AC-6126**: The booking page bundle (which draws the link page) keeps its first load budgets (230 kB JavaScript, 18 kB CSS, gzipped). Thumbnail rows, featured links, the socials row and the banner draw from the first load. Media, image, gallery, next times and the notice sheet each load as their own chunk, only when a block of that kind is on the page. Every picture has its width and height set and loads lazily below the fold.
- **AC-6127**: No request leaves for another site before a visitor presses Play. No cookie is set. Session storage holds only a closed banner and a continued notice.
- **AC-6128**: Every outside read (thumbnail, poster, the provider's title) goes through `createOutsideFetch`: https only, every resolved address checked against private, loopback, link local and similar ranges before connecting and after each redirect, 3 seconds in all, at most 64 kB of a page read for its tags, at most 1 MB of image, JPEG, PNG or WebP by its first bytes (SVG refused). Reads are rate limited per owner (30 a minute) and per address. Uploads are checked by their first bytes and stored with their metadata removed (JPEG APP segments, PNG text and `eXIf` chunks, WebP EXIF and XMP chunks), so no location leaves with a photo.
- **AC-6129**: The new tables are reached only through `crm_handle` definers. `crm_app` holds no grant, and the guard test proves a direct read is refused. A picture is served only while a live block on that handle's page uses it; anything else answers 404, including an id from another person's page.
- **AC-6130**: Every new block and every new editor piece meets spec 0058's AC-1 to AC-4 and AC-21 (alignment, motion, less text, accessibility, delight) in every look spec 0060 offers, in light and dark.
- **AC-6131**: Nothing else changes. The booking page reads `at` and `len` on both its addresses and nothing more is new there. `/f/` and the app are untouched. Existing tests pass.

## Decision

**Chosen option**: Option 1: New kinds in the existing block list, served from our origin, with click to load media.

Each new thing is a block kind in `ProfileBlock` (one schema, one renderer, one editor, one line in the kind check), pictures are stored in the existing private file store and served by the api, media loads only on a tap, and insights extend the daily rollups spec 0051 already writes.

**Implementation skills**: `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `crm-design-system` (`.claude/skills/crm-design-system/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `security-and-hardening` (`.claude/skills/security-and-hardening/`) · `zod` (`.claude/skills/zod/`) · `dataviz` (built in) · `seo-schema` (built in) · `interaction-design` · `emil-design-eng` · `interface-affordances` · `subtractive-design`

## Feature design

**Data model sketch** (one migration, `packages/db/migrations/0xxx_link_blocks_reach.sql`, numbered after main's last at the final merge):

| Table | Change |
|---|---|
| `auth.profile_items` | `profile_items_kind` adds `socials`, `media`, `image`, `gallery`, `times`, `banner`. `times` needs `page_id` like `page` (`profile_items_page` and `profile_items_plain` updated). New fields live in `data` (jsonb, still at most 4,096 bytes): `thumb` (image id), `style` (`row` or `featured`), `size` (`small`, `wide`, `large`), `showFrom`, `hideAfter`, `notice`, and per kind fields below. |
| `auth.profile_images` (new) | `id` uuid key, `user_id`, `workspace_id`, `kind` (`upload`, `thumb`, `poster`), `path` (unique, in the file store), `content_type` (`image/jpeg`, `image/png`, `image/webp`), `bytes` (at most 1,572,864), `width`, `height`, `created_at`. User foreign key with cascade. Index on (`user_id`, `workspace_id`). |
| `auth.profile_view_source_days` (new) | `user_id`, `workspace_id`, `day`, `fact` (`referrer`, `source`, `country`, `device`), `value` (1 to 120 characters), `views`, `visitors` (both at least 0). Key (`user_id`, `workspace_id`, `day`, `fact`, `value`). |
| `auth.profile_booking_days` (new) | `user_id`, `workspace_id`, `day`, `bookings` (at least 0). Key (`user_id`, `workspace_id`, `day`). |
| `auth.public_profiles` | Adds `qr_style` jsonb, nullable, at most 1,024 bytes. |

Per kind fields in `data`:
- `media`: `provider` (`youtube`, `vimeo`, `spotify`, `soundcloud`, `applemusic`), `ref` (the parsed id or canonical path), `title`, `poster` (image id).
- `image`: `image` (image id), `alt`, `caption`, `url`.
- `gallery`: `images` (2 to 12 of { image id, alt }), `display` (`row` or `grid`).
- `times`: the page by `workspace_id` and `page_id` columns, as `page` does.
- `banner`: `text`, `url`.
- `socials`: no fields.

Retention: the two new day tables go after a year with the daily cleanup, like the views. A picture no live or archived block uses is deleted from the store and the table after 24 hours by the same sweep. Deleting a block frees its pictures; archiving keeps them.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `profile.saveItem` (oRPC, existing) | POST | the new kinds and fields | `ProfileItem` | session, own page | `LIMIT_REACHED`, `CONFIG_INVALID` |
| `/api/profile/images` (new, REST, multipart) | POST | workspace id, file, kind `upload` | image id, width, height | session | 413 too big, 415 wrong type, 429 |
| `profile.fetchThumbnail` (new) | POST | workspace id, item id | image id or `none` | session, own item | `CONFIG_INVALID` when the site has none |
| `profile.counts` (existing, extended) | GET | workspace id, days (7, 30, 90) | series per day, the period before, top values per fact, funnel, presses | session | none |
| `profile.saveQrStyle` (new) | POST | workspace id, colour, picture id, frame label | the saved style | session | `CONFIG_INVALID` on low contrast |
| `/api/profile/insights.csv` (new) | GET | workspace id, from, to (at most 365 days) | CSV file | session | 400 |
| `/api/public/handles/:handle` (existing) | GET | adds `ref` (referrer host) and `src` (utm source) | unchanged, with the new kinds | none | 404 |
| `/api/public/profiles/:handle/images/:imageId` (new) | GET | versioned path | the picture, a day of cache | none | 404 |
| `/api/public/profiles/:handle/items/:itemId/times` (new) | GET | `tz` | up to 6 starts, the length, the slug | none | 404, 429 |
| `/api/public/handles/:handle/contact.vcf` (existing) | GET | adds `card` | vCard | none | 404 |
| `/api/public/booking/:publicKey/book` (existing) | POST | adds optional `via: { handle }` | unchanged | none | unchanged, a bad `via` is ignored |
| `/sitemap-handles.xml`, `/robots.txt` on the public origin (new) | GET | none | XML, text | none | none |

New public routes sit under `/api/public/profiles/:handle/…`, because `/api/public/handles/:handle/:slug` already means a booking page and would shadow them.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Thumbnail fetch | the picture | the link's saved `url`, its page's `og:image`, read through `createOutsideFetch` |
| Media facade | poster and default title | the provider's oEmbed answer (YouTube, Vimeo, Spotify, SoundCloud) or the page's `og:image` and title (Apple Music), read once on save |
| Media player | the frame address | built from `provider` and `ref` by `packages/core/src/profile/embeds.ts`, never the pasted text |
| Next times | the starts | the existing slot engine behind `/api/public/booking/:publicKey/slots`, for the page's first length, the next 14 days, the visitor's `tz` |
| View facts | referrer host, utm source | sent by the page from `document.referrer` and `location.search`, checked again on the server |
| View facts | country | the `x-vercel-ip-country` header, read with `readGeo` in `apps/api/src/edge.ts` |
| View facts | device | the request's user agent, classed by the same rule spec 0047's site visits use, then dropped |
| Visitor | the daily HMAC | spec 0047's `visitorId`, as today |
| Funnel bookings | count per day | `via.handle` on a booking request, checked against that handle's live blocks |
| Schedule window | now | the database's `now()` in the public read |
| QR colour check | contrast | the colour and the fixed light background, by the contrast rule the tokens already test |
| Owner's time zone for schedule chips | zone | the member's own time zone setting |

**Key invariants**:
- No outside origin is ever loaded by a visitor before a Play press, and pictures always come from our origin.
- A block's public answer carries no workspace id, member id or email (unchanged rule).
- Tiles never reorder: DOM order is the order the owner set.
- `data` stays under 4,096 bytes; pictures are stored by id, never inline.

**Security model**: the owner writes only their own page in the workspace they are a member of; every write goes through the existing profile procedures and `crm_handle` definers. Visitors read only live blocks. Pictures and posters are private objects served by the api after the live block check. No new secret, no new env var beyond the existing file store token.

**Configuration required**: none new. The file store token (`BLOB_READ_WRITE_TOKEN`) already exists; pictures use the `link-page/` prefix in the same private store.

**Critical test scenarios**:
- Happy path: add a YouTube link, see the facade, press Play, the player loads from `youtube-nocookie.com`, and before the press the network log has no outside request, verifies **AC-6105, AC-6106, AC-6127**.
- Happy path: a visitor arrives from instagram.com with `utm_source=ig_bio`, presses a page block, books; Insights shows the referrer, the source, the press and one booking, verifies **AC-6116, AC-6117, AC-6119**.
- Failure: a thumbnail fetch to a site that redirects to `169.254.169.254` is refused and stores nothing, verifies **AC-6128**.
- Failure: a next times chip for a time just taken opens the day with the "just taken" line, verifies **AC-6110**.
- Permission: an image id from another person's page answers 404, and a direct select on `auth.profile_images` as `crm_app` is refused, verifies **AC-6129**.
- Layout: a grid page tabbed through by keyboard visits tiles in the order they show, verifies **AC-6103**.

**Lanes** (each owns its files; none touches `apps/web/src/features/booking`, `features/bookings`, `packages/ui/src/modules/TeamWeek` or `HoursEditor`; lane branches never edit `docs/specs/`):

| Lane | Owns | Starts | Delivers |
|---|---|---|---|
| R1 Data and rules | `packages/contracts/src/booking/link-page.ts`, `link-page-rules.ts`, `packages/contracts/src/profile.ts`, `packages/db/src/schema/auth.ts` (the new tables only), the migration, `packages/core/src/profile/{embeds,schedule,sources,images}.ts` and tests, the guard tests | first | AC-6111, 6115, 6116, 6117, 6129 (data side) |
| R2 Server | `apps/api/src/public/link-page.ts` (new routes), in `apps/api/src/public/booking.ts` only the handle read, `contact.vcf` and `via` on book, the profile module's new procedures and the CSV route, `apps/web/handle-meta.ts`, `handle-shell.ts`, `apps/web/api/handle.mjs`, `apps/web/vercel.json` and `csp.test.ts` | after R1 | AC-6101 (fetch), 6105, 6107, 6110 (read), 6114, 6119, 6120, 6121, 6122, 6123, 6128 |
| R3 Renderers | `packages/ui/src/modules/LinkPage/**` (new block parts in their own files), `packages/ui/src/atoms/QrCode` (style options), stories and tests | after R1 and after spec 0060's renderer lane lands | AC-6102, 6103, 6104, 6106, 6108, 6109, 6112, 6113, 6124 (drawing), 6126, 6130 |
| R4 Editor and insights | `apps/web/src/features/link-page/**` | after spec 0058's Lane C lands, and R1 | AC-6101 (editor), 6103 (size picker), 6111 (chips), 6115, 6118, 6120 (button), 6124, 6125, 6130 |
| R5 Visitor wiring | `apps/web/src/public/booking/{ProfilePage.tsx,link-page.ts,boot.ts}`, a new `apps/web/src/public/booking/at-param.ts` and its one call in `BookingPage.tsx` | after spec 0058's Lane D lands; tell the spec 0062 lanes first | AC-6110 (chips to booking), 6116 (sending facts), 6126, 6127, 6131 |

## Build plan

Approach: Tracer Bullet. One thin thread first (the media block end to end, because it proves the policy, the facade, the outside fetch and a lazy chunk at once), then the rest by lane.

1. R1: contracts for every new kind and field, limits, the migration, core rules (embed parsing, schedule window, source checks, image checks), guard tests, satisfies **AC-6111, AC-6115, AC-6116, AC-6117, AC-6129**
2. Thread: media block from contract to editor to facade to player, with the CSP directive and the poster fetch, satisfies **AC-6105, AC-6106, AC-6107, AC-6127, AC-6128**
3. R2: picture upload and serving, thumbnail fetch, next times read, `via` on book, `contact.vcf?card`, counts with facts and funnel, CSV, satisfies **AC-6101, AC-6110, AC-6114, AC-6119, AC-6120, AC-6128**
4. R2: JSON-LD, crawler text in the shell, sitemap and robots, satisfies **AC-6121, AC-6122, AC-6123**
5. R3: thumbnail rows, featured, grid, socials row, image, gallery and viewer, banner, notice sheet, next times chips, QR styles, satisfies **AC-6102, AC-6103, AC-6104, AC-6108, AC-6109, AC-6112, AC-6113, AC-6124**
6. R4: Add grid entries and editors for each kind, size picker, schedule fields and chips, Insights with chart, facts, funnel and CSV, share links builder and QR style, satisfies **AC-6101, AC-6103, AC-6111, AC-6118, AC-6120, AC-6124, AC-6125**
7. R5: the page sends its facts, lazy chunks per kind, the `at` reader on the booking page, budget check, satisfies **AC-6110, AC-6116, AC-6126, AC-6127, AC-6131**
8. Verify pass across lanes in every spec 0060 look, light and dark, satisfies **AC-6130**

## Consequences

**Positive**:
- The page can look like the person, not a list, and still loads fast and privately.
- Owners see which channel brings visitors and bookings, which is the reason to pick Timefix over a plain link tool.
- Search engines can read and list the page.

**Negative / tradeoffs**:
- A new policy directive (frames from five providers) widens what the handle pages may load after a tap.
- Pictures add storage and a daily sweep; outside reads add rate limited server work.
- More block kinds mean more editor surface to keep short and clear.

**Neutral**:
- `auth.profile_views` keeps its shape; the facts live in their own day table.
- The booking request gains one optional field that spec 0062 can reuse for its own booking sources.

## Follow-up

- [ ] Spec 0062 should reuse `via` (and add UTM capture on bookings) rather than invent a second source field.
- [ ] Commerce blocks (products, tips, paid downloads) wait for the payments decision in spec 0062.
- [ ] Mailing list integrations for email signup (Mailchimp, Kit) and pixels (GA4, Meta) wait for spec 0064, because each adds an outside origin.
- [ ] Collections (a group that opens its own sub page) and A/B tests on links are left for later.

## Rationale

See [rationale.md](rationale.md).
