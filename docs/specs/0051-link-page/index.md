# 0051. The link page at `/<handle>`

**Date**: 2026-10-24
**Status**: Proposed (amended by [0056](../0056-link-page-per-workspace.md): one link page per workspace)

**Numbering**: 0051 taken by the spec lane on 24 October 2026 (0048 is Lists, 0049 and 0050 are claimed by another chat). This spec owns AC-5101 to AC-5199.

## Summary

The public profile at `/<handle>` stops being a list of booking pages and becomes a link in bio page, the way Linktree and Cal.com profiles work. A person keeps one ordered list of items on it: a link, a booking page, a contact card a visitor saves as a vCard, and a heading that groups the rest. The ordered list lives with the person, not with a workspace, because the profile crosses every workspace they are in. The dashboard shows a QR code that opens the page, and the owner sees how many people looked and what they pressed.

The booking page at `/b/:key` and the page at `/<handle>/<slug>` do not change at all. Nothing is added to the booking page's widgets: the owner's team asked for the link page to stay separate from it.

Reasoning, options and the calls taken on the owner's behalf: see [rationale.md](rationale.md). How to check it: [verify.md](verify.md).

## Requirements

**User stories**:

- As a person at an event, I want one address people can scan from my phone, so I can hand over everything about me in one move.
- As a visitor, I want to save the person's contact details to my phone in one press, so I remember who I met.
- As a visitor, I want their meeting links, their website, their LinkedIn and their WhatsApp in one place, so I pick the one I came for.
- As the owner of the page, I want to add, rename, reorder and archive items the same way I order my booking pages today, so there is nothing new to learn.
- As the owner of the page, I want to see it as a visitor sees it while I build it, so I do not have to publish to find a mistake.
- As the owner of the page, I want a QR code in my dashboard that opens my page, so I can show it on a phone or print it on a badge.
- As the owner of the page, I want to know how many people looked and which items they pressed, so I know what earns its place.
- As a person in two workspaces, I want my personal links and my work links to sit under their own headings, so a visitor is not confused by one long list.

**Acceptance criteria**

*The item list*

- **AC-5101**: A person's profile holds one ordered list of items, kept with their account and not with any workspace. An item is one of four kinds: `link` (a title, an address, an optional one line note and an optional icon), `page` (one of their booking pages), `contact` (the one contact card) or `heading` (a small heading the items under it belong to). Order is one sequence across every kind; a heading owns every item after it until the next heading.
- **AC-5102**: One profile holds at most 60 items: at most 40 of kind `link`, at most 12 of kind `heading`, at most 1 of kind `contact`, and the `page` items a person's booking pages allow. The 61st, or the 41st link, is refused with `LIMIT_REACHED` and a sentence naming the limit, and the editor's Add menu disables the kind that is full with the same sentence.
- **AC-5103**: A `link` item's address is `https://`, `http://`, `mailto:`, `tel:`, or `sms:`, at most 2,000 characters, with no credentials in it and no other scheme (`javascript:` and `data:` are refused with `CONFIG_INVALID`, "That address can't be a link."). An address typed without a scheme gets `https://`. Its title is 1 to 60 characters and its note at most 120.
- **AC-5104**: A `page` item names a workspace and a booking page in it. The page's own rules still decide whether a visitor sees it (Public, live, not deleted, its owner still an active member of a workspace that exists, exactly as `crm_booking_profile_pages` decides today). A page the rules now hide is skipped by the public read and its item stays, so turning the page back on puts it back where it was.
- **AC-5105**: A `heading` is 1 to 40 characters. Two headings may not have the same text ignoring case and surrounding spaces; a repeat is refused with `CONFIG_INVALID`, "You already have a heading called that."
- **AC-5106**: An item is archived rather than deleted when the owner chooses Archive: it leaves the public page at once, keeps everything it held, and the editor lists it under Archived with Restore. Delete removes it for good and asks first in a Modal (the confirm rule, 21 October 2026). Archiving a heading archives nothing under it; those items move up under the heading before it.
- **AC-5107**: Every write is idempotent on the client minted item id: a retry of the same add answers the item already made and adds nothing.

*The public page*

