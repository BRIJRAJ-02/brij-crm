# QuestionList

A form's questions as quiet hairline cards, closed until opened, that reorder by a handle or the keyboard.

## Why it exists

New. The form builder (spec 0023, `0023-experience.md`, Questions) needs questions that are closed until opened, with a summary when closed (the question, its answer type, Required, its choices, where it is filed) and an editor when open. OptionsEditor and SortBuilder reorder rows but have no closed and open states, and a Disclosure doesn't reorder; a variant of either would have bent its purpose. It is a React Aria `GridList` with drag and drop, the same pattern and the same `DragHandle` as SortBuilder and OptionsEditor; the editor inside an open row is whatever the caller renders.

Each question is a hairline card, space-8 apart (owner feedback F27, 20 October 2026, after a pass as 34px Table rows read as "too close"). Closed, a card is two lines with room around them, at least `size-row` plus `space-12` above and below: a type tile at the start (`typeIcon`, required, on a gray tile), the question with Required beside it, and under it in muted text the type, its choices and where it is filed ("Dropdown · 3 choices · Person › Budget band"; a form that keeps its submissions only leaves `filed` out, and the line stops after the choices); a chevron in a `size-input` square at the end. Why cards and not divided rows: at the builder's full width an open question holds its whole editor, and a card's edge bounds it and its footer, where hairline divided rows ran into each other; the gap separates questions without a heavier rule (the pattern Typeform's and Gumloop's builders use). They cannot be Card: each card is the list's `GridListItem` row itself, and Card's `section` and heading don't belong inside a grid row. They share LinkList's `comfortable` frame instead (`border`, `radius-md`, `surface-raised`, no shadow), so the library has no new card look.

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
- An open question ends in a footer line under a hairline: `renderFooter` puts its actions (Duplicate, Delete) at its end, and `renderFooterStart` a closing choice at its start on the same line (the form builder's "Visitors must answer"). Why a slot: the actions alone sat in an empty corner under the last field (owner feedback F27, 20 October 2026).

## States

- Closed (the default), open (the head selected, its editor under a hairline, then its footer row: a choice at the start, Duplicate and Delete at the end), refused (`hasProblem`: the danger edge and "Needs a fix"), hover (the head filled), keyboard focus (the handle in the tile's place at once, the inset ring), untitled ("Untitled question", muted), dragging (faded, with the drop line), and read only (no handles).
- No questions: the header alone, with its count at 0 and its actions.

## Keyboard

- The arrow keys move between questions (with a question itself focused); Tab moves within one: its handle, its head and, when open, its fields; Enter or Space on the header opens and closes it.
- On the handle: Space or Enter lifts the question, the arrows move it while the others slide out of its way, Space or Enter drops it, Esc puts it back. Each step is announced.
- Keys typed in an open question's fields stay in the field: the list is in `tab` mode, so a row never takes arrows or type ahead from its children.

## Differs from the spec

Questions sort through the library's drag wrapper (dnd-kit, decided 13 October), as every other list does.
