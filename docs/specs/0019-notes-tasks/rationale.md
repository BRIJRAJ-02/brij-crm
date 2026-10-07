# 0019. Notes and tasks: decision record

## Context

The scope's "Done when" for #19: a member adds a note or a task to any record; a task has an assignee, a due date and a done state; each person has a My tasks list; everything appears live for others. The owner settled that a task has one assignee and many linked records (3 October 2026). The record page (#17) already reserves the Notes and Tasks tabs, an Open tasks block on Overview and activity slots for notes and tasks; spec 0007 already names the `notes` and `tasks` event kinds; spec 0009 already defines when a task is visible.

The records engine stores records of objects with typed attributes, versioned values and links, and every record counts against the 1,000,000 record limit. A note is a rich text document of up to 200 KB with one parent; a task is a short to do with a date, a person and several records. The editor (Tiptap, spec 0003) arrives with the library's milestone 4, and real time co editing with versions is a separate feature (#27).

Forces: one copy of each item in the browser and live updates by events (house rules); hidden is absent (spec 0009), including for a task that links records the viewer can't see; trash, restore, purge and erase of records must carry their notes and task links (the brief and #22); Neon's free plan (no polling, no timers on the database); a note must never lose a person's typing to a dropped connection or a closed window; My tasks must be fast with many tasks.

## Options considered

### Option 1: own tables beside the engine (chosen)

`notes`, `tasks` and `task_records`, written by small services through `runWrite` and the one outbox hook, read through their own stores.

**Pros**: each shape fits (one parent per note, a link table for tasks); no record limit consumed; lists use indexes built for their exact orders; foreign keys tie notes and links to records for purge and erase; the editor's JSON lives in one jsonb column.
**Cons**: tasks can't use record features (custom attributes, table views, filters) without a later migration; a second set of write paths outside the engine that must follow the outbox and access rules by hand.

### Option 2: notes and tasks as system objects in the records engine

A "Tasks" and a "Notes" object with fixed attributes (title, due date, assignee, a relationship to every object).

**Pros**: tables, filters, views and bulk actions for tasks for free; one write path; history per field.
**Cons**: a relationship from tasks to "any object" doesn't exist in the engine (relationships join two objects); each note's document becomes a value with version rows on every autosave (hundreds of 200 KB versions); tasks and notes count against the record limit; the field history would surface every keystroke save in the timeline.

### Option 3: tasks as records, notes as their own table

Tasks through the engine (Option 2) and notes as Option 1.

**Pros**: tasks get views and filters.
**Cons**: still needs a relationship to any object; two models for one feature; the timeline and access rules split between them.

## Rationale

Option 1 matches both shapes the scope and the owner describe without bending the engine: "any record of any object" is a plain link table, and a note's autosave is one row update instead of a new value version each time. Option 2's need for a relationship to any object would be new engine work larger than this whole feature, and storing every autosave as a value version would bloat history and the timeline. Option 3 pays both costs for views on tasks that no requirement asks for yet.

Per decision:
- **Upsert on first content**: the brief's "nothing stored until content" with a client minted id makes retries safe and an empty "New note" free.
- **Last write wins with two notices**: the house rule's conflict rule, and the notice lands on whoever's text was replaced, from both directions; #27 replaces this with merging.
- **A 2 second max wait**: a debounce alone never fires while someone types steadily; 2 seconds bounds what a crash can lose.
- **Creator is the default assignee**: most tasks are for yourself, and an unassigned task would never show in My tasks.
- **Anyone who sees a task and writes one of its records may change it**: tasks are shared work on records; tying edits to the records' write level keeps one access model.
- **Soft delete with Undo and a 30 day cleanup**: matches records' trash window, makes a slip cost nothing, and the cleanup already exists (spec 0008).
- **Trash by read, purge by foreign key**: trashing a record changes no note or task row, so restore is exact; purge and erase can't leave a dangling note because the database removes it.
- **No replaced notice on tasks**: task fields are short, shown live, and edited rarely by two people at once; adding versions to tasks would be cost with no requirement.

## References

**Project sources**:
- `packages/ui/src/modules/TaskList/` (one `record` per task today, no sections) and `ActivityFeed/` (`note` and `task` entries with `isDone`).
- `packages/db/src/schema/records.ts` and `common.ts`: `auditColumns`, `actorColumns` with `member_id`, `actorConstraints`, the deleted pair pattern on `records`.
- `packages/core/src/engine/limits.ts`: `RESTORE_WINDOW = '30 days'`.
- `apps/api/src/app.ts`: the RPC body limit of 1 MB, answering `PAYLOAD_TOO_LARGE`.
- Specs 0003 (`RichTextEditor`, `RichTextDoc` capped at 200 KB, milestone 4), 0006 (settle, the offline retry schedule), 0007 (`notes` and `tasks` kinds, AC-82's write path through `outboxHook`, the live router), 0008 (`maintenance.daily` phases), 0009 (the task visibility rule), 0017 (`ACTIVITY_SOURCES`, the tabs and blocks).
- `.notes/briefs.md`: the #19 brief and the owner decisions of 3 October 2026.
