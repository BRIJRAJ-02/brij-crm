# 0019. Notes and tasks: the work next to the data

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Members add notes and tasks to any record of any object. A note belongs to one record and is written in the rich text editor; it saves itself as you type, and when two people edit one note at once the last save wins and both are told. A task has a title, a due date, a done state, one assignee and any number of linked records (none is fine); each person has a My tasks page grouped into Overdue, Today, Upcoming and No date. Notes and tasks appear on the record page, in its timeline, and live for everyone who may see them. They are their own tables, not records, and they follow their records into the trash and back.

## Structure

- [0019-screens.md](0019-screens.md): the Tasks and Notes tabs, the task dialog, the note window, My tasks, the Overview block, every state, and the library work.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #17 record page (spec 0017) | the page and panel tabs, Overview's blocks, `ACTIVITY_SOURCES` | none: hard prerequisite (milestone 1 here starts after #17's milestone 2) |
| #4 component library (spec 0003) | milestone 4's `RichTextEditor` and `NoteEditor` (`@crm/ui/editor`) | none: milestone 3 here (notes) waits for it. Milestones 1 and 2 (tasks) don't need it |
| #7 realtime (spec 0007) | outbox kinds `notes` and `tasks`, `item_ids`, the rule that non engine writes run through `runWrite` with the `writeHooks` composer and record their ids in the `Change` so `outboxHook` stores their rows (AC-82), the live router (`live.on`), coarse handling | if #7's milestone 1 and 2 haven't landed: add `notes` and `tasks` to the `outbox_kind` enum, add `item_ids uuid[] not null default '{}'`, teach `outboxHook` the two `Change` fields below, and add both event shapes exactly as spec 0007 writes them; #7 keeps them |
| #9 access model (spec 0009) | `inWorkspace`, the access table, the record check, object levels, and the task visibility rule (spec 0009's Decision) | none: the open policy applies until #24, and the rules here call the same functions |
| #8 background jobs (spec 0008) | `maintenance.daily`, to which this spec adds a phase | none: until #8 lands, deleted notes and tasks stay hidden and unpurged (nothing runs on a timer) |
| #6 client data (spec 0006) | the members store, the settle delay and the offline retry schedule | none |
| #15 relations (spec 0014) | `records.search` and `ReferencePicker` for linking records to a task | none: hard prerequisite through #17 |
| #22, #28, #27, #33 | the Trash screen, reminders and assignment notices, shared editing with versions, search over notes | none: each is named in Follow-up |

## Requirements

**User stories**:
- As a member, I want to add a task to a record with a due date and someone to do it, so follow ups don't live in my head.
- As a member, I want one list of my tasks, grouped by when they're due, so I know what to do today.
- As a member, I want to write notes on a record that save themselves, so I never lose what I learned on a call.
- As a member, I want notes and tasks to show on the record and in its timeline, live, so my team sees the work as it happens.
- As a member, I want a deleted record's notes and tasks to come back when it is restored, so a mistake costs nothing.

**Acceptance criteria** (this spec owns AC-432 to AC-461):

*Tasks*
- **AC-432**: A member adds a task from a record's Tasks tab (the "Add a task" field: type the title, press Enter), from the task dialog's "New task" on that tab, on Overview's Open tasks block, and on My tasks. A task has a title (1 to 2,000 characters, required), an optional due date, at most one assignee (an active member; it starts as the member creating it and can be cleared), and 0 to 20 linked records from any objects (created from a record, that record starts linked). It shows at once and in every other open browser that may see it within 1 second.
- **AC-433**: Ticking a task's checkbox marks it done and records who and when; unticking clears both. In an open list a task just ticked stays in place struck through until 1.5 seconds pass with no other tick in that list, then leaves it. A refusal rolls the checkbox back with the message as a toast with Retry.
- **AC-434**: The task dialog (`?task=<id>`, or `?task=new`) edits the title, due date, assignee and linked records, each saved when it is committed (as Details on the record page), and shows who created it and when. The due date and assignee use the field set's Date and Member editors; linked records use the record picker with an object switcher. Two people changing one task at once: the last save of each field wins, and the screen shows it live.
- **AC-435**: A record's Tasks tab lists the open tasks linked to it, by due date (earliest first, no date last, then oldest first), and a "Completed" part, closed by default, listing its done tasks newest done first. The tab's label carries the open count ("10,000+" past 10,000). Overview's "Open tasks" block shows the first 5 open tasks and "View all" (the Tasks tab), and "Add a task".
- **AC-436**: My tasks (`/w/$slug/tasks`, "My tasks" in the sidebar) shows, by default, open tasks assigned to me, grouped Overdue, Today, Upcoming and No date by my browser's local date, each group in due date order. A filter switches between "Assigned to me", "Created by me" and "All tasks" (every task I may see), and a status switch between "Open" and "Completed" (newest done first, no groups). The choice is in the address (`?filter=`, `?status=`). Lists load 50 at a time as I scroll and stay live.
- **AC-437**: An open task whose due date is before today in the viewer's time zone shows as overdue (TaskList's danger state). At local midnight, groups and overdue marks move without a reload and without any server call.
- **AC-438**: A task appears in each linked record's Activity as "added a task" (when it was linked to that record) and "completed a task" (when it was done), with its title; clicking it opens the task dialog. Unlinking a task removes its entries from that record's timeline.

