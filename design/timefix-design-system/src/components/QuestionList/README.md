QuestionList is the form builder's Questions tab: the form's questions as cards; a question opens in the list's place, so the page keeps one editor column beside its one preview.

**Use it for**: building a form, a booking page's extra questions, any ordered list of questions a visitor answers. **Don't use it for** the answers themselves (HostedForm) or for reordering plain options (the settings' Choices list does that).

**The consumer provides**: `QuestionBuilder` takes `questions` and `onChange(questions)` and owns selection, duplicate, delete with Undo, and add. The parts stand alone: `QuestionList` (`questions`, `selectedId`, `onSelect`, `onReorder`, `onRequiredChange`, `onDuplicate`, `onDelete`, `onAdd`, `freshIds`, `notice`), `QuestionSettings` (`question`, `onChange`, optional `onClose`), `QuestionTypePicker` (`onPick`) and `QuestionTypeTile`. Types, names and icons come from HostedForm's `QUESTION_KINDS`, so the builder and the guest form never disagree.

**States**: empty list, cards at rest, hovered, selected (accent edge and ring), dragging (faint ghost, lifted preview, dashed slot), a fresh card dropping in, "Deleted · Undo", a question open ("All questions" back, "2 of 5").

**Interaction**: press a card (or arrow to it and Space) to open it in place; it slides in from the side (08) and "All questions" goes back. Adding or duplicating a question opens it. Drag a card by its grip, or focus the grip, Enter, arrows and Enter to drop. New and duplicated cards drop in at their place (rows 0fr to 1fr, 12px rise). Delete collapses into an Undo strip (21) for six seconds. "Add question" opens a two-column grid of types in the shared Popover (05) with its plus turned; arrows move through the grid, Enter adds.

**Replaces**: QuestionList, the question editor's shell, the form's OptionsEditor use and the question type menu.
