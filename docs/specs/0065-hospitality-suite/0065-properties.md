# 0065 H7. Properties: many brands in one workspace

**Date**: 2026-11-06. The owner approved this through the [published plan](https://claude.ai/artifact/9SasYTbsmqDtKSCuw8KN17) on 6 November 2026. Its status follows the umbrella. It reverses 0066's "One business per workspace" rule and "Currency is the workspace's" rule.

## Summary

A workspace can hold several properties, each one a brand with its own places, menus, services, look, currency and public page. A workspace with one property never sees the word: the level shows only from a second property on. Nothing a guest already holds changes: place keys, QR codes and addresses stay as they are.

## Requirements

Each criterion is checkable. Nothing in slice 1 is visible to anyone.

**Structure and data (slice 1)**

- **AC-6512**: Every workspace has at least one property. A migration turns each existing business profile into its workspace's first property and attaches every place, menu and service category to it. All of a workspace's existing rows keep their ids, and every public key stays.
- **AC-6513**: A property holds name, kind, description, logo, cover, phone, email, website, links, look, currency, country and position. A property's logo and cover fall back to the workspace's brand kit when it has none of its own.
- **AC-6514**: Every place, menu and service belongs to exactly one property. A menu can serve only places in its own property, and the database refuses a `menu_places` row that crosses properties. So does `service_places`.
- **AC-6515**: People stays one list across the workspace. A reservation or appointment names its place, and so its property. A member's reach (AC-6594) limits Service, reservation and appointment lists; it does not change what their CRM role shows in People.

**A second property (slice 2)**

- **AC-6516**: An admin adds a property in Settings > Business. The first property's screens read exactly as they did until there are two.
- **AC-6517**: From two properties up, the sidebar's Business group shows a switcher. Every hospitality screen, the Design page, Insights' hospitality figures and ⌘K show the chosen property. The choice is kept per member on the device, and a link to a screen opens the property that screen's record belongs to.
- **AC-6518**: Limits: 20 properties per workspace; per property, 20 places, 30 menus, 2,000 items and 1,000 photos. The server refuses past them with `LIMIT_REACHED`.
- **AC-6519**: A property's currency can change only while it has no priced items or services, and the server refuses otherwise. Nothing ever converts a price.
- **AC-6590**: A property with no places, menus or services can be removed, after asking first. The first remaining property can't be removed. Moving a place or menu between properties is not part of this build.
- **AC-6591**: A menu or service can be copied to another property with Duplicate. The copy keeps its numbers, and the sheet warns when the currencies differ.

**The guest side (slice 3)**

- **AC-6592**: Each property has its own public page at its own handle in the shared handle namespace. The first property keeps the workspace's existing handle and address. A property's handle is taken only at its first Publish, and a workspace can take at most 5 new handles a day, so nobody can reserve names by the dozen.
- **AC-6593**: A property's page lists its places. With two or more places, Reserve asks for the place first, then runs the flow in AC-6550. `/m/`, `/q/` and `/r/` keys, printed QR codes and place addresses (`/<handle>/<slug>`) work unchanged. Each guest page, confirmation email and manage page wears its own property's look and name.

**Who can work where (slice 4)**

- **AC-6594**: A member's reach is All (the default) or chosen properties and places, on top of their role. Owners and admins are always All. There is no menu level and no permission grid.
- **AC-6595**: Reach is decided in one function in core, called by every hospitality read and write, and through the access door. A member outside a place gets the same answer as for a place that doesn't exist. Hiding a screen is never the only gate, as in AC-6504.
- **AC-6596**: Lists, counts, exports, Home's figures, Insights and ⌘K leave out what a member can't reach. Live updates carry no guest data to a member outside the place: a change event holds ids only and the client reads through the door.
- **AC-6597**: Changing a member's reach applies on their next request and is written to History. This slice has its own `security-access-reviewer` pass, and a test proves a reach limited member can't read another place by id, in every hospitality procedure.

## Decision

- **The property is the business profile, renamed and made plural.** Rename `business_profiles` to `properties`, give it an `id`, and drop the one per workspace rule. A new table beside it would keep two sources for the same facts. Runner up: a new table, copied once. Hospitality has only just opened, so the rows are few.
- `places`, `menus`, `service_categories` and `services` gain `property_id` (not null, a composite foreign key with `workspace_id`). `business_pages`, `business_photos` and `place_pages` move from one per workspace to one per property.
- Currency moves from the workspace to `properties.currency`, and every price read takes it from the owner's property. AC-6522, AC-6532 and AC-6610 read "the property's currency" from now on.
- Reach is a new tenant table `member_reach (workspace_id, member_id, property_id, place_id)` with forced row level security. No rows means All. Exactly one of `property_id` and `place_id` is set.
- Staff stay at workspace level, because a person can work in two brands. `staff_places` already says where.
- Internal names say property. In the product a single business still reads as "Business".
- **Implementation skills**: crm-data-model-access, crm-api-backend, crm-frontend-state, crm-design-system.

## Build plan

Tracer Bullet, one slice landing at a time. Lanes check their migrations as the hospitality release's were: an empty database, then a copy of production's setup with seeded rows, on Postgres 17 and 18, with old columns hashed before and after.

1. **Slice 1, invisible** (AC-6512 to AC-6515): rename, `property_id` everywhere, currency moved, definers and functions naming `business_profiles` updated. Every screen and public read works from the first property. No visible change, and `pnpm test:visual` moves nothing.
2. **Slice 2** (AC-6516 to AC-6519, AC-6590, AC-6591): settings, switcher, screens filtered by property, look and currency per property, limits.
3. **Slice 3** (AC-6592, AC-6593): handles per property, the property page, Reserve picking a place, guest surfaces and emails by property.
4. **Slice 4** (AC-6594 to AC-6597): `member_reach`, the one function, every procedure and list, live updates, the member panel's picker, security review.

## Consequences

- Until slice 4 lands, staff see every property, as they see every place today. A group with separate managers should wait for it.
- A manager limited to one property still sees all of People if their CRM role allows. The owner accepted this (AC-6515). Separating people per property would be its own, much larger decision.
- Items and photos now cap per property, so one workspace's storage can grow up to 20 times the old cap.
- A customer who wants one menu across two properties keeps two copies.

## Follow-up

- A property level `/sync` for AGENTS.md once slice 1 lands.
- Moving a place or a menu between properties, if anyone asks.
- A list of a workspace's properties as a public group page, if anyone asks.

Rationale: the plan linked above, and this file's Decision section.
