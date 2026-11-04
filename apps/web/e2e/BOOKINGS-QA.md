# Bookings QA checks

The bookings "bulletproof before release" set (4 November 2026), written off `car/forms`. A test marked **BUG** fails
today on purpose: it is a real defect, left red until it is fixed. Everything else passes and guards a behaviour that
already holds.

## Run it

```bash
# Pure checks
pnpm --filter @crm/contracts exec vitest run src/booking/qa-bookings.test.ts
pnpm --filter @crm/api exec vitest run src/public/qa-bookings.test.ts
pnpm --filter @crm/data exec vitest run src/bookings/qa-bookings.test.ts
# Postgres on 5433
pnpm --filter @crm/core exec vitest run src/booking/qa-bookings.test.ts
# Flows, against a running app (pnpm dev, or a preview: FLOW_BASE_URL=http://localhost:5700)
pnpm --filter @crm/web exec playwright test e2e/bookings-qa.flow.ts --project=1280
FLOW_PHONE_BROWSER=webkit pnpm --filter @crm/web exec playwright test e2e/bookings-qa.flow.ts --project=1280 -g phone
```

Every local visitor shares one address, so running the flow file more than once a minute meets the 60 reads a minute
per address limit (the page then says "This page didn't load", see B-18).

## The bugs

| Id   | Severity | What                                                                                                    | Test                                                                  | Owner          |
| ---- | -------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| B-01 | should   | A 62 day slots read over a clock going back is refused, so a long window shows no times for two months  | contracts `the slots reads the public page sends, across a clock change` | contracts / UI |
| B-02 | should   | No booking instance ceiling, per email limit or IPv6 /64 key                                            | api `the limits a flood of bookings meets`                            | API            |
| B-04 | should   | The bot check trusts `startedAt` when the ticket is left out                                            | api `the bot check on a booking`                                      | API            |
| B-06 | should   | A web address in the visitor's name goes out in guest invitations (phishing from our domain)            | contracts `a visitor's name`                                          | contracts      |
| B-07 | should   | CR, LF and control characters in the name reach mail subjects and the .ics                              | contracts `a visitor's name`                                          | contracts      |
| B-08 | should   | A phone page takes "call me" as the number to call                                                      | contracts `a number to call`                                          | contracts      |
| B-09 | should   | The .ics attendee CN isn't quoted: a colon in a name changes the attendee's address                     | core `the calendar file`                                              | core           |
| B-10 | low      | An invitation only page still answers its slots to anyone with the plain address                        | core `an invitation only page`                                        | core           |
| B-11 | should   | Guests can be invited to a request the host hasn't confirmed                                            | core `a request the host hasn't answered`                             | core           |
| B-12 | low      | An email with spaces around it is refused by the API (trim runs after the check)                        | contracts `a visitor's email`                                         | contracts      |
| B-13 | low      | A guest link shows the visitor's email, guests and note forever                                         | core `what an old guest link still shows`                             | core           |
| B-14 | should   | The keyboard path from a chosen time to Book is 16 Tab stops                                            | flow `books with the keyboard alone` (fixed, lane P)                  | UI             |
| B-16 | nice     | Times are 42px tall at 390, under the 44 a finger wants                                                 | flow `every day and time is at least 24 by 24` (fixed, lane P)        | UI             |
| B-17 | should   | With live updates connected, a new public booking never reaches an open Bookings screen until refocus   | data `a booking made on the public page reaches the owner's open Bookings screen` | API + data |
