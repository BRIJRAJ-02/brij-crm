# 0057. Questions on a booking page, filed into the CRM

**Date**: 2026-10-26
**Status**: Proposed

**Numbering**: 0057 taken on 26 October 2026. This spec owns AC-5701 to AC-5799. It amends [0025](0025-booking-pages/) (booking pages) and reuses [0023](0023-forms/) (forms) for the question model, the answer checks and the filing.

## Summary

The owner asked on 26 October 2026: "a booking link needs to have an option to add more fields to be filled, same as forms, along with an option to add it to the CRM with the same setup of mapping and creating." A booking page gains its own list of questions, built with the same editor as a form's, answered by the visitor beside their name and email, and filed onto the person record the booking already finds or creates. A question with nothing to file onto creates its attribute automatically, with Undo, exactly as a form's does.

This is a behaviour change to `/b/:key` and `/<handle>/<slug>`, which were frozen for behaviour on 24 October 2026. The owner's ask on 26 October lifts that freeze for this feature only.

## Requirements

**User stories**

- As a host, I want to ask a visitor a few questions when they book (their budget, their team size, what they want to talk about), so I come to the meeting ready.
- As a host, I want those answers saved on the person's record, the same way my forms save theirs, so I never copy them across by hand.
- As a visitor, I want the questions on the same short form as my name and email, so booking stays one step.

**Acceptance criteria**

*The questions*

- **AC-5701**: A booking page holds an ordered list of questions, at most 20. A question is spec 0023's `FormQuestion` exactly (`id`, `key`, `label`, `answerType`, `choices`, `choiceKeys`, `placeholder`, `required`, `filedOn`, `update`, `showWhen`), parsed by the same Zod schema, so a question means the same thing on a form and on a booking page.
- **AC-5702**: Every answer type a form offers is offered, except `file` until a booking page can take uploads (follow up). `showWhen` works as on a form, reading only earlier questions on the same page.
- **AC-5703**: The name, email, phone (for a phone location), guests and note fields stay as they are, before the questions. A question may not ask for the email or the name again: the editor does not offer an `email` question filed onto the person's email, since the booking already writes it.
- **AC-5704**: A page with no questions books exactly as today: no new request, no new markup.

*The editor*

- **AC-5705**: The booking page editor gains a Questions section, the same component the form builder uses (`QuestionsSection`, moved to a shared module both screens import): add, rename, reorder by drag or keyboard, change type, choices, required, show when, and Where it goes.
- **AC-5706**: Where it goes lists the People object's attributes that fit the answer type (`FILES_ONTO`), the same Select, the same "taken by" and "can't write" notes. Not filed keeps the answer with the booking only. A booking page's new, preset or duplicated question starts Not filed, kept with the booking (amended 30 October 2026, flow walks B3, live since `0018991af`): filing it, or creating an attribute for it, is the host's choice, so a page saved without a look never adds a column to everyone's People table. Forms keep filing a new question onto a new attribute by default (spec 0023). The editor says where the answers go once, on the Where it goes card, with the per question Select's label visually hidden (B6).
- **AC-5707**: A question the host files with nothing to file onto shows `Creates "X" on People` and, when the page is saved, the attribute is created automatically with no prompt, one per question, titled from the label, typed from the first `FILES_ONTO` fit, with a select's choices as options, made unique against existing titles. A toast says "Added N attributes to People." with Undo, which unfiles those questions and archives the attributes. Only a member with `schema.manage` sees this; anyone else keeps the question unfiled with the quiet note. This is the same code the form builder uses at publish (`planNewAttributes`), not a copy.
- **AC-5708**: A page has an "Add to the CRM" switch, on by default, which is today's behaviour (the visitor's person and company found or made). Off, the booking finds and makes no records, every Where it goes reads Not filed and is disabled, and the answers stay with the booking.

*Booking*

