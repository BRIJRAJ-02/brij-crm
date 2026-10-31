# Integrations

Everything that connects the CRM to the outside: calendar, booking, round robin, routing, forms, Slack, Zapier, other CRMs, and last of all email and sequences. See [index.md](index.md) for the house rules and the full order.

## Slice 12: Calendar and booking

### 44. Calendar sync · GA · done
Meetings show up on the records of the people in them, and booking can read and write each member's calendar.
**Done when:** a member connects a Google or Outlook calendar; past and upcoming meetings appear on every attendee's timeline, live as they change; unknown attendees can be created as people; each member chooses whether their meetings are shared or private; free and busy times can be read, and events created, moved and cancelled, for round robin and booking (#58, #59); a calendar that disconnects or expires says so and never silently stops.
- [x] Design it (spec): `/architect calendar sync`
- [x] Build it: `/develop calendar sync`
  - [x] Milestone 1: Google meetings on timelines
  - [x] Milestone 2: live, private and unknown attendees
  - [x] Milestone 3: free and busy, and events
  - [x] Milestone 4 and 5: Outlook, and several calendars per account (the follow up migration that drops the old columns is left)
  - [x] Quick actions on the week: book, block and hold (spec 0027)
- [ ] Verify it: `/check verify calendar sync`
- [x] Test it: `/test calendar sync`
Spec [0024](../specs/0024-calendar-sync/index.md), [0027](../specs/0027-calendar-quick-actions.md) · code in `packages/core/src/calendar/`, `apps/api/src/calendar/`, `apps/web/src/features/bookings/`

