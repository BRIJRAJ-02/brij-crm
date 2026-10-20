# QuestionList

A form's questions as compact rows, closed until opened, that reorder by a handle or the keyboard.

## Why it exists

New. The form builder (spec 0023, `0023-experience.md`, Questions) needs questions that are closed until opened, with a summary when closed (the question, its answer type, Required, its choices, where it is filed) and an editor when open. OptionsEditor and SortBuilder reorder rows but have no closed and open states, and a Disclosure doesn't reorder; a variant of either would have bent its purpose. It is a React Aria `GridList` with drag and drop, the same pattern and the same `DragHandle` as SortBuilder and OptionsEditor; the editor inside an open row is whatever the caller renders.

The questions are Table's rows, not cards (owner feedback F27, 20 October 2026): `size-row` tall, divided by hairlines under one hairline, each on one line (the handle, the question, its type Badge, Required, its choices, where it is filed at the end, a chevron), with Table's hover fill and its accent drop line. Stacked cards were a second card style beside Card, and four questions filled the column.

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

- The whole line opens and closes its row on press, Enter or Space; a pointer's hover fills it, as a Table row.
- Reorder by the handle, with a drop line, or by the keyboard: focus the handle, Enter to pick up, arrows to move, Enter to drop, Esc to cancel. Each move is announced: "Budget, moved to position 3 of 6".
- `hasProblem` marks the row a publish refused (a danger edge at its start and "Needs a fix"); the caller keeps it open until it is fixed.
- Without `onMove` the list is read only and shows no handles.
- An open row ends in a footer line under a hairline: `renderFooter` puts the row's actions (Duplicate, Delete) at its end, and `renderFooterStart` a closing choice at its start on the same line (the form builder's "Visitors must answer"). Why a slot: the actions alone sat in an empty corner under the last field (owner feedback F27, 20 October 2026).

## States

- Closed (the default), open (its editor under a hairline, then its footer row: a choice at the start, Duplicate and Delete at the end), refused (`hasProblem`: the danger edge and "Needs a fix"), untitled ("Untitled question", muted), dragging (faded, with the drop line), and read only (no handles).
- No questions: the header alone, with its count at 0 and its actions.

## Keyboard

- Tab moves through each row's handle, its line and, when open, its fields; Enter or Space on the header opens and closes it.
- On the handle: Enter picks the row up, arrows choose the drop line, Enter drops it, Esc cancels. The move is announced.
- Keys typed in an open row's fields stay in the field: the list is in `tab` mode, so a row never takes arrows or type ahead from its children.

## Differs from the spec

The spec names dnd-kit for drag (decided 13 October). This repo's lists still reorder with React Aria's drag and drop and `DragHandle`, so this one does too, and picks up with Enter rather than Space; it moves with the others when they change.
