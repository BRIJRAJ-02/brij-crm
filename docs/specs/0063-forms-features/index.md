# 0063. Forms features: layouts, question types, logic and analytics

**Date**: 2026-10-31
**Status**: Proposed

## Summary

Forms today are one long page with twelve question types, simple show when rules and no numbers on how they perform. This spec makes them as capable as Typeform and Tally while keeping what makes ours different: every answer still files straight into the CRM. Forms get three layouts (Classic, Steps, One at a time), ten new question types (date, time, date and time, rating, scale, multi select with Other, address, hidden, signature, ranking), jumps between steps, endings per outcome, a score with recall of earlier answers, a confirmation email to the visitor, save and resume, analytics with drop off per question, a template gallery, and the workspace brand kit as the form's look. "Powered by Timefix" stays. Payments, legal e signature, A/B tests and an AI builder come later.

## Requirements

**User stories**:
- As a marketer, I want a long form split into steps or asked one question at a time, so more people finish it.
- As a sales lead, I want to ask for a date, a rating, a score out of ten or a ranked list, and have each land in the right CRM field.
- As a form builder, I want questions and steps to follow earlier answers, a score that adds up, and a different ending for each outcome.
- As a visitor, I want a copy of what I sent and a way to finish a long form later.
- As the form's owner, I want to see how many people viewed, started and finished it, where they dropped off and where they came from.
- As a new user, I want to start from a ready form that already files into my CRM.

**Acceptance criteria** (AC-6301 onward; where a criterion builds an accepted criterion of spec 0023 `0023-types-and-logic.md`, that one is named and still holds):

Quality, by reference to spec 0058:
- **AC-6301**: Every screen, popup and visitor view this spec adds meets spec 0058 AC-1 (alignment), AC-2 (motion), AC-3 (less text), AC-4 (accessibility) and AC-21 (delight), checked the way 0058 `verify.md` describes.

Layouts (builds 0023 AC-1031 to AC-1035):
- **AC-6302**: Settings has **Layout**: Classic (default), Steps, One at a time, as three picture tiles (the 0058 `TileGrid` choice variant). It lives in the version document and publishes with it, so a visitor mid fill never sees it change.
- **AC-6303**: The questions list takes **New step** dividers with an optional title, which drag like a question. Removing one merges its questions into the step above. Breaks show only with Steps, stay kept and quietly noted with Classic, and are ignored by One at a time.
- **AC-6304**: Steps on the visitor page show "Step 2 of 3" and a progress line, Back and Continue, and the form's button text on the last step. Continue checks that step's shown questions with `checkAnswers`. Back keeps every answer. A step change moves focus to its first question and announces its place politely.
- **AC-6305**: One at a time shows one question per screen at heading size. Enter (or OK) continues from a single line field or a choice, Shift and Enter makes a new line in long text, Back returns, the progress line reads "2 of 7", and the same checks and messages as Classic apply. A choice question with one answer moves on by itself after a short pause, which reduced motion shortens to none.
- **AC-6306**: The step layouts and their code load only when a form uses them (see Performance). The loading shape draws the layout the form will show, so the first paint never jumps.

