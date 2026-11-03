# Feature state: forms (0063), team scheduling (0037), and what is left

Written 3 November 2026. One list, so any chat can pick up without reading a transcript.
Everything below is a feature, not a task: what it is, whether a user can use it today,
and what it would take to finish.

**Read this first.** Three facts decide most of what you do next:

1. **`stories (firefox)` times out at 35 minutes on main.** GitHub reports a timeout as
   `cancelled`, and the deploy gate needs every library job `success` **or** `skipped`.
   So any push to main that touches `packages/ui` or `packages/tokens` **cannot deploy** —
   it waits 900s and declines. The deploy arrives on the next push **without** a library
   delta, which makes those jobs skip. Three deploys of `da6a9355c` skipped this way.
   **Do not raise the timeout and do not collapse the shards** — the two shards per engine
   exist because the stories page accumulates across files, and the timeout is the symptom.
   The same leak crashes `stories (webkit)` out of memory at a different file each run.
2. **Migrations end at `0163`.** Confirm against `origin/main` immediately before writing a
   new one; do not trust this number. `pnpm db:generate` is unusable — its drizzle snapshots
   stop at 0113, so it diffs from a stale baseline and dumps an 86–95 KB whole-schema file.
   Hand-write the SQL in the house style, as `0159`, `0160` and `0163` do.
3. **`git push` runs lefthook's pre-push hook, and that hook is the full `pnpm check`.**
   A lane that "just pushes" starts a repo-wide ESLint and tsc storm; it once took the
   owner's 8-core laptop to load 68. Use `--no-verify` and run `pnpm check` deliberately.

---

## Live on both productions

`https://brij-crm-phi.vercel.app` and `https://app.timefix.com`. Check with
`/api/health`, which returns `{"status":"ok","release":"<sha>"}`, and then check the public
pages (`/`, `/login`, `/b/:key`, `/f/:key`) — the last outage was invisible to the health
endpoint alone.

| Feature | Spec | What a user can do |
|---|---|---|
| Routing, two doors | 0037 L6 | Bookings › Routing; rules decide where a lead goes; a free time check before a booking route is answered |
| Skills and Test | 0037 L7 | Skills on members, Won means, Known (new/person/company/customer), and a Test showing which rule fires and where it sends |
| Custom roles | 0037 J9 | Roles beyond the built-ins, joined into the access door; Roles screens; the role Select on Members; read-only roles cap what a Member's rules can do |
| Managed booking pages | 0037 L10 | A template page whose locked parts propagate to each member's own page; the member's read-only view |
| Roster, New meeting, Avatar | — | Quieter legend and weekend band; From and To side by side; a loaded logo on a near-white plate so a dark logo reads in dark mode |

## On `main`, built and green, **not yet serving**

`main` is at `da6a9355c`; both productions are still on `00f3c0c38`. This is the firefox
timeout above, not a failure. `car/propagated-audit` exists to release it: it touches no
library file, so the library jobs skip, the gate settles, and the deploy carries everything
on main with it.

| Feature | Spec | State |
|---|---|---|
| Form templates gallery | 0063 slice 5 | Eleven tiles; Blank first; a template files onto fields that already exist and creates none |
| Brand kit on the hosted form | 0063 slice 9 | The workspace's colour and logo, gated on `look.theme === 'brand'` |
| Webhooks | 0064 | Endpoints, events, signing secret, rotate, test |
| Link page layout | 0063 slices 1–4 | Arrived with `car/visual`'s 64 commits |
| Form partials and visits (tables, API) | 0063 slices 6–7 | Both tables, all three public endpoints, the Analytics tab |

## Update, 3 November evening

- `car/propagated-audit` landed with `544f59588`; `car/0063-visitor` landed as `280c8b130` (rebased on main, two
  formatting fixes and the `form.created` line now reads "made the form …"). Everything in the two sections
  below is on main.
- **Spec 0061 R5 is on main** (`8861ba94c`), not unbuilt as item 4 says.
- The embed: a `handle/slug` booking frame is heard across the 308 to the apex (`8cb6793f1`); popups open at full
  size under one shared head bar, and `/embed/*` is cached five minutes instead of an hour (`82f2b212e`).

- Link pages say who they are from (job title switch, company lockup with the brand logo, a closing line above
  Powered by Timefix), migration `0164`. Embedded booking pages take their content's height (the details step
  no longer keeps the calendar's), and embed dialogs follow the visitor's light or dark setting.

## Built, pushed, **not landed**

Two branches. Land `car/propagated-audit` first — it is the one that unblocks deploys.

### `car/propagated-audit` (no library delta — this one releases the deploy)
- **`managed_page.propagated`** (0037, AC-1334). A template's locked parts overwrite every
  member page under it, and only the template was audited. An owner opening History on their
  own page found their hours rewritten with nothing saying why. One entry per page changed,
  on that page.
- **`sendResumeLink` driven for the first time.** Two cases. Nothing referenced this service
  before, which is how it carried two independent faults at once.
- `pnpm check` green, 27 of 27, locally and in CI.

