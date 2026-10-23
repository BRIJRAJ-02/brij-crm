# 0046. History and logs: verify

How each criterion is checked. Milestone 1's checklist comes first, with what ran; the sections after it are the whole plan, milestone 2 included. Heavy suites run on GitHub CI (lanes push and read CI), not locally.


## Milestone 1 checklist

Run on `wip/settings-history` against a local Postgres 18 (single files; CI runs the rest).

- [x] `packages/contracts/src/audit.test.ts`: every `AUDIT_ACTIONS` entry sits in exactly one kind or in `AUDIT_NOT_LISTED` (30 and 1); the input pages 50 by default, 1 to 100, and refuses an unknown key; an entry refuses a raw before or after, an IP, a record id on a record link row, and an unlisted action (AC-4603, AC-4605, AC-4621).
- [x] `packages/core/src/audit/audit.test.ts` (real Postgres): a member, and an admin lowered to member through the door, each get 403 FORBIDDEN "Only workspace owners and admins can read the audit log." with no statement sent; an API key without `audit.read` too (AC-4622, AC-4634). Two workspaces each with an invite, a role change and a rename: each owner and an admin read only their own, and a cursor from one workspace, used in the other, reads only the other's own rows (AC-4623, AC-4635). An invite of 20 sharing one `at`, read 7 at a time, gives 20 distinct rows over 3 pages in the order of one page; a cursor with its microseconds cut, or one that isn't ours, is INPUT_INVALID (AC-4627). The answer holds no IP, request id, raw key or linked record id, and each entry is only its view (AC-4609, AC-4624). A page is 4 statements (the workspace setting, the timeout, the page, the names) and an empty one 3, the page selecting neither `ip` nor `request_id`, with no insert, update, delete or outbox row (AC-4625, AC-4628).
- [x] `packages/core/src/audit/view.test.ts`: `toEntryView` for every listed action and variant, each answer parsed by the strict contract; former member, deleted user with no profile values (AC-4610), a deleted round robin `isGone`, the system, unknown keys dropped, a `pictureHidden` only change with no field, and record links naming the booking only; then real rows through `writeAudit` and the names statement (AC-4606, AC-4607).
- [x] `packages/core/src/access/table.test.ts`: `listAuditEvents` is `{ permission: 'audit.read' }`, and the walk refuses it to a member (AC-4622).
- [x] `apps/api/src/modules/audit.test.ts`: owner 200, admin 200, a member just lowered from admin 403 with the sentence, signed out 401, another workspace's address 404, a bad cursor and a limit over 100 400 (AC-4621, AC-4634).
- [x] `packages/data/src/audit/log.test.ts` and `data.test.ts`: every status, Show more with the cursor, Try again for a first and a later page, 403 as `forbidden` (which drops the held access, so the next visit opens Your sign ins, AC-4618), the abort on dispose, and the retain that survives a remount (AC-4629, AC-4630).
- [x] `apps/web/src/features/settings/history-lines.test.ts`: every listed action has a sentence and a kind, and every sentence and variant is written out (AC-4604 to AC-4607).
- [x] `apps/web/src/features/settings/nav.test.ts`: History sits between Background jobs and Trash for every role, with the `clock` icon, and `settingsPageOf` marks its three addresses (AC-4600).
- [x] `HistoryScreen.browser.test.tsx` (Chromium): an owner gets both tabs, a member none; `/changes` without `audit.read` redirects to `/sign-ins`, and `/history` opens the right tab; each state says its copy; a row is read as its whole sentence; axe clean in light and dark at 1280 and 375 (AC-4601, AC-4604, AC-4615 to AC-4619).
- [ ] `apps/web/e2e/history.flow.ts` and the loading-shape History entry: CI's flows job.
- [ ] CI's size job: no first load growth, and the History routes in chunks of their own (AC-4631).
- [ ] Reviews: `security-access-reviewer` and `state-performance-reviewer` on the server pass; all four on the screen pass.

## Access and tenancy (AC-4622, AC-4623, AC-4634, AC-4635)