- **AC-5108**: `GET /api/public/handles/:handle` answers the person (handle, name, initials, picture, bio) and one page of their live items in order, every kind together, at most 20 items at a time, with a cursor for the next. An archived item, and a `page` item whose page is hidden, is never in the answer. The answer carries no workspace id, no member id, no email, and no item the owner archived.
- **AC-5109**: The page at `/<handle>` draws the person's card, then the items in order: a heading as a small heading, a `link` as a row with its icon, title and note, a `page` as the row it draws today (title, note, lengths, Team), and the `contact` card as its own block with Save contact. A row is a real link a visitor can open in a new tab, copy or middle click.
- **AC-5110**: An item's icon is drawn from our own origin only, so the policy `img-src 'self' data: blob:` is unchanged. In order: a known social network's own mark through `ProviderMark` (LinkedIn, X, Instagram, GitHub, Facebook, YouTube, AngelList, TikTok, Threads, matched from the address by `@crm/contracts/values`'s `social.ts`), else a Lucide icon the owner picked from a small set, else the title's first letter in the item's hue. No outside image is ever fetched, and no favicon is read from another site.
- **AC-5111**: The page reads at 390 wide first and holds to a comfortable measure on a wide screen, in light and in dark, meets WCAG AA for contrast, is fully reachable by keyboard in the order it reads, and keeps its loading, empty and failed states (the shapes of the rows while they load, so nothing jumps).
- **AC-5112**: An owner with a handle but no items yet shows the same page with a quiet empty state, never a broken page; an unknown handle is the existing not found page, word for word.

*The contact card and the vCard*

- **AC-5113**: The `contact` item holds the fields its owner typed: a full name (required), a job title, a company, one email, one phone, one website and a one line note. Nothing is read from a CRM record: the public page never shows workspace data.
- **AC-5114**: `GET /api/public/handles/:handle/contact.vcf` answers that card as vCard 3.0, `text/vcard; charset=utf-8`, `Content-Disposition: attachment; filename="<handle>.vcf"`, with the person's picture embedded as base64 when they have one and have not hidden it. A handle with no contact item answers 404. Every value is escaped per RFC 6350 and lines are folded at 75 octets.
- **AC-5115**: Save contact on the page is a plain link to that address, so it works on iOS, Android and desktop with no script, and it works when scanned straight from a QR code.

*The editor*

- **AC-5116**: Settings › Profile's "Pages on your profile" becomes "Your link page", built on the same section: the same cards, the same rows, the same grip, the same drag, the same keyboard move on the grip (Enter, the arrows, Enter), and the same Move up and Move down in each row's menu. Each move saves at once, and a refusal puts the row back and says why.
- **AC-5117**: "Add" is a Menu with Link, Booking page, Contact card and Heading. Link, Contact card and Heading open a Modal with their fields; Booking page opens a Modal listing the person's Public booking pages not already on the page, across every workspace, with the workspace named beside each.
- **AC-5118**: A row's menu offers Edit, Copy link, Move up, Move down, Archive and Delete. Edit opens the same Modal the add used, filled in. Delete asks first.
- **AC-5119**: Beside the list, a preview shows the page as a visitor sees it, in a phone sized frame, built from the same public page components and fed by the unsaved draft, so a change shows before it is saved. On a screen under 1100 wide the preview sits behind a Preview button that opens it in a Modal. The preview is never an iframe and never loads the public origin.
- **AC-5120**: A person with no handle yet sees the claim a handle note that stands there today, and the Add menu stays off until they claim one.

*The QR code*

- **AC-5121**: Home shows a "Your link page" card once the person has a handle: the QR code for `https://<public origin>/<handle>`, the address itself, Copy link, and Open. There is nothing to turn on: the code exists as soon as the handle does.
- **AC-5122**: The card's QR opens a Modal with the code drawn large, Copy link, and Download PNG, which draws the existing `QrCode` SVG into a canvas and saves `<handle>-link-page.png` at 1024 by 1024 with its quiet margin (a `blob:` address, which the app's policy allows). The code is dark on light in both themes, since not every scanner reads an inverted code.
- **AC-5123**: A person with no handle sees the card with a quiet state and a link to Settings › Profile to claim one; the card is never shown empty or broken.

*Views and presses*

