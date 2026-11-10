# 0065 H7. Properties: many brands in one workspace

**Date**: 2026-11-06. The owner approved this through the [published plan](https://claude.ai/artifact/9SasYTbsmqDtKSCuw8KN17) on 6 November 2026. Its status follows the umbrella. It reverses 0066's "One business per workspace" rule and "Currency is the workspace's" rule.

## Summary

A workspace can hold several properties, each one a brand with its own places, menus, services, look, currency and public page. A workspace with one property never sees the word: the level shows only from a second property on. Nothing a guest already holds changes: place keys, QR codes and addresses stay as they are.

## Requirements

Each criterion is checkable. Nothing in slice 1 is visible to anyone.

**Structure and data (slice 1)**

- **AC-6512**: Every workspace has at least one property. A migration turns each existing business profile into its workspace's first property and attaches every place, menu and service category to it. All of a workspace's existing rows keep their ids, and every public key stays.
- **AC-6513**: A property holds name, kind, description, logo, cover, phone, email, website, links, look, currency, country and position. A property's logo falls back to the workspace's brand kit when it has none of its own. Its cover is its own photo, falling back to the business page gallery's first photo (owner, 10 Nov 2026). As built (9 Nov 2026): properties have logo columns, and nothing sets a property's own logo yet, so every guest page wears the workspace's logo. The look (accent and guest look) is per business.
  - As built (10 Nov 2026, no migration): the cover is part of the business page's content (`BusinessPageContent.cover`, a `BusinessPhoto`), drafted and published with the page like the gallery, and stored as a `business_photos` row of that business. `businessCoverOf` and `businessPhotosOf` in contracts hold the one fallback rule. The public answer carries `cover` (with `src`); the page leads with it, the share image (`og:image`) and the preload use it, and JSON-LD's `image` lists it first.
  - Settings › Business › Page › Photos has a **Cover photo** row: Upload, Change, Adjust crop, Remove with Undo, then a description. It crops freely, as the gallery's photos do. With a cover set, no gallery photo says "Leads the page". After Remove, the row moves focus to Upload (for every FileDrop row, Brand's too).
  - Publish keeps the cover. A daily cleanup phase, `business_photos`, removes a business's pictures that no draft or published page uses (gallery or cover) a day after upload, files first, then rows.
- **AC-6514**: Every place, menu and service belongs to exactly one property. A menu can serve only places in its own property, and the database refuses a `menu_places` row that crosses properties. So does `service_places`. Dishes, menu photos and option groups belong to one property too (`property_id`, migration 0199): a dish is placed only in its own business's menus. That rule is a check in code for now, with no composite key on `menu_placements` or `menu_item_option_groups` yet.
- **AC-6515**: People stays one list across the workspace. A reservation or appointment names its place, and so its property. A member's reach (AC-6594) limits Service, reservation and appointment lists; it does not change what their CRM role shows in People.

**A second property (slice 2)**

- **AC-6516**: An admin adds a property in Settings > Business. The first property's screens read exactly as they did until there are two.
- **AC-6517**: From two properties up, the sidebar's Business group shows a switcher. Every hospitality screen, the Design page, Insights' hospitality figures and ⌘K show the chosen property. The choice is kept per member on the device, and a link to a screen opens the property that screen's record belongs to. As built: the choice is kept per workspace in this browser's storage (`crm.business.<workspace>`), so two people sharing one browser share it. A stored choice of a business the member no longer reaches is ignored. Insights has no hospitality figures yet, so nothing there follows the choice. Each business has its own menu draft, Publish, Discard, Hidden and look (`menu_drafts` keyed by workspace and property, 0199).
- **AC-6518**: Limits: 20 properties per workspace; per property, 20 places, 30 menus, 2,000 items and 1,000 photos. The server refuses past them with `LIMIT_REACHED`. Places' positions still run across the workspace. Service categories count per business; the services limit stays per workspace.
- **AC-6519**: A property's currency can change only while it has no priced items or services, and the server refuses otherwise. Nothing ever converts a price. Each property's currency is set in Settings › Business. Settings › Workspace's currency no longer moves prices: it follows onto the first property only while that property has no price.
- **AC-6590**: A property with no places, menus or services can be removed, after asking first. The first remaining property can't be removed. Moving a place or menu between properties is not part of this build.
- **AC-6591**: A menu or service can be copied to another property with Duplicate. The copy keeps its numbers, and the sheet warns when the currencies differ. As built, the product word is **Copy to another business**.
  - A menu copies into the other business's draft with its sections, placed dishes, sizes, option groups and options, under new ids, at no place, without photos (a photo's files are one business's).
  - A service copies with its options, staff rule, chosen staff and the kinds of room it needs, at no place, in no category, offline.

