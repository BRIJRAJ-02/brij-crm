# 0065. Hospitality suite: business profile, Menu, Menu QR and Table seating as Timefix apps

**Date**: 2026-11-03
**Status**: Proposed

**Numbering**: this spec owns AC-6501 to AC-6599. Migrations carry placeholder numbers (`0xha` to `0xhf`) and are renumbered after main's last migration when each slice lands. Scope row #68.

**Changed 4 Nov 2026 by spec [0066](../0066-business-booking/index.md)** (owner: table booking must scale to salons, clinics and other services, with Fresha style business pages):
- Tables are generic **resources** (`resources` with a `kind`: table, room, chair, bed, court, station, equipment, other), built in H0. Business kinds include salon, spa, barber, clinic and fitness. The early access flag is `business_apps`.
- **H3 and H4 are replaced by 0066 B7**: Table seating is a preset of the visit engine. The `reservations` and `reservation_tables` design below is superseded and not built; the guest flow, rules and Service screen requirements (AC-6550 to AC-6565) still hold, met through 0066.
- The "no public venue page" call is reversed: every business gets a business page (0066 B4); the menu page links back to it.
- Analytics is spec 0067 (was 0066 in the text below).
- Every guest surface is built on `@crm/ui/public-booking` and `@crm/ui/public-form` and the app library: see 0066 "Build on what exists". The guest menu adds MenuList and ItemSheet in a `@crm/ui/public-menu` entry.

## Structure

One umbrella, built in six slices. Every slice is a thin thread through every layer (Tracer Bullet), and each lands on its own.

| Slice | What | Depends on |
|---|---|---|
| H0 | Apps (install per workspace, early access gate) and the business profile with locations and hours | nothing |
| H1 | Menu app: build, publish, and the guest menu page with its theme | H0 |
| H2 | Menu QR app: tables and spots, printed codes, scan counts | H0, H1 |
| H3 | Table seating: reservation page, table fitting, guest emails, guests as People | H0 (places, areas and tables live there) |
| H4 | Service screen: today's book, walk ins, seat and finish, live for every device | H3 |
| H5 | SN look: the Warm preset and the guest theme polish for Somewhere Nowhere | H1 |

