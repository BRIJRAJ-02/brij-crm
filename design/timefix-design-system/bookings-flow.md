# Bookings flow

The one flow this module exists for: **a host makes a booking page, shares it, a guest books, and the host handles the meeting.** This page is the critical thinking behind its design: what goes wrong today, the principles, the flow step by step, and what was cut.

## The job

- **Host's job:** "Let people book time with me without the back-and-forth, and know what to do when they do."
- **Guest's job:** "Pick a time that works and be sure it's booked." Guests come once, often on a phone, and owe us nothing.
- **Success:** a new host shares a working link in under two minutes, with no setup they don't understand, and every later change is one obvious place away.

## What goes wrong today (main, 9 Nov)

1. **Two doors to the same room.** Availability and booking pages each live at two addresses; five of the module's eleven routes only redirect. Hosts can't form a map of where things are.
2. **The editor front-loads everything.** A new page opens into about fifteen cards across tabs (details, link, requests, five separate sharing cards, meeting, hours, limits, hosts, after booking, answers object, appearance, versions, publish, discard, restore). Basics and rare settings have equal weight, so nothing reads as "do this first".
3. **No "it works" moment.** Creating a page doesn't end with "your page is live, here's the link"; the host is left in settings, unsure whether guests can book.
4. **The guest is invisible.** The host edits fields without seeing what a guest sees, so every change is a guess.
5. **Words the host has to learn:** schedule, rotation, destination, answers object, one-off link. Each is a concept to understand before acting.
6. **Versions and Publish** contradict the 9 Nov decision for booking pages (Save changes, an On/Hidden switch, no drafts) and add a state ("unpublished changes") hosts must track.
7. **Sharing is scattered** over five cards (share link, share times, embed, one-off links, link page) when sharing is one intent with a few formats.

## Principles for this flow

1. **Works with zero setup.** Every page is born bookable: working hours from onboarding, 30 minutes, Google Meet. Settings refine; they never unlock.
2. **One primary action per screen**, in ink: Create page, Copy link, Save changes, Book. Everything else is quieter.
3. **Always show the guest's view.** Creation and editing sit beside a live preview of the booking page. Changing something shows its effect at once.
4. **Progressive disclosure by frequency.** What every host sets (name, duration, location, when) is open; what some hosts set (questions, limits, hosts, after booking, look) is a closed section with a one-line summary of its current value; what few hosts set (redirects, CRM object mapping, rate limits) sits under "More options" inside its section.
5. **Plain words.** Booking page, meeting, availability, hosts, questions. No schedules, rotations or destinations in the UI; they exist only underneath.
6. **Everything is reversible.** On/Hidden instead of publish; Undo instead of confirms; Save changes stays disabled until something changed, then turns into "Saved" with a tick. Only deleting a page with upcoming meetings asks first, and says what happens to them.
7. **The same pattern twice is the same component.** The guest picker is `BookingFlow`, the meetings list is `MeetingList`, the week is `WeekCalendar`, hours are `HoursEditor`: the flow invents nothing.

## Where things live

**Bookings** has three tabs, in the order hosts need them:

- **Meetings** (the home): upcoming and past meetings, with a List / Week switch. This replaces the separate list, calendar and team-day routes.
- **Pages**: booking pages as rows: a mini preview, name, duration and location, an On/Hidden switch, Copy link, and a ⋯ menu.
- **Availability**: working hours, time off and connected calendars in one place. This replaces the two availability addresses and the calendars route.

Routing appears as a fourth tab only for teams with more than one host. Round-robin is set up on a page's Hosts section. Calendars and access also stay reachable from Settings, which links here.

## The flow, step by step

**1. Start: Meetings, empty.** The first visit shows an empty state, not an empty table: "No meetings yet. Create a booking page and share it; meetings show up here as people book." One ink button: **Create booking page**.

**2. Create: one sheet, three questions.** A wide dialog. On the left:

- **Name** is prefilled "30 min meeting" and selected, ready to type over.
- **Duration** is a set of chips: 15, 30, 45, 60 or Custom.
- **Where** is a set of chips: Google Meet, Phone, In person, Zoom.

Below them sits a summary line, "Available Mon–Fri, 9:00 AM – 5:00 PM, India time · Change", which opens the hours inline.

On the right is the live guest preview: the real `BookingFlow` at a smaller scale, updating as the host types.

The primary action is **Create page**. Nothing else is asked. If no calendar is connected, a quiet line says "Connect a calendar so guests never book over your meetings · Connect". It never blocks.

