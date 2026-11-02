# Tasks

Spec 0019: tasks on a record (milestone 1), My tasks (milestone 2) and deleting a task (milestone 4). A task's own side panel reuses spec 0017's record panel shell (the simplify pass, 2 November 2026).

## A record's Tasks tab (TasksTab)

- **Purpose**: the follow ups about this record.
- **Main task**: add a task (type its title, press Enter) and tick it off.
- **Leaves out**: reminders (#28), tasks of related records.

## Overview's Open tasks block (OpenTasksCard)

- **Purpose**: a record's open tasks at a glance.
- **Main task**: see the first five, tick one, add one, or go on to the Tasks tab ("View all").
- **Leaves out**: completed tasks.

## The task panel (TaskPanel)

- **Purpose**: everything about one task, beside the page it opened from, on `?task=<id>`; `?task=new` is still a dialog.
- **Main task**: read it at a glance, tick it off with the panel's one quick action, and change its title, notes (a plain text Description, up to 5,000 characters, saved on leaving the field), due day, assignee and records in place.
- **Leaves out**: comments and an activity feed of its own (neither exists for a task: comments are record scoped), rich text in the description, reminders beyond the due day's inbox notice (the daily cleanup tells the assignee once, on the UTC day it is due), subtasks, a task's own full page (so the panel has no Expand).

## My tasks (MyTasksScreen)

- **Purpose**: each person's to do list across the workspace, on `/w/$slug/tasks` ("My tasks" in the sidebar, above Records).
- **Main task**: see what's due today and get it done.
- **Leaves out**: search and saved filters (#33, #20), other people's lists except through "All tasks".

## Notes

- Every list reads the data layer's tasks store (`data.tasks.forRecord`, `one`, `create`, `update`, `setDone`), never the network. The route's loader starts the record's open tasks with the page, so the tab's count and Overview's block arrive with it (`useTaskTotal`, `useTaskList`). The tab's count is the open tasks, and none open shows no count rather than "0".
- The quick add and "New task" are one composer row at the field's height (the button's `lg` size). With nothing open, the list says so in one row under it ("No open tasks", with New task under the words in place of the composer's button, as Attio and Twenty do) and Completed follows at once.
- The quick add makes a task with the typed title, this record linked, assigned to the person (owner decision 1), no due date; it shows first with the "New" badge at once, and the field clears and keeps focus. The field stops typing at 2,000 characters (its count shows past 1,800), so it never sends a title the server refuses.
- A task made here that lands at the top of the list drops in (`TaskList`'s `useDropIn`); the rest stay still, and in My tasks, grouped by day, a task with no due date lands in a later group and nothing animates.
- A tick shows at once; the task stays in the open list struck through until the list settles (1.5 seconds after the last change in it), then moves to Completed. A refused tick rolls back with a toast and Retry.
- Completed is a Disclosure, closed by default; its done tasks are read when it first opens, newest done first, with their count.
- The record chip on each row is the first linked record that isn't this one, with "+N" for the rest (`entries.ts`); this record shows only when it is the only link. A removed assignee reads "Former member". A task the person may not change has read only checkboxes and fields with "You can only view this task."
- My tasks under Assigned to me leaves out the assignee avatar: every row is the member's own, so the same face on each said nothing (as Home's My tasks card already did). Created by me and All tasks keep it.
- The panel is the library's `RecordPanel` with a task as its `subject` (its icon where a record's avatar sits, "Previous task" and "Next task" on the steps) and one `body` in place of tabs, so there is one panel shell in the app rather than two. Its width is `lg`. Previous and Next step through the list the panel sits beside: My tasks, and a record's Tasks tab (`stepTask` in `entries.ts`, one walk of the drawn rows, memoised, which never asks for a page: a neighbour not read yet simply disables the button). The open task's row stays marked and in view while they step (`TaskList`'s `openId`). Over another tab, or from the inbox, there is no list beside the panel, so no steps show. A step keeps the task on screen with the panel's thin progress line over it (`isStepping`) rather than emptying it. Done is the panel's one quick action ("Mark done" / "Reopen"), not a checkbox among the fields, and a refusal says so over them. Handing a task to somebody else raises "Task assigned" whose consequence line names who now has it, since nothing on screen shows that it reached them.
- The panel's fields are the field set's own editors (Date, Member, record reference), committed one by one as Details commits (optimistic, the refusal under the field). The title is one line that wraps as it grows (Field's `isWrapping`; Enter commits), its count only near the limit. Assignee and Records are each one field, chips inside, the record picker's object switcher ("Search in") inside its menu above the search, starting on the page's object; a pick on an object the person may only read is refused under the field before anything is sent, and so is a 21st record. The search is spec 0014's `records.search` through `data.records.search` (`useRecordSearch` in `features/records/links.ts`): the 20 most recently updated with nothing typed, a name prefix for one or two characters, then names, emails and domains that contain the text, 150 ms after the last key. "Create task" closes the dialog at once; a refusal raises a toast with Retry. Under the fields, "Created by" names who made it and when, as the fields label their values (a stacked DescriptionList). The More menu in the title bar, before Close, holds "Copy link" (the page's address with `?task=`) and "Delete task". A saved task has no footer.
- Opening the panel pushes `?task=` (Back closes it); closing it steps back when this page opened it, else replaces the address.
- A task in the timeline reads "added a task" or "completed a task" with its title, which opens the panel.
- My tasks reads `data.tasks.mine(workspace, filter, status)`: "Assigned to me" (the default), "Created by me" or "All tasks" (every task the person may see), and "Open" or "Completed", both in the address (`?filter=`, `?status=`; the defaults left out). The two switches sit in SectionBar's `bar` variant rather than a Toolbar, so each SegmentedControl keeps its own arrow keys; a switch on the page draws the new list loading in place, with no pending frame, so focus stays on the switch.
- Open tasks group under Overdue, Today, Upcoming and No date by the browser's local day (`day.ts`); a timer set for the next local midnight (checked again when the tab is shown) moves them, with no server call. Completed tasks list newest done first, with no groups.
- "Delete task" in the panel's More menu (beside "Copy link") acts at once, with no confirm: the task leaves every list and the dialog closes, with "Task deleted" and Undo for 10 seconds.
- Every string is in `strings.ts`.