### 58. Round robin assignment · GA · done
Share new leads and meetings fairly across a team, automatically.
**Done when:** an admin sets up a rotation of members, with optional weights, caps per day and per member availability (working hours, time off, and calendar free or busy from #44); a new record from a form, a booking or an import can be given an owner by the rotation, or by rules first (for example by region or company size) and the rotation as the fallback; an existing customer goes back to their current owner instead of the rotation; assignment stays fair and never gives the same lead to two members, even when many arrive at once; every assignment says why it went to that member; members see their share and admins can rebalance.
- [x] Design it (spec): `/architect round robin booking`
- [x] Build it: `/develop round robin booking`
  - [x] A round robin page books the fairest free member, and collective stops double booking
  - [x] Control and change: priority, calibration, reassign, removing a member (Settings › Scheduling › Rotations)
  - [x] Forms: a form submission gets an owner by the rotation
- [x] Test it: `/test round robin booking`
Spec [0029](../specs/0029-round-robin-booking/index.md) · code in `packages/core/src/rotation/` · rules first routing is #65. Still open from the plan: a fixed host plus rotation, and owners on import (P4.5).

### 59. Booking pages · GA · done
Let people outside the workspace book time with a member or a team, and land every booking on the right records.
**Done when:** a member shares a booking page that offers free slots from their connected calendar (#44), with meeting length, buffers, minimum notice, a booking window and daily limits; a team page books round robin across members (#58) or at a time all required members are free; the visitor picks a slot in their own time zone and answers a few questions; the booking creates the calendar event with a video link where the calendar provides one, matches or creates the person and company, puts the meeting on their timelines, and can create or move a deal; the visitor gets a confirmation, reminders before the meeting, and links to cancel or reschedule; two visitors picking the same slot at once never both get it; abuse is rate limited.
- [x] Design it (spec): `/architect booking pages`
- [x] Build it: `/develop booking pages`
  - [x] Milestone 1: a personal page books a meeting
  - [x] Milestone 2: emails, questions, deals and changing a booking
  - [x] Milestone 3: teams and the forms hand off
  - [x] The visitor's own calendar on top of the slots (spec 0028)
  - [x] Book by chat on the public page (spec 0042)
- [ ] Verify it: `/check verify booking pages`
- [x] Test it: `/test booking pages`
Spec [0025](../specs/0025-booking-pages/index.md), [0028](../specs/0028-booking-visitor-calendar.md), [0042](../specs/0042-booking-chat/index.md) · code in `packages/core/src/booking/`, `apps/api/src/public/`, `apps/web/embed/v1.js` · the public `/b/:key` page is frozen apart from the approved team rail. Next from the plan: embed snippets in the page editor (lane `wip/embed-snippets`), custom questions, reminder timing, Zoom, out of office.

### 64. Availability schedules · GA · in-progress
Several named schedules per person (working hours, date overrides), and each booking page picks one.
**Done when:** a member keeps several schedules and picks one per booking page; admins can set schedules for members; booking reads the schedule, with nothing left on the old per member hours.
- [x] Design it (spec): `/architect availability schedules`
- [ ] Build it: `/develop availability schedules`
  - [x] Schedules behind today's screens
  - [x] The list and the editor
  - [ ] Admins and the contract (the admin choice is built; the clean up migration that drops `hours_mode` and `booking_member_hours` is left)
- [x] Test it: `/test availability schedules`
Spec [0035](../specs/0035-availability-schedules/index.md) · code in `apps/web/src/routes/w.$slug.bookings_.availability.$scheduleId.tsx`

### 65. Lead routing · done
One rule format for forms and team booking pages: send a visitor to the right page or host by their answers, and show or hide questions with Show when.
**Done when:** a form or team page routes by rules first and the rotation as the fallback; every decision is stored once and explains itself; a report shows where leads went.
- [x] Design it (spec): `/architect lead routing`
- [x] Build it: `/develop lead routing`
- [x] Test it: `/test lead routing`
Spec [0043](../specs/0043-lead-routing/index.md) · code in `packages/core/src/routing/`, `apps/web/src/features/routing/`

### 66. Team calendar · planned
See the whole team's day on Bookings, one column per member, and act on a teammate's column.
**Done when:** a Me or Team switch shows one column per visible member; an admin books, moves or reassigns in a teammate's column; round robin bookings show who got them; it stays fast with many members.
- [x] Design it (spec): `/architect team calendar`
- [ ] Build it: `/develop team calendar`
  - [ ] See the team's day
  - [ ] Act on a teammate's column
  - [ ] Round robin and scale
Spec [0030](../specs/0030-team-calendar/index.md)

## Slice 14: Enrichment

### 47. Enrichment · dropped
Fill in company and person details automatically from a domain or email address.
**Done when:** a new company with a domain gets its logo, description, industry, size, location and social links filled in; people get job title and profiles where available; enriched values never overwrite what a person typed; enrichment counts against the plan.
Taken out of the plan by you on 23 October 2026 (it needs a paid provider).

### 67. Company logos and company from email domain · in-progress
The free part of enrichment: a company shows its own site's icon, and a person with a work email is linked to the company holding that domain, made when none does. From the owner's 30 October 2026 parity list.
**Done when:** a company with a domain shows its site's icon everywhere its picture shows, served from our own address; a person written by any path with a work email and no Company is linked to the company holding the domain, or a new one named from it; free mail domains never do this; a Company someone set is never replaced; the app offers Undo.
Spec [0059](../specs/0059-company-logos-email-domain/index.md)
- [x] Design it (spec): `/architect company logos and company from email domain`
- [ ] Build it: `/develop company logos and company from email domain`
  - [ ] Milestone 1: filing in the engine for every write path, with its answer field, AC-5911 to AC-5919
  - [ ] Milestone 2: Undo and live updates in the app, AC-5920, AC-5921
  - [ ] Milestone 3: the logo route and company pictures, AC-5901 to AC-5907
- [ ] Verify it: `/check verify company logos and company from email domain`
- [ ] Test it: `/test company logos and company from email domain`

## Slice 15: Forms, Slack and Zapier

### 48. Forms · GA · in-progress
Public web forms that feed the CRM: each submission becomes linked records, lands on their timelines, gets an owner, and can hand the visitor straight to a booking page.
**Done when:** a member builds a form from an object's attributes, each question using that attribute's one field design and validation rules, with show or hide logic and multiple steps, and previews it; publishing shares it as a link or embeds it on a website (inline or popup), and edits stay in a draft until republished; one submission creates or updates several linked records (the person matched on email, their company matched on the email's domain, and optionally a deal or a list entry), never overwriting what someone typed unless the form says to; hidden fields capture UTM tags and the page the form sat on, and answers can be prefilled from the link; each submission is kept on the form and on the records' timelines, can be given an owner by round robin (#58), can notify chosen members, and can route the visitor to a booking page (#59) picked by their answers; spam and bots are filtered without a puzzle for most people, consent text is recorded with each submission, and submissions count against the plan.
- [x] Design it (spec): `/architect forms`
- [ ] Build it: `/develop forms`
  - [x] Milestone 1: a hosted form makes a person (builder, versions, public submit, bot checks, processing job, timeline), AC-545 to AC-566, AC-583 to AC-587
  - [ ] Milestone 2: linked records, owners, notices, booking routing, review and spam flows, plan caps, consent, AC-547, AC-551, AC-559 to AC-579. Person, company and deal filing, owners by rotation, the emails and the booking hand off are built; stored consent, form settings, plan usage and the list entry target are left
  - [x] Milestone 3: forms on any website (sites, embed script, popups, capture, browser retry, file questions, custom domains), AC-587 to AC-593. Built with a lighter design: `embed/v1.js` does inline, popup, a corner button and capture of a site's own form, with allowed sites per form; file questions and custom domains are left
  - [ ] Milestone 4: analytics and consented tracking (counters, funnel, drop off, sources, outcomes, page views on timelines), AC-580 to AC-582, AC-594 to AC-596
- [ ] Verify it: `/check verify forms`
- [x] Test it: `/test forms`
- [ ] Review it (fresh model): `/check review forms`
- [ ] Document it: `/document forms`
Spec [0023](../specs/0023-forms/index.md); Show when and routing rules: #65, spec [0043](../specs/0043-lead-routing/index.md) · code in `packages/core/src/forms/`, `apps/web/src/features/forms/`, `apps/web/src/features/captures/` · next from the plan: more question types, a Steps layout, partial answers and the funnel (P4.3)

### 49. Slack and Zapier · needs a decision · planned
Connect the CRM to the tools customers already use.
**Done when:** a workspace connects Slack and gets the alerts it chooses in a channel; a Zapier connector offers triggers (record created or changed) and actions (create or update a record) over the public API.
- [ ] Design it (spec): `/architect Slack and Zapier`

## Slice 16: Other CRMs

### 50. CRM connectors · needs a decision · planned
Move in from HubSpot, Salesforce or Zoho, and optionally stay in sync with them.
**Done when:** a workspace imports objects, fields and records from a connected CRM through a mapping it reviews; optional two way sync keeps mapped fields current; a conflict where both sides changed waits for a person; deletes are never pushed to the other side; each connection shows its last sync and its errors.
- [ ] Design it (spec): `/architect CRM connectors`

## Last: Gmail and outreach

You moved these to the very end on 23 October 2026, after everything else in the plan. Gmail needs Google's restricted scope assessment before it can ship.

### 43. Email sync · needs a decision · planned · GA
Connect a mailbox so conversations land on the right people and companies automatically.
**Done when:** a member connects Gmail or Outlook; messages match people by address and companies by domain; missing people and companies can be created; each member chooses whether their mail is shared or private; threads show on timelines, live as mail arrives.
- [ ] Design it (spec): `/architect email sync`

### 45. Send email from records · needs a decision · planned
Write and send email from any person or company, through your own connected mailbox.
**Done when:** a member composes from a record, with templates and variables filled from its attributes; the email is sent from their own mailbox and lands on the timeline; replies thread back onto the record.
- [ ] Design it (spec): `/architect send email from records`

### 46. Sequences · needs a decision · planned
Multi step outreach that runs on its own and stops at the right moment.
**Done when:** a member builds a sequence of emails and tasks with waits between them; enrols records one by one or in bulk; a sequence stops when the person replies, books a meeting or unsubscribes; sending respects working hours and daily limits; each step's results are visible.
- [ ] Design it (spec): `/architect sequences`
