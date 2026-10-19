# 0025. Booking pages: rationale

## Context

Booking is the step after a qualified lead: the visitor picks a time, and the meeting lands on the right records. It has to read members' real calendars (spec 0024), never double book, work in the visitor's time zone, and connect to forms (spec 0023), which already hand a booking page a prefilled visitor. Like forms, it is a public surface on the open internet. The owner asked on 19 October 2026 for this spec to be written with the recommended answer to every open question, and to skip round robin (#58) for now.

## Options considered

### Option 1: build it in the CRM on spec 0024 and the forms public bundle (chosen)

**Pros**: one stack and host; records, timelines, deals and forms are joined without an integration; full control of the booking rules and privacy.
**Cons**: slot logic, time zones and emails to build and keep right.

### Option 2: embed a scheduling vendor (Calendly, Cal.com) and receive webhooks

**Pros**: mature scheduling, little to build.
**Cons**: another vendor and bill per member; questions can't use the CRM's fields; the forms hand off and deal steps become integration glue; visitor data in a third place.

### Option 3: self host Cal.com beside the CRM

**Pros**: open source, full featured.
**Cons**: a second large app, database and deploy to run, for a team that runs one.

## Rationale

Option 1 reuses what already exists (the forms public bundle, bot checks, matching, the jobs runner, the calendar adapter) and keeps bookings inside the CRM's data. Double booking is the failure that matters most: an advisory lock per host serialises bookings and rechecks the slot, and a Postgres exclusion constraint on the booking's time range is the last guard if anything bypasses the lock.

Calls made without a question, each with its runner up:
- Collective team pages now, round robin later (runner up: build a simple rotation now), as the owner skipped #58.
- Server computed slots cached 60 seconds per page and day (runner up: compute in the browser), so busy times never reach the public.
- Resend for email (runner up: the provider's invite alone), since it is the stack's chosen email provider; the calendar invite covers the gap until it is set up.
- A booking stays confirmed when its event fails to create (runner up: refuse the booking), so a provider outage never loses a booked visitor.

## References

- PostgreSQL exclusion constraints with range types: https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT
- Resend with React Email: https://resend.com/docs/send-with-nodejs
