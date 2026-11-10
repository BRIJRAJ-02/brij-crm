# 0066 rationale

## Context

On 4 Nov 2026, while Table seating (0065) was being designed, the owner asked for the table booking to be built "in a format that is scalable to many other services", like Fresha, "or also for clinics, doctors", and for Fresha style public pages for restaurants and other businesses (reference: a Fresha venue page for a Bengaluru hair studio). The owner then asked for everything to be thought through twice.

Fresha's model is the reference: a venue with services (categories, variants, lengths, "from" prices), a team (who does what, shifts), resources (rooms, chairs), a booking flow that starts from a service ("Any professional" first), a calendar with a column per staff member, clients with history, verified reviews, and a public venue page with gallery, rating, services, team, reviews, about, hours and location.

Timefix today books meetings with members (booking pages). Every guard is per member, slots come from a member's schedule and calendar, and there is no service catalogue, no non member staff, no resources (0065 H0 adds places, areas and resources), and no business page (link pages are per person).

## Options considered

### One engine or one per vertical
1. **Separate engines (tables, appointments, classes).** Each is simpler alone, but the same hard parts (allocation, guards, shifts, reminders, manage links, calendar, realtime) get built three times and drift.
2. **One visit engine, verticals as presets (chosen).** A visit item needs staff, resources or both; tables are a party fitted resource with no staff; a salon cut is a staff member plus maybe a chair; a clinic visit is a doctor plus a room. New verticals become data.
3. **Fold everything into the meeting engine (booking pages).** Most reuse on paper, but booking pages are member centric through and through (host NOT NULL, about 60 call sites). Converging later, once the visit engine is proven, is safer.

### Staff who are not members
Salons have stylists who never open a laptop; charging a seat for each would kill adoption. Staff profiles exist without a login; linking to a member is optional and makes the person one across both engines.

### The one person rule
A clinic doctor who also takes sales calls through a booking page would otherwise be double booked. Sharing the `host:<memberId>` lock and reading each engine's holds as busy in the other closes it; a race test proves it.

### Allocation
"Any professional" picks the least booked qualified person that day, which spreads work fairly and matches what salons expect; ties fall back to the order the owner set. Resources use best fit, like 0065. The search is bounded so a pathological catalogue cannot stall the public page.

### Business page location
Fresha venue pages live on fresha.com. Ours live in the handle namespace on timefix.com (and later the business's own domain, 0064), so a business shares one short address across Instagram, Google and print, and link pages and business pages never clash.

### Maps
An embedded map adds a third party origin, tracking and a CSP exception on every visit. Directions links give the same practical value; a static image through our server can come later.

### Reviews
Only completed visits can review, which is what makes Fresha's reviews trusted. Owners can reply and report, never delete, or the rating means nothing.

### Health data
Clinics bring special category data. Fencing sensitive intake to the treating staff and managers, never filing it onto People, never sending it in webhooks, auditing every read, and stating plainly that Timefix is not a medical record keeps the product honest without becoming an EHR.

### Events (Luma)
The owner then pointed at Luma: event pages with a cover, date, hosts and one Register button, guest lists with approval and check in, and calendar pages a community subscribes to. Classes are the same thing repeating. Events reuse the visit engine's holds for their hosts and room (a class blocks the teacher and the studio) but count registrations against a capacity instead of holding a resource per guest, which also covers group sessions that 0062 L4's seats would have handled for meetings.

## Calls made on the owner's behalf

- News and offers from a reservation are double opt in (10 Nov 2026): the address was typed by an anonymous visitor, so only its inbox can say yes. The link lasts 7 days, long enough to find the email and short enough that an old one can't be reused.
- A confirm from the inbox outweighs an earlier withdrawal, because it is the inbox's owner acting now; a tick alone still never does.
- Durable reservation limits live in `auth.rate_limit` because the in memory limiter holds per instance and forgets on every restart. The per place limit counts only checked input, so a flood of junk can't close a restaurant's bookings.
- One engine with presets; Table seating rebuilt as a preset (0065's reservation tables dropped).
- Staff without login; optional member link.
- Least booked "Any professional".
- Business pages in the handle namespace.
- No embedded maps.
- Verified reviews only, replies yes, deletion no.
- Several services per visit (up to 5) in B5, not the first thread.
- Pay at the venue until Stripe lands.
- Events as B8 of this spec (not a separate spec): free registration first, paid tickets after Stripe; guest avatars on event pages are opt in.

## References

- Fresha venue page reviewed 4 Nov 2026 (fresha.com/a/hair-fixr-studio-sahakarnagar-…): gallery, rating, section tabs, services by category with length and from price, team, reviews, about, hours, map, sticky book panel, nearby venues.
- Owner's layout references (menu editor, guest menu, item sheet, table tiles with timers, table detail with guests and timeline): kept with the hospitality notes.
- Specs: 0035 availability, 0057 questions, 0060 brand kit, 0062 L1 requests and cutoffs, 0063 forms, 0064 public platform and domains, 0065 Hospitality suite (places, resources, apps), 0165 consent records.
- Luma (luma.com), event and calendar pages, reviewed by reference on 4 Nov 2026.
- schema.org types: Restaurant, HairSalon, BeautySalon, DaySpa, MedicalClinic, Dentist, HealthClub, LocalBusiness.
