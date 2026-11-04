# QuestionList

A form's questions as quiet hairline cards, closed until opened, that reorder by a handle or the keyboard.

## Why it exists

New. The form builder (spec 0023, `0023-experience.md`, Questions) needs questions that are closed until opened, with a summary when closed (the question, its answer type, Required, its choices, where it is filed) and an editor when open. OptionsEditor and SortBuilder reorder rows but have no closed and open states, and a Disclosure doesn't reorder; a variant of either would have bent its purpose. It is a React Aria `GridList` with drag and drop, the same pattern and the same `DragHandle` as SortBuilder and OptionsEditor; the editor inside an open row is whatever the caller renders.

Each question is a hairline card, space-8 apart (owner feedback F27, 20 October 2026, after a pass as 34px Table rows read as "too close"). Closed, a card is two lines with room around them, at least `size-row` plus `space-12` above and below: a type tile at the start (`typeIcon`, required, on a gray tile), the question with Required beside it, and under it in muted text the type, its choices and where it is filed ("Dropdown · 3 choices · Person › Budget band · 72% answered"; a form that keeps its submissions only leaves `filed` out, and the line stops after the choices, and `stat` is left out unless the form has analytics and somebody has reached that question); a chevron in a `size-input` square at the end. Why cards and not divided rows: at the builder's full width an open question holds its whole editor, and a card's edge bounds it and its footer, where hairline divided rows ran into each other; the gap separates questions without a heavier rule (the pattern Typeform's and Gumloop's builders use). They cannot be Card: each card is the list's `GridListItem` row itself, and Card's `section` and heading don't belong inside a grid row. They share LinkList's `comfortable` frame instead (`border`, `radius-md`, `surface-raised`, no shadow), so the library has no new card look.

## Use

```tsx
<QuestionList
  label="Questions"
  items={summaries}
  openIds={open}
  onOpenChange={(id, isOpen) => toggle(id, isOpen)}
  renderOpen={(id) => <QuestionEditor id={id} />}
  onMove={(id, index) => move(id, index)}
/>
```

- The whole head (tile, lines, chevron) opens and closes its question on press, Enter or Space. A pointer's hover fills the head; an open question's head takes `surface-selected`.
- For a pointer, the drag handle takes the type tile’s place on hover or keyboard focus (not after a click, which leaves the tile), so a closed question starts with its type and nothing is held empty; on touch the handle stays in the line, always shown. Keyboard reorder is unchanged.
- Reorder by the handle, with a drop line, or by the keyboard: focus the handle, Enter to pick up, arrows to move, Enter to drop, Esc to cancel. Each move is announced: "Budget, moved to position 3 of 6".
- `hasProblem` marks the question a publish refused (the danger edge, and "Needs a fix" by its title); the caller keeps it open until it is fixed.
- Without `onMove` the list is read only and shows no handles.
- **A question with no type of its own** (a link page's FAQ, spec 0052): leave `typeLabel`, `typeIcon` and `isRequired` out and give `note` instead, the start of its answer on the second line. The row then begins with its grip rather than a type tile, and a row with neither a type nor a note keeps one line. Why a variant and not a new list: this is the same thing (a card, closed until opened, that reorders by its handle, holding whatever editor the caller renders); only the summary's parts differ, and the form builder's own summary is unchanged.
- **A page break** (`kind: 'step'`, spec 0063; T20, 5 November 2026): the form builder's Steps, in the same list so they drag like a question. Drawn as an inline header on the ground, no card ("Step 2 · About you"), breath above it, its grip always shown, its name a button (`onStepPress`: the builder shows that page in its preview) and its end the caller's menu (`renderStepEnd`); `renderStepTitle` puts a field in the name's place while it is renamed. Under it, `renderOpen` draws its logic when the caller opens it, in a hairline box on the ground. Why a header and not a card: a card read as one more question, and "the whole steps thing is still not clear" (the owner); Tally's page breaks are a line in the list.
- **The gap above a row** (`renderGap`): a dashed accent line with a small action on it ("Split here"), over the `space-8` between two cards, shown while a pointer is over the gap or focus is in it, hidden under touch (the caller offers the same action in an open card's footer). Why a slot: only the list knows where the gap between two of its rows is.
- **An open question's own head** (`renderOpenHead`, T40, 5 November 2026: "cluttered and not proper"): the caller's type menu and the question's own field take the place of the tile and the two lines, so the question is typed in the head itself, with no second title above a Question field; the grip stays in the line before them, and the chevron becomes its own button ("Close Budget", `aria-expanded`). The field takes the head's room. Why a slot: only the list draws the head, and a head that is a button can't hold a field.
- **Gaps kept in view** (`gaps="shown"`, T39: "adding a step in between feels like a find"): the cards part by `space-24` instead of `space-8` and each gap's action shows all the time, quietly, to a pointer, the keyboard and touch alike; the dashed line comes only while it is pointed at or focused. The default, `hover`, keeps the old behaviour.
- **A note** (`kind: 'note'`, critique c, 7): what the caller draws (`renderOpen`) in the step body's hairline box, on the ground, with no head and no grip, where it sits among the rows: a step's rules under its last question, so a rule is read after the questions it reads. It never moves itself; rows move around it. Why a kind and not a slot: only the list knows where its rows go, and the rules belong between two of them.
- `condition` reads as a logic chip on the second line, the branch mark before it ("Shown if Role is Designer", T41).
- `isCountHidden` leaves the count out of the header, for a list whose rows are not questions (a form's After they send).
- **The header sticks** at the top of the view as a long list scrolls, on the page's surface, below whatever bar sticks above it (`--sticky-top`, which Tabs' bar sets), so Add a question is never clipped under the tabs (4 November 2026).
- `wideActions` sit before `actions` only where the list is 480px wide or more: a secondary button whose action the menu in `actions` holds too (a form's Add a step), so at a phone's width the header keeps one primary and the menu and pushes nothing off the row.
- An open question ends in a footer line under a hairline: `renderFooter` puts its actions (Duplicate, Delete) at its end, and `renderFooterStart` a closing choice at its start on the same line (the form builder's "Visitors must answer"). Why a slot: the actions alone sat in an empty corner under the last field (owner feedback F27, 20 October 2026).

## States

- An open question with its own head (`OpenHead`), gaps kept in view (`GapsShown`), and a note among the rows (`WithNote`).
- A page break (`kind: 'step'`), with and without its logic open under it, and the gap's action on hover or focus.
- Closed (the default), open (the head selected, its editor under a hairline, then its footer row: a choice at the start, Duplicate and Delete at the end), refused (`hasProblem`: the danger edge and "Needs a fix"), hover (the head filled), keyboard focus (the handle in the tile's place at once, the inset ring), untitled ("Untitled question", muted), dragging (faded, with the drop line), and read only (no handles).
- No questions: the header alone, with its count at 0 and its actions.
- With analytics (spec 0063, AC-6322): `stat` adds how the question performs as the last part of the second line, with `statTitle` as its tooltip saying what the figure is of. Both are left out on a form with no analytics, and on a question nobody has reached yet.

## Keyboard

- The arrow keys move between questions (with a question itself focused); Tab moves within one: its handle, its head and, when open, its fields; Enter or Space on the header opens and closes it.
- On the handle: Space or Enter lifts the question, the arrows move it while the others slide out of its way, Space or Enter drops it, Esc puts it back. Each step is announced.
- Keys typed in an open question's fields stay in the field: the list is in `tab` mode, so a row never takes arrows or type ahead from its children.

## Differs from the spec

Questions sort through the library's drag wrapper (dnd-kit, decided 13 October), as every other list does.