**3. The "it works" moment.** The sheet slides (page side-by-side) to: ✓ "Your page is live", then:

- the link in a field with **Copy link** (which morphs to "Copied");
- three secondary options: **Email it**, **Add to website** and **Add to link page**;
- a ghost link: "See it as a guest".

Done closes the sheet onto the Pages tab, where the new row drops in at the top with a soft wash.

**4. Share, any time later.** Every page row and the editor header have one **Share** button, opening one popover:

- Copy link
- Offer specific times (pick slots to paste into an email)
- One-time link
- Embed on a website
- Add to link page

Five cards become one menu, ordered by how often each is used.

**5. Edit: one scroll, sections with summaries.** Opening a page shows a two-column editor: sections on the left, live preview on the right.

| Section | Summary when closed | Holds |
| --- | --- | --- |
| **Basics** (always open) | none | Name, link, duration, location, description |
| **When** | "Mon–Fri, 9–5 · 15 min buffer · book up to 60 days ahead" | Hours (yours or custom), buffers, notice, limits, time off |
| **Who** | "You" / "Round robin · 3 hosts" | Hosts, round robin, who can book |
| **Questions** | "Name, email + 2" | The booking form, built with `QuestionList` |
| **After booking** | "Confirmed at once · added to People" | Confirm first, notifications, add to CRM, then show / redirect |
| **Look** | "Calm · blue" | Guest look, accent, photo |

A sticky footer holds **Save changes**, disabled until something changes; saving shows a "Changes saved" toast. The header holds the page name, the On/Hidden switch, **Share** and ⋯ (Duplicate, Delete). There are no versions, drafts or publish.

**6. The guest books.** The calm `BookingFlow`:

1. Pick a day, then a time. The time splits into time + Next.
2. Fill in name, email and the page's questions.
3. **Book** shows a success check, "You're booked" and add-to-calendar buttons.

The time zone and the 12h/24h clock are always visible. Errors shake once and say how to fix them.

**7. The host sees it.** A notification arrives ("Maria Bell booked Demo · 45 min"). In Meetings the new row drops in with a wash under its day; the count rolls. Opening it shows a drawer with:

- time, guest, location with **Join**, and the answers;
- the linked CRM record, if any;
- actions: **Reschedule** and **Cancel**. Cancel collapses the row to "Cancelled · Undo", and the guest is emailed only after the undo window.

## Edge cases designed in

- **No calendar connected.** The page works; a warning line on Availability and in Create says why connecting helps. It never blocks.
- **A conflict appears** (a busy block lands on a booked meeting). The meeting card shows "2 conflicted · See conflict", which opens the week view at that hour.
- **A hidden page.** Its link shows guests "This page isn't taking bookings right now" with the host's name, not an error.
- **Deleting a page with upcoming meetings.** The only confirm: "Delete Discovery call? Its 3 upcoming meetings stay booked."
- **Time zones.** Guests see their own zone, detected and changeable. Hosts see theirs. A meeting shows both when they differ.
- **A team page with no hosts available.** Who shows a warning summary; the page row shows "Guests can't book: no hosts available · Fix".
- **Slow network.** Skeletons hold the final layout; Save shows a spinner inside the button; nothing jumps.

## What was cut, and why

- **Versions, drafts and Publish** for booking pages: they replaced one switch with a workflow; On/Hidden plus Save changes covers it.
- **Separate calendar, list and team-day routes**: one Meetings tab with a List / Week switch.
- **Five sharing cards**: one Share menu.
- **"Schedules" as a visible concept**: a page uses your hours or custom hours, chosen inside When. Named schedules stay available under When → "Use saved hours".
- **The answers-object mapping card**: moved into After booking → "Add to CRM", shown as a sentence ("Add guests to People, and link the meeting to their company").

## Full feature map: every Bookings feature, and where it lives

Everything the module does on main today keeps a home. The rule: each feature sits where the person already is when they need it, never in its own screen unless it is a job of its own.

### Meetings (the home)