- **AC-5124**: A profile view is counted once per read of `GET /api/public/handles/:handle` that is not the owner's own and not a known machine, kept in `auth.profile_views` by the owner's user id, the UTC day and the visitor, with a count. The visitor is the same daily HMAC spec 0047 already mints (`visitorId`), so no address and no user agent is stored and nobody can be followed from one day to the next.
- **AC-5125**: A press on an item is counted by `POST /api/public/handles/:handle/press` with the item's public id, sent as a beacon so the navigation is never held up, kept in `auth.profile_item_presses` by item, UTC day and visitor, with a count. A press that does not reach us is lost on purpose: nothing about the page waits on it.
- **AC-5126**: Both counters refuse a known machine, keep 60 presses and 60 profile reads a minute per address and 600 a minute per handle, and refuse an item id that is not on that handle's live page with 204 and no row written (a counter never says whether an id exists).
- **AC-5127**: The editor shows, per item, its presses over the last 30 days, and the section heading shows the page's views and its visitors over the same 30 days, with the period before it as the comparison. Zero reads as "No presses yet", never as a missing number.
- **AC-5128**: Views and presses older than a year go with the daily cleanup, like the booking page views do.

*Keeping what already works*

- **AC-5129**: The profile's old ordering (`booking_pages.profile_position` and `booking_pages.profile_section`) is read by nothing once the backfill has run: every Public page of every person becomes a `page` item in the order and under the heading it had, and each workspace's group from the `wip/profile-split` lane becomes a real heading named after that workspace. The two columns stay in place, unread, for one release, and a later migration drops them.
- **AC-5130**: The booking page editor's Section control writes the heading of that page's item. A page not on the profile yet gains its item when it is first placed there.
- **AC-5131**: `/b/:key` and `/<handle>/<slug>` are untouched: no new request, no new markup, no change to their policy headers. A guard test fails if the link page's modules are imported by either.
- **AC-5132**: `auth.profile_items`, `auth.profile_views` and `auth.profile_item_presses` are reachable only through the `crm_handle` definers. `crm_app` holds no grant on them, and a guard test proves a direct select is refused and that each new definer is owned by `crm_handle` with a fixed `search_path`.
- **AC-5133**: The search that appears on the page once there are more than eight rows searches titles and notes across every kind, keeps its 250ms rest and its "only the newest answer lands" rule, and never hides a heading whose items matched. With a search in play the page shows the matches flat, with no headings, and says how many matched.

## Decision

**Chosen option**: Option 1 in the rationale. One ordered item list per account, in schema `auth`, written and read only through `crm_handle` definer functions, with the booking pages joining that list as items rather than keeping an ordering of their own.

- **Where an item lives**: `auth.profile_items`, keyed by the owner's user id. The profile belongs to the person and crosses workspaces, so no workspace may own an item: leaving a workspace must never take a person's LinkedIn link with it.
- **How tenancy still holds**: schema `auth` sits outside the tenant fence, exactly as `auth.public_handles` and `auth.public_profiles` do. Row level security is not the control here; the definer is. Every function takes the owner's user id, the api passes only the session's own id, and `crm_app` cannot read the tables directly.
- **How the access door still applies**: a `page` item carries a workspace id and a page id, and nothing more. Whether a visitor sees that page is still decided where it is decided today, by `crm_booking_profile_pages` and then a read inside `withWorkspace()` as the page's read only `booking` actor. The link page never widens what a booking page shows.
- **Icons**: our own origin only. Social marks come from `ProviderMark`, everything else from the Lucide registry or a letter. The public pages' policy does not change, and no outside site learns that a visitor opened someone's link page.
- **Analytics**: the counting spec 0047 already built. Same visitor HMAC, same UTC day grain, same cleanup, no new vendor and no cookie.
- **The QR**: `uqr` and the `QrCode` atom already ship for two factor setup. Nothing new is installed.

**Implementation skills**: the house skills `crm-data-model-access` (the tables, the definers and the door), `crm-api-backend` (the public routes, limits and errors), `crm-frontend-state` (the editor through the one data layer) and `crm-design-system` (every screen); plus `drizzle`, `zod`, `vitest`, `security-and-hardening` and `playwright-cli`.

## Feature design

**Data model** (migration `0096_profile_items`):