Later, each with its own decision: menu import (paste, CSV, PDF), waitlist, deposits and card holds (after 0062 L5 Stripe), text message reminders (after 0062 L5 Twilio), floor plan canvas, ordering and paying at the table, per app billing (#38 and #42).

## Summary

Restaurants, cafés and bars get a set of Timefix apps. You turn on the ones you need: a Menu you edit once and publish, a Menu QR app that prints a code for every table, and Table seating that takes reservations online and runs the evening at the host stand. They share one business profile (name, places, opening hours, tables). Guests see a fast, phone first menu in your brand, and every guest who reserves becomes a Person in the CRM with their visit history. Billing per app comes later; for now an app is switched on per workspace by Timefix (early access) and then installed by an admin.

The menu model and the guest look follow the checklabs reference. The code and storage are new and follow this repo's rules. Table seating is built on Timefix's booking engine (its slot maths, questions, emails, manage links, cutoffs and embed), with tables instead of people as the thing being booked.

Reasoning and every call made on the owner's behalf: [rationale.md](rationale.md). Checks: [verify.md](verify.md).

## Requirements

**User stories**
- As the owner of a restaurant, I want to switch on only the apps I use, so the product stays simple and I pay for what I use later.
- As a manager, I want to change a price or mark a dish sold out in seconds, and have every QR code show it at once, so printed menus never go stale.
- As a guest at a table, I want the menu open in two seconds on bad signal, readable with one thumb, with allergens clear, so I can order with confidence.
- As a guest at home, I want to book a table for four at eight on the restaurant's own site, without making an account.
- As a host on a busy night, I want to see who is coming, seat walk ins on a free table, and mark tables done, from a tablet, with everyone's screen in step.
- As a marketer, I want every guest who reserved in the CRM with their visits, so I can thank regulars and see who stopped coming.

**Acceptance criteria**

*H0. Apps and the business profile*
- **AC-6501**: A workspace has an Apps page (Settings > Apps) listing the Hospitality apps (Menu, Menu QR, Table seating) as cards with a one line purpose and Install. The page only lists Hospitality apps when Timefix has opened early access for that workspace; otherwise the Apps page shows nothing about them.
- **AC-6502**: Early access is set per workspace from the operator console (spec 0047) by an operator, as one switch "Hospitality apps". It is the console's first write: one new definer `crm_set_early_access(workspace_id, flag, on)` owned by `crm_operator` with `update (early_access)` only, the flag from a closed list in contracts (`EARLY_ACCESS_FLAGS = ['hospitality']`), and an `operator_event` row holding the before and after. The definer is listed in `guards.test.ts`.
- **AC-6503**: Only a workspace admin installs or removes an app. Install is instant. Remove asks first in a Modal ("Menu stops showing to guests. Your menus are kept."), hides the app's screens and public pages at once, and keeps every row; installing again brings everything back as it was.
- **AC-6504**: Every server procedure and public route of an app refuses `APP_NOT_INSTALLED` (403, or the plain not found page in public) when the app is not installed, checked in one function `appInstalled(workspace, app)` in core that every entry point calls. Hiding a screen is never the only gate.
- **AC-6505**: Menu QR needs Menu. Installing Menu QR without Menu offers to install both in one step; removing Menu while Menu QR is installed asks to remove both.
- **AC-6506**: Installing any Hospitality app first time asks for the business profile in one short card (business name, kind: restaurant, café, bar, bakery, other; the first place's address, time zone and currency, prefilled from the workspace). Everything else is optional and editable later in Settings > Business.
- **AC-6507**: The business profile holds: name, kind, short description (up to 160 characters), cover photo, logo (the brand kit's, not a second copy), phone, email, website, and the person socials model's link list reused at business level. Currency is the workspace's (one currency per workspace).
- **AC-6508**: A business has one or more places (locations), each with a name, address (line, city, postcode, country), time zone, phone, and opening hours: a weekly pattern of up to 3 ranges per day (for example 12:00 to 15:00 and 18:00 to 23:00) plus dated exceptions (closed, or other hours, with an optional note like "Private event"). A range may cross midnight (18:00 to 02:00). Up to 20 places per workspace.
- **AC-6509**: A place has areas (for example Inside, Terrace, Bar; up to 12) and tables. A table has a label unique in its place (up to 12 characters, "T4", "Bar 2"), an area, the fewest and most guests it seats (1 to 30), whether it can be booked online, and which other tables it can join with. Tables are edited as a plain list with drag to reorder, add many at once ("Add 10 tables, T1 to T10, seats 2 to 4"). Up to 300 tables per place. Tables belong to H0 because both Menu QR and Table seating use them.
- **AC-6510**: The apps appear in the sidebar as their own section, Hospitality, holding only installed apps (Menus, QR codes, Reservations, Service). The section obeys the existing per member order and hide preferences.
- **AC-6511**: Two new permissions, `hospitality.manage` (apps setup: menus, tables, reservation rules, QR) and `hospitality.service` (today's book, seating, walk ins, 86 an item), both at grant level `any`, in a new "Hospitality" permission group, and both in `KEY_FORBIDDEN_PERMISSIONS` for now (API keys later). Owner and admin hold both; `ROLE_PERMISSIONS.member` is unchanged, so members hold neither until given a role that has them. The first install seeds a custom role "Floor staff" (based on Member, as every custom role is) holding only `hospitality.service` and no People object access: Service shows a guest's name, phone, party and notes from the reservation row itself, so floor staff never need record reach. The built in role list does not change.

*H1. Menu app*
- **AC-6520**: A workspace has menus (up to 30). A menu has a name (Dinner, Drinks, Brunch), the places it shows at, optional serving times (days and hours, for example Brunch Sat and Sun 10:00 to 15:00), a short note shown at its foot (for example "Prices include VAT. 12.5% service is added."), and its sections in order.
- **AC-6521**: A section has a name, an optional one line description, an optional serving time narrower than its menu's, and a layout (list or photo grid). Sections nest one level (Wines > Red); no deeper.
- **AC-6522**: An item has a name (up to 80), description (up to 400), price in minor units of the workspace currency (or no price, for example "Market price", shown as the item's price note up to 24 characters), an optional photo, dietary marks from a closed list (vegan, vegetarian, gluten free, dairy free, contains nuts, halal, spicy 1 to 3), allergens from the EU 14 list each as Contains or May contain, optional calories, a Featured flag, and a Sold out switch.
- **AC-6523**: An item may have sizes (up to 8, each a name and its own price, for example Glass 175ml 9.50 / Bottle 38.00) and option groups (up to 6 groups of up to 20 options, each option a name and a price difference; a group says choose 1, up to N, or any). Option groups can be shared between items (one "Milk" group used by every coffee).
- **AC-6524**: One item can appear in several sections and menus without copying it (an item is a thing; sections hold placements). Changing it changes everywhere; the editor says "Also on Lunch, Drinks" under the name.
- **AC-6525**: Edits save as you go into a draft. Publish makes the draft what guests see, as one versioned snapshot, the way forms publish. A small line says "3 changes not published" with Publish and Discard. The guest page never reads the draft.
- **AC-6526**: Sold out is the exception to drafts: it changes the live menu at once (no Publish), so the floor can 86 a dish mid service. Anyone with Run service can flip it from the Service screen or the item.
- **AC-6527**: Photos follow the logo pipeline (spec 0060: the browser redraws to WebP, the server checks bytes and strips metadata, private Blob store, served from our origin with versioned URLs), as two sizes, 1200 pixels and 400 pixels wide. Up to 4 MB in, up to 1,000 photos per workspace.
- **AC-6528**: The guest menu lives at `timefix.com/m/<key>` (a 16 character public key per place). It shows that place's menus that are serving now first (by the place's time zone), with the others one tap away in a menu switcher, and a "Serving from 18:00" note for one not serving yet. A link page gets two new block types, Menu and Reserve a table (spec 0061 blocks), pointing at these pages.
- **AC-6529**: The guest menu page: a header with cover, logo, name, open now or opens at, address and phone; sticky section chips that follow the scroll; search across names and descriptions; dietary filter chips; items as rows or a photo grid per section; tapping an item opens a bottom sheet with the photo, description, sizes, options with prices, allergens in words, and calories. Sold out items stay in place, dimmed with "Sold out". "Powered by Timefix" at the foot (spec 0060 foot card).
- **AC-6530**: "Your picks": a guest can add items (with size and options) to a list kept only in their browser, see the total, and show it to staff. It sends nothing anywhere and says so ("Show this to your server"). No ordering in this spec.
- **AC-6531**: Speed: the menu is served from one published snapshot through the edge cache (spec 0058 AC-23 pattern) and purged on Publish and on Sold out. On a mid range phone over slow 4G, the first menu text shows within 2 seconds and photos load lazily at the 400 pixel size. The page works with JavaScript slow or failing for reading (the snapshot's text is in the HTML).
- **AC-6532**: Prices format with the place's `locale` (a column on places, defaulted from its country, editable) and the workspace currency (`Intl.NumberFormat`), always with the currency's own minor units. No price is ever held as a float.
- **AC-6533**: Accessibility: WCAG AA in every theme; allergens are words, never colour or an icon alone; the item sheet is a proper dialog with focus kept inside and Escape to close; text zoom to 200% keeps one column with no sideways scroll.

*H2. Menu QR app*
- **AC-6540**: Each table gets a QR code, and each place gets one general code (for a window or a flyer). Extra named spots can be added (Bar, Pool, Room service, up to 50 per place).
- **AC-6541**: A code opens `timefix.com/q/<code>` where `<code>` is 12 random characters from a 32 letter alphabet. The address counts a scan and redirects (302) to the place's guest menu with the table's label in the fragment, so the page can say "Table 4" and later features (waitlist, ordering) know the table. Changing menus never changes a printed code.
- **AC-6542**: A code can be replaced (new code, the old one shows the place's menu without a table, so nothing printed breaks) and switched off (the old code shows "This code is no longer in use" and a link to the place's menu).
- **AC-6543**: Codes are drawn in the browser as SVG with the brand accent on white and the logo in the middle (high error correction), and downloaded as SVG or PNG one by one or all at once as a zip. A Print page lays out table tents (A6 folded, two per A4) and stickers (6 per A4), each with the logo, "Scan for the menu" and the table label; it prints from the browser with print CSS, no PDF service.
- **AC-6544**: Scans are counted per code per day (no person, no address kept), and shown as a small number on each code and as a 30 day line on the QR page. The fuller picture belongs to spec 0067 (analytics).

*H3. Table seating*
- **AC-6550**: A place has one reservation page at `timefix.com/r/<key>` (and embeddable with the existing widget: `data-timefix-reserve="KEY"`, popup and inline, same panel as booking and forms). Reservation rules are set per place: party sizes taken online (1 to 20, default 1 to 8), slot step (15 or 30 minutes), how long a table is held by party size (default 1 to 2: 90 minutes, 3 to 4: 105, 5 to 6: 120, 7+: 150), minimum notice (default 2 hours), how far ahead (default 60 days), when reservations are taken (the opening hours, or narrower reservation hours per day, default last seating 90 minutes before close), and the most guests starting in any 15 minutes (pacing, optional).
- **AC-6551**: The guest flow: party size, then a date (closed days and full days crossed out), then the times grouped by Lunch and Dinner (by the hour ranges) with the nearest times first if the chosen one is full, then name, email, phone (required, with the existing phone field), an optional note, and optional occasion (birthday, anniversary, business, other). Up to 6 extra questions from the booking questions model (spec 0057). Then a confirmation with Add to calendar, Change and Cancel.
- **AC-6552**: Availability is a pure function next to `computeSlots`: for each candidate start, a time is offered when some bookable table, or a joinable set of tables, seats the party and is free for the whole hold, inside reservation hours, after notice, within pacing. It reuses the engine's stepping, notice and window helpers. Tables are matched best fit: the smallest single table that seats the party, else the smallest joined set, never a table whose fewest guests is above the party.
- **AC-6553**: A reservation holds its tables with a database guard: a `reservation_tables` row per table with a time range, and an exclusion constraint so one table can never hold two overlapping live reservations. Booking takes a lock per place, recomputes, fits, inserts, and refuses `SLOT_TAKEN` with the next free times when it lost a race. Two guests racing for the last table: exactly one gets it.
- **AC-6554**: Parties above the online maximum see "For 9 or more, send a request" which makes a request (spec 0062 L1 requires confirmation semantics: holds nothing, staff confirm with a table). A place can also make every reservation a request.
- **AC-6555**: Guests get the confirmation email, a reminder 24 hours and 3 hours before (through the existing mail queue and templates, in the business's brand), and Change and Cancel links (the manage token pattern) with the place's cutoffs (default: change until 2 hours before, cancel until 2 hours before; later shows "Call us" with the phone). The place's staff with Run service get an email for every new reservation, change and cancel, which they can turn off.
- **AC-6556**: Each reservation matches or creates a Person in the CRM by email, then phone (the existing match rules), and the Person page shows a Visits panel: past and upcoming reservations, party size, no shows, notes. Guest notes ("Nut allergy", "Likes table 12") live on the Person and show on every later reservation.
- **AC-6557**: The public reservation endpoints use the existing public limiter (reads 60 per minute per address, bookings 5 per minute) and the booking pages' bot checks. Nothing about other guests (names, which tables are taken) is ever in a public answer: times are offered or not.

*H4. Service screen*
- **AC-6560**: Service shows one place's day: a list grouped by service (Lunch, Dinner) with time, name, party size, table, status, notes and occasion icons; a count of covers booked, seated and still to come; and a date switcher. A table view shows each table as a row with its reservations as blocks along the day's hours.
- **AC-6561**: Statuses: Booked, Confirmed (the guest pressed "I'm coming" in the 24 hour reminder email; later also by text message), Arrived, Seated, Finished, No show, Cancelled. One tap moves to the next likely status. Seated starts the table's clock; Finished frees the table for new online times at once.
- **AC-6562**: Staff can add a reservation by hand (phone bookings) with any party size and any free table, override the fit with a reason, move a reservation to another table or time by drag (dnd-kit, as the rest of the app) or by menu, and join tables for one party.
- **AC-6563**: Walk in: pick party size, see the tables free now and for how long ("T4, free for 1 h 40"), seat in one tap. A walk in needs no name.
- **AC-6564**: Every change shows on every open Service screen within a second through Centrifugo (one channel per place, workspace scoped), and the screen works on a tablet held either way (touch targets at least 44 pixels).
- **AC-6565**: No show and Cancel ask first in a Modal. Undo is one click for 10 seconds on status moves.

*H5. The SN look*
- **AC-6570**: The guest menu and reservation pages take their look from the brand kit (spec 0060 accent, logo, font pack) through the same `look.css` variables route, plus a menu theme preset. Three presets: Warm (the default, after the checklabs guest look: warm off white ground, near black text, soft pill chips, glass sticky bar), Clean (white, the app's own neutrals), Night (dark ground for bars). Each passes AA in its own colours.
- **AC-6571**: Somewhere Nowhere's workspace uses Warm with its brand kit; its look is reviewed against its current menu site with screenshots at 390 and 1280 before it is turned on. Filling SN's real menu is out of this spec (the owner deferred it).

## Decision

Build the Hospitality suite inside Timefix as installable apps with their own tables, sharing the platform pieces (workspaces, roles, access door, People, brand kit, public shell, edge cache, mail queue, Blob store, Centrifugo, embed widget) and reusing the booking engine's pure helpers for table availability. Reservations get their own storage rather than becoming rows in `bookings`, because every booking invariant is keyed on a member and a table is not a member. The menu follows the checklabs data model, simplified: one level of sub sections, items placed rather than copied, integer minor unit prices, a published snapshot per place. Early access is an operator switch; installation is per workspace by admins; billing later plugs into the same `appInstalled` check.

## Feature design

### Apps

- `workspace_apps (workspace_id, app text check in ('menu','menu_qr','table_seating'), installed_at, installed_by_member_id, removed_at null, plan text null)`, primary key `(workspace_id, app)`. Removal sets `removed_at`; reinstall clears it. `plan` stays null until billing (#38, #42).
- `workspaces.early_access text[] not null default '{}'`, written only by the operator console's new procedure, audited in the operator audit log.
- Core: `appInstalled(tx, workspaceId, app): Promise<boolean>` and `requireApp(...)` that throws `{ code: 'APP_NOT_INSTALLED' }`. Every hospitality procedure calls `requireApp` after the access door; every public hospitality definer joins `workspace_apps` and answers nothing when removed.
- Navigation: a fifth `NAV_SECTIONS` member `hospitality`; `universeOf` gains it only when an app is installed and the member has Manage hospitality or Run service.
- Roles: two permissions `hospitality.manage`, `hospitality.service` in the role model; the built in "Floor staff" role.

### Business profile and places

- `business_profiles` (one per workspace): name, kind, description, cover_path, phone, email, website, links jsonb (same shape as person socials).
- `places`: id, workspace_id, name, address fields, country, time_zone, phone, public_key (16), menu_key (16), hours jsonb `{ weekly: { mon: [{from:'12:00',to:'15:00'}], ... }, exceptions: [{ date, closed | ranges, note }] }` validated by one Zod schema in contracts (`PlaceHours`), at most 3 ranges a day, ranges sorted, no overlap.
- `areas` (place_id, name, position) and `tables` (place_id, area_id, label, min_guests, max_guests, online bool, position, joins uuid[] of tables in the same place), unique `(workspace_id, place_id, lower(label))`.
- Pure helpers in `packages/core/src/hospitality/hours.ts`: `openAt(hours, instant, zone)`, `nextOpening(...)`, `rangesOn(date)`, all crossing midnight correctly and handling DST by working in the place's zone.

### Menu

- Tables: `menus`, `menu_places` (which places), `menu_sections` (menu_id, parent_id null, name, description, layout, serving jsonb, position), `menu_items` (name, description, price_minor int null, price_note, photo_path, diet text[], allergens jsonb `[{ code, level:'contains'|'may' }]`, kcal, featured, sold_out, sold_out_at), `menu_placements` (section_id, item_id, position), `item_sizes` (item_id, name, price_minor, position), `option_groups` (workspace scoped, name, rule `one|up_to|any`, max), `options` (group_id, name, price_delta_minor, position), `item_option_groups` (item_id, group_id, position).
- Closed lists in contracts: `DIET_MARKS`, `EU_ALLERGENS` (celery, cereals with gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soya, sulphites).
- Publish builds, per place, one snapshot JSON (`MenuSnapshot`, Zod in contracts) of every menu shown there and stores it in `menu_versions (workspace_id, place_id, version, snapshot jsonb, published_by, published_at)`. The public definer returns only the latest snapshot for the place's `menu_key`, joined with the current sold out set (so Sold out needs no republish) and the business header.
- Public: `GET /api/public/menu/:key` (snapshot plus sold out ids), `GET /api/public/menu/:key/look.css`. Edge cached with a tag per place; purged on Publish, Sold out and profile changes. A new Vite entry `menu.html`, rewrite `/m/:key`, CSP and `public-paths.ts` entries, middleware allowance, lookup role `crm_menu_lookup` with its definer, guards tests extended.
- Editor: Menus screen lists menus; a menu opens a two pane editor (sections and items on the left as a sortable tree, the selected item's form on the right) with a phone preview toggle that renders the real guest components with the draft.

### Menu QR

- `qr_codes (workspace_id, place_id, table_id null, name, code char(12) unique, status live|replaced|off, replaced_by)`, `qr_scans (workspace_id, code_id, day, count)` upserted by the resolver.
- `GET /q/:code` is an API route (not a page): looks up through `crm_qr_lookup`, counts, 302 to `/m/<menu_key>#t=<table label>`; a replaced code redirects without the table; an off code serves a small page. Rate limited like other public reads.
- QR drawing: one pinned dependency (`qrcode-generator` or equal, chosen at build for size and no network) wrapped in one module in `apps/web`.

### Table seating

- `reservation_pages` (place_id, public_key, rules jsonb `ReservationRules`, questions jsonb, requests_only bool, status live|paused).
- `reservations` (workspace_id, place_id, starts_at, ends_at, party_size, status booked|confirmed|arrived|seated|finished|no_show|cancelled, source online|phone|walk_in, approval null|pending|declined, guest_name, guest_email, guest_phone, note, occasion, answers jsonb, person_record_id, manage_token_hash, idempotency_key, created_by_member_id null, seated_at, finished_at).
- `reservation_tables (workspace_id, reservation_id, table_id, during tstzrange, live bool)` with `exclude using gist (table_id with =, during with &&) where (live)`. `live` turns false on cancel, no show and finished (finished shortens `during` to end at `finished_at` instead, freeing the rest).
- Core: `tableSlots(input)` pure (next to `computeSlots`, reusing its stepping, notice and window helpers); `fitTables(tables, party, busy)` pure best fit including joins (bounded search: joins of up to 3 tables listed in `joins`); `reserve(...)` impure with an advisory lock per place, mirroring `bookPublicSlot`'s order (idempotency, lock, recompute, fit, insert, person match, mail).
- Mail: new kinds in the mail queue for reservations (confirmed, reminder, changed, cancelled, request received, declined), using the existing templates with the business brand.
- Embed: `v1.js` learns `data-timefix-reserve`, same panel, same height reporting.

### Service

- Screen at `/w/:slug/service` with place switcher, list and table views. Realtime: publish a change event on `hospitality:<workspace>:<place>` from the outbox relay; the screen patches in place through the data layer (no refetch storms).
- Data layer: `reservations` and `tables` collections in `packages/data`, optimistic status moves with rollback.

### Rules settled by the cross check

- **Engine helpers.** Stepping, notice and window are inline in `computeSlots` today. H3 starts by extracting them into exported pure helpers in `engine.ts`, with snapshot tests over the existing booking slot fixtures proving every booking slot is unchanged, before `tableSlots` uses them.
- **Depends on 0062 L1.** Requests, cutoffs and `TOO_LATE` come from 0062 L1 (built on `wip/0062-l1b`, landing before H3). H3 does not start until L1 is on main.
- **Reservation mail.** A new definer `crm_enqueue_reservation_mail` (mirroring `crm_enqueue_booking_mail`) queues `confirmed`, `reminder_24h`, `reminder_3h`, `changed`, `cancelled`, `requested`, `declined` and `staff_new`, keyed per reservation, with replace mode when a reservation moves so old reminders never fire.
- **Manage page.** `/r/:key/manage` with the token in the fragment, exactly as bookings' manage page; `reservations.manage_token_hash` unique across all workspaces; lookup definer `crm_reservation_by_token`. Change covers date, time and party size together and runs a full refit under the place lock; it is refused inside the cutoff like a cancel.
- **Routes.** `vercel.json`: rewrites `/m/:key` to `menu.html`, `/r/:key` and `/r/:key/manage` to `reserve.html`, `/q/:code` to `/api/public/qr/:code`; the catch all exclusion gains `m/ r/ q/`; CSP header blocks for both new entries; `public-paths.ts`, the middleware's `PUBLIC_HOST_PATH` and `public-paths.test.ts` updated together.
- **Removing an app** calls the edge cache `forget` on every place's tags (`menu:<placeId>`, `reserve:<placeId>`) in the same request. Removing Table seating keeps every future reservation working (emails, reminders, manage links: the guest holds a promise) while new ones are refused and Service is hidden.
- **Hours.** A range belongs to the date it starts on (Friday 18:00 to 02:00 is Friday's); an exception on a date replaces only ranges starting that date. Each range may carry a name (Lunch, Dinner) that the guest flow groups times by; with no name, times are shown ungrouped.
- **Last start and holds.** Reservation hours set the last start per day (default: the range's close minus 90 minutes). A hold may run past close.
- **Late, overstay, early.** Seating late keeps `ends_at`. An overstay extends `during` only while the table is free and otherwise shows a warning on Service. Online times always use the planned `during`. Finished early shortens `during` to `finished_at`.
- **Tables with future reservations.** Deleting a table with live future holds is refused `IN_USE` with a count and a link; a table can be archived instead (it leaves online fitting, keeps its holds). Changing capacity or joins never moves an existing hold; Service flags a reservation that no longer fits.
- **Changing hours or exceptions** never touches existing reservations; the editor warns "3 reservations fall outside the new hours" and links to them.
- **Staff emails** go to a per place recipient list (default: the member who installed Table seating), under a new email topic `reservations`, on by default, which each member can turn off.
- **People.** Matching uses the same person match `bookPublicSlot` uses (email first, then phone), as the system actor. A "Guest notes" text attribute is added to People when Table seating is first installed. Walk ins create no Person.
- **Privacy.** Deleting a Person blanks the guest columns of their linked reservations. Guest name, email, phone and note on reservations finished more than 24 months ago are blanked nightly (party size, times and tables stay for counts). A person's export includes their reservations.
- **Idempotency.** `unique (workspace_id, place_id, idempotency_key)`, the key made by the guest page per attempt; a replay answers the same reservation, as `bookings` do.
- **Limits.** At most 3 upcoming reservations per email per place; a table's `joins` at most 10; extra questions at most 6; menus 30, sections 100 per menu, items 2,000 per workspace, places 20, tables 300 per place, areas 12 per place.
- **Realtime.** The channel token for `hospitality:<workspace>:<place>` is minted only for a member holding `hospitality.service` (or manage) in a workspace with Table seating installed, and is checked again whenever the token refreshes, so a role change or uninstall cuts access within one refresh.
- **Navigation.** `NAV_SECTIONS` gains `hospitality` after `scheduling`; new page ids `menus`, `qr`, `reservations`, `service` join the closed `NavPage` list in that order; stored preferences without them parse as before and show them at the default position.

## Build plan

Each step is one lane; review (security, design, UX, state) before landing; migrations hand written with forced RLS and guard tests.

1. **H0 thread** (AC-6501 to AC-6511): `workspace_apps`, `early_access`, operator switch, `appInstalled`, Apps page, Business settings with one place, hours editor, areas and tables list, Hospitality nav section, the two permissions and Floor staff role. Thin first: install Menu shows an empty Menus screen.
2. **H1 thread** (AC-6520, 6522, 6525, 6528, 6529, 6531, 6532): one menu, flat sections, items with a price, Publish, guest page at `/m/:key` with the Warm look. Then thicken: sizes and options (6523), placements (6524), sold out live (6526), photos (6527), serving times and switcher (6520, 6521), search and filters, item sheet, Your picks (6530), link page blocks (6528), accessibility pass (6533).
3. **H2** (AC-6540 to AC-6544): codes, resolver, replace and off, drawing and downloads, print page, scan counts.
4. **H3 thread** (AC-6550 to 6553, 6555, 6557), after 0062 L1 is on main: extract the engine helpers (snapshot tests), rules, `tableSlots`, `fitTables`, `reserve`, public page `/r/:key`, emails. Then requests (6554), People and Visits (6556), embed.
5. **H4** (AC-6560 to AC-6565): list view, statuses, walk ins, manual add, table view with drag, realtime.
6. **H5** (AC-6570, 6571): presets, SN review shots, turn on for SN.

## Consequences

- Timefix gains its first concept of installable apps; billing (#38, #42) plugs into `workspace_apps.plan` and `appInstalled` with no new gate.
- The operator console gains its first write (early access). It is audited and limited to that one switch.
- Reservations sit beside bookings, not inside them: the booking engine's helpers are shared, but reports and the CRM timeline show both kinds through the Person page, not one table.
- Three new public routes (`/m/`, `/q/`, `/r/`) join `/b/` and `/f/` on timefix.com and later custom domains (0064 slice 1).
- One new client dependency (a QR drawing library).
- Menu photos add to Blob storage; the 1,000 photo cap keeps it bounded.

## Follow-up

- Menu import: paste text, CSV, then PDF or photo with AI reading (SN's menu first, when the owner says).
- Waitlist (online when full, and at the door) with text messages once Twilio lands (0062 L5).
- Deposits and card holds for large parties and no show fees, once Stripe lands (0062 L5).
- Floor plan canvas (drag tables on a map) replacing the table list view.
- Ordering and paying at the table (needs per visit sessions; the 12 character QR code is not a credential).
- Menu translations (the 0064 visitor language work).
- Analytics: menu views, item opens, scans per table and the reservation funnel feed spec 0067.
- `/sync` to add the Hospitality area to AGENTS.md once H0 lands.

## Rationale

See [rationale.md](rationale.md).
