# Integrations

Everything that connects the CRM to the outside: email, calendar, sending, sequences, enrichment, forms, Slack, Zapier and other CRMs. All of it comes after the first release. See [index.md](index.md) for the house rules and the full order.

## Slice 12: Email, calendar and booking

### 43. Email sync · needs a decision · GA
Connect a mailbox so conversations land on the right people and companies automatically.
**Done when:** a member connects Gmail or Outlook; messages match people by address and companies by domain; missing people and companies can be created; each member chooses whether their mail is shared or private; threads show on timelines, live as mail arrives.
- [ ] Design it (spec): `/architect email sync`

### 44. Calendar sync · GA · planned
Meetings show up on the records of the people in them, and booking can read and write each member's calendar.
**Done when:** a member connects a Google or Outlook calendar; past and upcoming meetings appear on every attendee's timeline, live as they change; unknown attendees can be created as people; each member chooses whether their meetings are shared or private; free and busy times can be read, and events created, moved and cancelled, for round robin and booking (#58, #59); a calendar that disconnects or expires says so and never silently stops.
- [x] Design it (spec): `/architect calendar sync`
- [ ] Build it: `/develop calendar sync`
  - [ ] Milestone 1: Google meetings on timelines
  - [ ] Milestone 2: live, private and unknown attendees
  - [ ] Milestone 3: free and busy, and events
  - [ ] Milestone 4: Outlook
- Spec [0024](../specs/0024-calendar-sync/index.md)

### 58. Round robin assignment · needs a decision · GA
Share new leads and meetings fairly across a team, automatically.
**Done when:** an admin sets up a rotation of members, with optional weights, caps per day and per member availability (working hours, time off, and calendar free or busy from #44); a new record from a form, a booking or an import can be given an owner by the rotation, or by rules first (for example by region or company size) and the rotation as the fallback; an existing customer goes back to their current owner instead of the rotation; assignment stays fair and never gives the same lead to two members, even when many arrive at once; every assignment says why it went to that member; members see their share and admins can rebalance.
- [ ] Design it (spec): `/architect round robin assignment`
- Rules first routing by qualification and meeting type, shared with forms: spec [0043](../specs/0043-lead-routing/index.md) (Proposed)

### 59. Booking pages · GA · planned
Let people outside the workspace book time with a member or a team, and land every booking on the right records.
**Done when:** a member shares a booking page that offers free slots from their connected calendar (#44), with meeting length, buffers, minimum notice, a booking window and daily limits; a team page books round robin across members (#58) or at a time all required members are free; the visitor picks a slot in their own time zone and answers a few questions; the booking creates the calendar event with a video link where the calendar provides one, matches or creates the person and company, puts the meeting on their timelines, and can create or move a deal; the visitor gets a confirmation, reminders before the meeting, and links to cancel or reschedule; two visitors picking the same slot at once never both get it; abuse is rate limited.
- [x] Design it (spec): `/architect booking pages`
- [ ] Build it: `/develop booking pages`
  - [ ] Milestone 1: a personal page books a meeting
  - [ ] Milestone 2: emails, questions, deals and changing a booking
  - [ ] Milestone 3: teams and the forms hand off
- Spec [0025](../specs/0025-booking-pages/index.md)

### 45. Send email from records · needs a decision
Write and send email from any person or company, through your own connected mailbox.
**Done when:** a member composes from a record, with templates and variables filled from its attributes; the email is sent from their own mailbox and lands on the timeline; replies thread back onto the record.
- [ ] Design it (spec): `/architect send email from records`

## Slice 13: Sequences

### 46. Sequences · needs a decision
Multi step outreach that runs on its own and stops at the right moment.
**Done when:** a member builds a sequence of emails and tasks with waits between them; enrols records one by one or in bulk; a sequence stops when the person replies, books a meeting or unsubscribes; sending respects working hours and daily limits; each step's results are visible.
- [ ] Design it (spec): `/architect sequences`

## Slice 14: Enrichment

### 47. Enrichment · needs a decision
Fill in company and person details automatically from a domain or email address.
**Done when:** a new company with a domain gets its logo, description, industry, size, location and social links filled in; people get job title and profiles where available; enriched values never overwrite what a person typed; enrichment counts against the plan.
- [ ] Design it (spec): `/architect enrichment`

## Slice 15: Forms, Slack and Zapier

### 48. Forms · GA · in-progress
Public web forms that feed the CRM: each submission becomes linked records, lands on their timelines, gets an owner, and can hand the visitor straight to a booking page.
**Done when:** a member builds a form from an object's attributes, each question using that attribute's one field design and validation rules, with show or hide logic and multiple steps, and previews it; publishing shares it as a link or embeds it on a website (inline or popup), and edits stay in a draft until republished; one submission creates or updates several linked records (the person matched on email, their company matched on the email's domain, and optionally a deal or a list entry), never overwriting what someone typed unless the form says to; hidden fields capture UTM tags and the page the form sat on, and answers can be prefilled from the link; each submission is kept on the form and on the records' timelines, can be given an owner by round robin (#58), can notify chosen members, and can route the visitor to a booking page (#59) picked by their answers; spam and bots are filtered without a puzzle for most people, consent text is recorded with each submission, and submissions count against the plan.
- [x] Design it (spec): `/architect forms`
- [ ] Build it: `/develop forms`
  - [ ] Milestone 1: a hosted form makes a person (builder, versions, public submit, bot checks, processing job, timeline), AC-545 to AC-566, AC-583 to AC-587
  - [ ] Milestone 2: linked records, owners, notices, booking routing, review and spam flows, plan caps, consent, AC-547, AC-551, AC-559 to AC-579
  - [ ] Milestone 3: forms on any website (sites, embed script, popups, capture, browser retry, file questions, custom domains), AC-587 to AC-593
  - [ ] Milestone 4: analytics and consented tracking (counters, funnel, drop off, sources, outcomes, page views on timelines), AC-580 to AC-582, AC-594 to AC-596
- [ ] Verify it: `/check verify forms`
- [ ] Test it: `/test forms`
- [ ] Review it (fresh model): `/check review forms`
- [ ] Document it: `/document forms`
Spec [0023](../specs/0023-forms/index.md); Show when and routing rules: spec [0043](../specs/0043-lead-routing/index.md) (Proposed)

### 49. Slack and Zapier · needs a decision
Connect the CRM to the tools customers already use.
**Done when:** a workspace connects Slack and gets the alerts it chooses in a channel; a Zapier connector offers triggers (record created or changed) and actions (create or update a record) over the public API.
- [ ] Design it (spec): `/architect Slack and Zapier`

## Slice 16: Other CRMs

### 50. CRM connectors · needs a decision
Move in from HubSpot, Salesforce or Zoho, and optionally stay in sync with them.
**Done when:** a workspace imports objects, fields and records from a connected CRM through a mapping it reviews; optional two way sync keeps mapped fields current; a conflict where both sides changed waits for a person; deletes are never pushed to the other side; each connection shows its last sync and its errors.
- [ ] Design it (spec): `/architect CRM connectors`