| Object | Schema | Key | Notes |
|---|---|---|---|
| `profile_items` | `auth` | `id` (uuidv7, client minted) | `user_id` (cascades with the account), `kind` (`link`, `page`, `heading`, `contact`), `position` (smallint, 0 to 999), `title` (1 to 60), `note` (null, ≤ 120), `url` (null, ≤ 2000), `icon` (null, ≤ 40, a Lucide name from the allowed set), `hue` (smallint), `workspace_id` (null, set for `page`), `page_id` (null, set for `page`), `card` (jsonb, null, set for `contact`), `archived_at` (null), `created_at`, `updated_at`. Unique (`user_id`, `position`) deferred within a reorder; unique (`user_id`, `workspace_id`, `page_id`) where `kind = 'page'` and `archived_at is null`; a partial unique index on (`user_id`) where `kind = 'contact'` and `archived_at is null`; a partial unique index on (`user_id`, `lower(btrim(title))`) where `kind = 'heading'` and `archived_at is null`. Index (`user_id`, `archived_at`, `position`, `id`) for the read. Checks per kind: a `link` has a url and no page, a `page` has a workspace and a page and no url, a `heading` has only a title, a `contact` has a card. |
| `profile_views` | `auth` | (`user_id`, `day`, `visitor`) | `views`, `first_at`, `last_at`. Index (`day`) for the cleanup. |
| `profile_item_presses` | `auth` | (`item_id`, `day`, `visitor`) | `presses`, `first_at`, `last_at`. Foreign key to `profile_items`, cascade. Index (`day`). |

`card` (jsonb, validated by the `ProfileCard` Zod schema before it is written, never read as free text): `{ fullName, jobTitle?, company?, email?, phone?, website?, note? }`, each a trimmed string, `fullName` 1 to 80, the rest at most 120, `email` an address, `phone` at most 32 characters of digits, spaces, `+`, `(`, `)` and `-`.

**Definers** (owned by `crm_handle`, `search_path = pg_catalog, pg_temp`, execute granted to `crm_app` only; the role gains select, insert, update and delete on the three tables and nothing else):

| Function | Answers or does |
|---|---|
| `crm_profile_items(owner uuid)` | Every live item of one person, in order. The editor's read, through the owner's own session only. |
| `crm_profile_items_archived(owner uuid)` | The same for archived ones, newest first, at most 100. |
| `crm_profile_items_public(owner uuid, after smallint, after_id uuid, max integer)` | The live items of one person in order after the cursor, at most `max`. The public read, which then resolves each `page` item through the booking lookup it already uses. |
| `crm_save_profile_item(owner uuid, item jsonb)` | Adds or edits one item, idempotent on its id, raising `54000 PROFILE_ITEM_LIMIT` past a limit and `23505` on a repeated heading or a second contact card. |
| `crm_order_profile_items(owner uuid, ids uuid[])` | Sets the whole order in one statement, refusing a list that is not exactly this person's live items. |
| `crm_archive_profile_item(owner uuid, item uuid, archived boolean)` | Archives or restores one item. |
| `crm_delete_profile_item(owner uuid, item uuid)` | Deletes one item and its presses. |
| `crm_count_profile_view(owner uuid, visitor text)` | Counts one view for today. |
| `crm_count_item_press(owner uuid, item uuid, visitor text)` | Counts one press for today, writing nothing when the item is not that person's live item. |
| `crm_profile_counts(owner uuid, from date, to date)` | Per item: presses in the range; plus the profile's views and visitors in the range. The editor's figures. |

**API surface**:

| Endpoint or procedure | Input | Output | Auth | Key errors |
|---|---|---|---|---|
| `GET /api/public/handles/:handle` (exists) | `after?`, `q?` | the person plus one page of items | public, limited | 404 for an unknown handle |
| `GET /api/public/handles/:handle/contact.vcf` | | the vCard | public, 20 a minute per address | 404 with no contact card |
| `POST /api/public/handles/:handle/press` | `{ item }` as text, sent by `sendBeacon` | 204 always | public, 60 a minute per address | never says whether an id exists |
| `profile.items` | | `ProfileItem[]` plus the archived ones | session, own account | |
| `profile.saveItem` | `ProfileItemInput` | `ProfileItem` | session, own account | `LIMIT_REACHED`, `CONFIG_INVALID` |
| `profile.orderItems` | `{ ids }` | `ProfileItem[]` | session, own account | `CONFIG_INVALID` for a stale list |
| `profile.archiveItem` | `{ id, archived }` | `ProfileItem` | session, own account | `NOT_FOUND` |
| `profile.deleteItem` | `{ id }` | `{ id }` | session, own account | `NOT_FOUND` |
| `profile.counts` | `{ days: 30 }` | per item presses, plus views and visitors | session, own account | |

