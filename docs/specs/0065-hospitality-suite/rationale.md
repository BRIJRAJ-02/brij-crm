# 0065 rationale

## Context

The owner (3 Nov 2026) wants a Hospitality suite inside Timefix for its first venue customer, Somewhere Nowhere (SN): a business profile, a Menu, QR codes that open the menu at each table, a guest menu look for SN, and table seating built on Timefix's own booking system. Each is a separate app, billed separately later. Filling SN's real menu is deferred by the owner.

A sister product, checklabs (Next.js 16 and Prisma on its own database), already has menus, tables, reservations and a guest menu. The owner chose to rebuild in Timefix with checklabs as the reference only: no connection to it, no copied code.

Timefix today has no apps, plans or entitlements (`SEAT_LIMIT` is infinite until #38), no workspace level business details beyond name, time zone, currency and country, no bookable resources (every booking guard is keyed on a member), and no prices outside CRM number values. It does have strong pieces to reuse: the pure slot engine, the public page shell with brand CSS, the edge cache, the mail queue, People matching, the access door, Centrifugo, the embed widget and the Blob upload pipeline.

## Options considered

### Where reservations live
1. **Rows in `bookings` with a nullable host and a party size.** Most reuse on paper. But `host_member_id` is NOT NULL, about 60 call sites read `'confirmed'` bookings as a member's busy time, the overlap guard is per member, emails assume a meeting with a host, calendar sync would try to write every table to someone's Google calendar. Every meeting path would carry a "unless it is a table" branch.
2. **Own tables, shared engine helpers (chosen).** `reservations` and `reservation_tables` with a per table exclusion constraint; the pure stepping, notice and window helpers from `engine.ts` are reused, and the write mirrors `bookPublicSlot`'s order. Meetings stay untouched; restaurant concepts (party size, hold by size, seated, walk in, no show) get first class columns.
3. **A generic "resources" layer in the booking engine first (rooms, equipment, tables).** Right long term, but it delays the owner's ask behind an engine rewrite. Option 2 keeps the table guard shaped so a later resources layer can absorb it.

### Availability model
Checklabs pools capacity per slot (covers) and assigns tables by hand. That overbooks the moment two parties of 3 take the last 4 top. Timefix fits real tables (best fit, bounded joins of up to 3) and guards each table in the database, so the online book can never promise a table that does not exist. Pacing stays as an optional cap on top for kitchens.

### Apps gate
1. Free for every workspace now: charging later for something people got free is hard, and most workspaces are not restaurants.
2. **Operator early access, then admin install (chosen).** Only workspaces Timefix opens see the apps; SN first. Billing later sets `plan` and flips the gate from operator to checkout.
3. Checklabs' `disabledModules` (UI only): rejected. A hidden screen with a live endpoint is no gate; `requireApp` runs on every entry point.

### Menu model
Taken from checklabs: menu, section, sub section, item, sizes (its variants), option groups (its modifier groups), allergens, diet tags, published snapshot, serving times. Changed: one sub section level instead of category plus sub category; items placed in sections rather than copied (checklabs duplicates items per menu, so a price change misses copies); prices as integer minor units (checklabs mixes Decimal and cents); sold out applied live over the snapshot so service never waits on Publish; themes actually rendered (checklabs designs themes in the CMS that the guest app never reads).

### QR codes
Checklabs uses 6 character table codes as if they were secrets. Here a code only opens a public menu, so 12 characters from 32 letters (60 bits) is ample to stop guessing and stays short to print. The code is explicitly not a credential; ordering later needs a per visit session. Codes resolve through the server so a printed code survives every menu change, and replacing a code keeps old prints working.

### Places
SN may have one place, but groups are common. Building places now costs one extra table and a switcher; adding them later means migrating every menu, table and reservation. Checklabs' Property > Venue is collapsed into one level.

### Who runs service
Hosts and waiters should not see the sales pipeline. A "Floor staff" built in role with only Run service, plus the guests of reservations they see, follows the access door's existing record reach rules.

### Guest look
Checklabs' guest app is the reference the owner likes: phone first 448 pixel column, warm neutrals, pills, glass sticky bar, spring press, bottom sheets. It becomes the Warm preset, driven by the brand kit through the same CSS variables route as link pages, so SN's look is a preset plus its brand, not a fork.

## Calls made on the owner's behalf

- Separate reservation storage (above), then superseded on 4 Nov by the visit engine of 0066, which serves tables, salons and clinics alike.
- Operator early access (above).
- One currency per workspace (the workspace's), as in 0062 L5.
- Text message reminders, deposits and waitlist wait for 0062 L5 (Twilio and Stripe).
- No ordering or payment at the table in this spec.
- ~~No public venue page of its own~~ reversed on 4 Nov: business pages are 0066 B4.
- Floor plan canvas later; tables are a list first.
- Phone is required for reservations (restaurants call guests); email stays required for the confirmation.

## References

- Checklabs survey (3 Nov 2026, read only): menu model in `checklabscms/prisma/schema.prisma`, slots in `checklabscms/src/lib/availability.ts`, guest look in `checklabsfrontend` `menu.module.css`.
- EU 14 allergens: Regulation (EU) No 1169/2011, Annex II.
- Specs reused: 0035 availability, 0057 booking questions, 0058 edge cache, 0060 brand kit, 0061 link blocks, 0062 L1 requests and cutoffs, 0064 public platform, 0047 operator console.