- **AC-5709**: The public booking form draws the questions after the note, with spec 0023's public question components, in light and dark, by keyboard, at 390 wide.
- **AC-5710**: `PublicBookInput` gains `answers` (a record of question key to value). The server checks them with `checkAnswers` from `@crm/contracts/forms` against the page's questions as they are at booking time. A missing required answer or a wrong value is refused with `PARAMS_INVALID` on the question's key, and nothing is booked.
- **AC-5711**: The answers are kept on the booking (`bookings.answers jsonb`, with the questions' labels as they were, so a later rename never changes what the visitor answered).
- **AC-5712**: When the page files into the CRM, the filed answers are written onto the person record the booking matched or made, in the same savepoint as `matchVisitor`, by each question's `update` rule (`fill` writes only an empty value, `always` overwrites), through the same record write the form filing uses. A write the record refuses (a validation rule, an archived attribute) keeps the booking and the answer, and marks that answer not saved, as a form submission does.
- **AC-5713**: A booking reached from a form's hand off (AC-1058) skips any question the form already answered onto the same attribute, and prefills one the form answered by the same key.

*Showing the answers*

- **AC-5714**: The answers show on the booking's details panel, on the record's activity timeline entry for the booking, in the host's new booking email, and in the booking's export, each as label then answer, the same way a form submission shows them.
- **AC-5715**: A rescheduled booking keeps its answers. A cancelled one keeps them for the host.

*Safety*

- **AC-5716**: Answers are untrusted text: length capped by type as on forms, never rendered as HTML, and export cells guarded against formula injection as the forms export is.
- **AC-5717**: A guard test proves a booking page's question cannot be filed onto an attribute of another object or another workspace (refused on save with `CONFIG_INVALID` on `questions`).

## Decision

- **Reuse, don't copy**: the question schema, the answer checks, the public question components, the editor section, the attribute planning and the record filing all come from forms. The booking page stores `questions` and `fileToCrm` in its settings; the booking stores `answers`.
- **Target object**: People only, since the booking already matches the visitor by email onto a person. Filing onto Companies or another object is a follow up.
- **When attributes are created**: on save of the booking page, the same moment a form creates them (publish), so a label typed key by key leaves no stray attributes.

**Implementation skills**: `crm-data-model-access`, `crm-api-backend`, `crm-frontend-state`, `crm-design-system`; plus `drizzle`, `zod`, `vitest`.

## Feature design

| Change | Detail |
|---|---|
| `booking_pages` settings | `questions FormQuestion[]` (max 20, default empty), `fileToCrm boolean` (default true), validated by the booking settings schema |
| `bookings` | `answers jsonb null`: `[{ questionId, key, label, answerType, value, attributeId? , saved? }]` |
| `PublicBookInput` | `answers?: Record<string, unknown>` |
| Public page read | the page's questions (labels, types, choices, required, show when), never `filedOn` |
| Shared modules | `QuestionsSection` and the attribute planning move to a shared place (`apps/web/src/features/questions/`), imported by forms and booking pages |

**Value sourcing**

| Value | Source |
|---|---|
| The record answers are filed onto | the person `matchVisitor` returns |
| The fit of an answer to an attribute | `FILES_ONTO` |
| Labels shown on a past booking | `bookings.answers`, stored at booking time |

## Build plan

1. **Thread** (AC-5701, 5709 to 5712): one short text question saved on a page, drawn on the public page, checked, stored on the booking and filed onto a People attribute, with an end to end test.
2. **Editor** (AC-5705 to 5708): the shared `QuestionsSection` on the booking page editor, the CRM switch, automatic attributes with Undo.
3. **Every type and show when** (AC-5702, 5703).
4. **Showing answers** (AC-5714, 5715) and the hand off skip (AC-5713).
5. **Guards** (AC-5716, 5717).

Reviewers: `security-access-reviewer` (public input, filing), `state-performance-reviewer` (the editor), `design-system-guardian` then `ux-interaction-reviewer` (editor and public page).

## Consequences

- The booking page's behaviour freeze is lifted for this feature.
- Forms and booking pages now share their question editor, so a change to one shows on both.

## Follow-up

- File questions on a booking page once the form upload work lands.
- Filing onto Companies or a chosen object.
- Spec 0025 and 0023 notes (`/sync`).

## Calls made fixing late traps, 27 to 30 October 2026 (shipped, main 82fbc760f)

A late trap is a change that saves fine, then breaks something later somewhere else, without anyone being told. Each line says what the product does now, and the trap it closes (numbers from the late trap audit). The owner asked for each to follow industry practice and delegated the product calls.

- A page's required question filed onto a field does not yet count as filling it for the Required guard (see spec 0012's amendment): the person is made before the answers are filed. Owed: make the person with the filed answers.
- Save clears Unsaved changes after a question creates an attribute (#57). Where the answers go doesn't offer an object it would refuse (#58). A booking question no longer turns into a workspace attribute and a People column without the owner choosing it (#59, #62).
