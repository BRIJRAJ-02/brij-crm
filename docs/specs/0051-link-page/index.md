# 0051. The link page at `/<handle>`

**Date**: 2026-10-24
**Status**: Accepted (the owner approved the build on 25 October 2026, "start building this as a functionality"; built on `wip/link-page` in phases 1c, 2 and 3, landing through `land/r13`)
**Amended**: 25 October 2026, twice. First to match what was built (amendments 1 to 16), then to match the owner's design boards for this page, which became readable again after phases 1c to 3 had shipped (amendments 17 to 28, a slice a lane is building now). Every change is listed under [Amendments, 25 October 2026](#amendments-25-october-2026) and marked "(amended)" where it sits.

**Numbering**: 0051 taken by the spec lane on 24 October 2026 (0048 is Lists, 0049 and 0050 are claimed by another chat). This spec owns AC-5101 to AC-5199.

## Summary

The public profile at `/<handle>` stops being a list of booking pages and becomes a link in bio page, the way Linktree and Cal.com profiles work. A person keeps one ordered list of blocks on it: a link, a booking page, a contact card a visitor saves as a vCard, and a heading that groups the rest. Blocks are open ended (amended): each kind keeps its own fields in one checked `data` column, so spec [0052](../0052-link-page-blocks/index.md) can add text, questions, forms and more without a new table. The person's social links (spec [0053](../0053-social-links/index.md)) sit as a row of icons under their name, never as a block. The ordered list lives with the person, not with a workspace, because the profile crosses every workspace they are in. Under the person's card the page carries two actions, Save contact and Share, and the Share button opens a QR the visitor can scan or pass on (amended). The owner builds the page in one editor of section cards, adds to it through one Add item modal, and sees how many people looked and what they pressed. The dashboard shows the same QR.

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

- **AC-5101** (amended): A person's profile holds one ordered list of blocks, kept with their account and not with any workspace. A block has a `kind` and that kind's fields; this spec defines four kinds, spec 0052 adds more, and a read that meets a kind it does not know skips that block and draws the rest, never failing. The four here: `link` (a title, an address, an optional one line note and an optional icon), `page` (one of their booking pages), `contact` (the one contact card) or `heading` (a small heading the items under it belong to). Order is one sequence across every kind; a heading owns every item after it until the next heading.
- **AC-5102**: One profile holds at most 60 items: at most 40 of kind `link`, at most 12 of kind `heading`, at most 1 of kind `contact`, and the `page` items a person's booking pages allow. The 61st, or the 41st link, is refused with `LIMIT_REACHED` and a sentence naming the limit, and the editor's Add menu disables the kind that is full with the same sentence.
- **AC-5103**: A `link` item's address is `https://`, `http://`, `mailto:`, `tel:`, or `sms:`, at most 2,000 characters, with no credentials in it and no other scheme (`javascript:` and `data:` are refused with `CONFIG_INVALID`, "That address can't be a link."). An address typed without a scheme gets `https://`, except that an email address typed on its own becomes `mailto:` and a phone number typed on its own becomes `tel:` (amended). `tel:` and `sms:` numbers lose their spaces and brackets, and a web address with spaces is stored percent encoded. The refusal reads "Use a web address, an email or a phone number." Email, call and text links open in place, never in a new tab. Its title is 1 to 60 characters and its note at most 120; titles and notes refuse every control character, U+2028 and U+2029 included. The address is kept exactly as checked, never wrapped in a redirect of ours (LinkTwin's lesson: the canonical https address lets the network's own app open it).
- **AC-5104**: A `page` item names a workspace and a booking page in it. The page's own rules still decide whether a visitor sees it (Public, live, not deleted, its owner still an active member of a workspace that exists, exactly as `crm_booking_profile_pages` decides today). A page the rules now hide is skipped by the public read and its item stays, so turning the page back on puts it back where it was.
- **AC-5105**: A `heading` is 1 to 40 characters. Two headings may not have the same text ignoring case and surrounding spaces; a repeat is refused with `CONFIG_INVALID`, "You already have a heading called that."
- **AC-5106** (amended twice): A block is hidden rather than deleted when the owner turns its "Show on the page" switch off. It leaves the public page at once, keeps everything it held, and keeps its place in the list, where the editor draws it dimmed with "Hidden from the page" where its address would be. The switch puts it back. There is no separate Archived list and no Restore. Delete removes it for good and asks first in a Modal (the confirm rule, 21 October 2026). A heading's switch hides the heading and every block under it, until the next heading; each block keeps its own switch and its own state, so turning the heading back on brings back exactly what was on before.
- **AC-5107**: Every write is idempotent on the client minted item id: a retry of the same add answers the item already made and adds nothing.

