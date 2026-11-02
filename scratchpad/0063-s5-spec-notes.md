# Spec 0063, slice 5: notes for /architect

Written by the slice 5 lane (`wip/0063-s5`). Nothing under `docs/specs/` was touched. Each note says what the spec
says, what was built, and why.

## 1. `endings` is absent, not an empty list

The spec's document table gives `endings` the default `[]`. It is built as `.optional()` instead, so a document
written before this spec reads as a form with no endings and nothing has to carry an empty list. Every reader uses
`document.endings ?? []`. The reason is practical: `FormDocument` is a strict schema whose output type is used by
app fixtures, and a required `endings` would have forced an edit to seven test fixtures, two of them in files
another chat owns this week (`snippets.test.ts`, `InstallTab.browser.test.tsx`). `steps` keeps its `[]` default;
the two now differ, which is worth settling one way or the other in the spec.

## 2. Jumps in One at a time name a question, not a step

AC-6313 says "a step (or a question in One at a time) can have ordered jump rules, each … go to step X". With One
at a time there are no steps: `groupsOf` ignores the breaks for that layout (AC-6303), so there is nothing called
"step X" to jump to. Built as: each question is its own group, named by its question key, and a jump's
`to: { step }` names that key. `FormQuestion` gained `jumps` for this. The spec should say which id a
conversational jump target holds.

## 3. A routing rule reaches an ending through a new route kind

"`RoutingRules` outcomes gain `ending?`" is built as a fourth form route, `{ kind: 'ending', endingId }`, added to
`Route` and to `FORM_ROUTES`, rather than an extra optional field on the existing outcomes. A discriminated union
reads better and keeps "where does this rule send them" one answer. The rules editor lists it in a rule's summary
but does not yet offer it as a route to pick (see "Not built" below).

## 4. An ending's booking button never reaches the page

`PublicForm.endings` carries an ending's heading, line and a web-address button only. A booking button is a signed
hand off, which only the server can make, so it arrives with the submit's own next step (`SubmitNext`). `SubmitNext`
of kind `message` gained `heading`, `button` and `ending` for this. The spec's "`PublicForm` gains … `endings`"
should say that much, since it changes what the page can draw on its own.

## 5. `points` on the page

"`points` only where needed for jumps on the page" is built as `readsScore(document)`: the page is sent points only
when some jump, Show when, routing rule or recall reads `score`. Otherwise no question carries points at all.

## 6. The score files as text

A number attribute holds its value as text everywhere in this codebase (`valueFor`), so the filed score is
`String(score)`. Nothing in the spec says otherwise; noted because a reader expecting a number in the column will
find a string, as they would for any number question.

## Not built in slice 5, and why

- **A routing rule's Ending route in the rules editor.** The contract, the publish check and the server all handle
  `{ kind: 'ending' }`; `RulesCard`'s route picker still offers only Book, Message and Redirect, so an ending can
  be reached by a jump but not yet by a rule from the UI. It belongs with whoever owns `RulesCard` next.
- **A Jumps row on a question card for One at a time.** The document, the path, the check and the hosted page all
  support question jumps; the editor shows the Jumps row on step dividers only. A half-built row on every question
  card seemed worse than none, so it is left for the slice that owns One at a time's editor.
- **No migration**, as the brief required: every field here is jsonb inside the form document.
