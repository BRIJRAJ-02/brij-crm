# Spec 0063 slices 6 and 7 — amendments and notes

Lane `wip/0063-s67`. The spec itself is never edited from a lane; these are the
points `/architect` should fold into `docs/specs/0063-forms-features/`.

## Amendments to the spec

1. **`form_partials` gains `id` as a real column and primary key.** The spec's
   table lists `id uuid not null uuidv7()` with "primary key with `workspace_id`",
   which is what was built. Noting it only because the API surface table implies
   a partial is found by token alone: it is found by
   `(workspace_id, token_hash)`, and `id` exists so the resume email can be keyed
   per partial per day.

2. **`form_visits` gains `first_at` and `last_at`.** Not in the spec's column
   list. They match `booking_page_views` (spec 0047) and are what makes "a
   visitor counted once a day however many times they look" observable. Neither
   is read by the Analytics tab.

3. **`FormDocument.confirmation` is optional, not defaulted.** The spec's table
   gives it the default `{ on: false }`. A Zod `.default()` makes the field
   required on the parsed type, which would force every stored document and
   every fixture to carry it. It is `.optional()` and read through
   `sendsConfirmation(document)`, exactly as `endings` is read through
   `endingsOf` for the same reason.

4. **`saveProgress` is optional, read through `savesProgress(document)`.** The
   spec gives it the default "`true` for Steps and One at a time", which a
   plain Zod default cannot express (it depends on `layout`). The function
   returns what the owner set, else `true` for Steps and One at a time, else
   `true` for Classic past `SAVE_PROGRESS_CLASSIC_MIN` (10) questions, which is
   the spec's "Classic forms with more than 10 questions".

5. **A new email kind, `form_resume`.** AC-6319 says the resume link "can email
   it to the address they gave", and the spec's API surface has the endpoint,
   but no template existed and none was named. Added as
   `packages/emails/src/templates/forms.ts`'s `formResume`, on the existing
   `email_form_confirmation` medium (no new `POWERED_BY_EMAILS` word). It
   carries the token and nothing else.

6. **`PublicForm` gains `savesProgress` and `resumed`.** The spec's API surface
   says the form read answers "the public form, plus saved answers and step when
   the token is valid" but does not name the fields. `resumed` carries them;
   `savesProgress` tells the page whether to offer Finish later at all, so the
   page never has to work the rule out for itself.

7. **`FILL_TICKET_MAX` moved to `packages/contracts/src/forms/ticket.ts`.**
   `public.ts` now needs `ResumedFill` from `partials.ts`, and `partials.ts`
   needs the ticket cap, which was in `public.ts`: a true module cycle, which
   with Zod schemas at module-eval time leaves one of them undefined.
   `public.ts` re-exports it, so nothing outside changed.

8. **Drop off is derived, not stored per question.** The spec stores only
   `furthest_question_id`. `reached`, `answered` and `leftHere` are worked out
   from it and the live form's question order (`dropOff` in
   `packages/core/src/forms/visits.ts`). The definitions are written in
   `FormAnalyticsQuestion`'s doc comment; AC-6322's chip shows
   `answered / reached`.

## Where I disagreed with the brief

- **AC-6322's files.** The spec's lane table gives AC-6322 to lane F3
  (`features/questions/*`), but the brief asked this lane for slices 6 and 7,
  and the chip is slice 7. It is built here: an optional `stat` on
  `QuestionListItem` (`packages/ui`), an optional `stats` map on
  `QuestionsSection`, and the `useQuestionStats` hook in `AnalyticsTab.tsx`.
  Three small additive edits, no restructuring. If F3 is live on those files,
  this is the overlap to watch.

## Things the next slice should know

- The beacon's `place` for the daily visitor hash is `form:<formId>`, and the
  submit route uses the same, so a completion lands on the row the view made.
  Changing either without the other silently stops completions being counted.
- `drizzle` expands a JS array in a `sql` template into a parenthesised tuple,
  not an array literal: `sql.param(order)` is required for `::text[]`.