| Feature | Where it lives in the new design |
| --- | --- |
| List, week and team day views | A List / Week / Team day switch. Team day puts members side by side for one day. |
| Filter whose meetings | A Mine / Everyone / one person switch, remembered per workspace. |
| Bookings only, or every calendar | In Week view, a switch between bookings only and all calendars (busy blocks drawn hatched). |
| Upcoming, past, cancelled | Tabs above the list, each with a count. |
| Requests waiting for you (pages set to "Confirm first") | A "Needs your OK" group at the top, each with **Confirm** and **Decline**. Decline asks one question with an optional reason. |
| Book a meeting yourself | **New meeting**: pick a page or a custom length, a time, who it's with (from People), extra guests and the location. |
| Block or reserve time | Drag across empty time in Week or Team day: "Block this time", "Hold for someone" or "Book a meeting". |
| Meeting drawer | Time, guest, location with **Join**, answers, notes, the linked record, activity. |
| Reschedule | From the drawer: the next two weeks of open times. The guest is told. |
| Cancel | Undo in place first; the guest is emailed after the undo window. |
| Hand to someone else | **Reassign**: a teammate, or "Next in rotation" for round robin pages. |
| No-show | **Mark as no-show** in the drawer's ⋯ menu; the meeting's tag changes. |
| Link to a CRM record | **Link to record** in the drawer: one person, company or deal, with search. |

### Pages

| Feature | Where it lives |
| --- | --- |
| Page list | Rows with a mini preview, name, length · place, who hosts, On/Hidden, **Share**, ⋯. Mine / Team switch. |
| Activity | A stats strip in the editor header: views, bookings, show rate this month. Opens the page's meetings. |
| Basics | Name, link, lengths (one or several for the guest to choose), place (one or several), description. |
| When | Hours: your working hours, a saved set of hours, or custom. Buffers before and after, minimum notice, how far ahead, limits per day and per week, and the time off that applies. |
| Who | Hosts: one person; everyone must be free (collective); or round robin with how it's shared out (equally, weighted, by priority) and this month's spread. Plus "a copy for each member" (managed pages) and who can book: anyone with the link, or only through a form. |
| Questions | The question builder (QuestionList); name and email are always asked. |
| After booking | Confirm first (bookings become requests), which calendar bookings go to, add the guest to People, then show a thank-you or go to a link, and reminders. |
| Look | Guest look (GuestLook), photo, and social links on the page. |
| Share | One menu: Copy link · Offer specific times (pick 2 to 5 times, get a link that offers only those) · One-time links (label, how many bookings, expiry; list with Revoke) · Embed on a website (EmbedPreview) · Add to link page. |
| Delete | Undo for pages with no upcoming meetings; one question when meetings stay booked. |

### Availability

| Feature | Where it lives |
| --- | --- |
| Working hours | HoursEditor. |
| Saved hours | A switch above the editor: Working hours · Weekend clinic · + New. Rename, set as default, delete (asks if pages use it). |
| Time off | A list of dates with **Add time off** (date or range, all day or hours, a note). If meetings fall inside: "3 meetings are booked then" with Reassign or Keep. |
| Calendars | Connected calendars with health (Connected, Needs reconnect, Some calendars skipped), check for conflicts, and which calendar new bookings go to. |
| Team availability | A Team week view: members down the side, the week across, working hours, time off and busy time. |

### Round robin and routing (teams)

| Feature | Where it lives |
| --- | --- |
| Round robin groups | Set up on a page's Who section. **Manage groups** opens the group list: members, who's paused, and handing a paused member's meetings on. |
| Routing | A Routing tab (teams only): rules read as sentences ("If Team size is more than 50, book Enterprise demo with Sales"), member skills, a **Test** panel that shows where a set of answers would go, and what counts as "won" in the CRM. |

### The guest's side

Booking page (BookingFlow) · request pending ("Priya will confirm your time") · their own **Manage booking** page (reschedule or cancel) · an expired one-time link · a hidden page · a page offering only specific times · the booking chat as an alternative way to book.

### Dummy workspace for the prototype

Northwind (team plan): Priya Raman (you, owner), Sam Kim, Jo Mendes, Ava Chen. Pages: Discovery call 30 min (Meet), Product demo 45 min (Zoom, confirm first), Onboarding 60 min (round robin: Sam, Jo, Ava), Quick chat 15 min (hidden), Site visit (in person, Northwind office), Support call 30 min (only through a form). About 20 meetings across last week, today and the next two weeks (a few cancelled, one no-show, two requests waiting, one clash), Jo on time off Thursday to Friday, Google Calendar connected, Outlook needing reconnect, a routing form with three rules, two one-time links, one offered-times link.

## How we'll know it works

- A first-time host shares a link in under two minutes, without opening a single closed section.
- Every setting is found in one try from its summary line (test: "Add a 10-minute buffer", "Ask for a phone number", "Let Sam take bookings too").
- Zero questions about "publish" or "schedules".
- Guests book on a phone in under 30 seconds.

The `BookingsFlow` card in Components plays this whole flow live, end to end, built only from the system's components.