### `car/0063-visitor` (library delta — expect no deploy on its own landing)
- **The hosted page counts its own visits** (0063, AC-6320/6321). Without this the Analytics
  tab reads zeros forever. `view` as the form draws with its source, `start` on the first
  answer, `reach` per question actually on screen. Classic reaches all at once; a stepped
  form counts only the step shown, which is the drop-off bar. `sendBeacon`, so the last
  question reached is reported as the visitor leaves; a keepalive `text/plain` post otherwise.
- **Save and resume, the visitor's half** (0063, AC-6319). Finish later keeps the fill and
  shows the link back with its expiry day, Copy and Email it to me. A stepped form saves on
  Continue naming the step it moves to; a Classic form over ten questions saves two seconds
  after typing stops. A resume link reopens on its step with its answers in.
- **The booking emails' origin.** `mail.ts` builds the manage button on `BOOKING_PUBLIC_ORIGIN`
  while the email is drawn against the app's. The earlier note said this made booking emails
  throw. **It does not.** `bookingDocument` treats any button off the app's origin as the
  meeting's video call, so "View your booking" would be drawn and labelled as join-the-call,
  silently, with no error anywhere. Both the document and the layout's guard now take the
  origins the email was told about — the same guard over a named list, not a wider one.
- **Lead qualification released** (AC-6316). Its three choice questions carry points.
- **`form.created` audited**, on `insertForm`, so one entry covers both the empty and the
  template path.
- **A stepped form promises a total only when it has one** (AC-6304). It showed "Step 1 of 3"
  and then gave two.
- The hosted page's CSS budget went 17 kB → 18 kB. It stood at 16.97 kB with 30 bytes of
  room, so any new UI there breached it.

---

## Not built

In the order I would take them.

### 1. Consent — spec 0023, AC-1053
A **Consent** answer type: a checkbox showing its exact wording, whose answer, wording,
wording version and time are stored as a consent record on the person. A required consent
blocks submit until ticked. **Nothing exists** — `'consent'` is not in `ANSWER_TYPES`.

Needs: the answer type and its control, the wording and version on the question, a consent
record (a migration), the builder's editor, `checkAnswers`, and the submission processing.
Roughly a lane. **This is the one with a legal shape**, and the Newsletter and Job
application templates ship today with no consent affordance at all.

### 2. Retention — spec 0023, AC-1054
Settings › Forms gains **Keep submissions**: forever (default), 12 months or 24 months. The
daily cleanup deletes older submissions and their raw answers, never the records they made.
Spam goes after 30 days whatever the setting. Needs a setting, a migration and a cleanup
phase. Pairs with consent; both are the data-protection half of 0023.

### 3. Booking intake template — 0063, AC-6315/6323
The twelfth tile, still held. **The earlier note calling this a one-line release is wrong.**
Its "ends with Book a meeting" ending needs a button naming a `bookingPageId`, and a template
cannot know one: every workspace's pages are its own and a new workspace has none. Release it
by resolving a page at draft time the way `filesOnto` resolves an attribute, and leaving the
button off where there is no page to send anyone to.

### 4. Spec 0061 R5 — the booking page's visitor wiring
AC-6110, AC-6116, AC-6126, AC-6127, AC-6131: the link page sends its facts, lazy chunks per
kind, the `at` reader, a budget check. Files: `apps/web/src/public/booking/{ProfilePage.tsx,
link-page.ts,boot.ts}`, a new `at-param.ts`, and **one call in `BookingPage.tsx`** — that one
line is the whole risk, since that file was being heavily edited for 0062 L1.

### 5. Spec 0037 L10's remaining MEDIUMs
One of four is done (the per-owner audit entry, above). Three remain; read the L10 review.

### 6. Small and cosmetic
- The points row repeats the choice words instead of sitting on the choice row
  (`OptionsEditor`).
- A cascade defect in the template tile: `.tile[data-tall] .name` loses to a later
  `[data-described] .name` of equal specificity. Fixed on the slice 8 branch; noted in case
  it reappears.

---

## Traps worth knowing before you touch any of it

- **A green can be a recording of an older green.** A test that reads across a package
  boundary with `readFileSync` does not bust that package's cache key, and `turbo.json`'s
  `test` task declares no `inputs`, so Turbo replays a stale pass.
- **`pnpm test:visual --update` silently adopts unrelated baseline drift.** Diff the baseline
  directory after every update and put back anything CI did not report as failing. The CI
  `screenshot-baselines` artifact is not safer — that job is literally `--update`.
- **A browser test's cascade is not production's.** Layer order is fixed by first appearance,
  so a test importing a component module before `styles/index.css` registers `components`
  first and leaves `reset` after it, and reset's `button { color: inherit }` then beats a
  component's own colour. Import the stylesheet first. Built pages link `/layers.css` before
  any module CSS and never have this.
- **`as unknown as DataLayer` warns about nothing.** When a screen starts reading a new slice
  the cast hides it: the screen throws, renders its error boundary, and every later locator
  misses a crashed page.
- **GitHub reads the whole commit message for `[skip ci]`, not just the subject.** Writing the
  token down to say it was absent once suppressed a run.
- **Check the tidy claims hardest.** Every wrong call on 2–3 November fitted the evidence too
  well: the contrast bug diagnosed from the code was disproved by a direct probe; the
  "one-line" template release was not one; the booking email was doing something quieter and
  worse than the note said. Read the file, the log or the pixels anyway.
