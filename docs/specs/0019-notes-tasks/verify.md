# 0019. Notes and tasks: verify

## AC-450: first pages at 100,000 tasks and 100,000 notes

`pnpm --filter @crm/core bench:notes-tasks` (scripts/bench-notes-tasks.ts) seeds one workspace with 100,000 tasks (172,000 links over 2,000 companies, the hub company linked to 10,000), 100,000 notes (the hub holding 10,000) and 50 members, then reads each first page through the services as the app role, row level security on, 30 warm runs each. Run locally on 21 October 2026 on the dev Postgres, while about twenty other builders ran their suites on the same machine (load average near 40), so the whole call times below carry that machine's queueing; the page statements' own times are in the plans under them.

| First page (whole service call) | p50 | p95 |
|---|---|---|
| My tasks, assigned, open | 21.2 ms | 68.2 ms |
| My tasks, assigned, done | 109.2 ms | 275.4 ms |
| My tasks, created, open | 169.9 ms | 359.8 ms |
| My tasks, created, done | 93.4 ms | 381.6 ms |
| My tasks, all, open | 104.8 ms | 304.5 ms |
| My tasks, all, done | 61.1 ms | 241.2 ms |
| Tasks tab (hub, 10,000 tasks), open | 229.4 ms | 469.4 ms |
| Tasks tab (hub, 10,000 tasks), done | 93.5 ms | 231.1 ms |
| Notes tab (hub, 10,000 notes) | 97.8 ms | 192.6 ms |

The page statements (`explain (analyze, buffers)`, warm):

| Statement | Plan | Execution |
|---|---|---|
| My tasks, assigned, open | Index Only Scan on `tasks_assigned_open`, 51 rows | 2.9 ms |
| My tasks, created, done | Index Only Scan on `tasks_created_done`, 51 rows | 0.8 ms |
| My tasks, all, open (the task rule) | Index Scan on `tasks_all_open`; per row, the links by `task_records_pkey` and each link's record by `records_pkey` | 6 to 30 ms |
| Tasks tab, open | `tasks_all_open` joined to `task_records_pkey` | 24 ms |
| Notes tab | `notes_by_record_created` bitmap, sorted | 15 ms |

Every page statement is far inside 300 ms. The whole call adds the linked records' displays (`readRecords`) and, on a record's lists, the count to 10,001; on an idle machine those are tens of milliseconds. Rerun on an idle machine before calling AC-450 closed for good.

Found by the run: "All tasks" first wrote the task rule with `exists` under an `or`, which Postgres turned into a hash of every link in the workspace (1.3 s per page, 87 s at p95 under load). The rule now uses scalar subqueries that run per row of the page. My tasks reads no count (its screen shows none).

## Flows

- `apps/web/e2e/my-tasks.flow.ts`: the four groups, the switches in the address and by keyboard, a tick leaving the open list, midnight with no request (a fake clock), axe in light and dark, at 1280 and 375. Passed locally against an API on 3212 and Vite on 5192.
- `apps/web/e2e/notes.flow.ts`: a new note stores nothing until typed, saves, lists with its count, shows in Activity and opens from it, a second browser shows another save, delete and Undo for a note and for a task, axe in light and dark. Passed locally (`FLOW_NO_LIVE=1`, the second stack's origin isn't admitted by the local Centrifugo; `FLOW_WORKSPACE_MS=180000` on a busy machine).