- `packages/core/src/access/table.test.ts`: `listAuditEvents` has the entry `{ permission: 'audit.read' }`; the walk calls it as a member and expects 403 `FORBIDDEN` before any statement touches `audit_events` (the statement log shows only the door's).
- `packages/core/src/audit/audit.test.ts`, "a member can't read the log": a member, a member whose role was just lowered from admin, and a principal without `audit.read` each get 403 with "Only workspace owners and admins can read the audit log."
- Same file, "another workspace's rows never show": two workspaces each with an invite, a role change and a rename; each owner's page holds only their own three, unfiltered, with each filter, and with a cursor minted in the other workspace (which pages through the caller's own rows only, never the other's). The repo's guard test (every tenant table forces row level security with a policy) still lists `audit_events`.
- `apps/api/src/modules/audit.test.ts`: `audit.list` over HTTP as owner (200), admin (200), member (403), signed out (401), another workspace's slug (404 from the door).
- Reviewer: `security-access-reviewer` on milestones 1 and 2.

## Every action reads as a sentence (AC-4605, AC-4606, AC-4607, AC-4610)

- `apps/web/src/features/settings/history-lines.test.ts`: walks `AUDIT_ACTIONS`; each action not in the not listed set has a template and a kind; a snapshot of all sentences from one fixture entry per action (and per variant: resent with a role change, accepted by link, link reset, a system decline, own and another's profile change, both sign in rule changes, one and several seats).
- `packages/contracts/src/audit.test.ts`: `AUDIT_KINDS` covers every action exactly once, with `member.preferences_changed` alone outside.
- `packages/core/src/audit/view.test.ts`: `toEntryView` per action from real `writeAudit` rows (made by calling the services in a test database): a removed member reads Former member, a deleted account Deleted user with no profile values, a deleted rotation `isGone`, a system actor System, unknown keys in `before` dropped.

## No IP, no request id (AC-4609, AC-4624)

- `audit.test.ts`: rows written with an IP and a request id; the answer, serialised, contains neither value, and no `before`/`after` key.
- The page statement's text (from the statement log) selects neither `ip` nor `request_id`.

## Statements and speed (AC-4625, AC-4626, AC-4627, AC-4628)

- Statement count from the counting connection `audit.test.ts` opens (every statement its pool's clients send, but begin and commit): the workspace setting, the 3 second timeout, the page, the names; an empty page has no names statement.

| Read | Statements |
|---|---|
| A page of 3 rows naming members and an invitation | 4 |
| An empty page | 3 |
- Paging: an invite of 20 addresses (one transaction, one `at`) read with `limit` 7 gives 20 distinct rows over 3 pages, in the same order as one page of 50; a cursor edited to drop its microseconds is refused 400.
- Speed: a seed of 100,000 audit rows in one workspace (mixed actions, 50 actors, one rare actor with 3 rows, one rare kind) on a local Postgres 18 as the app role with row level security on. `explain (analyze, buffers)` of: the first page; a page deep in; the rare actor; the rare kind; a 7 day range; all filters together. Each under 50 ms at p95 warm, and the plan an Index Scan on `audit_events_at` with no Sort node. The million record seed is waived on the current Neon plan (owner, 12 October); this table is the stand in. If a rare filter misses, the follow-up index is proposed, not built here.
- No write: the statement log for an `audit.list` call has no `insert`, `update` or `delete`, and no outbox row appears.

## The data layer (AC-4629, AC-4630, AC-4631)

- `packages/data/src/audit/log.test.ts`: `openLog` reads the first page, `more()` appends with the cursor, a failed first page is `failed`, a failed later page `more-failed` with the rows kept, a 403 `forbidden`, `dispose()` aborts. Milestone 2: `setFilters` aborts an answer still out and starts over keeping the previous rows as `previous` until the new page arrives.
- `boundaries` and the lint rule: no network call in `apps/web` outside `packages/data`.
- CI's size job: the first load does not grow; the History routes are their own chunks (`build.test.ts`).
- Reviewer: `state-performance-reviewer`.

## The screen (AC-4600 to AC-4604, AC-4608, AC-4611 to AC-4621, AC-4632, AC-4633)

- `apps/web/src/features/settings/nav.test.ts`: History sits between Background jobs and Trash for every role; `settingsPageOf` maps the three addresses.
- `HistoryScreen.browser.test.tsx` (Vitest browser mode, Chromium, Firefox and WebKit): an owner sees both Tabs and the table; a member sees no tab bar and the sign ins section; `/history/changes` as a member lands on `/history/sign-ins`; each state (loading, empty, filtered empty, failed, more failed, forbidden) with its copy; Enter on a row opens the Panel and Esc returns focus to the row; the filters write the address and a reload keeps them; Clear filters shows only while one is set.
- `apps/web/e2e/history.flow.ts` (CI's flows job): as an owner, invite someone, change their role, open History, read both sentences, filter to Invitations and joining, open the role change's details (Member → Admin); as that member, open History and see only Your sign ins. axe in light and dark at 1280 and 375.
- `e2e/loading-shape.flow.ts` gains History: loading regions within 4 px of the loaded ones.
- Reviewers: `design-system-guardian`, then `ux-interaction-reviewer`.

## Open items to record here

- The EXPLAIN timings on the 100,000 row seed (owed with milestone 2).
- The owner's answers to decisions 1 to 7, and to the open questions in `index.md`.