Every `profile.*` procedure acts on the caller's own account only: the owner's user id comes from the session and is never an input. There is no admin path to another person's link page, in this spec or in the operator console.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Public read | the person's name, initials, bio, picture | `crm_handle_owner`, as today |
| Public read | which items to show | `crm_profile_items_public`, archived ones left out |
| Public read | whether a `page` item is shown | `crm_booking_profile_pages` for that owner, intersected by (workspace, page) |
| Public read | a page item's title, note, lengths, Team | read inside `withWorkspace()` as the page's `booking` actor, as today |
| Public read | the next cursor | the last item's `position` and `id` |
| Public read | an item's icon | the social network matched from `url` by `@crm/contracts/values`, else the stored Lucide `icon`, else the title's first letter |
| Public read | an item's hue | the stored `hue`, minted on add by spec 0012's next hue rule |
| vCard | every field | the `card` json of the `contact` item |
| vCard | the embedded photo | the api's own picture fetch (`picture.ts`), skipped when the person hid it (`user_prefs.picture_hidden`) |
| View count | the visitor | `visitorId(key, { day, address, userAgent })` from `apps/api/src/analytics/visitor.ts` (spec 0047) |
| View count | the day | `utcDay()`, the same helper |
| View count | whether the reader is the owner | the session cookie on the public read, which the booking routes already resolve |
| Press count | which item | the public item id in the body, checked against that owner's live items inside the definer |
| Editor | an item's presses over 30 days | `crm_profile_counts` |
| Editor | the page's views and visitors | `crm_profile_counts` |
| Editor | which booking pages may be added | the person's own Public pages from the data layer's `BookingPageView` list, minus the ones with a live `page` item |
| Home | the QR's value | `publicProfileUrl(handle)` (`apps/web/src/features/booking/links.ts`) |
| Home | the handle | `me.get`'s profile, as Settings › Profile reads it |

**Key invariants**:

- One profile's live items have distinct positions, and the order the editor sends is exactly the set of its live items.
- A live `page` item names a (workspace, page) pair at most once per person.
- At most one live `contact` item per person, and at most one live heading of a given text per person.
- An item never crosses accounts: every definer filters by the owner passed in, and the api never passes an id but the session's own.
- The public answer carries no workspace id and no member id for any item.
- A press row cannot exist for an item that is not its owner's live item.

**Security model**:

- **Read**: the public read is open to anyone, and answers only what this spec names. It is rate limited as the profile read already is.
- **Write**: only the signed in person, for their own account. No workspace role grants it, and an admin of a workspace has no path to another person's link page.
- **Tenancy**: items hold no tenant data. The only tenant data on the page is a booking page's title, note and lengths, which the public page already shows and which still comes through the door.
- **Untrusted input**: an item's address is parsed and its scheme checked on the server before it is stored, not only in the browser. Every row is drawn as text, never as markup, and an outside link carries `rel="noopener noreferrer nofollow"` and `target="_blank"`.
- **Abuse**: the press route and the vCard route are limited per address and per handle, drop known machines, and answer the same way whether or not a thing exists.
- **Personal data**: a contact card is the owner's own details, published by them on purpose. Nothing about a visitor is stored beyond the daily HMAC spec 0047 already keeps, and both counters are swept after a year.

**Configuration required**: none. No new environment variable, no new credential, no new dependency.

**Critical test scenarios**:

- Happy path: a person adds a link, a heading, their booking page and a contact card, reorders them, and `/<handle>` shows exactly that order with the vCard downloading, verifies AC-5101, AC-5109, AC-5114, AC-5116.
- Failure case: two tabs reorder at once; the later order is refused as stale, the row goes back and the editor says so, verifies AC-5116 and the order invariant.
- Failure case: an item is archived while a visitor has the page open; the next read leaves it out and a press on it writes no row, verifies AC-5106 and AC-5126.
- Auth and permission: an admin of the person's workspace calls `profile.saveItem` with that person's item id and changes nothing (the definer filters by the caller), verifies the security model and AC-5132.
- Tenancy: a direct `select from auth.profile_items` as `crm_app` is refused, verifies AC-5132.
- Policy: the public page loads with no request to any outside origin, and no console policy violation, verifies AC-5110.

## Build plan

Tracer Bullet: slice 1 is one thin thread through every layer, and each slice after it is shippable on its own.

**Slice 1: one link on the page, end to end** (AC-5101 partly, AC-5103, AC-5107, AC-5108, AC-5109 partly, AC-5110, AC-5116 partly, AC-5117 partly, AC-5132)