*Notes*
- **AC-439**: "New note" on a record's Notes tab opens the note window (`?note=new`) with an empty title and body. Nothing is stored until the title or the body holds text; the first save creates the note and the address becomes `?note=<id>`. Closing a new note that never held text stores nothing.
- **AC-440**: A note saves itself 300 ms after typing stops and at least every 2 seconds while typing continues. The window shows "Saving…", "Saved" or "Not saved. Retrying…"; a save failing for lack of a network retries for 30 seconds, then shows "Not saved." with Retry and keeps the text. Leaving the page with an unsaved note asks the browser's "Leave site?" question. Closing the window while a save is pending lets it finish in the background; if it then fails, a toast "Your note wasn't saved." offers "Open note", which reopens it with the text.
- **AC-441**: The body is the rich text editor in note mode (headings, lists, task lists, links, quotes, code, mentions of members); what it can't hold is dropped on paste. The title holds up to 200 characters. A body over 200 KB is refused with "This note is too long to save. Split it into two notes." and nothing is lost from the screen.
- **AC-442**: A record's Notes tab lists its notes, last edited first, each with its title ("Untitled note" when empty), the first 200 characters of its text, its author and when it was last edited; 20 at a time as you scroll; live. The tab's label carries the count.
- **AC-443**: When someone else saves a note I have open: if I have nothing unsaved, within 1 second my window shows their version with "<Name> edited this note, so it now shows their version."; if I have unsaved text, mine is saved over theirs and I see "<Name> edited this note at the same time. Your version was saved over theirs." Their window then shows mine, with the first message. The note's history is not kept (#27 adds versions).
- **AC-444**: A note appears in its record's Activity as "added a note" at the moment it was created, with its title and the start of its text; clicking it opens the note.

*Deleting, the trash and restore*
- **AC-445**: Deleting a task or a note (from its dialog or window menu, with no confirm) hides it everywhere at once and raises a toast "Task deleted" or "Note deleted" with "Undo" for 10 seconds, which brings it back exactly as it was. A deleted task or note is removed for good after 30 days by the daily cleanup.
- **AC-446**: When a record goes to the trash, its notes disappear from every screen (an open note window shows "This note isn't available. Its record may have been deleted, or you may not have access to it."), and every task loses that record from its linked records, staying otherwise unchanged. Restoring the record brings all of it back. Purging or erasing the record deletes its notes and its task links for good; the tasks themselves stay.

*Across the feature*
- **AC-447**: Access follows spec 0009. A note is visible only when its record is; adding, editing or deleting it needs `write` on the record's object. A task is visible when it has no live linked records, or the viewer is its assignee or creator, or at least one linked record is visible to them; linked records the viewer can't see are left out of what they see and are never removed by their edits, but still count toward the 20. A visible task can be changed by its assignee, its creator, anyone when it has no linked records, and anyone with `write` on the object of at least one linked record they can see; anyone else gets 403 `FORBIDDEN` "You can view this task but not change it.". Hidden notes and tasks are absent from lists, counts, activity and events, exactly as if they didn't exist. A test with injected rules proves each.
- **AC-448**: Every note and task write that changes something stores one outbox row (`notes` with the note's id and its record; `tasks` with the task's id and every record linked before or after the write) in the same transaction; a refused write stores none. Other browsers update from these events only, never by polling.
- **AC-449**: Creating a task with a client minted id, then repeating the call after a lost answer, returns the same task and writes nothing twice; a note's id works the same way for its first save. An id already used by another task, or by a note on another record, answers 409 `ID_TAKEN`.
- **AC-450**: On a seed with 100,000 tasks and 100,000 notes in one workspace, the first page of My tasks (each filter and status), of a record's Tasks tab and of its Notes tab each return within 300 ms at p95 in the database call; numbers in `verify.md`.
- **AC-451**: Every screen part here is built from tokens and library components only, works fully by keyboard with a visible focus ring, meets contrast in light and dark, and the editor's code loads only when a note opens, so the first load stays under 250 kB. Each milestone runs in production.

## Decision

**Chosen option**: Option 1: notes and tasks as their own tables (`notes`, `tasks`, `task_records`) beside the records engine, written through small services in `packages/core` that store their own outbox rows, and read through stores in `packages/data` that keep one copy of each note and task.

