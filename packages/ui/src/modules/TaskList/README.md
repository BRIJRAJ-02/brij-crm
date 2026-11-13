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
- The records show as the field set's one row of records (`ChipRow`, as a record reference value shows everywhere): the first as a flat RecordChip (a link through `recordHref`), then "+N", which opens every one as a link.
- The due day reads Today, Tomorrow, Yesterday or the date (without its year when it is this year, "Oct 24", as Linear and Attio write it; the numeric format keeps the year), from today in the provider's time zone. Once it has passed on an open task, it turns red (`tag-red-text`, medium) with an alert icon, and reads "Overdue" first.
- Done tasks are struck through in the tertiary colour, and their due day goes tertiary too.
- `sectionOf(task)` answers the heading a task sits under (`{ id, title }`, My tasks' Overdue, Today, Upcoming, No date): a heading row draws before each run of tasks with the same section (React Aria's `GridListSection` and `GridListHeader`), announced as a row header and skipped by the arrows. Rows still loading stay in the run they follow.
- `layout="inline"` draws at most 10 rows in place, with no scroll of its own (Overview's Open tasks); `list` (the default) fills its slot and scrolls inside it.
- `maxRows` raises the inline layout's cap, for a list drawn in full in place (the Completed part); `onShowMore` then draws "Show more" under the rows for the next page, since an in place list has no scroll of its own to page by (it is not virtualised, so the screen hands it only loaded rows).
- `toolbar` and `footer` draw above and under the list in the module's own column, filling its slot (a record's quick add, and the Completed part, which scrolls inside itself past half the slot). The toolbar stays in every state, so the quick add is there when the list is empty. It is a composer row: give its buttons `size="lg"` so they match the 30px field, and it stops at `size-column-max`, so the button stays beside its field on a wide page. An empty list, in every layout, says so in one row (EmptyState's default `row`, 5 November 2026) and takes only that row, so Completed follows it rather than sinking to the foot of the slot. The footer provides `RowInset`, so a quiet Disclosure there (Completed) puts its chevron on the rows' checkboxes and its words on their titles. A short list does the same: the list takes only its rows' height, so Completed sits right under the last task; a long one stops at what the toolbar and Completed leave and scrolls inside itself (22 October 2026). Why slots: screens may not lay anything out themselves (no class names in the app), and the tab's three parts belong to this list.
- `newIds` marks tasks just made here with the accent "New" Badge (until the screen's list settles).
- `emptyTitle` and `emptyBody` say what an empty list means in the screen's own words ("No open tasks").
- `emptyActions` puts the way to start inside the empty state, under its words (a record's "New task"), as Attio and Twenty do. Why a prop: copy pointing elsewhere ("Add one above") made the person look for the control; the screen still owns the button, and it shows only while the list is empty.
- `hideRecord` drops the record chips.
- Under 480px of width (a phone, a narrow card) the title comes first: it keeps at least a narrow column, the record chip holds to the smallest column and is cut short, and the checkbox, due day and assignee never shrink.
- `isReadOnly` makes every checkbox read only (the viewer can't tick tasks). A task with a `readOnlyReason` has a read only checkbox and a `LockReason` saying why.
- `status`: `loading` (skeleton rows after the loading delay), `error` (one row, like its empty state: the alert mark and "Tasks didn't load" in the danger colour, "Check your connection and try again." under it, and Try again from `onRetry`), or `no-access`.
- Rows are keyed by their task, so when a ticked task leaves the list, focus and state stay with the right rows.
- Give it a slot with a height (the `list` layout): it scrolls inside it. Rows not loaded yet draw as skeletons, and `onRangeChange` hears which range is on screen.

## States

- In a narrow card (a record's Open tasks on a phone) the checkbox keeps its own box and never shrinks under the title, and a row with no due day gives that column's room to the title (QA, 22 October 2026: the box drew over the title's first letter).

Default, done, overdue, read only, a locked task, several records ("+N"), new, sections (and with rows still loading), inline (loading, empty, failed, and Show more), with the quick add and Completed, loading (skeleton rows after the loading delay), empty (the library's words or the screen's own), failed (with Try again), no access, rows still loading. Hover on a row (pointer only, a wash), pressed, focus (the outline ring).

## Keyboard

Tab enters the list. The up and down arrows move between rows (section headings are skipped), left and right between a row's checkbox, record link and "+N". Space ticks the checkbox; Enter on a row opens the task.

## Differences from the artifact

Not in the artifact. `record` and `recordHref` on a task gave way to `records` and the list's `recordHref(record)` (spec 0019), so one task can name several records; `recordCount` stays for a count past the listed ones but draws nothing of its own.

## Timefix prototype (spec 0072)

Takes its look from the prototype's task rows: `size-row` rows at `radius-md`, `space-8` in from the sides, a `border-subtle` hairline under each. The title is `text-body`; the parts after it sit `space-12` away (the title's `space-4` margin on the row's `space-8` gap). The due day is `text-body-sm` in `text-secondary` with tabular figures; overdue it is `tag-red-text` in `text-body-sm-strong`. A row washes `surface-subtle` under a pointer and `surface-hover` when pressed, over `duration-quick` on `ease-out`, its hairline giving way; the keyboard's row takes the outline ring just inside it, since the list clips. Section headings take the prototype's Completed fold's words: `text-body-sm-strong` in `text-secondary`. Reduced motion drops the colour transitions.

**Use it for** a record's Tasks tab, Overview's Open tasks, My tasks, a meeting's follow ups. **Don't use it for** checklists inside a form (Checkbox) or onboarding steps.

**The consumer provides** `tasks` (a `ListSource` of `{ id, title, isDone, dueOn?, assignee?, records?, recordCount?, readOnlyReason? }`), `onToggle(task, isDone)`, `onAction` to open a task, `recordHref`, and the quick add (`toolbar`) and Completed fold (`footer`, a quiet Disclosure holding an inline TaskList).

**States**: open, due (grey), overdue (red, "Overdue" first), done (struck through, greyed), read only and locked, new, with sections, inline, empty ("All caught up" is the screen's `emptyTitle`), loading, rows still loading, failed, no access, Completed folded or open (the footer's Disclosure).

**Interaction**: Space or a click ticks the checkbox; Enter or a click on the row opens the task; the arrows move between rows, left and right within one; hover washes the row (CSS only).

**Differences from the prototype**
- Rows stay `size-row` tall, not the prototype's `size-row` plus `space-8`: the virtualiser lays rows out at a fixed `size-row` (AC-14), so a taller row needs that height changed in the TSX, left for the lead.
- The hairline sits under every row, the last one too: the virtualiser wraps each row on its own, so no sibling rule can draw it only between rows.
- The checkbox is the library's square Checkbox: its `round` look (the prototype's round done circle) is owed to Checkbox (it needs a prop there), as Checkbox's README says.
- The due day has no calendar icon and the record and assignee keep their library parts (a flat RecordChip in the field set's chip row, an `xs` avatar; the prototype's is 20px); a done task's day steps down to `text-tertiary` rather than fading to `opacity-disabled`, which would take its text under 4.5:1.
- Not here: the strike, then fold, then move into "Completed (n)" after 700ms with the rolling count, unticking within that time, `freshIds` drop ins, the flag for high priority, the repeat mark, the due time, the hover open arrow and the built in add row. The screen owns ticking (`onToggle`), Completed (`footer`) and the quick add (`toolbar`); the timed fold is owed to the tasks screen phase.
- Kept beyond the prototype: `ListSource` paging with skeleton rows, `sectionOf` headings, `layout="inline"` with `maxRows` and `onShowMore`, `newIds` and the New badge, several records with "+N", `isReadOnly` and `readOnlyReason`, `hideRecord`, `status`, the empty words and action, `toolbar` and `footer` with RowInset; `isDone`, `dueOn` and `onAction` are the prototype's `done`, `due` and `onOpen`.