1. Migration `0096_profile_items`: the three tables and the `crm_handle` grants, plus `crm_profile_items`, `crm_profile_items_public`, `crm_save_profile_item` and `crm_delete_profile_item`. Guard test for the grants, the owners and the hardening.
2. `packages/contracts`: `ProfileItem`, `ProfileItemInput`, `ProfileCard`, `ProfileItemKind`, and `PublicProfileItem` folded into `PublicProfile` (the existing `links` stays, carrying the page items, until slice 2 replaces it).
3. `packages/core/src/profile/items.ts`: read, save and delete for one account; the public read joins the items with the booking lookup.
4. `apps/api`: the `profile.items`, `profile.saveItem` and `profile.deleteItem` procedures, and the public read answering items.
5. `packages/data` plus `apps/web` Settings › Profile: Add › Link, its Modal, the row, Edit and Delete, through the one data layer.
6. `apps/web` public page: a `link` row with its icon, drawn by `ProviderMark`, a Lucide icon or a letter.

**Slice 2: the whole list** (AC-5101, AC-5102, AC-5104, AC-5105, AC-5106, AC-5108, AC-5109, AC-5111, AC-5112, AC-5116 to AC-5120, AC-5129, AC-5130, AC-5131, AC-5133)

1. The rest of the definers: order, archive and the archived read, with the limits and the per kind checks.
2. The backfill: every Public page becomes a `page` item in its order, each workspace group from `wip/profile-split` becoming a heading named after the workspace, and `profile_section` and `profile_position` left in place, unread.
3. The editor becomes "Your link page": the Add menu with all four kinds, Archive and Archived, the drag, keyboard and menu moves over the one list, and the booking page editor's Section control writing its item's heading.
4. The preview panel beside the list, and behind a Preview button under 1100 wide.
5. The public page draws headings, pages and links as one ordered list, with its loading, empty and failed states. `sections.ts` reads headings, not `profile_section`.
6. The guard test that the link page's modules never reach `/b/:key`.

**Slice 3: the contact card and the vCard** (AC-5113, AC-5114, AC-5115)

1. `ProfileCard` writing and the single live contact rule.
2. `packages/core/src/profile/vcard.ts`: the vCard 3.0 writer, escaping and folding, with the picture embedded.
3. `GET /api/public/handles/:handle/contact.vcf`, limited, plus the Save contact block on the page and its editor Modal.

**Slice 4: the QR on Home** (AC-5121, AC-5122, AC-5123)

1. The "Your link page" card on Home, with the QR, the address, Copy link and Open.
2. The Modal with the large code and Download PNG, drawn from the existing `QrCode` SVG.

**Slice 5: views and presses** (AC-5124 to AC-5128)

1. The counting definers and the two counter routes, reusing `visitorId`, `utcDay` and `isMachine`.
2. The beacon on the public page, which never holds up a navigation.
3. `profile.counts` and the figures in the editor, per item and for the page.
4. The cleanup's two new sweeps, beside the booking page views sweep.

## Consequences

- The profile's ordering moves from the booking pages table to one list with the person. Anything that reasoned about `profile_position` has one place to change, and after this a page's place on a profile is no longer a property of the page.
- `auth` gains three tables and ten definers. Every one is a thing `security-access-reviewer` must look at, and the guard tests grow to match.
- The public read now joins two sources (the item list, and the booking lookup) per page of 20. That is one extra statement per read, bounded by the page size.
- A person in several workspaces gets one page that mixes them on purpose, under headings they control. The `wip/profile-split` lane's grouping survives as the backfill's starting shape and then becomes editable, which the lane alone could not give.
- The page stays client rendered, so a social crawler still sees the shell. That is a real cost, and the follow up below names it.

## Follow-up

Named, not built here:

- **Themes and appearance**: a background, a button shape, a font pair and a colour, as Linktree's Appearance tab offers.
- **A store**: anything that takes money on the page.
- **Mailing list and newsletter items**: an email capture block that feeds a list or an outside provider.
- **Remember who you met**: the event feature Anish described, where a visitor adds a photo and a note after meeting someone and both sides keep it. It needs its own spec: it writes on the visitor's side, which nothing on this page does today.
- **Favicons for links**: fetched once by the api, stored in R2 (#32) and served from our own origin, so a link to a site with no social mark can still carry its own icon without touching the policy.
- **Server rendered meta and an OG card** for `/<handle>`, so a shared link previews with the person's name and picture.
- **A second contact card** or several, for a person who hands out a work card and a personal one.
- **Collections**, the Linktree idea of a group of links that opens on its own page.
