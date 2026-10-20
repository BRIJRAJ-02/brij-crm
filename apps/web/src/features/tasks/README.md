# Tasks

Spec 0019, milestone 1: tasks on a record. My tasks (milestone 2) and deleting a task (milestone 4) come later; the side panel's Tasks tab waits for spec 0017's milestone 4 (the panel).

## A record's Tasks tab (TasksTab)

- **Purpose**: the follow ups about this record.
- **Main task**: add a task (type its title, press Enter) and tick it off.
- **Leaves out**: reminders (#28), tasks of related records, deleting a task (milestone 4).

## Overview's Open tasks block (OpenTasksCard)

- **Purpose**: a record's open tasks at a glance.
- **Main task**: see the first five, tick one, add one, or go on to the Tasks tab ("View all").
- **Leaves out**: completed tasks.

## The task dialog (TaskDialog)

- **Purpose**: everything about one task, on `?task=<id>` (or `?task=new`) over whichever tab opened it.
- **Main task**: set its title, when it's due, who has it and which records it is about.
- **Leaves out**: comments on tasks, reminders, subtasks, deleting it (milestone 4).

## Notes

- Every list reads the data layer's tasks store (`data.tasks.forRecord`, `one`, `create`, `update`, `setDone`), never the network. The route's loader starts the record's open tasks with the page, so the tab's count and Overview's block arrive with it (`useTaskTotal`, `useTaskList`). The tab's count is the open tasks, and none open shows no count rather than "0".
- The quick add and "New task" are one composer row at the field's height (the button's `lg` size). With nothing open, the list says so in one row under it and Completed follows at once.
- The quick add makes a task with the typed title, this record linked, assigned to the person (owner decision 1), no due date; it shows first with the "New" badge at once, and the field clears and keeps focus. The field stops typing at 2,000 characters (its count shows past 1,800), so it never sends a title the server refuses.
- A tick shows at once; the task stays in the open list struck through until the list settles (1.5 seconds after the last change in it), then moves to Completed. A refused tick rolls back with a toast and Retry.
- Completed is a Disclosure, closed by default; its done tasks are read when it first opens, newest done first, with their count.
- The record chip on each row is the first linked record that isn't this one, with "+N" for the rest (`entries.ts`); this record shows only when it is the only link. A removed assignee reads "Former member". A task the person may not change has read only checkboxes and fields with "You can view this task but not change it."
- The dialog's fields are the field set's own editors (Date, Member, record reference), committed one by one as Details commits (optimistic, the refusal under the field). The title is one line that wraps as it grows (Field's `isWrapping`; Enter commits), its count only near the limit. Assignee and Records are each one field, chips inside, the record picker's object switcher ("Search in") inside its menu above the search, starting on the page's object; a pick on an object the person may only read is refused under the field before anything is sent, and so is a 21st record. The search is spec 0014's `records.search` through `data.records.search` (`useRecordSearch` in `features/records/links.ts`): the 20 most recently updated with nothing typed, a name prefix for one or two characters, then names, emails and domains that contain the text, 150 ms after the last key. "Create task" closes the dialog at once; a refusal raises a toast with Retry. Under the fields, "Created by" names who made it and when, as the fields label their values (a stacked DescriptionList); "Copy link", an icon button with its tooltip in the title bar before Close, copies the page's address with `?task=`. A saved task has no footer. Deleting arrives with milestone 4, with the More menu.
- Opening the dialog pushes `?task=` (Back closes it); closing it steps back when this page opened it, else replaces the address.
- A task in the timeline reads "added a task" or "completed a task" with its title, which opens the dialog.
- Every string is in `strings.ts`.
