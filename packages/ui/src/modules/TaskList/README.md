# TaskList

To dos, each with a done checkbox, its title, the record it is about, its due day and who has it.

## Why it exists

New. The record page's Tasks tab and the My tasks page (#19) list tasks. It is a React Aria `GridList` (so a row can hold a checkbox and a link and still move by arrow), virtualised through React Aria's `Virtualizer` and fed by a `ListSource` (AC-9). Each part is an existing atom: `Checkbox`, a flat `RecordChip` and an `Avatar`. TaskItem is its row, not a component of its own.

## Use

```tsx
<TaskList
  label="Tasks"
  tasks={taskSource}
  onToggle={(task, isDone) => setDone(task.id, isDone)}
  onAction={(task) => openTask(task.id)}
/>
```

- A task has a `title`, `isDone`, and optionally `dueOn` (`YYYY-MM-DD`), an `assignee`, and the `record` it is about with `recordHref`.
- The due day reads Today, Tomorrow, Yesterday or the date, from today in the provider's time zone. Once it has passed on an open task, it turns the danger colour and reads "Overdue" first.
- Done tasks are struck through in the tertiary colour.
- `hideRecord` drops the record chip, on the record's own page.
- Give it a slot with a height: it scrolls inside it. Rows not loaded yet draw as skeletons, and `onRangeChange` hears which range is on screen.

## States

Default, done, overdue, loading (skeleton rows after the loading delay), empty, failed (with Try again), rows still loading. Hover on a row (pointer only), focus (the inset ring).

## Keyboard

Tab enters the list. The up and down arrows move between rows, left and right between a row's checkbox and record link. Space ticks the checkbox; Enter on a row opens the task.

## Differences from the artifact

Not in the artifact.
