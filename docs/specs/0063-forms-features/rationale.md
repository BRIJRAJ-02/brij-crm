# 0063 rationale: Forms features

## Context

Forms (spec 0023) file every answer straight into the CRM, which Typeform, Tally and Fillout need Zapier for. That is the edge. Everything around it is thin. There is one layout (a single long card), twelve answer types, per question show when rules and routing, no confirmation to the visitor, no way to finish later, no analytics at all (the Submissions tab shows counts only), no templates, and a look limited to light or dark and rounded or square. An audit on 31 October 2026 found the Steps and One at a time layouts already drawn in `packages/ui/src/public-form/HostedFormSteps.tsx`, but only as library stories that the hosted page never imports. It also found the confirmation email's template and queue function (`formConfirmation`, `queueFormConfirmation`) built but not wired to any form setting.

Spec 0023 `0023-types-and-logic.md` already set out much of this as Release 1 and Release 2 (AC-1031 to AC-1059), and the owner accepted it on 20 October 2026, including Steps live in release 1 and One at a time in release 2. The owner also reopened the hosted form page (`/f/:key`) for a redesign and form types (20 October). On 31 October the owner said to complete every phase of the links, booking and forms plan and to decide the details the industry standard way without asking. The one exception they named: "Powered by Timefix" stays.

There is also a documentation conflict to settle. `apps/web/src/features/forms/README.md` and the header of `apps/web/src/public/main.ts` say the hosted page loads no React and weighs about 12 kB. Since 19 October it draws with the library's own controls, and `apps/web/.size-limit.js` budgets 223 kB of JavaScript and 17 kB of CSS (raised on 26 October for file uploads). The README in `packages/ui/src/public-form/` is the accurate one.

Constraints: the house rules (tokens only, library first, functional core, Zod contracts, forced row level security per workspace), no new origins on public pages, the hosted form budget, and spec 0058's alignment, motion, less text and delight rules.

## Options considered

### Option 1: Ship only what 0023 already accepted

Build 0023's Release 1 and 2 as written (layouts, the seven types, show when on steps, confirmation, anonymous analytics) and stop.

**Pros**:
- Already accepted, smallest scope.

**Cons**:
- Leaves out what buyers now expect from Typeform and Tally: jumps, endings, a score, recall, save and resume, templates, signature and ranking.
- No brand look, so forms stay visually apart from the link page and booking pages.

### Option 2: Grow the one form document and the one renderer, in four lanes, in value order

Everything new goes into the versioned `FormDocument` and the existing `@crm/ui/public-form` renderer. Two tables are added (partial saves, daily visits). Logic stays as rule rows with a read only Flow view. Templates live in code. The look comes from spec 0060's brand kit.

**Pros**:
- One document and one renderer means the builder preview, the hosted page and the embed stay one tree.
- Versioning already protects a visitor mid fill from changes.
- Lanes split cleanly by layer.

**Cons**:
- The document and its publish checks grow.
- Needs careful bundle splitting to keep the budget.

### Option 3: A separate conversational form product

Build One at a time as its own page and document, like Typeform's separate engine.

**Pros**:
- Free to design from scratch.

**Cons**:
- Two renderers, two sets of checks and two filing paths to keep in step.
- Breaks the one input system the owner asked for on 19 October.

## Rationale

Option 2 keeps what already works (one document, one renderer, one checker shared by page and server, one filing path) and adds the features in the order they pay off: layouts first (they lift completion the most), then question types, then logic, then the things around a submit, then measurement, then templates and look. Option 1 would leave the product a step behind the tools it is compared with, and Option 3 would split a system the owner asked to keep as one.

Choices made without asking, by industry standard:
- **Layout names**: Classic, Steps, One at a time in the interface (the owner accepted these words in 0023), with `conversational` as the stored key that `0023-form-design.md` already names.
- **Steps stored as breaks**, not nested questions, as `0023-form-design.md` set out, so reordering never loses a question.
- **Logic as rule rows plus a read only Flow view**, not an editable node canvas. Tally and HubSpot edit logic in rows; Typeform's map is mostly for reading. Rows are keyboard friendly and fit the existing Show when and routing builders. A plain SVG Flow view avoids a new dependency.
- **Jumps only go forward**, as Typeform and Tally do, so no visitor can loop and the server's path check stays simple.
- **One score, from points per answer**, as Typeform's calculator and Tally's calculated fields are mostly used. Named variables beyond the score wait until someone needs them.
- **Recall with double braces**, the common syntax in Typeform, Tally and Fillout, rendered as text only.
- **Up to four extra endings**, enough for qualify, disqualify and book outcomes without a maze.
- **Save and resume on by default for Steps and One at a time**, off for short Classic forms. A resume link holds an opaque token only and expires in 30 days, like Jotform and Fillout.
- **Analytics without cookies**, keyed by the daily hash the link page already uses, so no consent banner is needed and the data matches what Plausible style tools record.
- **Median time, not average**, because a few abandoned tabs skew an average.
- **Signature with a typed fallback**, so it is never pointer only (WCAG 2.5.1 and 2.1.1).
- **Ranking files as text**, because no attribute type holds an order today. The full order stays on the submission.
- **50 questions**, up from 30. Steps make longer forms usable and the budget still holds. Typeform and Tally have no low cap.
- **Templates in code**, versioned and tested, not rows a user could break. Twelve starters cover the common CRM intake jobs (Fillout and Tally galleries lead with the same).
- **Brand as the default look for new forms** once spec 0060 lands, as Calendly and Typeform apply a workspace brand by default.
- **New types stay out of booking page questions for now**, so spec 0057's booking page lanes (owned by another session) don't move under this work.
- **Payments, legal e signature, A/B tests and an AI builder are later**, because each needs its own provider or legal decision.

## References

**Project sources** (in this repo):
- `docs/specs/0023-forms/` (`index.md`, `0023-types-and-logic.md`, `0023-form-design.md`, `0023-experience.md`, `0023-public-surface.md`)
- `docs/specs/0043-lead-routing/`, `docs/specs/0057-booking-page-questions.md`, `docs/specs/0058-visual-and-short/`, `docs/specs/0051-link-page/` (the daily keyed visitor hash)
- `packages/contracts/src/forms/{answer-types,document,routing,show-when,presets}.ts`
- `packages/core/src/forms/{filing,spam,notify}.ts`, `packages/core/src/emails/queue.ts` (`queueFormConfirmation`)
- `packages/ui/src/public-form/README.md`, `HostedFormSteps.tsx`
- `apps/web/.size-limit.js` (the 223 kB and 17 kB budget)
- The 31 October 2026 audit of the forms feature (this session)

**Practices & standards**:
- WCAG 2.2 AA, including 2.1.1 (keyboard) and 2.5.1 (pointer gestures have an alternative)
- Progressive disclosure for logic and advanced settings
- Cookieless, aggregate analytics with no stored address
- The server as the single source of truth for derived values (path, score)