*The public page*

- **AC-5108**: `GET /api/public/handles/:handle` answers the person (handle, name, initials, picture, bio) and one page of their live items in order, every kind together, at most 20 items at a time, with a cursor for the next. The answer's `items` replace the old `links` and `sections` (amended). A link's `mark` is matched on the server, so the public bundle parses no addresses, and the server checks each stored address again before it answers it. An archived item, and a `page` item whose page is hidden, is never in the answer. The answer carries no workspace id, no member id, no email, and no item the owner archived.
- **AC-5109** (amended twice): The page at `/<handle>` draws the person's card (picture or initials, name, bio, then the socials row), then the two header actions (AC-5134), then the blocks in order: a heading as a small heading, a `link` as a row with its icon, title and note, and a `page` as the row it draws today (title, note, lengths, Team). The `contact` block draws no row of its own: its one action, Save contact, is in the header (amended). A row is a real link a visitor can open in a new tab, copy or middle click, and a link's `rel` holds `me` only when its address is a profile on a known network. A live link with no note centres its title vertically and keeps it left aligned. The person's social links (spec 0053) are a row of icons under the bio, drawn from that spec's store, and are never a block. (Amended again, to the owner's boards:) every row carries its icon in a tinted square, accent soft for a booking page and the quiet surface for everything else, and every row ends in a quiet mark, a chevron for a booking page and an arrow up and to the right for a link that leaves the page. The earlier "Book" ending is dropped: a page of rows with a coloured word on several of them reads loud, and the chevron and the arrow already say which row stays with us and which one leaves. The foot reads "Powered by timefix" with "Claim your free page" beside it, which is the only place the page sells anything.
- **AC-5110**: An item's icon is drawn from our own origin only, so the policy `img-src 'self' data: blob:` is unchanged. In order: a known social network's own mark through `ProviderMark` (LinkedIn, X, Instagram, GitHub, Facebook, YouTube, AngelList, TikTok, Threads, matched from the address by `@crm/contracts/values`'s `social.ts`), else a Lucide icon the owner picked from a small set, else the title's first letter in the item's hue. No outside image is ever fetched, and no favicon is read from another site.
- **AC-5111**: The page reads at 390 wide first and holds to a comfortable measure on a wide screen, in light and in dark, meets WCAG AA for contrast, is fully reachable by keyboard in the order it reads, and keeps its loading, empty and failed states (the shapes of the rows while they load, so nothing jumps).
- **AC-5112**: An owner with a handle but no items yet shows the same page with a quiet empty state, never a broken page; an unknown handle is the existing not found page, word for word.

*The contact card and the vCard*

- **AC-5113**: The `contact` item holds the fields its owner typed: a full name (required), a job title, a company, one email, one phone, one website and a one line note. Nothing is read from a CRM record: the public page never shows workspace data.
- **AC-5114**: `GET /api/public/handles/:handle/contact.vcf` answers that card as vCard 3.0, `text/vcard; charset=utf-8`, `Content-Disposition: attachment; filename="<handle>.vcf"`, with the person's picture embedded as base64 when they have one and have not hidden it. A handle with no contact item answers 404. Every value is escaped per RFC 6350 and lines are folded at 75 octets.
- **AC-5115**: Save contact on the page is a plain link to that address, so it works on iOS, Android and desktop with no script, and it works when scanned straight from a QR code.

*The editor*

- **AC-5116** (amended twice): The editor is a view of Settings › Account › Profile (`?view=link-page`), which keeps the app's first load inside its budget because the view loads on demand. (Amended, to the owner's boards:) it is reached from its own row in the Settings › Account nav, "Your link page" with the `link` icon, sitting under Profile, and Profile keeps the row that points at it too. Its header is the title, the line "One page for everything people can do with you. Drag to reorder.", the page's own address as a link that opens it, and Share. The editor is built on the same section the old "Pages on your profile" used: the same cards, the same rows, the same grip, the same drag, the same keyboard move on the grip (Enter, the arrows, Enter), and the same Move up and Move down in each row's menu. Each move saves at once, and a refusal puts the row back and says why.
- **AC-5117** (amended twice): "Add item" opens one Modal, "Add to your link page", not a menu of four. The Modal is: a radio group, "What are you adding", with the kinds in the order Link, Booking page, Contact card, Section, each with its icon and a line saying what it is; under it the chosen kind's own fields, from the registry; a Section select that says where the block lands, with "No section" in it; and, for a link, an icon picker and a "How it will look" row that draws the block as the page will. The foot says "It goes to the end of the section. Drag it anywhere afterwards." with Cancel and Add item. "New section" sits beside "Add item" as a second button and opens the same Modal with Section already chosen. A full kind is disabled in the radio group with its limit sentence. Booking page shows the person's Public booking pages not already on the page, across every workspace, naming the workspace beside each only when the pages come from more than one.
- **AC-5118**: A row's menu offers Edit, Copy link, Move up, Move down, Archive and Delete. Edit opens the same Modal the add used, filled in. Delete asks first.
- **AC-5119**: Beside the list, a preview shows the page as a visitor sees it, in a phone sized frame, built from the same public page components and fed by the unsaved draft, so a change shows before it is saved. When the editor's column is too narrow for both (the layout's container breakpoint, not a fixed screen width; amended), the preview sits behind a Preview button that opens it in a Modal. The preview takes two fifths of the width (`PreviewLayout previewShare="wide"`) and draws no "Powered by" foot. (Amended, to the owner's boards:) its head is "Preview" with a Phone and Desktop SegmentedControl, which changes the frame's width only, since the page is one layout at both sizes. The preview is never an iframe and never loads the public origin.
- **AC-5120**: A person with no handle yet sees the claim a handle note that stands there today, and the Add menu stays off until they claim one.

*The QR code*

- **AC-5121** (amended twice): Home shows a "Your link page" card once the person has a handle: the QR code for `https://<public origin>/<handle>` at 120px (`QrCode size="sm"`), the address itself, Copy link, Open, and Edit beside the title. There is nothing to turn on: the code exists as soon as the handle does.
- **AC-5122** (amended): The card's QR, and the editor header's Share, open the one Share modal (AC-5135): the code drawn at 180px, the line "Point a phone camera at this to open your page. Print it on a badge or a card for events.", the address with Copy, then Download QR code and Open page, then the figures foot. Download QR code draws the existing `QrCode` SVG into a canvas and saves `<handle>-link-page.png` at 1024 by 1024 with its quiet margin (a `blob:` address, which the app's policy allows). The code is dark on light in both themes, since not every scanner reads an inverted code.
- **AC-5123**: A person with no handle sees the card with a quiet state and a link to Settings › Profile to claim one; the card is never shown empty or broken.

*Views and presses*

- **AC-5124**: A profile view is counted once per read of `GET /api/public/handles/:handle` that is not the owner's own and not a known machine, kept in `auth.profile_views` by the owner's user id, the UTC day and the visitor, with a count. The visitor is the same daily HMAC spec 0047 already mints (`visitorId`), so no address and no user agent is stored and nobody can be followed from one day to the next. (Amended:) only the first read with no `q` at all is a view; a cleared search sends an empty `q` and is no view. A read another site makes (`sec-fetch-site` other than `same-origin`) never counts, and past 600 a minute for one page reads stop counting. The owner's own reads are left out only where their session cookie reaches, which is the app's host; on the public apex host their own reads count until the owner preview fix in `wip/link-page-polish` lands.
- **AC-5125**: A press on an item is counted by `POST /api/public/handles/:handle/press` with the item's public id, sent as a beacon so the navigation is never held up, kept in `auth.profile_item_presses` by item, UTC day and visitor, with a count. A press that does not reach us is lost on purpose: nothing about the page waits on it.
- **AC-5126** (amended): Both counters refuse a known machine first, before any limit is spent. The press keeps 60 a minute per address and 600 a minute per handle, keyed by the handle in the address (an old handle has its own budget); the view's per page budget is keyed by the owner. A press refuses an item id that is not on that handle's live page with 204 and no row written (a counter never says whether an id exists).
- **AC-5127** (amended): The editor shows, per block, its presses over the last 30 days as a quiet chip with the `activity` icon beside the row's switch, and the section heading shows the page's views and its visitors over the same 30 days, with the period before it as the comparison, said as the earlier count ("up from 12"), never a percent (amended). Zero reads as "No presses yet", never as a missing number; headings carry no figure. The figures read daily rows (`auth.profile_view_days`, `auth.profile_item_press_days`) kept beside the visitor rows, at most 60 rows a period, and "visitors" is the sum of each day's visitors.
- **AC-5128** (amended): Views and presses older than a year, visitor rows and day rows alike, go with the daily cleanup, like the booking page views do. The sweep (`crm_sweep_profile_counts`) runs in each workspace's daily cleanup and takes its rows with `skip locked`, so whichever cleanup runs first does the work; one sweep job of its own is a later improvement.

*Keeping what already works*

- **AC-5129**: The profile's old ordering (`booking_pages.profile_position` and `booking_pages.profile_section`) is read by nothing once the backfill has run: every Public page of every person becomes a `page` item in the order and under the heading it had, and each workspace's group from the `wip/profile-split` lane becomes a real heading. (Amended, which closes the question that stood here:) a heading is never named after a workspace, because a workspace name can be private and the owner's board says in so many words that nobody visiting the page sees which workspace a page came from. The pages of the person's first workspace keep no heading; each later workspace's pages get a heading called "Book a time", numbered when that repeats, and the editor shows a one time note asking the owner to rename them. The two columns stay in place, unread, for one release, and a later migration drops them.
- **AC-5130** (amended): A booking page made Public, whether created so or switched from Link only, joins the end of its owner's link page once (`crm_place_profile_page`), as the old profile listed every Public page. It is never added again while any block of theirs names it, an archived one included, and it is never refused for a limit. The booking page editor's Section control is gone: it shows "On your link page" with Edit link page, to the page's owner only.
- **AC-5131**: `/b/:key` and `/<handle>/<slug>` are untouched: no new request, no new markup, no change to their policy headers. A guard test fails if the link page's modules are imported by either.
- **AC-5132**: `auth.profile_items`, `auth.profile_views` and `auth.profile_item_presses` are reachable only through the `crm_handle` definers. `crm_app` holds no grant on them, and a guard test proves a direct select is refused and that each new definer is owned by `crm_handle` with a fixed `search_path`.
- **AC-5133** (amended): The search that appears on the page once there are more than eight rows, headings not counted, searches titles and notes across every kind, keeps its 250ms rest and its "only the newest answer lands" rule, and never hides a heading whose items matched. With a search in play the page shows the matches flat, with no headings, and says how many matched.

*The page's header actions, the Share modal and the editor's list (amended, 25 October 2026, to the owner's boards)*

- **AC-5134**: Under the person's card the public page shows two actions side by side: Save contact, wide and in the one action colour, and a 44px square button beside it labelled "Share this page". Save contact is the link to the vCard (AC-5115) and shows only when the person has a live contact block; without one the Share button stands alone, aligned the same way. The contact block then draws no card of its own in the list, since its one action is already in the header.
- **AC-5135**: One Share modal serves two readers. A visitor's, opened from the public page's Share button: the QR code, "Scan this to open this page", the address with Copy, and Open page. Where the browser has `navigator.share`, the button hands the page to the system share sheet instead and the modal is the fallback. It shows no figures and no download, so the public bundle carries neither. The owner's, opened from the editor header's Share and from Home's QR card: the same code and address, plus Download QR code and a figures foot showing Views and Clicks over the last 30 days with "See all clicks", which opens the editor. The owner's figures never reach the public page's bundle, and the figures foot is absent until the figures have loaded rather than showing a zero.
- **AC-5136**: The editor draws the list as section cards. A section is a card with a grip, its heading, "N items", and a section menu (Rename, Move up, Move down, Delete). Blocks before the first heading sit in one unnamed card at the top. Each row inside is a grip, the block's icon in a tinted square, its title, its muted line (an address, "Booking page · 30 min", "Hidden from the page"), its press chip, a "Show on the page" switch, and a row menu. Dragging works both inside a section and from one section to another, and the keyboard move on a grip does the same; a move across sections is one save, as a move inside one is.
- **AC-5137**: A block's place is stored as one flat ordered sequence across every kind, with headings in it, exactly as AC-5101 says. The section cards are a drawing of that sequence, not a second store: choosing a section in the Add modal puts the block at the end of that heading's run, and "No section" puts it before the first heading. A hidden block keeps its place in the sequence, so `position` stays set while `archived_at` is set, and only the public read filters on `archived_at is null`.

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

**Data model** (amended: migrations `0098_profile_items`, `0099_contact_card` and `0100_profile_counts` on `wip/link-page`, renumbered again at landing if needed):

| Object | Schema | Key | Notes |
|---|---|---|---|
| `profile_items` | `auth` | `id` (uuidv7, client minted) | The columns every kind shares: `user_id` (cascades with the account), `kind` (text, checked by `profile_items_kind` against the known kinds), `position` (smallint, 0 to 999; amended again: it stays set while a block is hidden, so a hidden block holds its place in the editor's list, and the check `profile_items_placed` goes with the hide switch), `data` (jsonb, an object of at most 4 KB; spec 0052 raises this), `workspace_id` and `page_id` (null, both set together, set only for `page`), `archived_at` (null), `created_at`, `updated_at`. Everything else a kind holds lives in `data`: a link's `title`, `url`, `note`, `icon`, `hue`; a heading's `title`; a contact card's fields. Unique (`user_id`, `position`) `DEFERRABLE INITIALLY DEFERRED`, so a reorder sets every place in one statement; unique (`user_id`, `workspace_id`, `page_id`) where `kind = 'page'` and `archived_at is null`; a partial unique index on (`user_id`) where `kind = 'contact'` and `archived_at is null`; an expression index on (`user_id`, `lower(btrim(data->>'title'))`) where `kind = 'heading'` and `archived_at is null`. Index (`user_id`, `archived_at`, `position`, `id`) for the read. Checks per kind: a `page` has a workspace and a page, the other kinds have neither; each kind's `data` is checked by `crm_check_profile_item` (below) before every write. |
| `profile_views` | `auth` | (`user_id`, `day`, `visitor`) | `views`, `first_at`, `last_at`. Index (`day`) for the cleanup. |
| `profile_view_days` | `auth` | (`user_id`, `day`) | `views`, `visitors`, written in the same statement as the visitor row (amended). |
| `profile_item_press_days` | `auth` | (`item_id`, `day`) | `presses`, written in the same statement as the visitor row (amended). |
| `profile_item_presses` | `auth` | (`item_id`, `day`, `visitor`) | `presses`, `first_at`, `last_at`. Foreign key to `profile_items`, cascade. Index (`day`). |

**How a kind is checked** (amended): `ProfileBlock` in `@crm/contracts` is a Zod discriminated union on `kind` (`ProfileLinkBlock`, `ProfileHeadingBlock`, `ProfilePageBlock`, `ProfileContactBlock`), and every write is parsed by it in core before it reaches the definer. The definer checks `data` again with `crm_check_profile_item(kind, data, workspace, page)` (owned by `crm_handle`, not a definer, run only inside the definers), which refuses an unknown kind, an unknown key or a value its kind cannot hold with `22023 PROFILE_ITEM_DATA`. Both reads (core's `itemOf` and `publicItemOf`) parse each row with the union and drop a row that fails, so an unknown kind is skipped, never a crash. A new kind is therefore a Zod schema, a renderer, an editor registry entry, a public mapping, and one small migration that adds the word to `profile_items_kind` and replaces `crm_check_profile_item` (as `0099_contact_card` did for `contact`).

The contact card's fields in `data` (validated by `ProfileContactBlock`, never read as free text; amended: the phone is saved as E.164 from the library's `PhoneField`): `{ fullName, jobTitle?, company?, email?, phone?, website?, note? }`, each a trimmed string, `fullName` 1 to 80, the rest at most 120, `email` an address, `phone` at most 32 characters of digits, spaces, `+`, `(`, `)` and `-`.

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
| `crm_profile_counts(owner uuid, from date, to date)` | Per item: presses in the range; plus the profile's views and visitors in the range, read from the day rows. The editor's figures. |
| `crm_place_profile_page(owner uuid, workspace uuid, page uuid)` (amended) | Adds a `page` block at the end once, when a page is made Public, unless any block of the owner already names it (AC-5130). |
| `crm_sweep_profile_counts(before date)` (amended) | Deletes visitor and day rows older than a year from the four tables, `skip locked`. |
| `crm_check_profile_item` and `crm_pack_profile_items` (amended) | Not definers: owned by `crm_handle` and run only inside the definers above. One checks a kind's `data`; the other closes the gaps in `position` after an archive or a delete. |
| `crm_booking_owner_pages(owner uuid, pages uuid[])` (amended, owned by `crm_booking_lookup`) | Which of those pages the owner may place and which are live: ids and `is_live` only. |

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
| `profile.pageChoices` (amended) | | `ProfilePageChoice[]` | session, own account | |
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

**Built** (amended): slices 1 and 2 in phase 1c, slices 3 and 4 in phase 2, slice 5 in phase 3, all on `wip/link-page`. The migrations landed as `0098` to `0100` rather than `0096`, and the table took the blocks shape in the Data model above rather than per kind columns. The small items still open are in `wip/link-page-polish`: the QR PNG's ground in dark theme, the page's own address in the vCard, the editor's press chips holding their place on a phone, and the owner's own views on the apex host.

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

**Slice 6: the boards pass** (AC-5106, AC-5109, AC-5116, AC-5117, AC-5119, AC-5122, AC-5127, AC-5129, AC-5134 to AC-5137). Not built when this amendment was written: the owner's boards landed after phases 1c to 3 shipped, and a lane is building to them now. It is one slice because every part of it is a drawing of the same store: the header's two actions, the one Share modal in its two readings, the one Add item modal, the section cards, and the hide switch in place of the Archived list. The only store change in it is dropping the `profile_items_placed` check so a hidden block keeps its place, and the only read change is that the public read already filtered on `archived_at`.

## Amendments, 25 October 2026

What was built differs from the first text in these ways. Each is a call made during the build (by crm-87 or the builder, under the owner's 21 October delegation) and is written into the section it changes above.

1. **Blocks, not four fixed kinds.** `auth.profile_items` keeps the shared columns plus `workspace_id` and `page_id`, and one `data jsonb` for everything else, checked by the `ProfileBlock` union and by `crm_check_profile_item`. Unknown kinds are skipped by both reads. (AC-5101, Data model.) Why: the owner said "will later also need blocks. more blocks"; per kind columns would have made each new block a table change.
2. **New Public booking pages join the link page by themselves**, once, never refused for a limit; the booking editor's Section control is gone. (AC-5130.) Why: the old profile listed every Public page, so a person who makes a page Public expects to find it there.
3. **The editor is a view of Settings › Account › Profile** (`?view=link-page`). (AC-5116.) Why: the app's first load had about 10 bytes of headroom.
4. **Addresses**: a bare email or phone becomes `mailto:` or `tel:`; numbers lose spaces; the refusal sentence; email, call and text open in place. (AC-5103.)
5. **Page and link endings**: a booking page block ends in "Book"; `rel="me"` only on a network profile; the socials row sits under the bio and is never a block. (AC-5109.)
6. **No audit rows** for link page writes. (Consequences.)
7. **Search** shows after more than eight rows, headings not counted. (AC-5133.)
8. **Open for the owner**: the backfill's workspace named headings are public. (AC-5129.)
9. **Contact card**: the phone is saved as E.164; the owner's own card is titled "Contact card" on their page (their name is already above it); the vCard leaves out the photo when the picture is WebP or the handle is past 300 vCard reads a minute (the card still answers); 20 a minute per address. (AC-5113 to AC-5115.)
10. **Home card**: the QR at 120px with Edit beside the title; the Modal's code fills the Modal. (AC-5121, AC-5122.)
11. **A live link with no note** centres its title vertically. (AC-5109.)
12. **LinkPage's foot is a slot**; the editor's preview draws no "Powered by" foot. (AC-5119.)
13. **Views**: the owner's own views are left out only where their cookie reaches; cross site reads never count; a cleared search is no view. (AC-5124.)
14. **Limits' keys**: the press budget per handle is keyed by the handle in the address; the view's by the owner. (AC-5126.)
15. **Figures** read daily rows; visitors are summed per day; the comparison is the earlier count, not a percent. (AC-5127.)
16. **The sweep** runs in each workspace's daily cleanup with `skip locked`. (AC-5128.)

### Amendments 17 to 28: the owner's design boards

The owner's boards for this page (`Main`, `PublicLight`, `Share`, `Editor`, `AddItem`) were readable again on 25 October, after phases 1c to 3 had shipped. They are the design this page is held to, so these are written here even though a lane is still building them. Each is a call made under the owner's 21 October delegation, with its reason.

17. **Two header actions on the public page**: Save contact wide in the action colour, and a square Share button beside it (AC-5134). Why: the boards put both above the list, where a visitor who came to save a card or to pass the page on finds them without reading the list. The contact block stops drawing a card of its own, since its one action is now in the header.
18. **One Share modal, read two ways** (AC-5135, AC-5122). Why: the board draws one modal, and one component is one set of words and one set of screenshots. The visitor's reading drops the download and the figures so nothing about the owner's traffic reaches the public bundle, and the system share sheet is preferred where the browser has one, because on a phone that is what people expect of a share button.
19. **The figures foot shows Views and Clicks only.** The board's third figure, "Meetings booked", waits: nothing today ties a booking to a press on the link page, and inventing an attribution would be a spec of its own. Named in Follow-up.
20. **One Add item modal instead of four** (AC-5117). Why: the board draws one modal with the kinds as a radio group, and with more kinds coming in spec 0052 a menu of eight would be a menu nobody reads. The registry does not change shape: the Modal hosts the chosen kind's `Editor`, which is the entry each kind already has.
21. **A block is placed into a section at add time**, through a Section select in that modal, with "No section" in it (AC-5137). Why: the board's foot promises it ("It goes to the end of the section"), and it costs nothing, because the sections are a drawing of the one flat sequence the store already keeps.
22. **The editor's list is section cards** with a grip, the heading, a count and a section menu, and rows that carry an icon tile, a press chip, a switch and a menu (AC-5136). Why: the board, and because a card is what makes a heading feel like something you can move as a whole.
23. **Hidden replaces archived in the editor** (AC-5106, AC-5137). A switch on the row, the row staying where it is and reading "Hidden from the page", no second list and no Restore. Why: the board, and because a row that stays where it was is easier to find again than one that moved to a list at the bottom. `archived_at` still carries the state; what changes is that `position` stays set, so the check `profile_items_placed` goes.
24. **A heading's switch hides the heading and the blocks under it**, each block keeping its own state, so turning it back on restores exactly what was on (AC-5106). Why: a card is one thing on the screen, so one switch on it has to mean the whole card.
25. **"Your link page" gets its own row in the Settings › Account nav**, under Profile, while the screen stays the lazily loaded view at `?view=link-page` (AC-5116). Why: the board puts it in the nav, and the budget reason for the separate view is about loading, not about where the row lives.
26. **The editor's header** carries the page's own address as a link and a Share button beside it (AC-5116). Why: the board, and because the two things an owner does most from this screen are look at the page and pass it on.
27. **The preview gains a Phone and Desktop control** (AC-5119). Why: the board. It changes the frame's width only, because the page is one layout at both sizes.
28. **No heading is ever named after a workspace** (AC-5129), which closes the question amendment 8 left open. Why: the board says in so many words that nobody visiting the page sees which workspace a page came from, and a workspace name can be private. The first workspace's pages keep no heading, later ones get "Book a time" numbered when it repeats, and the editor asks the owner once to rename them.

A call the boards did not settle, taken here: the public card shows the name, the bio and the socials row and nothing else. The light board shows a location line under the bio, and the dark one the page's own address. An account has no location field today, and a visitor who is already on the page does not need its address, so neither is drawn; a location line is named in Follow-up for when the account has one.

Amendment 5's "Book" ending on a booking page row is superseded by amendment 17's boards: every row ends in a quiet mark, a chevron for a page that stays with us and an arrow out for a link that leaves.

## Consequences

- The profile's ordering moves from the booking pages table to one list with the person. Anything that reasoned about `profile_position` has one place to change, and after this a page's place on a profile is no longer a property of the page.
- `auth` gains three tables and ten definers. Every one is a thing `security-access-reviewer` must look at, and the guard tests grow to match.
- The public read now joins two sources (the item list, and the booking lookup) per page of 20. That is one extra statement per read, bounded by the page size.
- A person in several workspaces gets one page that mixes them on purpose, under headings they control. The `wip/profile-split` lane's grouping survives as the backfill's starting shape and then becomes editable, which the lane alone could not give.
- The page stays client rendered, so a social crawler still sees the shell. That is a real cost, and the follow up below names it.
- (Amended) A block's fields live in `data` and are checked twice, by Zod in core and by `crm_check_profile_item` in the database. That keeps a new kind to one small migration, but the per kind rules exist in two languages and must be kept in step; a test per kind proves the two agree.
- (Amended) Link page writes leave no audit row. The blocks are the person's own, and a workspace's History is read by that workspace's admins, so writing them there would publish a personal list to colleagues.

## Follow-up

Named, not built here:

- **More blocks**: text, questions, a Timefix form, email signup, testimonials, music, video. Spec [0052](../0052-link-page-blocks/index.md).
- **Social links**: built as their own store and spec, [0053](../0053-social-links/index.md).

- **Meetings booked**, the board's third figure: it needs a booking to be tied to the press that led to it, which nothing does today.
- **A location line** under the bio, once an account has a location to put there.
- **Themes and appearance**: a background, a button shape, a font pair and a colour, as Linktree's Appearance tab offers.
- **A store**: anything that takes money on the page.
- **Mailing list and newsletter items**: taken by spec 0052 (email signup, through a hosted form).
- **Remember who you met**: the event feature Anish described, where a visitor adds a photo and a note after meeting someone and both sides keep it. It needs its own spec: it writes on the visitor's side, which nothing on this page does today.
- **Favicons for links**: fetched once by the api, stored in R2 (#32) and served from our own origin, so a link to a site with no social mark can still carry its own icon without touching the policy.
- **Server rendered meta and an OG card** for `/<handle>`, so a shared link previews with the person's name and picture.
- **A second contact card** or several, for a person who hands out a work card and a personal one.
- **Collections**, the Linktree idea of a group of links that opens on its own page.