Calls made here (the brief's and the owner's, plus the gaps they left):
- Own tables, not system objects (brief). Tasks have one assignee and many linked records, zero allowed (owner decision, 3 October 2026).
- A note has one parent record, Tiptap JSON plus a plain text copy and a title; autosave at 300 ms; last write wins with a notice; no versions; a window on `?note=<id>`; a client minted id; nothing stored until there is content (brief).
- A task title up to 2,000 characters, `is_done` with `done_at` and `done_by`, `due_on` as a date, no reminders (brief).
- Tasks tab, Overview open tasks, activity entries, My tasks with Overdue, Today, Upcoming and No date and the three filters (brief).
- Access follows the record, with spec 0009's task rule (brief and spec 0009).
- Trash hides notes and task links; restore brings them back; purge and erase delete them (brief).
- **A new task is assigned to the member creating it** (added; Attio's default; listed for the owner).
- **Anyone who may see a task and write one of its records may change it** (added; listed for the owner).
- **Deleting a note or a task is undoable for 10 seconds and kept hidden for 30 days** before the daily cleanup removes it (added; listed for the owner).
- **At least every 2 seconds while typing** a note saves (added: 300 ms after a pause alone would never save during a long dictation).
- **Tasks have no replaced notice** (added): a task's fields are short and show live; the notice is kept for record values and notes.

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `tiptap` (`ueberdosis/tiptap`, `.claude/skills/tiptap/`) · `drizzle` (`.claude/skills/drizzle/`) · `neon-postgres` (`.claude/skills/neon-postgres/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`) · `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `tanstack-router-best-practices` (`.claude/skills/tanstack-router-best-practices/`) · `react-aria` (`.claude/skills/react-aria/`) · `stories` (`.claude/skills/stories/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model

Two migrations: `tasks` and `task_records` in milestone 1, `notes` in milestone 3. Every table has forced row level security with the standard policy, and the guard tests list them.

| Table | Columns | Keys, checks and indexes |
|---|---|---|
| `tasks` | `workspace_id`; `id` uuid v7 (client chosen); `title` text not null; `is_done` boolean not null default false; `done_at` timestamptz null; `done_by_*` actor columns null; `due_on` date null; `assignee_member_id` uuid null; audit columns (`created_*`, `updated_*`); `deleted_at` timestamptz null; `deleted_by_*` actor columns null | Primary key (`workspace_id`, `id`). Foreign key (`workspace_id`, `assignee_member_id`) → `members`. Checks: `char_length(title) between 1 and 2000`; `is_done = (done_at is not null)`; `(done_at is null) = (done_by_type is null)`; `(deleted_at is null) = (deleted_by_type is null)`. Indexes, all `where deleted_at is null`: `tasks_assigned_open` (`workspace_id`, `assignee_member_id`, `due_on` nulls last, `created_at`, `id`) `and not is_done`; `tasks_created_open` (`workspace_id`, `created_by_member_id`, `due_on` nulls last, `created_at`, `id`) `and not is_done`; `tasks_all_open` (`workspace_id`, `due_on` nulls last, `created_at`, `id`) `and not is_done`; `tasks_assigned_done` (`workspace_id`, `assignee_member_id`, `done_at` desc, `id`) `and is_done`; `tasks_created_done` (`workspace_id`, `created_by_member_id`, `done_at` desc, `id`) `and is_done`; `tasks_all_done` (`workspace_id`, `done_at` desc, `id`) `and is_done`. Plus `tasks_trashed` (`workspace_id`, `deleted_at`) `where deleted_at is not null` |
| `task_records` | `workspace_id`; `task_id`; `record_id`; `position` smallint not null; `created_at` timestamptz not null; `created_by_*` actor columns | Primary key (`workspace_id`, `task_id`, `record_id`). Foreign keys (`workspace_id`, `task_id`) → `tasks` `on delete cascade` and (`workspace_id`, `record_id`) → `records` `on delete cascade`. Index `task_records_by_record` (`workspace_id`, `record_id`, `created_at` desc, `task_id`), which also serves the cascade. At most 20 rows per task, checked by the service under the task's row lock |
| `notes` | `workspace_id`; `id` uuid v7 (client chosen); `record_id` uuid not null; `title` text not null default `''`; `content` jsonb not null (a `RichTextDoc`); `content_text` text not null default `''`; `version` integer not null default 1; audit columns; `deleted_at`, `deleted_by_*` | Primary key (`workspace_id`, `id`). Foreign key (`workspace_id`, `record_id`) → `records` `on delete cascade`. Checks: `char_length(title) <= 200`; `char_length(content_text) <= 100000`; deleted pair as above. Indexes: `notes_by_record` (`workspace_id`, `record_id`, `updated_at` desc, `id`) and `notes_by_record_created` (`workspace_id`, `record_id`, `created_at` desc, `id`), not partial (they also serve the cascade); `notes_trashed` (`workspace_id`, `deleted_at`) `where deleted_at is not null` |
| `outbox` | `kind` gains `notes` and `tasks`, and `item_ids` exists (spec 0007, or its thin slice per Dependencies) | as spec 0007 |

`content_text` is derived on the server from `content` by `richTextToPlain(doc)` (pure, in `packages/contracts/src/notes.ts`, new): text nodes in order, a line break between blocks, a mention as `@` plus its label, cut to 100,000 characters. The client never sends it.

**State transitions**:
- Task: `open` ⇄ `done`; any ⇄ `deleted` (restore within 30 days) → removed by the daily cleanup.
- Note: (not stored) → `live` on the first save with text; `live` ⇄ `deleted` → removed by the daily cleanup.
- A record's trash, restore, purge and erase act on notes and task links only through the reads (trash and restore) and the foreign keys (purge and erase); no note or task row changes when a record is trashed.

### Services (`packages/core/src/tasks/` and `packages/core/src/notes/`, new)

Each write runs in one `runWrite` with the scope it was given and the API's `writeHooks` composer (spec 0007 AC-82), and each read in `inWorkspace`; each has an access table entry. A write that changes something records it in the `Change` through `context.record`: this spec adds `Change.notes: { noteId, recordId }[]` and `Change.tasks: { taskId, recordIds }[]` (`recordIds` = every record linked before or after the write), and `outboxHook` writes one `notes` row (`item_ids` the note ids, `record_ids` their records) and one `tasks` row (`item_ids` the task ids, `record_ids` the union of their records) per write, taking the counter row last. A write that changes nothing records nothing, so no row is stored.

| Service | What it does |
|---|---|
| `createTask(scope, { id, title, dueOn?, assigneeMemberId?, recordIds? })` | a replay of a live task with this id created by the same actor returns it; any other existing id is `ID_TAKEN`. Checks the title (1 to 2,000 after trimming the ends), the assignee (an active member, else `NOT_FOUND` "That member isn't in this workspace."), and each record (live and visible through the record check, else `NOT_FOUND` "That record does not exist."; at most 20, else `LIMIT_REACHED` "A task links at most 20 records."). Locks each record `for share` so a concurrent trash or purge waits. Inserts the task and its links (positions in input order). Outbox `tasks` with the task id and the record ids |
| `updateTask(scope, { taskId, title?, dueOn? (null clears), assigneeMemberId? (null clears), isDone?, addRecordIds?, removeRecordIds? })` | locks the task `for update`; checks the change rule (AC-447); applies only the given fields; `isDone: true` on an open task sets `done_at = now()` and `done_by`, `false` clears them, the same value changes nothing; adds links (visible, live, the 20 cap counting every current link, hidden ones included) and removes links (only ones the caller can see; others are ignored). Nothing changed means no write and no outbox row. Outbox `tasks` with the task id and every record linked before or after |
| `deleteTask`, `restoreTask(scope, { taskId })` | sets or clears `deleted_at` and `deleted_by` under the change rule; restore is refused after 30 days by the cleanup having removed it (`NOT_FOUND`) |
| `getTasks(scope, { ids })` | up to 100 visible, live tasks as `TaskView`; others left out |
| `listTasks(scope, { scope: { record } \| { mine: 'assigned' \| 'created' \| 'all' }, status, cursor?, limit })` | the keyset lists in value sourcing, with `total` on the first page |
| `saveNote(scope, { id, recordId, title?, content?, baseVersion? })` | upsert. When the id is new: the record live, visible and `write` (else `NOT_FOUND` or `FORBIDDEN`), the title or the content's text non empty after trimming (else `CONFIG_INVALID` "Write something first."), the content at most 200 KB as UTF-8 JSON (else 413 `PAYLOAD_TOO_LARGE`), then insert with version 1. When it exists: the same `recordId` (else `ID_TAKEN`), locked `for update`, not deleted (else `NOT_FOUND`), write the given fields, `version = version + 1`, and when `baseVersion` differs from the stored version, answer `overwrote: { by: <the previous updated_by>, at: <the previous updated_at> }`. Unchanged title and content write nothing. Outbox `notes` with the note id and its record |
| `getNote(scope, { noteId })`, `listNotes(scope, { recordId, cursor?, limit })` | a live, visible note with its content; the record's notes as summaries |
| `deleteNote`, `restoreNote(scope, { noteId })` | as tasks; restore refused with `RECORD_DELETED` "Restore the record first." while its record is in the trash |
| activity sources (registered in spec 0017's `ACTIVITY_SOURCES`) | `note` (rank 4): the record's live notes by `created_at`, actor `created_by`, title or "Untitled note", the first 200 characters of `content_text`. `task` (rank 5): each visible live task linked to the record, once at `task_records.created_at` by its `created_by` ("added a task") and, when done, once at `tasks.done_at` by `done_by` ("completed a task") |
| `maintenance.daily` phase `notes_tasks` (spec 0008) | after the record purge phase: delete notes and then tasks whose `deleted_at` is older than `RESTORE_WINDOW` (30 days), 500 per batch, until a batch comes back short |

**The task visibility predicate** (built from spec 0009's record rule compiler, applied in every task read): `not exists (a live linked record) or t.assignee_member_id = $me or t.created_by_member_id = $me or exists (a linked record that is live and passes the viewer's record rule for its object, and whose object is not at level none)`. With the open policy (every role until #24) it compiles to nothing, so the SQL is the plain list query. Linked records are filtered the same way inside `TaskView.records`.

### API surface

oRPC on `/api/rpc`; each through the `member` door; writes take a `mutationId` (passed to the `writeHooks` composer) and nudge the worker like every write procedure (spec 0008). Refusals answer `{ code, message, data?: { refusals } }`.

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `tasks.create` | `workspace`, `id` uuid v7, `title`, `dueOn?` (`YYYY-MM-DD`), `assigneeMemberId?`, `recordIds?` (≤ 20), `mutationId` | `TaskView` | member | 404 `NOT_FOUND` (an assignee or a record that is missing, trashed or hidden); 409 `ID_TAKEN`, `LIMIT_REACHED`; 400 `INPUT_INVALID` |
| `tasks.update` | `workspace`, `taskId`, `title?`, `dueOn?` (null clears), `assigneeMemberId?` (null clears), `isDone?`, `addRecordIds?` (≤ 20), `removeRecordIds?` (≤ 20), `mutationId` | `TaskView` | member; the change rule | 403 `FORBIDDEN`; 404; 409 `LIMIT_REACHED`; 400 |
| `tasks.delete`, `tasks.restore` | `workspace`, `taskId`, `mutationId` | `TaskView` (restore) or nothing | member; the change rule | 403; 404 |
| `tasks.get` | `workspace`, `ids` (1 to 100) | `TaskView[]` (missing, deleted and hidden ids left out) | member | 404 (workspace only) |
| `tasks.list` | `workspace`, `scope`: `{ recordId }` or `{ mine: 'assigned' \| 'created' \| 'all' }`, `status`: `open` or `done`, `cursor?`, `limit` 1 to 100 (default 50) | `{ items: TaskView[], nextCursor?, total?: { count, atLeast } }` (`total` only without a cursor) | member | 404 (also a hidden or trashed record); 422 `FILTER_INVALID` (a bad cursor) |
| `notes.save` | `workspace`, `id` uuid v7, `recordId`, `title?`, `content?` (`RichTextDoc`), `baseVersion?` (integer or null for a new note), `mutationId` | `{ note: NoteSummary, overwrote?: { by: Actor, at } }` | member; `write` on the record's object | 403; 404; 409 `ID_TAKEN`; 413 `PAYLOAD_TOO_LARGE`; 422 `CONFIG_INVALID` |
| `notes.get` | `workspace`, `noteId` | `Note` (`NoteSummary` plus `content`) | member | 404 |
| `notes.list` | `workspace`, `recordId`, `cursor?`, `limit` 1 to 50 (default 20) | `{ items: NoteSummary[], nextCursor?, total?: { count, atLeast } }` | member | 404; 422 `FILTER_INVALID` |
| `notes.delete`, `notes.restore` | `workspace`, `noteId`, `mutationId` | `NoteSummary` (restore) or nothing | member; `write` | 403; 404; 409 `RECORD_DELETED` |

**Shapes** (Zod in `packages/contracts/src/tasks.ts` and `notes.ts`, new): `TaskView { id, title, isDone, doneAt?, doneBy?: Actor, dueOn?, assigneeMemberId?, records: RecordRefDisplay[] (visible, live, by position), recordCount (visible, live), createdAt, createdBy: Actor, updatedAt }`. `NoteSummary { id, recordId, title, excerpt, version, createdAt, createdBy: Actor, updatedAt, updatedBy: Actor }`. `Note = NoteSummary & { content: RichTextDoc }`.

**Status codes**: as spec 0005, plus 403 `FORBIDDEN` (spec 0009) and 413 `PAYLOAD_TOO_LARGE` (request level, exists). No new code.

**Events** (spec 0007's shapes): `{ kind: 'notes', recordIds: [recordId], noteIds: [id] }` and `{ kind: 'tasks', recordIds: [...linked before or after], taskIds: [id] }`, with `mutationId`.

### Data layer (`packages/data`)

- **One copy of each task**: a task store keyed by id holding `TaskView` bodies; every list holds ids. `tasks.forRecord(workspace, recordId, status)`, `tasks.mine(workspace, filter, status)` return `{ source: ListSource<TaskEntry>, total, status, retry }` with pages from `tasks.list`; `tasks.one(workspace, id)` serves the dialog.
- **Task writes are optimistic** (spec 0005's layering rule): `create` inserts the body and puts its id first, marked new, in every loaded open list it belongs to (the record lists of its linked records; My tasks "Created by me" and "All tasks"; "Assigned to me" when the assignee is the current member) until that list settles; `update` and `setDone` change the body at once; a refusal rolls back with a toast and Retry. Each list settles (rereads its loaded pages) 1.5 seconds after the last change in it (`SETTLE_MS`, spec 0006), which is when a ticked task leaves an open list and a moved due date takes its place.
- **Task events**: a `tasks` event refetches the held bodies it names (`tasks.get`, 100 ids a call) and marks dirty every loaded record list whose record it names and every loaded My tasks list; dirty lists settle. A `coarse` `tasks` event refetches every held task body and marks every loaded task list dirty; a `coarse` `notes` event rereads every loaded note list and the open note. A `records` event with deleted, restored or purged ids refetches the held tasks linking those records and marks those records' lists dirty.
- **Notes**: `notes.forRecord(workspace, recordId)` (pages of 20, a `notes` event naming the record rereads its loaded pages, at most twice a second); `notes.open(workspace, { noteId | 'new', recordId })` returns a session `{ status, title, doc, saveState, notice?, setTitle, setDoc, flush, close }`:
  - a new session sends nothing until the title or the doc's text is non empty; its first save mints nothing new (the id was minted when the window opened);
  - title changes wait 300 ms after the last keystroke, at most 2 seconds; doc changes come from the editor's `onChange` (300 ms, with a 2 second max wait); one save in flight at a time, the latest state sent next;
  - a failed save with no response retries after 1, 2, 4, 8 and 15 seconds (spec 0006's offline schedule), then `saveState: 'failed'` with Retry; a refusal stops at once with its message;
  - `baseVersion` is the version of the last save or read this session applied; an `overwrote` answer sets the "saved over theirs" notice;
  - a `notes` event for the open note with a higher version and another `mutationId`: with nothing unsaved, the session reads `notes.get` and replaces title and doc (the window remounts the editor keyed by version) with the "now shows their version" notice; with unsaved changes it keeps them and the next save answers `overwrote`;
  - `close()` keeps the session alive until its pending save lands; a `beforeunload` handler asks while any session has unsaved or failed changes.
- Nothing polls. Day boundaries for My tasks recompute from a browser timer set to the next local midnight, which calls no server.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| task create | id | the client's uuid v7, minted when the dialog or quick add opens |
| task create | default assignee | the current member's id (`me` in the definitions store) |
| task create | linked record from a record page | the page's record id |
| task create | links' positions | the order of `recordIds` |
| task create, update | who and when | `scope.actor`, the transaction's `now()` |
| tick | `done_at`, `done_by` | `now()` and `scope.actor` |
| task dialog | assignee display | the members store by `assigneeMemberId`; "Former member" when not an active member |
| task dialog | linked records | `TaskView.records` (`RecordRefDisplay`) |
| record picker | the object switcher's objects | the definitions store's live objects, in sidebar order; starting on the page's object, else the first |
| record picker | results | spec 0014's `records.search` for the chosen object |
| Tasks tab | open list order | `due_on` ascending nulls last, then `created_at`, then `id`, through `task_records_by_record` joined to `tasks` |
| Tasks tab | completed order | `done_at` descending, then `id` |
| Tasks tab | the record chip on each row | the first of `TaskView.records` that isn't the page's record, with "+N" for the rest; the page's record when it is the only link |
| task dialog, note window | "Copy link" | the current page's URL with `?task=<id>` or `?note=<id>` |
| Notes tab | the label count | `notes.list` `total.count` ("10,000+" when `atLeast`), counting up to 10,001 |
| Tasks tab | the label count | `total.count` of the open list ("10,000+" when `atLeast`), counting up to 10,001 |
| My tasks | which tasks | `assigned`: `assignee_member_id` = me; `created`: `created_by_member_id` = me; `all`: every task, each through the visibility predicate |
| My tasks | order | open: `due_on` ascending nulls last, `created_at`, `id` (the `*_open` indexes); done: `done_at` descending, `id` (the `*_done` indexes) |
| My tasks | group headings | the task's `dueOn` against today's date in `Intl.DateTimeFormat().resolvedOptions().timeZone`: earlier is Overdue, equal is Today, later is Upcoming, none is No date |
| My tasks | filter and status | `?filter=` (`assigned` default, `created`, `all`) and `?status=` (`open` default, `done`) |
| overdue mark | when | the same date comparison, open tasks only |
| cursors | their shape | base64url of the last row's sort values and id, parsed by a strict Zod schema |
| note save | `content_text` | `richTextToPlain(content)` on the server |
| note save | version | `version + 1` under the row lock |
| note save | `overwrote.by` and `at` | the row's `updated_by` and `updated_at` before this write, when `baseVersion` differs |
| note list | excerpt | the first 200 characters of `content_text`, runs of white space joined to one space |
| note list | order | `updated_at` descending, `id` |
| note window | "<Name>" in notices | the members store by the actor id; "Former member" otherwise |
| note window | save state | the session's `saveState` |
| activity | note and task entries | the sources above, through spec 0017's merge |
| delete | the undo window | 10 seconds, the toast's action |
| cleanup | which rows | `deleted_at < now() - RESTORE_WINDOW` (30 days, `limits.ts`) |
| constants | 2,000, 20, 200, 200 KB, 100,000, 50, 20 | `TASK_TITLE_MAX`, `TASK_RECORDS_MAX`, `NOTE_TITLE_MAX`, `NOTE_CONTENT_MAX_BYTES`, `NOTE_TEXT_MAX`, `TASK_PAGE`, `NOTE_PAGE` in `packages/contracts/src/tasks.ts` and `notes.ts` |

### Key invariants

- A note has exactly one record for life; a task's links change only through `addRecordIds` and `removeRecordIds`, never by sending a whole list.
- A write never removes a link the writer can't see.
- `is_done` and `done_at` agree, enforced by a check.
- Notes and tasks of a trashed record are hidden by every read and come back unchanged on restore; purge and erase remove notes and links through the foreign keys, never leaving one pointing at a missing record.
- Every change stores exactly one outbox row in its own transaction; a refused or empty write stores none.
- The browser holds one copy of each task and each open note; lists hold ids.
- Nothing reads the database on a timer.

### Security model

- Every procedure passes the `member` door; every service runs in `inWorkspace` under forced row level security, with an access table entry; the change rules are checked in the service, never only in the client.
- Note content is a `RichTextDoc` parsed with its Zod schema (allowed nodes and marks only, safe links, spec 0003); it is rendered through the editor's schema, never as HTML. `content_text` is derived on the server.
- Titles are plain text with length checks; due dates are `YYYY-MM-DD` dates parsed by Zod.
- Event payloads carry ids only; spec 0009's `filterEvent`, through spec 0007's delivery, decides who gets a `notes` or `tasks` event (a note when its record is visible; a task per spec 0009's rule), and an event narrowed for an audience arrives `coarse`.
- Error messages never name a record or a member the caller can't see.
- `security-access-reviewer` reviews milestones 1, 3 and 4; `state-performance-reviewer` reviews every milestone.

### Configuration required

None. The editor's packages are already pinned by spec 0003.

### Critical test scenarios

- Tasks happy path: add a task by quick add on a company, set a due date and assignee in the dialog, link a person, tick it; the person's Activity shows "added a task" and "completed a task"; a second browser sees each step within a second, verifies **AC-432** to **AC-435**, **AC-438**, **AC-448**.
- My tasks: tasks due yesterday, today, next week and with no date fall into the four groups; each filter and status; a fake clock crosses midnight and the groups move with no request, verifies **AC-436**, **AC-437**.
- Notes happy path: a new note stores nothing until a letter is typed; typing for 5 seconds saves at least twice; the list and Activity show it; a second browser opens it, verifies **AC-439**, **AC-440**, **AC-442**, **AC-444**.
- Note clash: two browsers on one note; one idle, one typing; both orders of events produce the two notices; the idle one shows the other's text, verifies **AC-443**.
- Offline: a note typed with the network off retries, then fails with Retry, then saves when back; leaving asks first, verifies **AC-440**.
- Too long: a 250 KB paste is refused with the message and the text stays, verifies **AC-441**.
- Lifecycle: delete and undo a task and a note; trash a record and see its notes vanish and its task links drop; restore; purge and erase on a test clock remove notes and links and keep tasks; the cleanup phase removes 30 day old deleted rows, verifies **AC-445**, **AC-446**.
- Access (rules injected): a hidden record's notes and tasks absent from lists, counts, Activity and events; a task linked to a hidden and a visible record shows only the visible one, and an edit by that viewer keeps the hidden link; a viewer outside the change rule gets 403, verifies **AC-447**.
- Replays: repeated `tasks.create` and first `notes.save` return the same row with one outbox row; a reused id answers `ID_TAKEN`, verifies **AC-449**.
- Scale: the 100,000 task and note seed, every list's first page within budget, `explain` in `verify.md`, verifies **AC-450**.
- Quality: keyboard only through quick add, the dialog, the note window and My tasks; axe and contrast in both themes; `pnpm size` with the editor in its own chunk, verifies **AC-451**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 starts after #17's milestone 2; milestone 3 also waits for spec 0003's milestone 4 (the editor).

**Milestone 1: tasks on a record**
1. Migration: `tasks`, `task_records`, their indexes and policies; the `tasks` outbox kind and `item_ids` if #7 hasn't added them; guard tests, satisfies **AC-432**, **AC-448**
2. Contracts: `TaskView`, the task inputs and constants, the `tasks.*` contracts, the `tasks` event shape, satisfies **AC-432**, **AC-434**
3. Core: `createTask`, `updateTask`, `getTasks`, `listTasks` (record scope), the visibility predicate and change rule, `Change.tasks` and its `outboxHook` row, access table entries, the two task activity sources, satisfies **AC-432** to **AC-435**, **AC-438**, **AC-447** to **AC-449**
4. API: `tasks.create`, `tasks.update`, `tasks.get`, `tasks.list`; the contract walking test and the outbox test extended, satisfies **AC-432** to **AC-435**, **AC-448**, **AC-449**
5. Data layer: the task store, `tasks.forRecord`, `tasks.one`, optimistic writes, settle, the event rules, the live router handler for `tasks`, satisfies **AC-432** to **AC-435**
6. Library: TaskList variants (`records` with "+N", `sectionOf` headings, the `inline` layout) and the ReferencePicker object switcher, stories, README, guardian, artifact publish, satisfies **AC-434**, **AC-435**, **AC-451**
7. Screens: the Tasks tab on the page and the panel (quick add, open list, Completed), the task dialog on `?task=`, Overview's Open tasks block; deploy; `ux-interaction-reviewer`, `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-432** to **AC-435**, **AC-438**, **AC-451**

**Milestone 2: My tasks**
8. Core and API: `listTasks` for `mine` (three filters, two statuses) on their indexes; a 100,000 task seed script and its measurements, satisfies **AC-436**, **AC-450**
9. Data layer: `tasks.mine` with its settle and event rules, satisfies **AC-436**
10. Screen: `/w/$slug/tasks`, "My tasks" in the sidebar, the filter and status switches in the address, the four groups, the midnight timer, every state; deploy; `ux-interaction-reviewer`, satisfies **AC-436**, **AC-437**, **AC-451**

**Milestone 3: notes**
11. Migration: `notes`, its indexes and policy; the `notes` outbox kind if needed; guard tests, satisfies **AC-439**, **AC-448**
12. Contracts: `NoteSummary`, `Note`, `richTextToPlain`, the `notes.*` contracts, satisfies **AC-439**, **AC-441**
13. Core and API: `saveNote` (upsert, `overwrote`), `getNote`, `listNotes`, the note activity source, access entries, satisfies **AC-439** to **AC-444**, **AC-447** to **AC-449**
14. Data layer: `notes.forRecord` and the note session (save loop, max wait, retries, notices, flush, `beforeunload`), satisfies **AC-440**, **AC-443**
15. Library: `NoteList` (new module) and RichTextEditor's `onChangeMaxWait` prop (spec 0003's interface gains it), stories, README, guardian, artifact publish, satisfies **AC-440**, **AC-442**, **AC-451**
16. Screens: the Notes tab on the page and the panel, the note window on `?note=`, the editor in its own lazy chunk; deploy; `ux-interaction-reviewer`, `security-access-reviewer`, satisfies **AC-439** to **AC-444**, **AC-451**

**Milestone 4: the lifecycle**
17. Core and API: `deleteTask`, `restoreTask`, `deleteNote`, `restoreNote`; the trash rules in every read; the `notes_tasks` phase in `maintenance.daily`; foreign key cascade tests for purge and erase, satisfies **AC-445**, **AC-446**
18. Screens: delete in the dialog and window menus with the Undo toasts; the unavailable note state, satisfies **AC-445**, **AC-446**
19. Proof: access tests with injected rules across every procedure and event; the scale numbers; the two browser flows locally and in production; `verify.md`; deploy; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-447**, **AC-450**, **AC-451**

## Consequences

**Positive**:
- Tasks and notes have the shape the work has (one assignee, many records; one record per note) instead of bending the records engine to fit.
- The record page, the panel and the timeline gain notes and tasks through slots #17 already built.
- Lists stay fast at any size through keyset pages on purpose built indexes.

**Negative / tradeoffs**:
- Notes are last write wins: when two people type in one note at once, the slower one's text is replaced (with a notice) until #27 brings shared editing and versions.
- Tasks aren't records, so they can't be filtered in tables, carry custom attributes, or join lists; a later feature that wants that must migrate them.
- Six partial indexes on `tasks` add write cost to every task change (tasks change rarely, so it's small).
- Deleted notes and tasks sit hidden for 30 days, and until #8's cleanup runs they stay longer.
- My tasks' "All tasks" in a big workspace is a long list; it pages but has no search until #33.
- The task visibility predicate, once #24 adds rules, adds a correlated check per task; measured then.

**Neutral**:
- Two migrations (three tables). New procedures `tasks.*` and `notes.*`; no new error code.
- One new library module (`NoteList`), variants on TaskList and ReferencePicker, and one prop on RichTextEditor.

## Open questions for the owner

1. **Who is a new task assigned to by default?** Recommended: the member creating it (they can clear it); an unassigned task never shows in anyone's My tasks.
2. **Who may change a task?** Recommended: its assignee, its creator, anyone when it links no records, and anyone who may write at least one of its linked records.
3. **What does deleting a note or task do?** Recommended: it hides at once with a 10 second Undo, and the daily cleanup removes it after 30 days, like records.
4. **Is last write wins acceptable for notes until #27?** Recommended: yes, with both people told; the slower writer's text in a true clash is replaced.
5. **Should a note emptied after it was saved stay as an empty note?** Recommended: yes; it can be deleted, and deleting it silently would surprise someone who is about to type.

## Follow-up

- [ ] **Owner**: answer the open questions above.
- [ ] **#28**: due date reminders and "assigned to you" notices.
- [ ] **#27**: shared notes replace the save loop with Yjs, keep versions, and the replaced notice goes away.
- [ ] **#29**: comments on a passage of a note use the editor's comment anchors.
- [ ] **#22**: the Trash screen may list deleted notes and tasks; its brief's purge of notes and tasks is done here.
- [ ] **#33**: global search over task titles and `content_text`.
- [ ] **#30**, **#36**: export and privacy erase include notes and tasks.
- [ ] **#38**: limits on notes and tasks per workspace, if storage needs them (none in v1).
- [ ] `/sync`: spec 0003's RichTextEditor interface gains `onChangeMaxWait`, its inventory gains `NoteList`; spec 0008's `maintenance.daily` gains the `notes_tasks` phase.
