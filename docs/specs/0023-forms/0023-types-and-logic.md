# 0023. Forms: types, steps and conditions, more questions, filing, notices and routing

The owner accepted every recommendation in this spec, including its open questions, on 20 October 2026: Help shows keyboard shortcuts until a help centre exists; a page with its own hours becomes a schedule named after the page; only `booking.admin` edits a colleague's schedules; an Outlook personal account books without a Teams link and the host is told; steps go live in release 1 and one at a time in release 2; the form layout data change is accepted; sidebar changes reach the member's other tabs through the workspace `nav` event.

**Date**: 2026-10-20 (revision asked for by the owner's roadmap decisions of 20 October 2026)
**Revises**: [0023-experience.md](0023-experience.md) ("one page, no steps, no conditions"; AC-547 and AC-589 moved to Follow-up) and the contract in that file. **Aligns with**: [0023-form-design.md](0023-form-design.md) on branch `wip/formdesign` (the Classic redesign, the field checker, Steps and Conversational drawn as stories). Where this file and the experience file differ on types, steps, conditions or routing, this file wins; on the look of the visitor's page, the form design file wins.
**Owns**: AC-1031 to AC-1070.

## Summary

Forms grow from one calm page into three layouts (Classic stays the default; Steps; One at a time), with simple "show when" rules on questions and steps and no flow canvas. They get the question types people keep asking for (date, time, rating, scale, multi select with Other, address, hidden fields) and prefill from the link. Behind the form, a submission files the person's company by email domain (never for free email providers), can open a deal and join a list, tells the team per submission (or in a daily digest), can confirm to the visitor, and routes by rules to a booking page and an owner, including a round robin rotation. Analytics start with anonymous counters; consent and retention get their rules. Each part is marked below as being built now, next (Release 1) or later (Release 2).

## What is being built when

| Part | When | Where |
|---|---|---|
| Classic redesign, the field checker, "(optional)", "Choose one" | **Now** (lane `wip/formdesign`) | 0023-form-design.md |
| Steps and One at a time as library stories only | **Now** (same lane) | 0023-form-design.md |
| More question types, hidden fields, URL prefill | **Release 1** | AC-1040 to AC-1043 |
| Company by email domain with the free email rule; deal filing | **Release 1** | AC-1044, AC-1045 |
| Team notice per submission, digest opt in, visitor confirmation | **Release 1** | AC-1047, AC-1048 |
| Layout setting with Steps live; show when rules | **Release 1**, after the question types | AC-1031 to AC-1039 |
| One at a time live | **Release 2** | AC-1034 |
| Routing rules to a booking page and an owner, round robin | **Release 2** (needs spec 0029) | AC-1049 to AC-1051 |
| Anonymous analytics; consent; retention | **Release 2** | AC-1052 to AC-1054 |
| List filing | **Release 3** (needs #51 lists) | AC-1046 |
| Visitor tracking with cookies (AC-594 to AC-596), popup and slide in (AC-589) | **Later**, unchanged | index.md |

## Requirements

**User stories**:
- As a member, I want a longer form split into short steps, and some questions shown only when they apply, without drawing a flow chart.
- As a member, I want to ask for a date, a rating or several choices, and to pass a campaign or a known email in the link.
- As a member, I want a lead's company found from their work email, and a deal opened when the answers say it is worth one.
- As an owner, I want to hear about each enquiry (or once a day), and the visitor to get a copy.
- As a sales lead, I want big enquiries routed to the right person's booking page, and the rest shared fairly.

**Acceptance criteria**:

*Layouts (types)*
- **AC-1031**: A form's Settings tab has **Layout**: Classic (default), Steps, One at a time. It is part of the draft and publishes with the version, so a visitor part way through never sees the layout change under them.
- **AC-1032**: The questions list offers a **New step** divider (from the add menu, and "Start a step here" on a question) with an optional title; it drags like a question; removing one merges its questions into the step above. Breaks show only with Steps; with Classic they are kept and hidden behind a quiet note; One at a time ignores them. Publish refuses an empty step ("Step 3 has no questions. Add one or remove the step.").
- **AC-1033**: Steps on the visitor's page: "Step 2 of 3" and a progress line, Back and Continue, the last step's button reading the form's button text. Continue checks that step's shown questions with `checkAnswers`; Back keeps every answer; a step change moves focus to its first question and announces "Step 2 of 3" politely.
- **AC-1034**: One at a time shows one question per screen at heading size, Enter (or OK) continues from a single line field or a choice, Back returns, a progress line (read as "2 of 7"), the same checks and messages as Classic.
- **AC-1035**: The step layouts are not in the hosted page's bundle until a form uses one; the hosted page stays within its 220 kB JS and 16 kB CSS budget.

*Show when*
- **AC-1036**: A question or a step can have **Show when**: up to 5 rules joined by "all" or "any". A rule names an earlier question and an operator fitting its type: is, is not, is any of, contains, is answered, is empty, is more than, is less than (numbers, ratings, scales, dates). Without rules it always shows.
- **AC-1037**: One function, `isShown(document, answers)` in `packages/contracts`, decides what shows, on the page and on the server. A hidden question is never required and its answer is dropped by the server (AC-553); a step whose questions are all hidden is skipped and not counted in "Step 2 of 3".
- **AC-1038**: Publish refuses a rule that names a later or deleted question, a choice that no longer exists, or a value that doesn't fit the type, as one sentence naming both questions ("“Budget” shows when “Team size” is 50 or more, but Team size comes after it.").
- **AC-1039**: In the builder, an open question card has a **Show when** row (Add a rule, each rule as three Selects or a value Field, all or any), and the closed card carries a one line summary ("Shows when Budget is Over $10k").

*More question types*
- **AC-1040**: New answer types, each one value, each with its visitor control and what it files onto:

  | Type | Visitor control | Files onto |
  |---|---|---|
  | Date | date field with a picker; optional earliest and latest | date |
  | Time | time Select in 15 minute steps, 12 or 24 hour by locale | text |
  | Rating | 1 to 5 stars as a radio group | rating, number |
  | Scale | 0 to 10 (NPS, the default) or 1 to 5, 1 to 7, 1 to 10, as a radio group with end labels | number |
  | Multi select | checkboxes, optional minimum and maximum picks, optional **Other** with a text box | select (multiple) |
  | Address | line 1, line 2, city, region, postcode, country (the country picker) as one group | location |
  | Hidden | nothing shown; its value comes from the link or a default | text, select, number |

  Other's text is kept on the submission and never filed; the chosen options file as usual.
- **AC-1041**: Every new control is plain HTML in the public bundle, fully keyboard usable, labelled (rating and scale as radio groups named by the question, with their end labels read), meets WCAG AA, and is checked by `checkAnswers` with the server's messages.
- **AC-1042**: Any question can be prefilled from the link (`?<key>=<value>`, repeated for multi select). A prefilled visible question stays editable. A value that doesn't fit (an unknown choice, a malformed email) is ignored, never shown as an error. Hidden questions take the link's value, else their default. UTM tags, the page and the referrer are still captured on their own (AC-591). Prefill values are untrusted and checked exactly like answers.
- **AC-1043**: The builder's **Install** tab shows the link with a "Prefill" helper listing each question's key, so a member can build a link like `/f/<key>?email=…&plan=pro`.

*Filing onto the CRM*
- **AC-1044**: A People form links the person to a company by their email's domain: an existing company with that domain is linked, else one is created with the domain and a name from it. Emails at free providers (the maintained list plus the workspace's own additions in Settings › Forms) get no company, unless the form asks a Company question, whose answer then matches or creates the company by name (refines AC-559).
- **AC-1045**: A form can open a deal: off, **Create a deal** (named "<company or person> from <form name>", in a chosen stage, linked to the person and company, owned like the person), or **Use an open deal** (the person's newest open deal, else create). Deal questions file onto it. The builder offers this only to members who can write deals (AC-546).
- **AC-1046**: Once lists (#51) exist, a form can add its main record to a list with entry values (such as a stage); an entry already there is updated by the fill rule (AC-558).

*Notices*
- **AC-1047**: Each processed submission (never spam or held) sends the form's owner and its listed members an email with the answers they may see (AC-573) and a link to the submission; once #28 exists, an in app notice too. Each member can switch a form, or all forms, to one **daily digest** at the workspace's digest hour instead (refines AC-568).
- **AC-1048**: A form can send the visitor a **confirmation** (off by default): a copy of their answers (hidden questions left out), sent once per submission from the workspace's sending setup with the owner as reply to, never for spam (AC-569).

*Routing*
- **AC-1049**: The Settings tab's **After someone sends it** holds ordered **routing rules**, each built from the same rules as Show when, then a final **Otherwise**. A rule's outcome sets either or both: **Offer a booking page** (a page, or none) and **Assign to** (a member, a rotation of spec 0029, or nobody). The first matching rule wins; Otherwise applies when none does.
- **AC-1050**: A rotation outcome calls spec 0029's `assignOwner` on the new main record inside processing, so leads and meetings share one fair count; a matched record keeps its owner (AC-567). The submission records which rule matched and who was assigned and why ("Rule 2, Budget is Over $10k: Bea by rotation Sales").
- **AC-1051**: The routed booking page opens prefilled (spec 0025's hand off). When the page is round robin and the submission's new owner is in its rotation, the visitor is offered that owner's times first (spec 0029, known people to their owner). Fallbacks stay as AC-571.

*Analytics, consent, retention*
- **AC-1052**: Analytics start anonymous: views, starts, completions and drop off per step and question are counted with no cookie, no visitor id and no stored address (AC-580, AC-581 without AC-594's tracking). The form's Analytics tab shows them by day and by source (UTM, referrer).
- **AC-1053**: A **Consent** question shows its exact wording as a checkbox; its answer, wording, wording version and time are stored as a consent record on the person (AC-578, AC-579). A required consent blocks submit until ticked.
- **AC-1054**: Settings › Forms has **Keep submissions**: forever (default), 12 months or 24 months; the daily cleanup deletes older submissions and their raw answers, never the records they made. Spam is deleted after 30 days whatever the setting.

## Contract changes (`FormDocument`, `PublicForm`)

- `layout: 'classic' | 'steps' | 'conversational'` (shown as "One at a time"), default `'classic'`; `steps: { id, title?, startsAt: questionId }[]`, default `[]`. As 0023-form-design.md recommends: breaks, not nesting, so reordering never loses a question.
- `Rule = { questionKey, op, value? }`; `ShowWhen = { join: 'all' | 'any', rules: Rule[] }` (1 to 5 rules); `showWhen?: ShowWhen` on a question and on a step.
- `answerType` gains `date`, `time`, `rating`, `scale`, `multi_select`, `address`, `hidden`; per type options: `date { earliest?, latest? }`, `scale { from: 0 | 1, to: 5 | 7 | 10, lowLabel?, highLabel? }`, `multi_select { min?, max?, other: boolean }`, `hidden { default? }`. `FILES_ONTO` extends per AC-1040.
- `deal: { mode: 'off' | 'create' | 'use_open', stageOptionId? }`; `list?: { listId, values }` (Release 3).
- `routing: { rules: { when: ShowWhen, bookingPageId?, assign?: { member: id } | { rotation: id } | 'nobody' }[], otherwise: { bookingPageId?, assign? } }`, replacing `after.offerMeeting` (migrated into `otherwise`).
- `notify: { memberIds }`, `confirmation: boolean`.
- `PublicForm` gains `layout`, `steps: { title?, keys }[]`, and each question's `showWhen` and type options, resolved by `publicFormOf`. Routing, notify and deal never reach the browser.
- `publishProblem` gains the checks of AC-1032 and AC-1038, and "A routing rule points at a booking page that no longer exists."
- At most 30 questions still; at most 10 steps; at most 20 routing rules.

## Design notes

- **Where it runs**: `isShown` and `checkAnswers` are pure, in contracts, used by the public bundle, the builder preview and `processSubmission`. Routing runs in `processSubmission` after matching, inside the same transaction as the owner write, so a rotation assignment and the record agree. The booking page outcome is decided at submit (the visitor needs it at once) by `isShown`'s rule evaluator over the answers, and stored on the submission so processing can't disagree.
- **Company by domain**: the domain is the email's part after `@`, lower case, with `www.` removed; the free list is the `free-email-domains` package pinned in the catalog plus `form_settings.extra_free_domains`; matching uses Companies' unique domain attribute under the advisory lock already taken for the person (AC-562).
- **Notices**: one job `forms.notify` per processed submission (light lane), sending through the Resend wrapper; the digest is one job per member per day at `form_settings.digest_hour` in the forms time zone. Members' choices live in a new `form_notice_prefs (workspace_id, member_id, form_id null for all, mode 'each' | 'digest' | 'off')`.
- **Confirmation**: rendered with React Email, the answers as a list in question order, sent once (idempotency key = submission id).
- **Retention**: `form_settings.keep_months` (null forever, 12, 24); a phase of `maintenance.daily`.
- **Analytics**: the `form_stats` counters already planned (index.md step 22 and 23), fed by beacons with no identifier; step and question drop off keyed by step index and question key.
- **Screens**: Settings gains Layout (a SegmentedControl: Classic, Steps, One at a time, owned by the form editor's builder), Deal, Notify, Confirmation and Routing cards; routing rules are a reorderable list of rows (rule summary, outcome, menu), editing in a Panel with the Show when rule builder. All from the library, through `design-system-guardian` and `ux-interaction-reviewer`.
- **Security**: routing, notify lists and deal settings stay server side; prefill and hidden values are untrusted input checked like answers; a rotation outcome needs the publisher to be allowed to use that rotation (`booking.admin` or a rotation member), checked at publish.

## Critical test scenarios

- Steps with a hidden step: a two step form where step 2 shows only for "Budget is Over $10k"; a small budget submits after step 1 with "Step 1 of 1"; verifies **AC-1033**, **AC-1037**.
- Server agrees: a forged post with an answer to a hidden question and a missing hidden required answer is accepted with the hidden answer dropped; verifies **AC-1037**.
- Prefill: `?email=ada@acme.com&plan=unknown` fills email, ignores plan, and a hidden `utm_campaign` takes its value; verifies **AC-1042**.
- Company: ada@acme.com links Acme by domain; bob@gmail.com gets none unless the Company question is answered; verifies **AC-1044**.
- Routing: rule 1 sends Over $10k to Bea's page assigned by rotation Sales; Otherwise to the team page with nobody; the submission records the rule; verifies **AC-1049**, **AC-1050**.
- Notices: owner on each, a member on digest gets one email next morning listing three submissions; spam sends nothing; verifies **AC-1047**.
- Retention: with 12 months, a 13 month old submission is gone after the cleanup and its person remains; verifies **AC-1054**.
- Accessibility: rating, scale, multi select with Other and address by keyboard and screen reader; axe clean; verifies **AC-1041**.

## Build plan

**Release 1, part 1: question types and filing** (one thread: contracts, public bundle, builder, processing)
1. Contracts: the new answer types with their options, `FILES_ONTO`, `checkAnswers` for each, prefill parsing; public bundle controls; builder type options; satisfies **AC-1040** to **AC-1043**.
2. Processing: company by domain with the free list and workspace additions; deal create or use open; satisfies **AC-1044**, **AC-1045**.
3. Notices: `forms.notify`, `form_notice_prefs`, the digest job, the confirmation email; satisfies **AC-1047**, **AC-1048**.

**Release 1, part 2: layouts and show when**
4. Contracts: `layout`, `steps`, `ShowWhen`, `isShown`, the publish checks; server drops hidden answers; satisfies **AC-1031**, **AC-1036** to **AC-1038**.
5. Builder: New step dividers, the Show when row and summaries, the Layout control; satisfies **AC-1032**, **AC-1039**.
6. Visitor: the Steps layout from the library stories, lazy loaded; budget check; satisfies **AC-1033**, **AC-1035**.

**Release 2**
7. One at a time live; satisfies **AC-1034**.
8. Routing rules, `assignOwner` through spec 0029, the stored outcome, the known owner hand off; satisfies **AC-1049** to **AC-1051**.
9. Anonymous analytics tab; consent question; retention setting and cleanup phase; satisfies **AC-1052** to **AC-1054**.

**Release 3**
10. List filing once #51 exists; satisfies **AC-1046**.

Each part ends with a deploy, Playwright over a second browser, and the reviewers (`security-access-reviewer` for routing, prefill and notices; `state-performance-reviewer` for processing and the digest).

## Consequences

- The visitor page stops being "one page always"; Classic stays the default, so existing forms don't change.
- `isShown` becomes a shared rule language for forms; it must stay small (no nesting, no arithmetic) or it turns into the flow canvas the owner turned down.
- Routing moves the meeting offer out of `after.offerMeeting`, a contract migration of published documents (handled by reading old versions through a default).
- More email: per submission notices can be noisy for busy forms, which is why the digest exists.

## Follow-up

- [ ] Scoring and calculated answers (Release 3, roadmap).
- [ ] Partial submissions (Release 3).
- [ ] Popup and slide in (AC-589), templates and themes (Release 3).
- [ ] Visitor tracking with consent (AC-594 to AC-596), after anonymous analytics.
- [ ] Attribute rules on the visitor's page (`PublicQuestion.rules`), pending in 0023-form-design.md.

## Rationale (inline)

The owner decided on 20 October 2026: Classic stays the default; steps and conditions use a simple "show when", no flow canvas; notices per submission with a digest opt in; analytics without cookies first. Steps as breaks rather than nesting (from 0023-form-design.md) keep reordering safe and let one data shape serve all three layouts. One rule shape for Show when and routing means a member learns it once and the server evaluates both with one tested function. Runner ups: a flow canvas (Typeform logic jumps, Tally's conditional blocks), turned down by the owner; routing as its own object shared across forms (Chili Piper, Cal.com Routing forms), deferred until a customer has several forms routing the same way; per type controls from the CRM's field editors, refused because the public bundle must stay small.
