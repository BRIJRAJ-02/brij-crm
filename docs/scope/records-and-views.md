# Records and views

How people see and work their data: the record page, notes and tasks, table and board views, bulk actions, and reports. See [index.md](index.md) for the house rules and the full order.

## Slice 4: Record page and activity

### 17. Record page · needs a decision
One place to see everything about a record: its attributes, its related records, and a timeline of what happened to it.
**Done when:** every attribute edits in place; related records are listed per relation and can be added or removed; the timeline shows creation, every field change with who and when, notes, tasks and comments, and updates live.
- [ ] Design it (spec): `/architect record page`

### 19. Notes and tasks
Notes and tasks on any record of any object, so the work stays next to the data.
**Done when:** a member adds a note or a task to any record; a task has an assignee, a due date and a done state; each person has a My tasks list; everything appears live for others.
- [ ] Build it: `/develop notes and tasks`

## Slice 5: Views

### 20. Table views and saved views · needs a decision
Slice any object the way you work: filter, sort, pick columns, and save the result as a view for yourself or the team.
**Done when:** filters combine with and/or groups and work on any attribute, including through a relation and "assigned to me"; numbers, dates and currency sort correctly; column choice and order save with the view; views are private or shared, with a default per object; a filtered first page loads inside the scale budget at a million records.
- [ ] Design it (spec): `/architect table views and saved views`

### 21. Board view
See any object as columns grouped by a status or select attribute, and move records by dragging.
**Done when:** dragging a card writes the attribute and moves it live for everyone; a read only field cannot be dragged; each view chooses its card fields; empty columns can be shown or hidden.
- [ ] Build it: `/develop board view`

### 22. Bulk actions and trash
Act on many records at once, and make deletes safe to undo.
**Done when:** a member selects many records (or everything matching a filter) to edit a field or delete; large bulk changes run in the background with progress; deleted records go to a trash and can be restored with their links, notes and history for 30 days, then are removed for good.
- [ ] Build it: `/develop bulk actions and trash`

## Slice 18: Reports and dashboards

### 52. Reports and dashboards · needs a decision
Answer "how are we doing" with charts over any object or list.
**Done when:** a member builds a chart (count, sum or average, grouped by any attribute or over time, including time in stage from attribute history) and pins it to a dashboard; amounts in several currencies are converted for totals; charts respect access and update live; a dashboard can be shared with the workspace.
- [ ] Design it (spec): `/architect reports and dashboards`
