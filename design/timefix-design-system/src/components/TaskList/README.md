Tasks on a record or for a person, with an inline add row and a Completed fold.

**Use it for**: a record's Tasks section, My tasks, a meeting's follow-ups. **Don't** use it for checklists inside a form (Checkbox) or onboarding steps.

**The consumer provides**: `tasks` (`title`, `done`, `due` as a Date (the chip words it through the shared date format: Today, Tomorrow, Yesterday, else "13 Nov", and turns red once it has passed), `assignee`, `record`), `onToggle(id, done)`, `onAdd(title)` and `freshIds`.

**States**: open, due (grey chip), overdue (red chip "Overdue · Yesterday", "Overdue · 6 Nov"), done (struck through and greyed), all caught up, Completed folded or open.

**Interaction**: Space or a click ticks the round check; the tick draws itself (checkbox check, 350ms), the label strikes through, and after 700ms the row folds to nothing (250ms) and lands in "Completed (n)", whose count rolls. Unticking within that time keeps the row. Unticking a completed task drops it back into the open list. The add row is quiet until focused, then a filled input; Enter adds and the new task drops in, Esc clears.

**Replaces**: TaskList.
