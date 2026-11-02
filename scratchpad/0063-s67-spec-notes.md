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

## What the security review found, and what it changed

`security-access-reviewer` on 009e63858 returned two must-fixes, both real and
both fixed in the follow-up commit:

- **The three new public endpoints skipped the submit's Origin and signature
  gate.** `sendBeacon` and a `text/plain` POST are both sent with no CORS
  preflight, so another site could have spent a visitor's resume-email budget
  and filed visits for people who never saw the form. All three now run the
  same `postFrom(...)` gate the submit does, over the raw body so a listed
  site's HMAC still verifies.
- **They spent the submit's fill-ticket use budget.** `check()` counts a use
  against `TICKET_LIMITS.usesPerTicket` (5 a day). A real visitor on a Steps
  form sends a beacon per question and a save per Continue, so from the sixth
  call their own submit came back `reused`, which scores 3 against
  `SPAM_SCORE.reviewAt` of 3 — their genuine submission would have been held
  for review and never filed, silently, on exactly the forms this feature is
  for. `TicketBook.check` now takes `{ count: false }`, which these three pass.

Also taken: the missing composite foreign key on `form_visits.version_id`, and
a test that a member the form's object is hidden from gets NOT_FOUND from
`forms.analytics` rather than zeroes.

Left, with reasons:

- **The resume token travels in the link's query string** (`?resume=`), so it
  can leak through `Referer` and access logs. It has to be a link, so the
  mitigation belongs with the page that reads it: `history.replaceState` the
  query away on load and `Referrer-Policy: no-referrer` on `/f/:key`. Both are
  F2's files (`apps/web/src/public/*`), so they are owed there, not here.
- `rowOfToken` and `dropPartial` filter on `form_id` and `token_hash` without
  an explicit `workspace_id` predicate, resting on forced row level security.
  That holds and is proven, but adding the predicate would match the rest of
  the codebase.

## Not built here, and why

**AC-6319's visitor side is not built.** The hosted page has no Finish later
button and no "Saved" line: `grep -rn "partials\|/events" apps/web/src/public
packages/ui/src/public-form` finds nothing, so nothing calls the three new
endpoints yet. The spec's lane table gives the hosted page to **F2**
(`packages/ui/src/public-form/*`, `apps/web/src/public/{main,context,frame}.ts`),
and this lane was not given those files. Everything behind them — the contracts,
the tables, the endpoints, the bot checks, the resume read on the public form,
the confirmation and the cleanup — is built and tested. F2 owes: the save on
each Continue, the quiet "Saved", the Finish later control, the beacon calls,
and reading `PublicForm.resumed` / `PublicForm.savesProgress` on load.

## What the two UI reviews found

`design-system-guardian` and `ux-interaction-reviewer` on the Analytics tab.
Both passed it on tokens, library components and states (no raw values, no
`className` or `style`, no one-off markup, `Chart` used as its README asks).
Taken:

- **Both charts' axis labels were being thinned by index**, so the drop off
  chart drew five bars and printed three labels, over the wrong bars. Fixed on
  this side by giving short `axisLabel`s (the day number; `Q1`…`Q6`) and
  keeping the full text in `label`, which the tooltip and the table view read.
- **The comparison line restated the previous figure** ("540" over "540 in the
  30 days before"), which reads as the same number twice and otherwise makes a
  reader subtract. It now shows the signed change, or "Same as the 30 days
  before".
- **The median's arrow meant the opposite of what it looked like**: less is
  better for a time, so a form that got slower showed the same ↑ as a form that
  got more visitors. It now says "39s faster" / "12s slower" and draws no arrow.
- **The in-range no-data case fell through to a flat chart.** A range with no
  visits but traffic before it now gets its own line and keeps the range
  control; the by-source table gets an empty state.
- **The chip had no denominator.** `statTitle` on `QuestionListItem` carries
  "72% of the 88 who reached this question" as its tooltip.
- `QuestionList`'s README and a story now cover `stat`, and two dead strings
  are gone.

Left, as owed rather than done:

- **AC-6321's empty state should carry the Copy link button**; it currently has
  the line only. The handler lives in `FormEditor`, so it is a prop to thread.
- **The drop off block should probably sit above the daily chart**, and name
  the worst question in words, since finding it is the tab's whole job. A
  reorder plus a sentence; worth doing but it is a judgement call about a
  screen the owner has not seen yet.
- **Changing the range blanks the tab** rather than dimming it; `Chart` has
  `isRefreshing` for exactly that.
- `ChartPlot` thins labels by index for every kind, which is right for dates
  and wrong for categories. Fixed here by not giving it long category labels;
  the general fix belongs in `packages/ui` with a story.
