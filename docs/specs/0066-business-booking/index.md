# 0066. Business booking: services, staff, resources and business pages

**Date**: 2026-11-04
**Status**: Proposed

**Numbering**: this spec owns AC-6601 to AC-6699. Migrations carry placeholder numbers and are renumbered after main's last migration when each slice lands. It changes spec 0065: Table seating (0065 H3, H4) is built as a preset of this engine, and 0065's own `reservations` design is replaced (see 0065's note). Analytics moves to spec 0067. Scope row #69.

## Structure

| Slice | What | Depends on |
|---|---|---|
| B0 | The engine: appointments, holds with database guards, the pure visit planner, one person across meetings and appointments | 0065 H0 (places, areas, resources) |
| B1 | Services catalogue, staff profiles and shifts (settings screens) | B0 |
| B2 | Online booking of one service: the booking flow, emails, manage page, clients as People | B1, 0062 L1 |
| B3 | Calendar: the day and week board by staff or by resource, add, move, block time, statuses, live | B2 |
| B4 | Business page: the public profile of a business and each place, with SEO | B1 (B2 for Book) |
| B5 | Several services in one visit; intake forms and consent for clinics; sensitive services | B2 |
| B6 | Verified reviews and replies | B2, B4 |
| B7 | Table seating as a preset (party size fitting, joined tables, floor grid with timers, walk ins) | B3 |
| B8 | Events and classes, after Luma: event pages, registration with capacity, approval and waitlist, guest list and check in, a business's events calendar, recurring classes | B2, B4 |

Later, each with its own decision: paid tickets, deposits, card holds and no show fees (Stripe, 0062 L5), text messages (Twilio, 0062 L5), waitlist, packages, memberships and gift cards, a discovery marketplace (search, nearby), staff who never sign in getting their day by email, rebook reminders, POS and tips.

## Summary

Timefix grows from "book a meeting with a person" into "book a visit at a business": a haircut with any stylist at the Indiranagar studio, a 30 minute consultation with Dr Rao in room 2, a padel court for 90 minutes, a table for four at eight. One engine handles all of them. A business lists its services (with lengths and prices), its staff (who does what, and when they work) and its resources (chairs, rooms, beds, courts, tables). A visit needs some staff, some resources, or both, and the engine finds times when everything needed is free, then guards each one in the database so nothing is ever double booked.

Each business gets a public business page in the style of Fresha's venue pages: photos, rating, open now, services with prices and a Book button, team, reviews, about, hours and directions. A restaurant's page shows its menu and Reserve a table instead of services. Every client becomes a Person in the CRM with their visits, spend, notes and consents. Restaurants, salons, spas, barbers, clinics and studios are presets over the same engine, sold as separate apps (billing later, 0065's app model).

Reasoning and every call made on the owner's behalf: [rationale.md](rationale.md).

## Requirements

**User stories**
- As a salon owner, I want clients to book "Haircut, any stylist, Saturday" from my page or Instagram, and each stylist to see only real gaps, so I never call anyone to fix a clash.
- As a clinic manager, I want a consultation to need both a doctor and a free consult room, the patient to fill the intake form and consent before arriving, and their answers seen only by the people treating them.
- As a stylist who is also a Timefix member, I want my client appointments and my meetings to block each other, because I am one person.
- As a front desk person, I want one calendar of everyone's day where I can drag, add a walk in and block a lunch break.
- As a client, I want a page that tells me what the place offers, what it costs, whether it is open and what others thought, and books me in under a minute without an account.
- As an owner, I want every client in the CRM with their history and spend so I can win them back.

**Acceptance criteria**

*B0. The engine*
- **AC-6601**: An appointment (a visit) belongs to one place and has one or more items, each item one service (with its variant) at a start and end, in order, back to back unless a gap is set. An item holds what it needs: zero or one staff member and zero or more resources, each as a hold row with a time range.
- **AC-6602**: Two database guards: no staff member holds two overlapping live holds, and no resource holds two overlapping live holds (exclusion constraints on `(staff_id, during)` and `(resource_id, during)` where live). Holds include the service's buffer after (cleanup).
- **AC-6603**: The planner is one pure function `planVisit(input)` in `packages/core/src/visits/planner.ts`. Given the place's hours, each needed staff member's shifts and busy times, each candidate resource's busy times, the services asked for, the party size, notice, window, step and pacing, it returns the offered start times and, for a chosen start, the allocation (which staff, which resources). It never reads the database.
- **AC-6604**: Allocation rules: "Any staff" picks the qualified staff member with the fewest booked minutes that day (ties by the staff order the business set); resources are fitted best fit (smallest capacity that seats the party, then joins of up to 3 joinable resources). The search is bounded: at most 5 items, 60 staff and 300 resources per place; a plan that would exceed 2,000 allocation tries for one start is dropped as not offered.
- **AC-6605**: Booking a visit mirrors `bookPublicSlot`'s order: idempotency key, read busy calendars outside any lock, take the place lock and then every involved person lock in sorted order (the same `host:<memberId>` key meetings use), recompute, allocate, insert, refuse `SLOT_TAKEN` with the next free times when the plan no longer holds.
- **AC-6606**: One person, two engines: a staff profile linked to a member is that member. Their meeting bookings (booking hosts) and calendar busy times block appointment times, and their appointment holds block meeting slots in `computeSlots`. Tests prove both directions and a race between a meeting and an appointment for the same person.

*B1. Services, staff and shifts*
- **AC-6610**: Services live in categories (up to 50 categories, 500 services per workspace). A service has a name, description (up to 600), up to 8 variants (each a name like "Short hair", a length 5 to 600 minutes, and a price in minor units with a price type: fixed, from, free or on request), a buffer after (0 to 120 minutes), whether it books online, which places offer it, who can do it (all staff, or chosen staff), which resources it needs (a kind and a count, or specific resources), the capacity mode (one client; or a party fitted to a resource's capacity, used by tables), an optional intake form (B5), and a short cancellation note.
- **AC-6611**: Staff profiles: name, title (Senior stylist, Dentist), photo, short bio, the places they work at, the services they do, the order they show in, and an optional link to a member. A staff member without a linked member never signs in; a linked one sees their own calendar. Up to 60 staff per place.
- **AC-6612**: Shifts: each staff member has a weekly pattern per place (the `PlaceHours` shape from 0065) plus time off (dated, whole or part day, with a reason: holiday, sick, training, other). Shifts are capped by the place's opening hours unless marked "outside hours" (for early prep). A shift pattern can be copied to other staff.
- **AC-6613**: Settings screens: Services (categories as groups, drag to order, a service opens a side panel editor), Team (staff cards with photo and services count; a staff member opens their profile with Shifts as a week grid), and Resources (0065's place page). Every list has bulk select and bulk actions.

*B2. Online booking*
- **AC-6620**: A place's booking flow lives at `timefix.com/<handle>/book` (and `/book/<service-slug>` to start on a service), and embeds with the existing widget (`data-timefix-book="<handle>"`, popup and inline, the same panel and height reporting as booking pages and forms).
- **AC-6621**: Steps, each one screen with a sticky summary (place, service, staff, time, price) on wide screens and a bottom bar on phones: service (by category, with length and price, search) → professional ("Any professional" first, then staff with photo and title; only those who do the service) → date and time (a week strip and times grouped Morning, Afternoon, Evening; days with nothing crossed out; the earliest free day preselected) → details (name, email, phone, optional note; a returning email fills the name) → intake and consents when the service has them (B5) → review and confirm. Back never loses an earlier choice.
- **AC-6622**: After booking: a confirmation screen with Add to calendar, Directions, Change and Cancel; a confirmation email with the business brand; reminders 24 hours and 2 hours before (each a place setting); Change and Cancel through a manage page with the token in the fragment, honouring the place's cutoffs (0062 L1 semantics: `TOO_LATE`); confirm first services make a request (0062 L1).
- **AC-6623**: Every client matches or creates a Person (email, then phone, as the system actor). The Person page gets a Visits panel: upcoming and past visits with service, staff, price, status; total spend; no shows; notes ("Prefers Asha", "Latex allergy") as a "Client notes" attribute. A "Clients" saved view lists People with at least one visit, with last visit and spend columns.
- **AC-6624**: Staff (and the place's recipient list) get an email for each new, changed and cancelled visit, under the `appointments` email topic, on by default, each member can turn it off.
- **AC-6625**: Public endpoints use the public limiter (reads 60 per minute per address, bookings 5 per minute) and the booking pages' bot checks; at most 3 upcoming visits per email per place. Public answers never reveal other clients, which staff are busy, or why a time is not offered.

*B3. Calendar*
- **AC-6630**: A Calendar screen per place: a day view with one column per staff member on shift (photo and name at the top), a week view for one person, and a switch to columns by resource. Appointments are blocks coloured by status, showing client, service and time; tapping one opens its panel (client with visit count and notes, items, price, status actions, history).
- **AC-6631**: Add by clicking an empty slot (client search or new, service, staff prefilled from the column, time prefilled), walk in (now, any free staff), block time (lunch, meeting; blocks online times), and move or resize by drag (dnd-kit) with a check: moving onto a clash asks "Double book Asha?" and only owners and admins may.
- **AC-6632**: Statuses: Booked, Confirmed (the client pressed "I'm coming" in the reminder), Arrived, Started, Completed, No show, Cancelled. One tap moves to the next. Undo for 10 seconds on status moves; No show and Cancel ask first.
- **AC-6633**: Changes show on every open calendar within a second (Centrifugo, one channel per place, the token minted only for members with `services.calendar` and an installed app, checked again on refresh). The calendar stays smooth at 60 staff and 400 appointments a day (virtualised columns).
- **AC-6634**: A staff member without a calendar permission sees only their own column (a linked staff member's own day).

*B4. Business page*
- **AC-6640**: Every workspace with a business app has a business page at `timefix.com/<handle>`, with a business handle in the same handle namespace as link pages (0056 rules: unique everywhere, reserved words, old handles still find the page). A business with several places shows a place picker on its page and each place at `timefix.com/<handle>/<place-slug>`.
- **AC-6641**: The page, top to bottom (after Fresha's venue page): a photo gallery (up to 20 photos, a large first photo and four tiles on wide screens, a swipe carousel on phones, "See all photos" opening a viewer); name, business kind, rating and review count (B6), open now or opens at, short address with Directions; section tabs (Services or Menu, Team, Reviews, About) that follow the scroll; Services as category chips over cards (name, length, "from ₹899", Book); Team (photo, name, title, rating); Reviews; About (description, amenities from a closed list such as Wi‑Fi, parking, wheelchair access, card payments, kids friendly), Opening hours with today marked; Location (full address, Directions to Google or Apple Maps). A sticky side panel on wide screens repeats name, rating, Book now, open status and address; phones get a sticky Book now bar. "Powered by Timefix" at the foot.
- **AC-6642**: A restaurant's page shows its menu sections (0065 H1) in place of Services and "Reserve a table" in place of Book now; a business with both shows both.
- **AC-6643**: Look: the brand kit (accent, logo, font pack) and a page preset, through the `look.css` variables route; AA in light and dark. The first content paints within 2 seconds on slow 4G; photos load lazily at the right size; the HTML carries the text (no blank shell for crawlers).
- **AC-6644**: SEO: title, description, canonical, Open Graph image (the first photo), and JSON-LD of the right type (`Restaurant`, `HairSalon`, `BeautySalon`, `DaySpa`, `MedicalClinic`, `Dentist`, `HealthClub`, or `LocalBusiness`) with address, geo when known, opening hours, price range, aggregate rating (B6) and the menu or booking link. The page is in the public sitemap. A place can be hidden from search engines.
- **AC-6645**: Map: no embedded third party map in this spec (it adds a tracking origin and a CSP hole); Directions opens the visitor's map app with the address. A static map image through a server side wrapper is a follow-up.

*B5. Several services, intake and sensitive services*
- **AC-6650**: A client can add up to 5 services to one visit ("Add another service" after the first), each with its own professional or "Any"; the planner places them back to back (with buffers) and offers a start only when the whole sequence fits.
- **AC-6651**: A service can require an intake form (a form from the Forms app, 0063) filled during booking or sent after booking with a "fill before your visit" link, and consents (0065's consent records, 0165) ticked before confirming. Answers are attached to the visit.
- **AC-6652**: A service can be marked sensitive (health, body). Its intake answers and the visit's notes are visible only to the staff on that visit and to members with `services.manage`; they are never filed onto People attributes, never in webhooks, never in exports by default; the Person page shows "Intake on file" with a link that checks access. Every read of them is audited.
- **AC-6653**: This spec stores bookings, intake answers and consents only. It is not a medical record system: no clinical notes, prescriptions or diagnoses. The settings page for a clinic says so.

*B6. Reviews*
- **AC-6660**: After a visit is Completed, the client gets one email asking for a rating (1 to 5 stars) and an optional comment, through a single use link; only completed visits can be reviewed (verified), one review per visit, within 30 days.
- **AC-6661**: Reviews show on the business page with the first name and last initial, the date, the service and the staff member; the rating shows as an average with the count once there are 3 reviews. The owner can reply once per review (shown under it) and can report a review (hidden while Timefix looks, through the operator console); owners cannot delete or edit reviews.

*B7. Table seating as a preset*
- **AC-6670**: Installing Table seating creates a service "Table" in capacity mode party (no staff, needs one table resource or joined tables) with holds by party size (0065 AC-6550's defaults), and the reservation rules of 0065 AC-6550 map onto place and service settings. The guest flow is 0065 AC-6551 (party size first) on this engine; the public address is `timefix.com/<handle>/reserve` (and `/r/<key>` kept as a short link).
- **AC-6671**: Service screen (0065 H4) is the Calendar in resource mode plus a Floor view: a grid of table tiles (after the owner's references) coloured by state (free, booked soon, seated, needs attention), each with its timer since seating and the next booking ("Booking at 20:30"), joined tables drawn as one tile with a link mark, an area switcher at the bottom, and walk in from any free tile.

*B8. Events and classes (after Luma)*
- **AC-6680**: An event has a title, cover image, description (rich text), start and end in the place's zone (or online with a video link shown only to registered guests), a place or a free address, hosts (staff profiles or members), a capacity (or unlimited), and optional registration questions (the forms question model, 0057). It holds its hosts and its room through the engine's holds (AC-6602), so nobody can book the yoga teacher or the studio during the class.
- **AC-6681**: Each event has a public page at `timefix.com/<handle>/e/<slug>` (and `/e/<key>` as a short link): cover, title, date and time in the visitor's zone with the place's zone shown when different, location with Directions, hosts with photos, "42 going" with up to 8 guest avatars (only guests who chose to show themselves; off by default), the description, and one Register button opening a short form (name, email, the event's questions). It embeds with the widget (`data-timefix-event`).
- **AC-6682**: Registration modes: open (instant, until full), approval (each registration waits for a host to accept; the guest is told it is pending), and invite only (the page asks for an invite link). When full, guests can join a waitlist; a cancellation offers the spot to the first on the waitlist by email for 12 hours, then the next.
- **AC-6683**: Guests get a confirmation with an add to calendar file, reminders 24 hours and 1 hour before, a Cancel link, and a personal QR code. The host's guest list screen shows registered, pending, waitlist and checked in counts, searches guests, exports CSV, and checks in by scanning the QR with the phone camera (the app page asks for the camera) or by tapping a name.
- **AC-6684**: Hosts can email all guests (or one status) from the event, plainly, through the mail queue with the business brand; at most 3 such emails per event per day.
- **AC-6685**: Recurring classes: an event can repeat weekly on chosen days until a date (up to 52 occurrences); each occurrence has its own guest list and capacity; a client can register for one occurrence or the series. Cancelling one occurrence emails its guests.
- **AC-6686**: The business page gains an Events section (upcoming first) and `timefix.com/<handle>/events` lists them as a calendar page (after Luma's calendar pages): upcoming and past, filterable by category, with "Subscribe" giving an iCal feed of public events.
- **AC-6687**: Every registered guest matches or creates a Person; the Person page lists events attended (checked in) and missed. Paid tickets wait for Stripe (0062 L5).

## Decision

Build one place based visit engine for every appointment business, with staff, resources and services as data, rather than separate engines for restaurants, salons and clinics. Keep the meeting engine (booking pages) as it is, linked by the one person rule, and converge them later. Make Table seating a preset, so 0065's separate reservation tables are not built. Give every business a public business page in the handle namespace.

## Feature design

### Data (new tables, all tenant scoped with forced RLS and workspace led indexes)

- `service_categories (place scope none; name, position)`, `services (category_id, name, description, buffer_after_min, online, capacity_mode 'one'|'party', staff_rule 'all'|'chosen', intake_form_id null, sensitive bool, cancel_note, slug, position, archived_at)`, `service_variants (service_id, name, minutes, price_minor, price_type 'fixed'|'from'|'free'|'on_request', position)`, `service_places (service_id, place_id)`, `service_staff (service_id, staff_id)`, `service_resources (service_id, kind, count, resource_id null)`.
- `staff (name, title, photo_path, bio, member_id null unique per workspace, position, archived_at)`, `staff_places (staff_id, place_id, shifts jsonb PlaceHours, outside_hours bool)`, `staff_time_off (staff_id, place_id null, starts_at, ends_at, reason)`.
- `appointments (place_id, person_record_id, client_name, client_email, client_phone, note, party_size, status, approval, source 'online'|'desk'|'walk_in', manage_token_hash unique, idempotency_key, total_minor, currency, created_by_member_id, cancelled_at, cancel_reason)`.
- `appointment_items (appointment_id, service_id, variant_id, starts_at, ends_at, price_minor, price_type, staff_id null, position)` with the service name and variant name copied at booking (a later rename doesn't rewrite history).
- `appointment_holds (item_id, staff_id null, resource_id null, during tstzrange, live bool, check exactly one of staff_id/resource_id)` with `exclude using gist (staff_id with =, during with &&) where (live and staff_id is not null)` and the same for `resource_id`.
- `staff_blocks (staff_id, place_id, during, reason)` for blocked time, read by the planner as busy.
- `business_pages (handle, gallery jsonb of photo paths, amenities text[], seo_hidden bool)`, `place_pages (place_id, slug)`.
- `reviews (appointment_id unique, rating smallint 1..5, comment ≤ 1,000, client_display, reply ≤ 1,000, replied_at, state 'shown'|'reported'|'hidden')`.

### Engine

- `planVisit` works on interval sets in UTC with each place's zone for hours and shifts; reuses `toInstant`, `windowsForDay`, `subtractBlocked` from `engine.ts` (0065's cross check: extract notice, window and stepping into exported helpers first, with booking slot snapshot tests).
- Inputs are loaded by one impure `loadVisitInputs(tx, place, services, range)`: hours, shifts, time off, blocks, holds, linked members' booking holds and calendar busy (through the existing `BusyReader`).
- `computeSlots` gains one more busy source for a member linked to a staff profile: that staff member's live holds.
- Locks: place lock `place:<id>` then person locks `host:<memberId>` (sorted) for linked staff. Meetings already take `host:<memberId>`, so a meeting and an appointment for one person serialise.

### Permissions

`services.manage` (catalogue, staff, shifts, resources, business page, reviews replies), `services.calendar` (everyone's calendar, add, move, statuses), in the existing Business group from 0065 (renamed from Hospitality), both forbidden to API keys for now. A linked staff member without either sees and acts on their own column only.

### Public routes

`/<handle>` (business page through the handle shell: the handle row says whether it is a person's link page or a business), `/<handle>/<place-slug>`, `/<handle>/book[/<service-slug>]`, `/<handle>/reserve`, manage page `/<handle>/visit#<token>`; APIs under `/api/public/business/…`; edge cached with tags `business:<workspace>` and `place:<id>`, purged on any page relevant change. Reserved handle words gain `book`, `reserve`, `visit`, `menu` as second segments for business handles only.

## Build plan

1. **B0** engine with tests (planner unit tests across zones, DST, joins, any staff fairness, bounds; guard tests for both exclusion constraints; the one person race test), behind no UI.
2. **B1** settings screens: Services, Team with Shifts, Resources wording from 0065.
3. **B2** thin thread: one service, any staff, book, email, manage, Person; then the full flow and embed.
4. **B3** calendar day view by staff, then week, resources, drag, blocks, statuses, realtime, virtualisation.
5. **B4** business page, then SEO and sitemap, then the restaurant variant.
6. **B5** several services, intake and consent, sensitive services.
7. **B6** reviews.
8. **B7** Table seating preset and the Floor view.
9. **B8** events: one off event with open registration, page, emails, guest list; then approval, waitlist, check in, recurring classes, calendar page and iCal.

Each slice gets the security, design, UX and state reviews, and screenshots in the real layout before landing.

## Consequences

- Timefix serves salons, spas, barbers, clinics, studios and restaurants with one engine; new verticals are presets (services, resource kinds, wording), not code.
- Two booking engines exist (meetings and visits), joined by the one person rule; converging them is a later decision.
- The handle namespace now holds people and businesses.
- Health related intake makes privacy load bearing: sensitive services are fenced and audited, and Timefix explicitly is not a medical record.
- 0065's `reservations` and `reservation_tables` are not built; Table seating is B7.

## Follow-up

- Classes and group sessions; deposits and no show fees; text messages; waitlist; packages, memberships and gift cards; discovery marketplace; staff day by email; rebook reminders; POS, tips; static map image; converging booking pages into services.
- `/sync` to add a visits area to AGENTS.md once B0 lands.

## Rationale

See [rationale.md](rationale.md).