**The guest side (slice 3)**

- **AC-6592**: Each property has its own public page at its own handle in the shared handle namespace. The first property keeps the workspace's existing handle and address. A property's handle is taken only at its first Publish, and a workspace can take at most 5 new handles a day, so nobody can reserve names by the dozen. As built (migration 0200):
  - Which business holds a handle is a new tenant table, `property_handles`, since `auth.public_handles` knows only the workspace. A handle the workspace holds but no business names (a removed business's) is no page at all, and stays the workspace's.
  - "Taken only at its first Publish" applies to every business but the first, which keeps today's claim at once (0066 AC-6640, 0068 AC-6813). Before that Publish the address is a wish (`business_pages.pending_handle`): checked as free when saved, held for nobody, so Publish can still be refused `SLUG_TAKEN`, which the editor shows on the field.
  - The 5 a day are counted per workspace in `crm_claim_business_handle` from the handles made in the last 24 hours. A handle the workspace holds or held is its own again, free. The old cap of 20 per workspace became 20 per business (in the app) and 400 per workspace (in the definer).
  - `business_page.address` and `business_page.published` in History carry the property id and the handle.
  - On top of the workspace's 5, each person can take at most 10 new business addresses a day across every workspace (owner, 10 Nov 2026; no migration). The api spends the durable limiter (`identity.consumeRateLimit`, key `business-handles:user:<id>`, 24 hours) atomically before the claim, only for an address nobody held before (`crm_handle_taken`), so parallel claims can't pass the cap. A claim refused after that (the workspace's 5, or taken meanwhile) still costs one. Past it, `LIMIT_REACHED` on `handle`: "You’ve taken 10 new addresses today. Try again tomorrow." It applies to Claim and to another business's first Publish. Link page handles (personal, team pages, Add a page) take another path and are unchanged.
- **AC-6593**: A property's page lists its places. With two or more places, Reserve asks for the place first, then runs the flow in AC-6550. `/m/`, `/q/` and `/r/` keys, printed QR codes and place addresses (`/<handle>/<slug>`) work unchanged. Each guest page, confirmation email and manage page wears its own property's look and name. As built:
  - Reserve asks for the place first only at the business's own address, and only with two or more places taking reservations online. With one open place it goes straight there, and a place's own address reserves there.
  - At the business's address the page no longer moves to its first place's address, though the canonical link still names it. While Reserve offers several places, the open line and the "Or call" phone leave the panel and the phone bar, since they would be one place's.
  - Reservation emails wear their place's business name and carry no look or accent, so nothing changed there.

**Who can work where (slice 4)**

- **AC-6594**: A member's reach is All (the default) or chosen properties and places, on top of their role. Owners and admins are always All. There is no menu level and no permission grid. As built (migration 0201):
  - Reach is set by someone with `workspace.manage` (owners and admins; a custom role can't hold it) who reaches every business. Narrowing an owner or admin answers `CONFLICT`.
  - Settings › Members, a member's panel, has a **Works in** picker for owners and admins, shown once there are two businesses or a business with two places. It is one multiple choice Select: Every business; a one place business as one choice; else a heading with "All of <business>" and each place. Each pick saves at once and is put back on a refusal.
  - **See versus whole.** Someone reached to some places of a business sees that business (switcher, menus, catalogue, the page editor read only, place lists cut to their places). A change to the whole business (its profile, menus, Sold out, Publish, look, catalogue, page, a new place) is `FORBIDDEN`: "You work in some of this business’s places only. Ask an admin to change where you work."
  - **Staff stay workspace level.** Any limited member is `FORBIDDEN` from staff profile writes (save, move, link, archive, restore, photo). Shifts, time off and blocks need both the place and the staff member in reach, checked before anything names a staff member. Staff lists show only staff who work in a reached place, and only those places' entries. `upcoming` still counts every place (a number only).
  - A removed member's rows stay. A member who comes back, or an admin demoted, gets the old narrow reach back (fails closed).
  - `removeProperty` answers `IN_USE` while a reach names the business ("Someone works in this business. Change where they work in Members first."). Neither foreign key cascades, because a reach that lost its only row would read as every business.
  - The system and the public doors (form, booking, the guest reservation door) reach everything. API keys, partners and email links reach nothing, as no business permission reaches them today.
- **AC-6595**: Reach is decided in one function in core, called by every hospitality read and write, and through the access door. A member outside a place gets the same answer as for a place that doesn't exist. Hiding a screen is never the only gate, as in AC-6504.
- **AC-6596**: Lists, counts, exports, Home's figures, Insights and ⌘K leave out what a member can't reach. Live updates carry no guest data to a member outside the place: a change event holds ids only and the client reads through the door. As built: `visits` events still carry place ids to every audience (ids only). New reservation emails go only to members who reach the place. Not narrowed: `menuPlaceIds` (edge purge ids, which never leave the server); Home, Insights and exports have no hospitality figures yet.
- **AC-6597**: Changing a member's reach applies on their next request and is written to History. History counts, never names: `member.reach_changed`, "limited Bea to 1 business and 2 places", "let Bea work in every business". A reach change stores a `nav` event naming the member, and the data layer reads the businesses list again on any `nav` event, so the switcher and ⌘K follow mid session. This slice has its own `security-access-reviewer` pass, and a test proves a reach limited member can't read another place by id, in every hospitality procedure.

## Decision

- **The property is the business profile, renamed and made plural.** Rename `business_profiles` to `properties`, give it an `id`, and drop the one per workspace rule. A new table beside it would keep two sources for the same facts. Runner up: a new table, copied once. Hospitality has only just opened, so the rows are few.
- `places`, `menus`, `service_categories` and `services` gain `property_id` (not null, a composite foreign key with `workspace_id`). `business_pages`, `business_photos` and `place_pages` move from one per workspace to one per property.
- Currency moves from the workspace to `properties.currency`, and every price read takes it from the owner's property. AC-6522, AC-6532 and AC-6610 read "the property's currency" from now on.
- Reach is a new tenant table `member_reach (workspace_id, member_id, property_id, place_id)` with forced row level security. No rows means All. Exactly one of `property_id` and `place_id` is set.
- Staff stay at workspace level, because a person can work in two brands. `staff_places` already says where.
- **Each business has its own menu library** (decided for slice 2b, 9 Nov 2026). A shared library would let one dish be priced in two currencies, which AC-6519 forbids. Old whole workspace drafts went to the first business.
- **The first business keeps claim at once**, so nothing a guest already holds moves. Only later businesses wait for Publish.
- **Seeing part of a business is not changing all of it** (slice 4). A change to the whole business needs the whole business in reach, so a limited member can never edit what other places' guests see.
- **The contract step is deferred.** Dropping the `business_profiles` view and the `crm_first_property_id()` defaults waits for a later migration once slice 1 is live, because they protect old code while a deploy rolls out.
- **Separate businesses stay unlinkable in public, unless the owner links them** (owner, 10 Nov 2026). Every public cache tag is per business: `business:<sha256(label, workspace, property)[0:32]>`, and the menu's `menu-ws:<same id>` (`menu.cacheId`). Writes purge through `businessEdgeTags(scope, { properties | places | every, menus })`, which reads which businesses a write touched. Workspace wide changes (apps, brand kit, workspace delete and restore) purge each business's tag, and a workspace delete reads its tags first (a failed read refuses the delete). `brand:<workspace id>` stays as a server only tag (Vercel's `addCacheTag`, never in a body). Why: a group may run brands that guests must not tie together, and a shared tag in the public JSON told anyone they were one workspace.
  - The old workspace wide tags (`business:<hash(ws)>`, `menu-ws:<hash(ws)>`) are purged beside the new ones until 24 Nov 2026 (`legacyWorkspaceCacheTags`), so pages cached before the change still clear.
  - The audit of public surfaces found no cross business name or link beyond the two residuals in Follow-up: the business page JSON and its photo, logo, `brand.css` and `menu.css` routes; the handle shell (meta, JSON-LD, crawler text, boot block); the guest menu JSON and its `look.css`, logo, photos, table routes and `/m/` shell; the reservation page (`/r/`, no store); the sitemap (by handle, no grouping); the share image.
- **The cover is a photo of the business's own, with the gallery's first as the fallback** (owner, 10 Nov 2026). Why: a page needs a lead photo the owner chooses, and the fallback means no page that has photos is left without one. It lives in the page's content, so it drafts and publishes like the gallery and needs no column.
- **10 new business addresses a day per person** (owner, 10 Nov 2026). Why: the workspace's 5 alone let someone with many workspaces take 5 in each; a cap on the person closes that without touching honest use.
- Internal names say property. In the product a single business still reads as "Business".
- **Implementation skills**: crm-data-model-access, crm-api-backend, crm-frontend-state, crm-design-system.

## Build plan

Tracer Bullet, one slice landing at a time. Lanes check their migrations as the hospitality release's were: an empty database, then a copy of production's setup with seeded rows, on Postgres 17 and 18, with old columns hashed before and after.

1. **Slice 1, invisible** (AC-6512 to AC-6515; built, migration 0198): rename, `property_id` everywhere, currency moved, definers and functions naming `business_profiles` updated. Every screen and public read works from the first property. No visible change, and `pnpm test:visual` moves nothing.
2. **Slice 2** (AC-6516 to AC-6519, AC-6590, AC-6591; built, 0198 and 0199): settings, switcher, screens filtered by property, look and currency per property, limits.
3. **Slice 3** (AC-6592, AC-6593; built, 0200): handles per property, the property page, Reserve picking a place, guest surfaces and emails by property.
4. **Slice 4** (AC-6594 to AC-6597; built, 0201): `member_reach`, the one function, every procedure and list, live updates, the member panel's picker, security review.

## Consequences

- Until slice 4 lands, staff see every property, as they see every place today. A group with separate managers should wait for it. Slice 4 landed with 0201 (9 Nov 2026).
- A manager limited to one property still sees all of People if their CRM role allows. The owner accepted this (AC-6515). Separating people per property would be its own, much larger decision.
- Items and photos now cap per property, so one workspace's storage can grow up to 20 times the old cap.
- A customer who wants one menu across two properties keeps two copies.
- Rollout windows (deploy notes must say so): while 0199 is applied and old code runs, old code's `on conflict (workspace_id)` on `menu_drafts` fails, so every menu edit and Publish is refused; while 0200 is applied, old code's Publish fails, since the old four argument `crm_list_business` is gone. A rollback leaves either window open.
- Sold out needs the whole business in reach, a cost for floor staff limited to one place.

## Follow-up

- A property level `/sync` for AGENTS.md once slice 1 lands.
- Moving a place or a menu between properties, if anyone asks.
- A list of a workspace's properties as a public group page, if anyone asks.
- A contract migration that drops the `business_profiles` view and the `crm_first_property_id()` defaults.
- Composite keys on `menu_placements` and `menu_item_option_groups`, so the database refuses a dish placed across businesses. Old dev data may hold such a crossed placement.
- Slice 4 filters still to check end to end: `listServicePlaces.elsewhere`, `currentProperty`, both sides of both copies, ⌘K's Switch to list and the switcher.
- `hospitality.properties` (names, kind, currency, counts) is open to any member while a business app is on; narrow it by reach.
- A Sold out per place, so floor staff limited to one place can mark a dish.
- The stored switcher choice could add the member id to its key, if two people share a browser.
- Spec 0070's managed members and any hospitality API key need a reach of their own.
- **Remove `legacyWorkspaceCacheTags` on 24 Nov 2026**, once every page cached under the old workspace wide tags has run out. Until then each write purges both.
- **Decided (owner, 10 Nov 2026)**, all built:
  - **AC-6513's cover**: its own photo, falling back to the gallery's first photo.
  - **Separate brands**: unlinkable in public unless the owner links them; tags are per business.
  - **Handles**: 10 new business addresses a day per person, on top of the workspace's 5.
- Booking pages and link pages lock up to the workspace's first business (0066 AC-6646, `publishedBusinessHandle`). That is a link the owner made on purpose, so it stays.
- **Open, not decided (owner)**:
  - **Two businesses with no logo or accent of their own** both wear the workspace's brand kit, so they share logo bytes and the same `brand.logo` and look versions in their JSON. Fixing it needs a logo and accent control per business (the `properties.logo_*` columns exist, nothing writes them).

Rationale: the plan linked above, and this file's Decision section.
