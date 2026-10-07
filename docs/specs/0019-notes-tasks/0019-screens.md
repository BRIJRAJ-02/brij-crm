# 0019. The screens of notes and tasks

## Summary

Tasks show in three places: a record's Tasks tab (and the same tab in the side panel), the Open tasks block on Overview, and the My tasks page. They all use TaskList, and one task dialog edits a task with the field set's Date, Member and record reference editors. Notes show in a record's Notes tab as a list, and open in a window with the rich text editor that saves itself. One new library module (`NoteList`) and a few variants are needed; everything else composes what exists.

## Routes and search params (`apps/web/src/routes`)

| Route | Change | Params |
|---|---|---|
| `/w/$slug/objects/$object/$recordId/$tab` (spec 0017) | `$tab` also accepts `notes` and `tasks` | `task` (uuid or `new`), `note` (uuid or `new`), validated with Zod; anything else is dropped |
| `/w/$slug/objects/$object` (the table, spec 0017) | `panelTab` also accepts `notes` and `tasks` | `task`, `note` as above |
| `/w/$slug/tasks` (new, `w.$slug.tasks.tsx`) | My tasks | `filter` (`assigned` default, `created`, `all`), `status` (`open` default, `done`), `task` |

Opening a dialog or the note window pushes its param (so Back closes it); `?task=new` and `?note=new` are replaced by the id after the first save. Screen code lives in `apps/web/src/features/tasks/` and `apps/web/src/features/notes/` (new), each with its README brief and `strings.ts`.

## Library work (`packages/ui`)

Each gets a README, a story per state, the three browser tests, axe, a screenshot, `design-system-guardian`, then the artifact publish.

