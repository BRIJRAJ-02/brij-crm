# Integrations

Everything that connects the CRM to the outside: email, calendar, sending, sequences, enrichment, forms, Slack, Zapier and other CRMs. All of it comes after the first release. See [index.md](index.md) for the house rules and the full order.

## Slice 12: Email and calendar

### 43. Email sync · needs a decision · GA
Connect a mailbox so conversations land on the right people and companies automatically.
**Done when:** a member connects Gmail or Outlook; messages match people by address and companies by domain; missing people and companies can be created; each member chooses whether their mail is shared or private; threads show on timelines, live as mail arrives.
- [ ] Design it (spec): `/architect email sync`

### 44. Calendar sync · needs a decision
Meetings show up on the records of the people in them.
**Done when:** a member connects a Google or Outlook calendar; past and upcoming meetings appear on every attendee's timeline; unknown attendees can be created as people.
- [ ] Design it (spec): `/architect calendar sync`

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

### 48. Forms · needs a decision
Web forms that create or update records, to capture leads and requests.
**Done when:** a member builds a form mapped to an object's attributes and shares it as a link or embeds it on a website; a submission creates or updates a record (matching on email or domain) and can notify someone; spam is filtered out.
- [ ] Design it (spec): `/architect forms`

### 49. Slack and Zapier · needs a decision
Connect the CRM to the tools customers already use.
**Done when:** a workspace connects Slack and gets the alerts it chooses in a channel; a Zapier connector offers triggers (record created or changed) and actions (create or update a record) over the public API.
- [ ] Design it (spec): `/architect Slack and Zapier`

## Slice 16: Other CRMs

### 50. CRM connectors · needs a decision
Move in from HubSpot, Salesforce or Zoho, and optionally stay in sync with them.
**Done when:** a workspace imports objects, fields and records from a connected CRM through a mapping it reviews; optional two way sync keeps mapped fields current; a conflict where both sides changed waits for a person; deletes are never pushed to the other side; each connection shows its last sync and its errors.
- [ ] Design it (spec): `/architect CRM connectors`
