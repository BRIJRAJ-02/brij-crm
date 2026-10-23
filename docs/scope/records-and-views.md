# Records and views

How people see and work their data: the record page, notes and tasks, table and board views, bulk actions, reports, and the app frame around them (sidebar, settings and Home). See [index.md](index.md) for the house rules and the full order.

## Slice 4: Record page and activity

### 17. Record page · in-progress
One place to see everything about a record: its attributes, its related records, and a timeline of what happened to it.
**Done when:** every attribute edits in place; related records are listed per relation and can be added or removed; the timeline shows creation, every field change with who and when, notes, tasks and comments, and updates live.
- [x] Design it (spec): `/architect record page`
- [ ] Build it: `/develop record page`
   - [x] The page, thin all the way through
   - [x] The timeline
   - [x] Related records and the Overview (landed on `land/r13` at b3f2098e)
   - [ ] The side panel, with Previous and Next
- [ ] Verify it: `/check verify record page` (`verify.md` covers milestones 1 and 2)
- [x] Test it: `/test record page`
Spec [0017](../specs/0017-record-page/index.md) · code in `apps/web/src/features/records/`

### 19. Notes and tasks · done
Notes and tasks on any record of any object, so the work stays next to the data.
**Done when:** a member adds a note or a task to any record; a task has an assignee, a due date and a done state; each person has a My tasks list; everything appears live for others.
- [x] Design it (spec): `/architect notes and tasks`
- [x] Build it: `/develop notes and tasks`
   - [x] Tasks on a record
   - [x] My tasks
   - [x] Notes
   - [x] The lifecycle
- [x] Verify it: `/check verify notes and tasks`
- [x] Test it: `/test notes and tasks`
Spec [0019](../specs/0019-notes-tasks/index.md) · code in `apps/web/src/features/tasks/`, `apps/web/src/features/notes/`

## Slice 5: Views

### 20. Table views and saved views · in-progress
Slice any object the way you work: filter, sort, pick columns, and save the result as a view for yourself or the team.
**Done when:** filters combine with and/or groups and work on any attribute, including through a relation and "assigned to me"; numbers, dates and currency sort correctly; column choice and order save with the view; views are private or shared, with a default per object; a filtered first page loads inside the scale budget at a million records.
- [x] Design it (spec): `/architect table views and saved views`
- [ ] Build it: `/develop table views and saved views`
   - [x] Filter and sort any object, saved on its default view
   - [x] Saved views, private and shared, and the layout
   - [ ] Hidden, archived, live breadth and scale (the code is in; the scale runs are not recorded)
- [ ] Verify it: `/check verify table views and saved views`
- [x] Test it: `/test table views and saved views`
Spec [0020](../specs/0020-table-saved-views/index.md) · code in `apps/web/src/features/views/`, `packages/core/src/views/`

### 21. Board view · in-progress
See any object as columns grouped by a status or select attribute, and move records by dragging.
**Done when:** dragging a card writes the attribute and moves it live for everyone; a read only field cannot be dragged; each view chooses its card fields; empty columns can be shown or hidden.
- [x] Design it (spec): `/architect board view`
- [ ] Build it: `/develop board view`
   - [x] A read only board
   - [x] Drag, live
   - [ ] Breadth and proof (group by, empty columns and card fields are in; the stuck in stage badge, add a card from a column and the first load budget are left, lane `wip/board-wins`)
Spec [0021](../specs/0021-board-view/index.md) · code in `apps/web/src/features/board/`

### 22. Bulk actions and trash · done
Act on many records at once, and make deletes safe to undo.
**Done when:** a member selects many records (or everything matching a filter) to edit a field or delete; large bulk changes run in the background with progress; deleted records go to a trash and can be restored with their links, notes and history for 30 days, then are removed for good.
- [x] Design it (spec): `/architect bulk actions and trash`
- [x] Build it: `/develop bulk actions and trash`
   - [x] Delete, the trash and undo, inline
   - [x] Inline bulk edit
   - [x] Big changes as jobs
   - [x] Delete forever and the purge
- [ ] Verify it: `/check verify bulk actions and trash` (no `verify.md`: the 50,000 record job run is not on record)
- [x] Test it: `/test bulk actions and trash`
Spec [0022](../specs/0022-bulk-actions-trash/index.md) · code in `packages/core/src/engine/trash.ts`, `packages/core/src/engine/bulk-edit.ts`

## Slice 5: The app frame

### 60. App shell and sidebar · done
The frame around every screen: the sidebar with its sections, the order each person chooses, hidden items, favourites and counts.
**Done when:** each member orders and hides sidebar items and stars favourites, kept across devices and live; Tasks and Inbox show counts; quick actions sit in the shell.
- [x] Design it (spec): `/architect app shell and sidebar`
- [x] Build it: `/develop app shell and sidebar`
   - [x] The new order, end to end
   - [x] Order and hide
   - [x] Favourites
   - [x] Counts and the parts that wait on other features (Lists waits on #51)
- [ ] Verify it: `/check verify app shell and sidebar`
- [x] Test it: `/test app shell and sidebar`
Spec [0034](../specs/0034-app-shell-sidebar/index.md) · code in `apps/web/src/features/workspace/`

### 61. Settings area · done
Every setting in one place, under Settings, split into your account and the workspace.
**Done when:** account, workspace, objects, members, security, scheduling, history and trash settings all live under Settings with one navigation; every page is full width.
- [x] Design it (spec): `/architect settings area`
- [x] Build it: `/develop settings area`
Spec [0026](../specs/0026-settings-area.md) · code in `apps/web/src/features/settings/`

### 62. Home · done
The workspace's landing page: what needs you today, at a glance.
**Done when:** Home opens with a setup checklist, then cards that each answer "what needs me now" (agenda, tasks due, new captures, team today, a metrics row), and each member can hide the sections they don't want.
- [x] Design it (spec): `/architect home`
- [x] Build it: `/develop home`
- [x] Verify it: `/check verify home`
Spec [0041](../specs/0041-home-dashboard/index.md) · code in `apps/web/src/features/home/`, `packages/core/src/home/`

## Slice 18: Reports and dashboards

### 52. Reports and dashboards · needs a decision · planned
Answer "how are we doing" with charts over any object or list.
**Done when:** a member builds a chart (count, sum or average, grouped by any attribute or over time, including time in stage from attribute history) and pins it to a dashboard; amounts in several currencies are converted for totals; charts respect access and update live; a dashboard can be shared with the workspace.
- [ ] Design it (spec): `/architect reports and dashboards` (spec number 0050 is set aside for it)
