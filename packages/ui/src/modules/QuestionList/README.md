# QuestionList

A form's questions as cards, closed until opened, that reorder by a handle or the keyboard.

## Why it exists

New. The form builder (spec 0023, `0023-experience.md`, Questions) needs cards that are closed until opened, with a summary when closed (the question, its answer type, Required, its choices, where it is filed) and an editor when open. OptionsEditor and SortBuilder reorder rows but have no closed and open states, and a Disclosure doesn't reorder; a variant of either would have bent its purpose. It is a React Aria `GridList` with drag and drop, the same pattern and the same `DragHandle` as SortBuilder and OptionsEditor; the editor inside a card is whatever the caller renders.

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

- The whole header opens and closes its card on press, Enter or Space; there is no hover fill.
- Reorder by the handle, with a drop line, or by the keyboard: focus the handle, Enter to pick up, arrows to move, Enter to drop, Esc to cancel. Each move is announced: "Budget, moved to position 3 of 6".
- `hasProblem` marks the card a publish refused; the caller keeps it open until it is fixed.
- Without `onMove` the list is read only and shows no handles.

## Differs from the spec

The spec names dnd-kit for drag (decided 13 October). This repo's lists still reorder with React Aria's drag and drop and `DragHandle`, so this one does too, and picks up with Enter rather than Space; it moves with the others when they change.