Question types (builds 0023 AC-1040 to AC-1043):
- **AC-6307**: Ten new answer types, each one value, each with its visitor control and the attribute types it files onto: Date (date), Time (text, as `HH:MM`), Date and time (timestamp, in the visitor's time zone, which is stored with it), Rating (rating, number), Scale (number; 0 to 10 by default for NPS, or 1 to 5, 1 to 7, 1 to 10, with end labels), Multi select (select with `isMulti`, optional least and most picks, optional Other with a text box), Address (location, as one group: line 1, line 2, city, region, postcode, country), Hidden (text, select, number; no control), Signature (file, a PNG drawn on the page), Ranking (text and long text, as "1. A, 2. B"; the full order stays on the submission).
- **AC-6308**: Every new control works by keyboard and screen reader. Rating and Scale are radio groups named by the question with their end labels read. Ranking reorders with arrow keys as well as by dragging. Signature offers "Type your name instead", which draws the typed name in a script face, so nobody is blocked by a pointer. All meet WCAG AA.
- **AC-6309**: Any question can be prefilled from the link (`?<key>=<value>`, repeated for multi select). A value that doesn't fit is ignored, never shown as an error. Hidden questions take the link's value, else their default. Prefill values are untrusted and checked exactly like answers. The Install tab shows a **Prefill link** helper listing each question's key.
- **AC-6310**: A form holds at most 50 questions (up from 30), one File question and one Signature question. Other's text is kept on the submission and never filed.
- **AC-6311**: Booking page questions (spec 0057) keep their current types. The new types show only in the form builder until a later spec opens them to booking pages.

Logic:
- **AC-6312**: Show when keeps working on questions and now on steps (0023 AC-1036 to AC-1039). A step whose questions are all hidden is skipped and not counted.
- **AC-6313**: **Jumps**: in Steps and One at a time, a step (or a question in One at a time) can have ordered jump rules, each "when these answers match, go to step X" or "go to ending Y", built from the same rule rows as Show when. No match goes to the next step. Jumps only go forward, so a visitor can never loop.
- **AC-6314**: One function, `pathOf(document, answers)` in `packages/contracts`, decides which questions a visitor passed through, on the page and on the server. Answers to questions off the path are dropped by the server, and a question off the path is never required.
- **AC-6315**: **Endings**: a form has one default ending (today's thank you) and up to four more, each with a heading, one line, an optional button (a web address or Book a meeting) and the existing after send outcomes. A jump or a routing rule (spec 0043) can name an ending.
- **AC-6316**: **Score**: Choice, Dropdown, Multi select, Yes or no, Rating and Scale answers can carry points. The form's `score` is their sum. It can be shown in an ending, used in jumps, show when and routing rules (`score is more than 7`), and filed onto a number attribute (for example a lead score). The server works the score out again from the stored answers and never trusts the page's number.
- **AC-6317**: **Recall**: a question's label, its help line and an ending's text can include an earlier answer or the score (`{{name}}`, `{{score}}`), shown as plain text. Publish refuses a recall of a later or deleted question, as one sentence naming both.

After sending:
- **AC-6318**: **Confirmation email** to the visitor (builds 0023 AC-1048): off by default. When on, it sends once per accepted submission to the form's email answer, with the form's own subject and one line (defaults given), a copy of the answers the visitor saw (hidden answers left out, a signature shown as "Signed"), reply to the form's owner, and never for spam or held submissions. It uses the existing `queueFormConfirmation` and `formConfirmation` template.
- **AC-6319**: **Save and resume**: Steps and One at a time forms save the visitor's answers on each Continue (Classic forms with more than 10 questions on a quiet timer). The visitor sees "Saved" quietly, and may ask for **Finish later**, which shows a resume link and can email it to the address they gave. Opening the link restores their answers and step within 30 days. A partial is never filed into the CRM, never counted as a submission, and is deleted on submit or after 30 days.

Analytics (builds 0023 AC-1052):
- **AC-6320**: Each form counts views, starts (the first answer), completions (accepted, not spam), median time to complete, and for those who left, the question they left on. No cookie, no stored address, no visitor id beyond the daily keyed hash the link page already uses (spec 0051).
- **AC-6321**: The form editor has an **Analytics** tab: four numbers at the top (views, starts, completion rate, median time) with the change on the previous period, a daily chart, a drop off bar per question in form order, and a by source table (UTM source, else the referring site, else Direct). Ranges: 7, 30 and 90 days. Empty state: one line and the Copy link button.
- **AC-6322**: The Form tab's question cards show a small reached and answered chip when the form has analytics, so a weak question is visible where it is edited.

Templates:
- **AC-6323**: **New form** opens a template gallery as picture tiles: Blank first, then Contact us, Demo request, Lead qualification (with score), Event signup, Feedback, NPS, Job application, Booking intake (ends with Book a meeting), Newsletter, Support request, Customer onboarding. Each tile shows a small preview of its look and a one line purpose. Choosing one makes a draft whose questions file onto the workspace's matching standard attributes, and leaves unmatched answers kept with the submission, with no field created until publish.
- **AC-6324**: Templates live in code, versioned, with a test that each parses as a `FormDocument` and publishes on a fresh workspace.

Editor:
- **AC-6325**: **Logic** is edited where it applies: a question card's Show when row, a step divider's Jumps row, and each choice's points as a small number beside it. A **Flow** view (a button in the Form tab) draws the steps top to bottom with their jumps as plain arrows and endings at the foot, read only, with each part a link back to where it is edited.
- **AC-6326**: Publish checks the logic and refuses, in one sentence each: a jump to a removed step or ending, a jump backwards, a rule on a later question, a step with no questions, a recall of a later question.

Look:
- **AC-6327**: The form's look offers **Brand** (the workspace brand kit of spec 0060: accent, logo, font pack) beside today's Light or Dark and Rounded or Square. Brand is the default for new forms once spec 0060 lands. The contrast guard of spec 0060 applies, so no unreadable pair can be published. The hosted page gains no new origin: fonts and logos are served from our own address.
- **AC-6328**: "Powered by Timefix" stays under every hosted form and embed, quiet and aligned (spec 0058 AC-26).

Safety and performance:
- **AC-6329**: Every new table forces row level security per workspace with a policy, and the guard tests (every tenant table forces it; a cross workspace read returns nothing) cover them.
- **AC-6330**: Partial saves and analytics events pass the same bot checks as a submit (honeypot, the signed fill ticket, rate limits per hashed address, size caps), and a resume link carries only an opaque token, never an answer, an email or a name.
- **AC-6331**: A Classic form using today's question types stays within the hosted form budget (223 kB JavaScript and 17 kB CSS, gzipped). Each layout and each heavy control is its own lazy chunk with its own budget line in `apps/web/.size-limit.js`.
- **AC-6332**: The stale "no React, about 12 kB" lines in `apps/web/src/features/forms/README.md` and the header comment of `apps/web/src/public/main.ts` are corrected to match the real budget.

## Decision

**Chosen option**: Option 2: Grow the one form document and the one hosted renderer, in four lanes, built in value order.

Everything new lives in the versioned `FormDocument` and the existing `@crm/ui/public-form` renderer, with two new tables (partial saves and daily visits). Logic stays rule rows, not a canvas. Templates live in code. The look comes from the brand kit of spec 0060.

**Implementation skills**: `crm-design-system` (`.claude/skills/crm-design-system/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `zod` (`.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `react-aria` (`.claude/skills/react-aria/`) · `dataviz` (built in) · `interaction-design` (`.claude/skills/interaction-design/`) · `emil-design-eng` (`.claude/skills/emil-design-eng/`) · `vitest` (`.claude/skills/vitest/`)

## Feature design

**Document changes** (`packages/contracts/src/forms/document.ts`, jsonb, no migration):
| Field | Shape | Default |
|---|---|---|
| `layout` | `'classic' \| 'steps' \| 'conversational'` (shown as One at a time) | `'classic'` |
| `steps` | `{ id, title?, startsAt: QuestionId, showWhen?, jumps?: { when: ShowWhen, to: { step: id } \| { ending: id } }[] }[]` | `[]` |
| `questions[].points` | numbers per choice, in the order of `choices`; for Rating and Scale one number per point value or `'value'` (the answer itself) | absent |
| `questions[].options` | per type: `date { earliest?, latest? }`, `scale { from: 0 \| 1, to: 5 \| 7 \| 10, lowLabel?, highLabel? }`, `multi_select { min?, max?, other: boolean }`, `hidden { default? }`, `ranking { choices }` (uses `choices`) | absent |
| `endings` | `{ id, heading, line?, button?: { kind: 'url', url } \| { kind: 'booking', bookingPageId } }[]`, at most 4 beside the default | `[]` |
| `scoreFiledOn` | `FiledOn` (a number attribute) | absent |
| `confirmation` | `{ on: boolean, subject?, line? }` | `{ on: false }` |
| `look` | gains `theme: 'plain' \| 'brand'` | `'plain'` for existing forms, `'brand'` for new ones once 0060 lands |
| `saveProgress` | boolean | `true` for Steps and One at a time |

`ANSWER_TYPES` gains `date`, `time`, `datetime`, `rating`, `scale`, `multi_select`, `address`, `hidden`, `signature`, `ranking`, and `FILES_ONTO` gains their rows as in AC-6307. `FactKey` gains `score`. `RoutingRules` outcomes gain `ending?`. `FORM_QUESTIONS_MAX` becomes 50. `PublicForm` gains `layout`, `steps` (resolved to question keys), `endings`, `points` only where needed for jumps on the page, and `brand` (resolved colours, logo and font pack names, never raw CSS).

**New shared functions** (plain TypeScript, no Zod, in `packages/contracts/src/forms/`, used by the page, the editor preview and the server): `pathOf(document, answers)` (which questions and steps were on the path, and which ending), `scoreOf(document, answers)`, `recall(text, answers, score)` (plain text out, never HTML).

**Data model** (one migration, placeholder `0xxx_form_partials_and_visits.sql`, renumbered at the final merge):

`form_partials`
| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid, not null | tenant; forced row level security |
| `id` | uuid, not null, `uuidv7()` | primary key with `workspace_id` |
| `form_id` | uuid, not null | FK to `forms`, cascade |
| `version_id` | uuid, not null | FK to `form_versions`; a resume on a newer version keeps answers whose question ids still exist |
| `token_hash` | text, not null | SHA-256 of a random 32 byte token; unique per workspace |
| `answers` | jsonb, not null | checked per question like a submit |
| `step_id` | text, null | where the visitor was |
| `ip_hash` | text, null | rate limits only |
| `created_at`, `updated_at` | timestamptz | |
| `expires_at` | timestamptz, not null | created plus 30 days; index for the cleanup |

`form_visits`
| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid, not null | tenant; forced row level security |
| `form_id` | uuid, not null | FK to `forms`, cascade |
| `day` | date, not null | UTC |
| `visitor` | text, not null | the daily keyed hash (spec 0047), check `^[0-9a-f]{32}$` |
| `version_id` | uuid, not null | |
| `source` | text, not null | normalized: `utm:<source>`, `ref:<host>` or `direct`, at most 60 characters |
| `started_at`, `completed_at` | timestamptz, null | |
| `furthest_question_id` | text, null | |
| `duration_ms` | integer, null | first answer to accepted submit |
| primary key | (`workspace_id`, `form_id`, `day`, `visitor`) | one row per visitor per form per day |

Indexes: `form_partials (workspace_id, token_hash)` unique, `form_partials (expires_at)`, `form_visits (workspace_id, form_id, day)`. Retention: partials 30 days, visits 13 months, both in the daily cleanup job. Signature files use the existing `form_uploads` path and store.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/public/forms/:publicKey` | GET | `resume?` token | the public form, plus saved answers and step when the token is valid | none (public key) | 404 unknown or paused |
| `/api/public/forms/:publicKey/partials` | PUT | fill ticket, `resumeToken?`, answers, `stepId` | `{ resumeToken }` (new on first save) | none, bot checks | 400 invalid answer, 429 |
| `/api/public/forms/:publicKey/partials/email` | POST | fill ticket, `resumeToken` | 202 | none, bot checks, per address daily limit | 400 no email answer, 429 |
| `/api/public/forms/:publicKey/events` | POST (beacon) | fill ticket, `kind: view \| start \| reach`, `questionId?`, `source` | 204 | none, bot checks | 204 always (lossy by design) |
| `/api/public/forms/:publicKey/submissions` | POST | as today | as today, plus `ending` | as today | as today |
| `forms.analytics` (oRPC) | query | `formId`, `range: 7 \| 30 \| 90` | totals, previous totals, by day, by question, by source | member who may see the form | NOT_FOUND |
| `forms.templates` (oRPC) | query | none | template list (id, name, purpose, look preview) | member | none |
| `forms.createFromTemplate` (oRPC) | mutation | `templateId`, `name?` | the new draft form | `forms.manage` | FORBIDDEN |

**Value sourcing**:
| Action | Value produced or shown | Source |
|---|---|---|
| Hosted page draws a layout | layout and steps | the live version's `document.layout` and `steps`, resolved by `publicFormOf` |
| Continue in Steps | next step | `pathOf(document, answers)` on the page |
| Submit | kept answers, ending | `pathOf` and `scoreOf` on the server from the stored answers |
| Score filed | number | `scoreOf`, onto `scoreFiledOn` |
| Recall in a label | earlier answer text | the page's own answers state, through `recall` |
| Confirmation email | address, subject, answers | the form's email question answer; `confirmation.subject` else the default `CONFIRMATION_DEFAULT_SUBJECT`; the stored answers on the path |
| Resume | answers and step | `form_partials` row found by the token's hash |
| Analytics numbers | views, starts, completions, median, drop off, source | `form_visits` rows in range; median from `duration_ms`; drop off from `furthest_question_id` where `completed_at` is null |
| Previous period | comparison numbers | the same query for the range before |
| Brand look | colours, logo, font pack | spec 0060 brand kit, resolved server side into `PublicForm.brand` |
| Template draft | questions and filing | code templates in `packages/core/src/forms/templates/`, matched to the workspace's standard attributes by their slug |

**Key invariants**:
- The server decides what was on the path and the score. The page's view is only a convenience.
- A partial is never a submission, never filed, never notified, never in Submissions.
- Analytics never store an address, a cookie or a lasting visitor id.
- Jumps only go forward. Recall only reads earlier answers.
- No new origin in the hosted page's Content Security Policy.

**Security model**: members see analytics only for forms they may see (the access door, as Submissions). Public endpoints are reached only by a live form's public key. Resume tokens are 32 random bytes, stored hashed, valid 30 days, deleted on submit. Hidden and prefilled values are untrusted and checked like answers. Recall output is text, never HTML. Signature uploads accept only PNG under 300 kB through the existing upload checks. Personal data stays where it is today (submissions), plus partials, which expire.

**Performance**: the real budget is React and React Aria at 223 kB JavaScript and 17 kB CSS gzipped (`apps/web/.size-limit.js`, 26 October 2026). Lazy chunks, each with a budget line: Steps and One at a time together at most 10 kB, Signature at most 8 kB, Ranking at most 6 kB, Date and Date and time at most 14 kB, analytics beacon at most 1 kB in the first load. The editor's Analytics tab and Flow view are lazy routes in the app.

**Alignment, motion, less text, delight, accessibility**: as spec 0058 AC-1 to AC-4 and AC-21. Step changes reached by keyboard never wait on motion. One at a time uses a short fade and rise between questions from the motion tokens, instant under reduced motion.

**Lanes** (each owns its files; avoid `apps/web/src/features/booking`, `features/bookings`, `TeamWeek`, `HoursEditor`; lane branches never edit `docs/specs/`):
| Lane | Owns | Delivers |
|---|---|---|
| F1 Contracts and server | `packages/contracts/src/forms/*`, `packages/core/src/forms/*` (including `templates/`), `apps/api/src/forms/*`, `packages/db/src/schema/forms.ts` and the migration, `packages/emails/src/templates/forms.ts`, the cleanup job entry | AC-6307 (contracts), 6309, 6310, 6312 to 6318 (server), 6319 (server), 6320, 6324, 6329, 6330 |
| F2 Hosted page | `packages/ui/src/public-form/*`, `apps/web/src/public/{main,context,frame}.ts`, `packages/data/src/public-form*`, `apps/web/.size-limit.js` form lines | AC-6302 (visitor side), 6304 to 6308, 6313, 6315 to 6317 (visitor side), 6319 (visitor side), 6327 (visitor side), 6328, 6331, 6332 |
| F3 Editor | `apps/web/src/features/forms/*` except the new Analytics and Templates files, `apps/web/src/features/questions/*` | AC-6302, 6303, 6309 (Install helper), 6311, 6322, 6325, 6326, 6327 (editor) |
| F4 Analytics and templates | new `apps/web/src/features/forms/{AnalyticsTab,TemplateGallery}.tsx` and their strings and tests, `packages/data` forms analytics reads | AC-6321, 6323 |

F3 wires F4's tab and gallery into `FormEditor.tsx` and `FormsScreen.tsx`. F3 starts after spec 0058 Lane B lands (it owns `PublishDialog`, `SyncDialog`, `InstallTab`, `FormsScreen`, `FormEditor`). F1 goes first in each slice so F2 to F4 code against real contracts.

**Critical test scenarios**:
- Steps happy path: a three step form, Continue checks each step, Back keeps answers, submit files as Classic does, verifies **AC-6304**.
- One at a time: Enter moves on, a single choice moves on by itself, reduced motion makes it instant, verifies **AC-6305**.
- Jump: "Budget is under $1k" jumps to the ending "Not a fit"; a forged post carrying answers to skipped questions is accepted with those answers dropped, verifies **AC-6313**, **AC-6314**.
- Score: three choices worth 2, 3 and 5 give 10, filed onto Lead score; a forged page score of 99 is ignored, verifies **AC-6316**.
- Recall: "Thanks {{name}}" shows the typed name as text; a name containing `<b>` shows the angle brackets, verifies **AC-6317**.
- Resume: Finish later on step 2, open the link the next day, answers and step return; after submit the link shows the form empty, verifies **AC-6319**.
- Analytics: 10 views, 6 starts, 3 completions, 3 left on question 4; the tab shows 50% completion and a drop off bar on question 4; no row holds an address, verifies **AC-6320**, **AC-6321**.
- Tenancy: a cross workspace read of `form_partials` and `form_visits` returns nothing, verifies **AC-6329**.
- Budget: the Classic form's first load stays under 223 kB; a Steps form loads its chunk, verifies **AC-6331**.

## Build plan

Approach: Tracer Bullet. Each slice runs contracts, server, hosted page and editor end to end before the next.

1. Slice 1, Steps end to end: `layout` and `steps` in the document, `pathOf` with Show when on steps, the lazy Steps chunk on the hosted page, the Layout tiles and step dividers in the editor, the budget lines, the README fixes, satisfies **AC-6302, AC-6303, AC-6304, AC-6306, AC-6312, AC-6314, AC-6331, AC-6332**
2. Slice 2, One at a time on the same chunk, satisfies **AC-6305**
3. Slice 3, question types batch one (date, time, date and time, rating, scale, multi select, address, hidden) with filing, prefill and the Install helper, the 50 question limit and the booking page filter, satisfies **AC-6307, AC-6308, AC-6309, AC-6310, AC-6311**
4. Slice 4, batch two (signature with the typed fallback, ranking), satisfies **AC-6307, AC-6308, AC-6310**
5. Slice 5, logic: jumps, endings, points and score, recall, publish checks, the Flow view, satisfies **AC-6313, AC-6315, AC-6316, AC-6317, AC-6325, AC-6326**
6. Slice 6, the migration, partial saves and resume, the confirmation email, satisfies **AC-6318, AC-6319, AC-6329, AC-6330**
7. Slice 7, analytics: beacon, `form_visits`, the Analytics tab, card chips, satisfies **AC-6320, AC-6321, AC-6322**
8. Slice 8, templates in code and the gallery, satisfies **AC-6323, AC-6324**
9. Slice 9, Brand look once spec 0060 lands, and the Timefix footer check, satisfies **AC-6327, AC-6328**
10. Verify pass across all slices: alignment probe, motion check, screenshots in light and dark, keyboard and screen reader runs, satisfies **AC-6301**

## Consequences

**Positive**:
- Forms reach parity with Typeform and Tally on the things buyers compare, while still filing into the CRM without Zapier.
- Owners see where people drop off and fix the question that loses them.
- Templates give a working form in one click.

**Negative / tradeoffs**:
- The form document grows, so publish checks grow too and need careful tests.
- Two new tables and a cleanup duty.
- Ranking files as text, which is readable but not sortable in the CRM.

**Neutral**:
- Booking page questions keep their types for now (AC-6311).
- `0023-types-and-logic.md` items for company by domain, deal filing, consent and retention are not in this spec and stay owed there.

## Follow-up

- [ ] Later spec: payments in forms (needs a payment provider decision; the roadmap names Paddle or Lemon Squeezy for the product's own billing, and a visitor payment usually needs Stripe Connect).
- [ ] Later spec: legal e signature flow (audit trail, signed PDF), A/B tests, AI form builder.
- [ ] Later: address autocomplete (any provider adds an origin to the hosted page's policy).
- [ ] Spec 0023 still owes: company by email domain, deal filing, consent record, retention setting (AC-1044, 1045, 1053, 1054).
- [ ] Open the new question types to booking page questions (spec 0057) in a later spec.
- [ ] `dataviz` is a built in skill; note it in `AGENTS.md` if lanes rely on it (for /sync).

## Rationale

See [rationale.md](rationale.md) for the context, options and reasoning.
