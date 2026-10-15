# TaskList

To dos, each with a done checkbox, its title, the records it is about, its due day and who has it.

## Why it exists

New. The record page's Tasks tab, Overview's Open tasks block and the My tasks page (#19) list tasks. It is a React Aria `GridList` (so a row can hold a checkbox and a link and still move by arrow), virtualised through React Aria's `Virtualizer` and fed by a `ListSource` (AC-9). Each part is an existing atom: `Checkbox`, a flat `RecordChip`, `Badge`, `Tooltip` and an `Avatar`. TaskItem is its row, not a component of its own. Spec 0019 added variants rather than a new component: several records with "+N", section headings, the inline layout and the "New" badge.

## Use

```tsx
<TaskList
  label="Tasks"
  tasks={taskSource}
  recordHref={(record) => pageOf(record)}
  onToggle={(task, isDone) => setDone(task.id, isDone)}
  onAction={(task) => openTask(task.id)}
/>
```

- A task has a `title`, `isDone`, and optionally `dueOn` (`YYYY-MM-DD`), an `assignee`, and the `records` it is about, the one to show first, first (with `recordCount` when it is about more than `records` lists).
- The first record shows as a flat RecordChip (a link through `recordHref`); the rest as a "+N" Badge, whose Tooltip names them and whose hidden text reads "N more records".
- The due day reads Today, Tomorrow, Yesterday or the date, from today in the provider's time zone. Once it has passed on an open task, it turns the danger colour with an alert icon, and reads "Overdue" first.
- Done tasks are struck through in the tertiary colour.
- `sectionOf(task)` answers the heading a task sits under (`{ id, title }`, My tasks' Overdue, Today, Upcoming, No date): a heading row draws before each run of tasks with the same section (React Aria's `GridListSection` and `GridListHeader`), announced as a row header and skipped by the arrows. Rows still loading stay in the run they follow.
- `layout="inline"` draws at most 10 rows in place, with no scroll of its own (Overview's Open tasks); `list` (the default) fills its slot and scrolls inside it.
- `newIds` marks tasks just made here with the accent "New" Badge (until the screen's list settles).
- `emptyTitle` and `emptyBody` say what an empty list means in the screen's own words ("No open tasks. Add one above.").
- `hideRecord` drops the record chips.
- `isReadOnly` makes every checkbox read only (the viewer can't tick tasks). A task with a `readOnlyReason` has a read only checkbox and a `LockReason` saying why.
- `status`: `loading` (skeleton rows after the loading delay), `error` (with Try again from `onRetry`), or `no-access`.
- Rows are keyed by their task, so when a ticked task leaves the list, focus and state stay with the right rows.
- Give it a slot with a height (the `list` layout): it scrolls inside it. Rows not loaded yet draw as skeletons, and `onRangeChange` hears which range is on screen.

## States

Default, done, overdue, read only, a locked task, several records ("+N"), new, sections, inline, loading (skeleton rows after the loading delay), empty (the library's words or the screen's own), failed (with Try again), no access, rows still loading. Hover on a row (pointer only), focus (the inset ring).

## Keyboard

Tab enters the list. The up and down arrows move between rows (section headings are skipped), left and right between a row's checkbox, record link and "+N". Space ticks the checkbox; Enter on a row opens the task.

## Differences from the artifact

Not in the artifact. `record` and `recordHref` on a task gave way to `records`, `recordCount` and the list's `recordHref(record)` (spec 0019), so one task can name several records.