- **TaskList** (variants): `TaskEntry.record` and `recordHref` become `records: RecordRefDisplay[]` and `recordCount`, shown as the first record's flat RecordChip and "+N" (a Tooltip lists the others); `sectionOf(task) → { id, title } | undefined` draws a heading row before the first task of each section (headings are not focusable rows; the list's arrow keys skip them); `layout: 'list' | 'inline'` (`inline` draws at most 10 rows with no scroll of its own, for Overview); `newIds` marks tasks just created with the "New" Badge.
- **ReferencePicker** (variant): `objects` (`[{ id, label, icon, hue }]`), `objectId` and `onObjectChange` draw a Select above the search field to choose which object to search; without them nothing changes.
- **NoteList** (new module). Why new: no list in the library shows a document summary (title, a two line excerpt, author, time) and opens it; TaskList and ActivityFeed rows have other shapes. A React Aria `GridList`, virtualised, fed by a `ListSource<NoteListItem>` (`{ id, title, excerpt, author: ActorDisplay, updatedAt }`), each row: the title (or "Untitled note"), the excerpt in TruncatedText at two lines, the author's Avatar and name, RelativeTime "edited …". `onAction(id)` opens it. States: loading (skeleton rows after the loading delay), empty, error with Try again, rows still loading.
- **RichTextEditor** (prop, spec 0003's interface): `onChangeMaxWait?: number`, the most milliseconds `onChange` may wait while typing continues (2,000 here).

## A record's Tasks tab (page and panel)

Brief: Purpose: the follow ups about this record. Main task: add a task and tick it off. Leaves out: reminders (#28) and tasks of related records.

- At the top, a Field "Add a task" (placeholder "Add a task and press Enter"): Enter creates the task with that title, this record linked, assigned to me, no due date; the field clears and keeps focus. A title over 2,000 characters shows the Field's count in its error state and doesn't submit.
- "New task" (secondary Button) opens the dialog on `?task=new` with this record linked.
- TaskList (`hideRecord` is not used, because a task may link other records too; the chip shows the first linked record that isn't this one, or this one when it is alone), open tasks in their order, `onToggle` ticks, `onAction` opens the dialog.
- "Completed (<N>)": a Disclosure, closed by default, holding a second TaskList of the done tasks, loaded when first opened.
- States: loading, empty ("No open tasks. Add one above."), error with Try again; on a read only record (no `write` and not the creator or assignee) the field and "New task" are left out and checkboxes are read only with the rule's reason.

## Overview's "Open tasks" block (spec 0017's slot)

A Card, heading "Open tasks", TaskList `layout="inline"` with the first 5 open tasks, then "Add a task" (opens the dialog on `?task=new`) and "View all" (the Tasks tab). Empty: "No open tasks." with "Add a task".

## The task dialog

Brief: Purpose: everything about one task. Main task: set when it's due and who has it. Leaves out: comments on tasks, reminders, subtasks.

- Modal (dialog), title "Task" (or "New task").
- Fields, in order: Title (Field, multiline, a count to 2,000); Done (Checkbox; edit mode only); Due date (the field set's Date editor, `surface='form'`); Assignee (the field set's Member editor, single; a removed assignee reads "Former member"); Records (the field set's record reference editor, many, with ReferencePicker's object switcher, at most 20; a pick on an object the member can only read is refused under the field with "You can't link a task to a record you can't change.").
- Edit mode commits each field like Details: optimistic, rolled back with the message under the field on a refusal. A footer line "Created by <name> · <relative time>". Menu (the "More" icon button): "Copy link", "Delete task".
- New mode: the same fields, "Create task" (primary) and "Cancel"; "Create task" closes the dialog at once (optimistic) and the task shows in the lists it belongs to; refusals reopen nothing and show as a toast with Retry.
- A task that doesn't exist, was deleted, or is hidden: the dialog shows EmptyState "This task doesn't exist or you can't see it." with "Close".
- Read only (outside the change rule): every field read only with the reason "You can view this task but not change it."; no Delete.

## My tasks

Brief: Purpose: each person's to do list across the workspace. Main task: see what's due today and get it done. Leaves out: search and saved filters (#33, #20), other people's lists except through "All tasks".

- Sidebar: "My tasks" (icon `square-check`) above the Records section; it is the current item on this page.
- Top bar: "My tasks", and "New task" (primary) opening the dialog with no record linked.
- A Toolbar with two SegmentedControls: "Assigned to me", "Created by me", "All tasks"; and "Open", "Completed". Both write the address.
- TaskList filling the content area: open tasks with `sectionOf` giving "Overdue", "Today", "Upcoming", "No date"; completed tasks newest done first, no sections.
- Empty states: open and assigned "Nothing assigned to you. Tasks assigned to you show here."; open and created "You haven't created any open tasks."; open and all "No open tasks in this workspace."; completed "No completed tasks yet."
- Loading and error as TaskList's own states. Live: new, changed, ticked and reassigned tasks move at the next settle.

## A record's Notes tab (page and panel)

Brief: Purpose: what the team learned about this record. Main task: write a note and find it again. Leaves out: writing together in real time (#27) and comments (#29).

- "New note" (primary) opens the note window on `?note=new`.
- NoteList, last edited first, 20 at a time; a row opens the window on `?note=<id>`.
- States: loading, empty ("No notes yet. Write the first one."), error with Try again; on a read only record "New note" is left out.

## The note window

- Modal (window variant, the large size), labelled by the note's title.
- Header: the record's RecordChip (a link to its page), the save state text ("Saving…", "Saved", "Not saved. Retrying…", "Not saved." with a Retry Button), a menu ("Copy link", "Delete note"), and Close.
- A title Field without a visible label (labelled "Title" for screen readers), placeholder "Untitled note", up to 200 characters.
- NoteEditor (RichTextEditor in note mode) with `onChangeMaxWait={2000}`, mentions searched from the members store, the editor's code loaded lazily when the window first opens (a skeleton meanwhile).
- Notices as a Callout above the editor: "<Name> edited this note, so it now shows their version." (neutral) or "<Name> edited this note at the same time. Your version was saved over theirs." (warning); each closes with its own button and on the next save.
- Refusals: too long ("This note is too long to save. Split it into two notes.", from the session's own size check or the service's 422 `CONFIG_INVALID` on `content`) and unavailable ("This note isn't available. Its record may have been deleted, or you may not have access to it.") show as danger Callouts; the text stays for copying.
- A note that doesn't exist, was deleted, or is hidden, opened from a link: EmptyState with the unavailable message and "Close".
- Read only (no `write`): the editor and title read only, with the reason as a Callout; no Delete.
- Closing (Esc, Close, Back) with a pending save closes at once; the save continues in the data layer.

## Deleting

- "Delete task" and "Delete note" act at once (no confirm), close the dialog or window, and raise a toast "Task deleted" or "Note deleted" with "Undo" for 10 seconds.

## Keyboard and focus

- Quick add keeps focus in its field after Enter; a new task's row gets the "New" badge until the list settles.
- Dialogs and the note window take focus on open (the title field for a new task or note, else the dialog heading) and return it to their trigger on close; after a delete, focus returns to the list.
- TaskList and NoteList follow their READMEs; section headings in TaskList are announced as headings and skipped by arrow keys.
- `dxe quick`, `ux-interaction-reviewer` and `design-system-guardian` before each milestone lands.

## Rationale (short)

One dialog for every task, built from the field set's own editors, keeps a due date or an assignee looking and behaving exactly as a date or member attribute does everywhere else. Quick add makes the common case one line and one key. The note window is a dialog rather than a page, so a note opens over whatever you were doing and Back closes it, which matches how notes are read in the record's context.
