# 0007. Change events and realtime: every change, to everyone allowed to see it

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Spec 0005 built the first live path: each write stores a small event in the database, and a relay sends it to everyone in the workspace. This spec finishes that path. A screen that was offline for minutes or hours catches up from the database instead of reloading, every kind of change (list entries, views, notes, tasks, members, access, jobs) gets its own event, and once access rules exist each group of people with the same access gets its own channel that names only ids they may see. Old events are deleted after a day, only while the worker is awake anyway, and the time from a save to every open screen is measured against the one second target with 100 people online.

## Requirements

**User stories**:
- As a member, I want a screen that lost its connection to catch up by itself when it returns, so I never work on stale data or have to reload.
- As a member, I want changes to lists, views, notes, tasks, members and jobs to appear live, not only changes to records.
- As a member with limited access, I want live updates to show me only what I may see, so the live channel never leaks a record or field hidden from me.
- As the owner of this product, I want delivery time measured against the target, so a slow relay shows up before users notice.
- As an admin, I want a member whose access changed, or who was removed, to stop receiving what they may no longer see at once.

**Acceptance criteria** (numbered after spec 0005's and the range reserved for #11 to #22; this spec owns AC-72 to AC-101):
- **AC-72**: A browser offline for longer than Centrifugo's memory history (more than 5 minutes or more than 1,000 events) catches up when it reconnects: it calls `realtime.catchUp` from its last applied `seq`, and every record, column, definition and member change made meanwhile shows in place, with no page reload and no refetch of rows that didn't change. Proven by Playwright: one browser offline 6 minutes while another makes 150 edits across 40 records and adds a column; within 2 seconds of reconnecting every change shows.
- **AC-73**: When the last applied `seq` is older than the oldest retained outbox row, or more than 5,000 rows behind the head, `realtime.catchUp` answers `reset: true`, and the live layer asks every store for its resync (spec 0006 AC-62), with no page reload.
- **AC-74**: No change is lost around a first load or a reconnect. When live is on, the data layer reads the workspace head (from `realtime.subscriptionToken`) before its first cached read, and on every new or unrecovered subscription calls `realtime.catchUp` from its watermark. A write that commits while a screen's first load is in flight shows on that screen. When live is off (`VITE_REALTIME_URL` unset, as in previews) the token call is skipped and nothing waits for it. A response replaces a stored record only under spec 0006's revision rule (AC-44), so a slow refetch never shows an older value.
- **AC-75**: Restarting Centrifugo (memory history lost, a new epoch) loses no change and causes no resync for a client whose watermark is still retained: it catches up through the API. Clients spread their catch up calls over a random 0 to 2 seconds after an unrecovered resubscribe.
- **AC-76**: The relay publishes each workspace's rows in `seq` order through Centrifugo's `batch` API, up to 100 rows per call, with idempotency keys. After the worker is stopped for 10 minutes while 2,000 rows pile up across 3 workspaces, it drains them in order within 30 seconds of restarting, and no client applies a row twice out of order.
- **AC-77**: Every outbox row records its commit time (`created_at`, taken with `clock_timestamp()` in the hook under the counter row lock) and its `published_at`. Every event carries `at` (the commit time). While awake, the relay keeps a rolling 5 minute window and once a minute logs `relay.stats` (rows published, lag p50, p95 and max, pending rows and the oldest pending age); the worker's `/health` JSON reports the same numbers from memory for #11 to chart.
- **AC-78**: With 100 simulated members online in one workspace on the load seed (the #12 harness's `live` scenario, local capped Docker, per the owner's decision that scale proofs run locally), while the open model mix edits, the time from a write's commit to the change in every subscriber's store (event received and `records.get` done) has p95 ≤ 1 second, and relay lag p95 ≤ 250 ms, measured warm (the worker awake). The same run with 1,000 members online is measured and recorded (judged in #41). Results go in `verify.md`.
- **AC-79**: One Zod `ChangeEvent` union in `packages/contracts` defines every event kind: `records`, `definitions`, `entries`, `views`, `notes`, `tasks`, `members`, `access`, `jobs`, plus the `restricted` stub. A test fails when a kind has no rule in spec 0009's `filterEvent` or no handler slot in the client's live router. A client ignores a kind it doesn't know (a newer server during a deploy) without breaking its `seq` order.
- **AC-80**: Every engine write that touches list entries (an entry added, removed, restored, hidden or shown by its record's delete or restore, purged, or an entry value changed) stores one `entries` row per list, naming the entry ids and their record ids. Past 1,000 entries in one list the row is coarse (refetch what you hold of that list).
- **AC-81**: `definitions` rows cover every schema change: an object created, renamed, archived, restored or reordered; an attribute, option or attribute group created, changed, archived, restored or reordered; a list's own definitions. A row names its `objectId`, its `listId`, or neither (the workspace's object list), and the client refetches exactly that.
- **AC-82**: Writes outside the engine (views #20, notes and tasks #19, members #23, access changes in spec 0009 and #24, jobs in spec 0008) run through `runWrite` with the one `writeHooks` composer and record their ids in the `Change` (`context.record`), so `outboxHook`, the one exported outbox writer, stores their rows and takes the counter row last. The test that calls every write procedure and expects outbox rows (spec 0005) covers them, and a refused write stores none.
- **AC-83**: Deleting, restoring or erasing a record with 200,000 links collects at most 1,001 far record ids per object, marks that object coarse in the `Change`, and keeps the write's extra memory under 50 MB. Its event names the object as coarse.
- **AC-84**: The relay acts on an `access` row (spec 0009 decides which writes store one; its `item_ids` name the members affected) in `seq` order: after publishing it, and before any later row of that workspace, it calls Centrifugo's server `disconnect` for the user of every member named, with code 4500 ("access changed"). While the worker is awake this happens within 5 seconds of the commit; when the worker was asleep, within 5 seconds of its reconnect after the wake. Measured warm.
- **AC-85**: The relay loads a workspace's audiences (spec 0009's `audiences`) once per workspace per awake period and keeps them in memory until the worker sleeps. It drops that workspace's entry when it reaches a `members` or `access` row, before publishing the next row, so an access change takes effect in `seq` order. #12 measures the cache's size and the reload cost.
- **AC-86**: Every audience channel of a workspace receives every `seq` exactly once: spec 0009's `filterEvent` for that audience when anything in the row is left for it, else the stub `{ seq, at, kind: 'restricted' }`. Proven with three test audiences injected through spec 0009's rule source test server (one hides an object, one hides a field, one limits members to their own records): the WebSocket frames each restricted member's browser receives (Playwright) contain no hidden id, and a member who may read none of an event receives only its stub.
- **AC-87**: `mutationId` appears only on an event an audience receives unchanged; a copy `filterEvent` changed carries none, and a stub never does. A writer whose audience receives its change whole still never fetches it back.
- **AC-88**: `realtime.catchUp` filters every row through the caller's audience with the same `filterEvent`, so a catch up never returns an id the caller wouldn't have received live. A row the caller may read nothing of is left out (a catch up carries no stubs).
- **AC-89**: Published outbox rows older than `OUTBOX_RETENTION` (24 hours) are deleted through `crm_outbox_prune`, in batches of 10,000, called by the relay after a publish pass while the worker is awake (at most one batch per pass, and a new round at most every 10 minutes) and by spec 0008's daily cleanup; nothing runs it on a timer of its own, so pruning never wakes the database. An unpublished row is never deleted. A catch up from a pruned `seq` answers `reset: true`. Pruning 1 million rows on the load seed keeps relay lag inside AC-78's target while it runs.
- **AC-90**: The relay runs only while the worker is awake (spec 0005's active state, which spec 0008 milestone 3 makes the worker's awake state): LISTEN plus spec 0005's backing off safety poll (1, 2, 5, 15, then every 60 seconds), never a fixed 1 second poll, and no timer of its own for pruning or anything else. While the worker sleeps the relay makes no database call.
- **AC-91**: The harness records the share of delivered events a client discards because it holds nothing of the named object, so the decision not to split channels per object is checked against a number (the trigger is in Consequences). Recorded in `verify.md`.

## Decision

**Chosen option**: Option 1: one ordered stream per audience channel (members grouped by their data policy, spec 0009's `policyKey`), with every `seq` on every audience channel as its filtered event or a stub, and the Postgres outbox as the history behind them.

Every event keeps its gap free per workspace `seq` on every channel; Centrifugo's memory history covers short drops and `realtime.catchUp` reads the outbox for anything longer; events are filtered at delivery time through spec 0009's `filterEvent`, and with no access rules every member shares the one audience `open`, so a workspace still has exactly one channel.

Calls settled in the cross check of 8 October 2026: published outbox rows are kept 24 hours (`OUTBOX_RETENTION`), and anything older resyncs what the screen holds; pruning runs only inside the relay while the worker is awake, and spec 0008's daily cleanup calls the same prune; the relay runs on the worker's own login (`crm_worker`, spec 0008), which alone may list workspaces and prune; no channel per object until AC-91's number says so; history beyond memory comes from Postgres, not a Redis engine for Centrifugo. One question stays with the owner: the stub's timing signal (see Open questions).

**Implementation skills**: `centrifugo` (`pedronauck/skills`, community, `.claude/skills/centrifugo/`) · `neon-postgres` (`.claude/skills/neon-postgres/`) · `drizzle` (`.claude/skills/drizzle/`) · `zod` (`.claude/skills/zod/`) · `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `vitest` (`.claude/skills/vitest/`) · `playwright-cli` (`.claude/skills/playwright-cli/`) · `use-railway` (`.claude/skills/use-railway/`) · `system-design` (`.claude/skills/system-design/`) · `security-and-hardening` (`.claude/skills/security-and-hardening/`) · house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Starting point**: spec 0005 milestone 3 is built first: the outbox, `outboxHook` composed by `writeHooks`, the relay in the worker (active while there is work, dormant after 3 quiet minutes, woken by the API's `POST /internal/outbox-wake` to `WORKER_INTERNAL_URL` with the `WORKER_WAKE_SECRET` header), `workspace:<id>` with `history_size` 1000 and `history_ttl` 300 s, the tokens and the browser subscription. Everything here extends it; nothing replaces it.

**One owner per concept** (the same split in specs 0006 to 0009):

| Concept | Owner |
|---|---|
| The store, windows, the revision rule, the resync (refetch what a tab holds), coarse coalescing | spec 0006 |
| The live router, the watermark, `realtime.catchUp`, when a resync is needed | this spec |
| `ChangeEvent`, the outbox columns, `outboxHook`'s mapping, the relay, `planDelivery`, the stub, `realtime.subscriptionToken`, the prune and `OUTBOX_RETENTION` | this spec |
| `policyKey`, `audiences`, `filterEvent` and its rule per kind, which writes store an `access` row, `members.role`, `enterAsActor` and `systemScope` | spec 0009 |
| The worker's awake and asleep states, the `crm_worker` login, the daily cleanup, the `jobs` kind's writes | spec 0008 |

**Dependencies, and the thin slice this spec builds where a feature isn't there yet**:

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #10 core loop (spec 0005) | the outbox, `outboxHook`, the active and dormant relay, the wake call, the channel and client subscription | none: a hard prerequisite |
| #6 client data (spec 0006) | the revision rule, the store's resync, coarse coalescing, the `records`, `definitions` and `members` handlers | none: spec 0006 lands first |
| #9 access model (spec 0009) | `filterEvent`, `policyKey` and `audiences` (its milestone 1); the injectable rule source test server (its milestone 2); the `access` rows (its milestone 3) | none: milestone 2 uses spec 0009 milestone 1; milestone 4 lands with spec 0009 milestone 3, after its milestone 2 |
| #8 background jobs (spec 0008) | the `crm_worker` login (its milestone 1) to run the relay and own the prune; the worker's awake state (its milestone 3) | none: milestone 3 waits for spec 0008 milestone 1; until spec 0008 milestone 3, "awake" means spec 0005's active relay |
| #12 load harness | the 100 and 1,000 online `live` scenario | if `packages/load` doesn't exist, this spec builds only the `live` scenario there, on #12's seed and session minting interface, and #12 adopts it |
| #11 monitoring | charts and alerts on relay lag and backlog | the `relay.stats` log line and the worker `/health` numbers |
| #13, #18, #19, #20, #23, #24, #51 | their writes emit their kinds | none: each feature records its ids in the `Change` and registers its client handler; this spec defines the kinds and the test that holds them to it |

**Build order across specs 0006 to 0009** (the same list in all four specs; one item at a time, each landed and checked before the next):
1. Spec 0005 milestone 3: the outbox, `outboxHook` and the `writeHooks` composer, the active and dormant relay woken by the API, the `workspace` channel.
2. Spec 0006 milestones 1 to 3.
3. Spec 0007 milestone 1: catch up from the outbox, and the outbox migration that adds every event kind.
4. Spec 0009 milestone 1: roles, the sealed scope, `@crm/core/system` (`enterAsActor`, `systemScope`), the pure policy functions.
5. Spec 0007 milestone 2: every kind of change live, each row planned through spec 0009's `filterEvent`.
6. Spec 0008 milestones 1 and 2: the job runner and the `crm_worker` login.
7. Spec 0007 milestone 3: the outbox pruned.
8. Spec 0008 milestone 3: the daily cleanup and the sleeping worker.
9. Spec 0009 milestone 2: hidden means absent.
10. Spec 0009 milestone 3 with spec 0007 milestone 4, in one release: audience channels, the stub, access changes.
11. Spec 0007 milestone 5: delivery measured at 100 and 1,000 online.

**Data model** (one migration in milestone 1, one in milestone 3):

| Table or function | Change | Rules |
|---|---|---|
| `outbox` (milestone 1) | The `outbox_kind` enum gains `entries`, `views`, `notes`, `tasks`, `members`, `access`, `jobs`. `object_id` becomes nullable (kinds with no object). New: `list_id` uuid null, `item_ids` uuid[] not null default `'{}'`, `actor_member_id` uuid null. `created_at` now defaults to `clock_timestamp()` and the hook sets it explicitly. (Spec 0006 adds `replaced`: `{ by, cells }`, `by` once, at most 200 cells, null past that; owner decision, 8 October 2026.) | Existing primary key (`workspace_id`, `seq`) and the unpublished partial index stay. No new index: pruning walks the primary key from each workspace's oldest `seq`. `actor_member_id` is never published: it is the member whose write stored the row (for `jobs`, the job's starter), read by spec 0009's `filterEvent` for `jobs`. |
| `crm_outbox_prune(before timestamptz, max integer)` (milestone 3) | new security definer function, owned by `crm_relay`, which gains `delete` on `outbox`; execute granted to `crm_worker` only (spec 0008 milestone 1 creates it), never to `crm_app` | Deletes published rows with `created_at` before `before`, oldest `seq` first in each workspace (a skip scan over the primary key), stopping at a workspace's first unpublished row; at most `max` rows per call (clamped 1 to 10,000); returns the count deleted, nothing else. Same hardening as `crm_outbox_workspaces` (begin atomic, fixed `search_path`, qualified names, the migration refuses to finish if anyone but the owner can reach `crm_relay`). The guard tests list it. |

`crm_app` gets no `delete` on `outbox`: every delete goes through the function.

`item_ids` by kind: `entries` entry ids, `views` view ids, `notes` note ids, `tasks` task ids, `members` member ids, `access` the affected member ids, `jobs` job ids; empty for the rest. `record_ids` carries records for `records`, the entries' records for `entries`, the parent record for `notes`, the linked records for `tasks`.

**Engine changes** (`packages/core/src/engine/write.ts`):
- Entry lists in `Change` become `EntryRef { entryId, listId, recordId }`. `capChange` caps entries per list at `CHANGE_CAP` the way it caps records per object, and adds `coarseLists`.
- `farReferences` returns at most `CHANGE_CAP + 1` distinct far record ids per object (a `limit` per object in SQL) and a `truncated` flag; `context.record` notes truncated objects in a new `Change.coarseObjects`, and `capChange` puts them in `coarse`. No hook gets every far reference any more: the audit log (#36) names the deleted record and its link count. This reverses spec 0005's "hooks receive the full `Change`" (see Follow-up).
- `Change` gains one field per kind written outside the engine (`views`, `notes`, `tasks`, `members`, `access`, `jobs`: ids), each added by the feature that writes it and filled through `context.record`.
- `outboxHook` stays the one exported outbox writer: one row per object for `records`, one per list for `entries`, one per object, list or workspace for `definitions`, and one per kind for the fields above.

**The event** (`ChangeEvent`, Zod in `packages/contracts/src/realtime.ts`; `seq` and `at` on every kind):

```json
{ "seq": 41, "at": "2026-10-03T09:12:44.318Z", "kind": "records", "objectId": "…", "recordIds": ["…"], "attributeIds": ["…"], "coarse": false, "mutationId": "…", "replaced": { "by": { "type": "member", "id": "…" }, "cells": [{ "recordId": "…", "attributeId": "…", "versionId": "…" }] } }
{ "seq": 42, "at": "…", "kind": "entries", "listId": "…", "entryIds": ["…"], "recordIds": ["…"], "attributeIds": ["…"], "coarse": false }
{ "seq": 43, "at": "…", "kind": "definitions", "objectId": "…" }
{ "seq": 44, "at": "…", "kind": "views", "objectId": "…", "viewIds": ["…"], "coarse": false }
{ "seq": 45, "at": "…", "kind": "notes", "recordIds": ["…"], "noteIds": ["…"] }
{ "seq": 46, "at": "…", "kind": "tasks", "recordIds": ["…"], "taskIds": ["…"] }
{ "seq": 47, "at": "…", "kind": "members", "memberIds": ["…"] }
{ "seq": 48, "at": "…", "kind": "access", "memberIds": ["…"] }
{ "seq": 49, "at": "…", "kind": "jobs", "jobIds": ["…"], "coarse": false }
{ "seq": 50, "at": "…", "kind": "restricted" }
```

Ids only, never values. What each kind makes the client do: `records` refetch the named records (`records.get`) or, when coarse, the object's loaded windows and count (spec 0006); `entries` the same for list entries; `definitions` refetch the named object's or list's attributes, or `objects.list`; `views`, `notes`, `tasks` refetch those items through their own stores (when coarse, the ones they hold); `members` refetch `members.list`; `access` naming this member: the access reload below, else nothing; `jobs` refetch those jobs, or when coarse the unfinished jobs the tab holds (spec 0008); `restricted` advance the watermark, nothing else.

**Channels** (Centrifugo, one node, memory engine, one namespace):

| Namespace | Channel | History | Who subscribes | Carries |
|---|---|---|---|---|
| `workspace` (exists) | `workspace:<workspaceId>` until milestone 4, then `workspace:<workspaceId>.<policyKey>` (spec 0009; `open` when nothing is restricted) | `history_size` 1000, `history_ttl` 300 s, `force_recovery` (as shipped by spec 0005) | every active member whose audience it is, by a subscription token for that one channel | every `seq` exactly once: the audience's filtered event, or the stub |

`allow_subscribe_for_client` stays false: only tokens from the door open a channel. Because every audience channel carries every `seq`, Centrifugo's recovery and the client's `seq = last + 1` check hold on each channel as they do today.

**The relay** (`apps/api/src/realtime/relay.ts`, pure planning in `packages/core/src/realtime/plan.ts`):
- **When it runs**: only while the worker is awake (AC-90). Until spec 0008 milestone 3 that is spec 0005's active state; from then on the worker's awake state, and the relay's own 3 minute dormancy becomes the worker's idle clock. Spec 0008 milestone 1 moves its connections to the worker's `crm_worker` login.
- **Per pass**, for each workspace with pending rows (from `crm_outbox_workspaces`, or the LISTEN payload):
1. Audiences: `audiences(scope)` from spec 0009, cached per workspace for the awake period (AC-85). Until spec 0009 milestone 3 there is one audience, `open`, of every active member, and its channel is `workspace:<id>`.
2. `planDelivery(row, audiences, facts)` answers, per audience, `{ channel, event }`: `filterEvent(audience, row, facts)` from spec 0009, or the stub when that leaves nothing. Facts (`eventFacts(row)` from spec 0009: record owners and teams, view owners, job starters and permissions) are loaded once per batch only for rows that need them.
3. Publish through `POST /api/batch` (ordered, `parallel: false`): for each row, one `publish` per audience channel, idempotency key `<workspace>:<seq>:<policyKey>`. Mark `published_at` when the batch succeeds; a failure stops that workspace and retries on the next pass (as in spec 0005).
4. For a `members` or `access` row: drop the workspace's audience cache before the next row. For an `access` row, after publishing it: Centrifugo `disconnect` for the user of every member in its `item_ids`, with code 4500 "access changed" (AC-84).
5. Feed the lag (`published_at - created_at`) into the rolling stats.
- **Prune** (milestone 3): after a pass, when the last prune round in this awake period finished more than 10 minutes ago, or the last batch came back full, call `crm_outbox_prune(now() - OUTBOX_RETENTION, 10000)` once. One batch per pass, so publishing never waits behind more than one prune batch. A round ends when a batch comes back short. Spec 0008's daily cleanup calls the same function through the same `pruneOutbox` export of `packages/db`.

**API surface** (oRPC on `/api/rpc`):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `realtime.subscriptionToken` (changed) | `workspace` | `{ channel, token, head }`: the caller's own audience channel (`workspace:<id>` until milestone 4, then `workspace:<id>.<policyKey>`), its token, and the workspace head | member | 404 `NOT_FOUND` |
| `realtime.catchUp` (new) | `workspace`, `after` (integer ≥ 0) | `{ head, reset, events: ChangeEvent[] }` | member | 404 `NOT_FOUND`, 400 `INPUT_INVALID` |
| `realtime.connectionToken` (exists) | none | `{ token }` | session | 401 |

`realtime.catchUp` reads rows with `seq > after` up to the head, filters each through the caller's audience (`filterEvent`; a row that leaves nothing is skipped, never a stub), and collapses them into at most one event per (kind, object or list), ids merged; past 1,000 ids an object or list goes coarse. It answers `reset: true` with no events when `after` is below the oldest retained row minus one, or more than 5,000 rows behind the head. Its own events carry the collapsed range's last `seq`, and carry no `replaced` and no `mutationId`.

**Status codes**: 400 `INPUT_INVALID`, 401 `UNAUTHENTICATED`, 404 `NOT_FOUND` (non member, removed member, unknown workspace), 500 `INTERNAL`. No new codes. Rate limiting of `realtime.catchUp` comes with the central limits module (#38) like every read; its cost is bounded by the 5,000 row cap.

**Client** (`packages/data/src/live/`):
- **Only when live is on** (`VITE_REALTIME_URL` set): the token call runs beside `me.get`, and the data layer awaits its `head` before its first cached read. When live is off, no token call is made, nothing waits, and `live.status()` is `off`.
- **One live router**: each store registers a handler for its kinds (`live.on(kind, handler)`) and its resync (`live.onResync(resync)`). Spec 0006 registers `records`, `definitions` and `members`; spec 0008 `jobs`; #19 and #20 their kinds. Unknown kinds are ignored after their `seq` is applied.
- **Watermark `W`**: the last contiguous `seq` applied from the channel. It starts at `head` from the token.
- **Catch up**: a new subscription, an unrecovered resubscribe, a `seq` gap, or the tab returning visible after more than 5 minutes hidden: `realtime.catchUp({ after: W })` (after a random 0 to 2 second wait when unrecovered), hand its events to their handlers, set `W = head`, then apply buffered live events with `seq > W`. `reset: true`: every store's resync (spec 0006 AC-62).
- **The stub** advances `W` and does nothing else.
- **The access reload** (spec 0009 AC-146): on disconnect code 4500, or an `access` event naming this member, call `realtime.subscriptionToken` again (the channel may have changed), reload `access.mine`, run every store's resync (definitions and held records), then reconnect, subscribe to the returned channel and catch up from `W`. Code 4500 sits in Centrifugo's range of terminal codes, so the client never reconnects on its own first; the live layer reconnects once the reload is done. A `NOT_FOUND` from the token call means the member was removed: `live.status()` turns `off` and the workspace frame shows spec 0005's not found state.
- **Ordering of reads**: spec 0006's revision rule. This spec keeps no request numbers of its own.
- **Coarse refetches**: spec 0006's coalescing, at most one per object or list per second.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| write | `seq` | `workspace_counters.outbox_seq + 1` under the row lock (spec 0005) |
| write | `created_at`, the event's `at` | `clock_timestamp()` in the hook, after the counter row is taken |
| write | `actor_member_id` | the write scope's actor when it is a member, else null; for a `jobs` row, the job's starter |
| write | the kind and the ids | the capped `Change`: engine writes, or the fields non engine writers record through `context.record` |
| write | `coarse` for an object or list | `capChange`: more than `CHANGE_CAP` (1,000) ids, or the object is in `Change.coarseObjects` |
| relay | the audiences | `audiences(scope)` (spec 0009), cached per workspace for the awake period, dropped on `members` and `access` rows |
| relay | each channel's event | `filterEvent(audience, row, facts)` (spec 0009), or the stub when it leaves nothing |
| relay | the channel name | `workspace:<workspaceId>.<policyKey>`; `workspace:<workspaceId>` until milestone 4 |
| relay | `mutationId` on a copy | kept by `filterEvent` only when it changed nothing |
| relay | users to disconnect | `members.user_id` of the members in an `access` row's `item_ids`, read under `withWorkspace` |
| relay | `published_at` | `clock_timestamp()` when Centrifugo's batch answers success |
| relay stats | lag p50, p95, max | rolling 5 minute window of `published_at - created_at` of rows this relay published |
| relay stats | pending rows, oldest pending age | the unpublished rows the relay read this pass |
| `subscriptionToken` | `channel` | the caller's audience: `policyKey(access.data)` from the scope the door built (spec 0009) |
| `subscriptionToken` | `head` | `workspace_counters.outbox_seq`, read without a lock |
| `catchUp` | `head` | the same counter, read first in the transaction |
| `catchUp` | the oldest retained `seq` | `min(seq)` of the workspace's outbox rows (first primary key row) |
| `catchUp` | `reset` | `after < oldest - 1`, or `head - after > CATCH_UP_MAX_ROWS` (5,000, a constant in `packages/core`) |
| client | the watermark at start | `head` from the workspace token (only when live is on) |
| client | the catch up delay | random 0 to 2,000 ms, only after an unrecovered resubscribe |
| prune | the cutoff | `now() - OUTBOX_RETENTION` (24 hours, a constant in `packages/core`) |
| prune | the batch | `PRUNE_BATCH` (10,000) rows per call, oldest `seq` first per workspace |
| prune | when | after a relay pass, when the last round in this awake period ended more than `PRUNE_EVERY` (10 minutes) ago or the last batch was full; and spec 0008's daily cleanup |
| harness | delivery time | the subscriber's clock when `records.get` resolves, minus the event's `at` (same host, so one clock) |
| harness | discarded share | events whose object or list the simulated client holds nothing of, over events received |

**Key invariants**:
- Every committed write that changes something has its outbox rows; a rolled back write has none (spec 0005).
- `seq` per workspace has no gaps and follows commit order, and every audience channel of the workspace carries every `seq` exactly once, as the filtered event or the stub.
- Events are filtered at delivery time (live and catch up), never at write time; the outbox stores the full ids.
- An event names only ids its receiving audience may read; a stub names none.
- Events are invalidations: applying one twice or out of order changes nothing, so only completeness matters, and the watermark guards it.
- An unpublished row is never pruned, and pruning runs only inside a relay pass or the daily cleanup, never on a timer of its own.
- `actor_member_id` never leaves the database.
- No hook receives an unbounded far reference list.

**Security model**:
- Channels open only by tokens from the `member` door; a token names one channel, the caller's own audience channel.
- An access change disconnects the affected users at once (code 4500), and they come back only through a new token for their new channel; a removed member is refused that token. A connection token outlives a removal by at most 10 minutes but opens nothing.
- The stub reveals that something the member can't see changed, and when; nothing more. Left to the owner (Open questions).
- `mutationId` goes only on events an audience receives unchanged, so two rows sharing one can't reveal a hidden link.
- The relay and catch up read outbox rows under `withWorkspace`. From spec 0008 milestone 1 the relay runs on the worker's `crm_worker` login, which alone may execute `crm_outbox_workspaces` and `crm_outbox_prune`; `crm_app` can neither list workspaces nor delete outbox rows. Both definer functions return ids or a count only.
- `security-access-reviewer` reviews milestones 1, 3 and 4; `state-performance-reviewer` reviews milestones 1, 3 and 5.

**Configuration required**:
- `infra/centrifugo/config.json`: the `workspace` namespace as spec 0005 shipped it (`history_size` 1000, `history_ttl` 300 s, `force_recovery`, `allow_subscribe_for_client` false). No new namespace.
- No new variables: the worker already has `CENTRIFUGO_API_URL` and `CENTRIFUGO_API_KEY`, the api `CENTRIFUGO_TOKEN_SECRET`, and the wake call uses spec 0005's `WORKER_INTERNAL_URL` and `WORKER_WAKE_SECRET`.
- Constants, not variables: `OUTBOX_RETENTION` (24 hours), `CATCH_UP_MAX_ROWS` (5,000), relay batch size (100), `PRUNE_BATCH` (10,000), `PRUNE_EVERY` (10 minutes), `ACCESS_CHANGED` (disconnect code 4500).

**Critical test scenarios**:
- Happy path: two browsers, one offline 6 minutes while the other edits; reconnect shows every change with no reload; a preview with live off makes no token call, verifies **AC-72**, **AC-74**.
- Restart: Centrifugo restarted mid session; worker stopped 10 minutes with 2,000 pending rows, verifies **AC-75**, **AC-76**.
- Reset: a watermark below the retained rows, and one 6,000 rows behind, each asking every store for its resync, verifies **AC-73**, **AC-89**.
- Kinds: each engine write kind and each non engine writer stores its rows through `outboxHook`; the kind registry test; an unknown kind is skipped, verifies **AC-79** to **AC-82**.
- Huge delete: 200,000 links, memory and the coarse event, verifies **AC-83**.
- Audiences: three injected test audiences across live delivery and catch up; frames inspected; every channel gets every `seq`; `mutationId` only on unchanged events; a role change and a removal disconnect with 4500 and the browsers reload or stop, verifies **AC-84** to **AC-88**.
- Awake only: with the worker asleep, no query reaches Postgres from the relay (`pg_stat_activity`); no fixed 1 second poll; a prune round runs only after a pass, verifies **AC-89**, **AC-90**.
- Load: 100 and 1,000 online, delivery p95, relay lag, discarded share, prune during load, verifies **AC-77**, **AC-78**, **AC-89**, **AC-91**.

## Build plan

Tracer Bullet: each milestone ends with something you can see in production or in the harness. The milestones sit in the build order above, between the other specs' milestones.

**Milestone 1: a screen that was away catches up** (after spec 0006)
1. Migration: the `outbox_kind` values, nullable `object_id`, the new `outbox` columns and the `clock_timestamp()` default; the hook writes `created_at` and `actor_member_id`, satisfies **AC-77**
2. `ChangeEvent` in `packages/contracts` with `at`, every kind and the `restricted` stub; the relay publishes `at`; the client ignores unknown kinds after applying their `seq` (shipped before any server emits a new kind), satisfies **AC-77**, **AC-79**
3. Relay batching through Centrifugo's `batch` API inside spec 0005's active state (its backing off safety poll, no fixed poll), the rolling stats, the `relay.stats` log line and the worker `/health` numbers, satisfies **AC-76**, **AC-77**, **AC-90**
4. `realtime.catchUp` (collapse, cap, reset) and `{ channel, token, head }` from `realtime.subscriptionToken`, satisfies **AC-72**, **AC-73**
5. Client: the live router with `live.on` and `live.onResync`, the watermark from `head` (token call only when live is on), catch up on new, unrecovered or gapped subscriptions and after 5 minutes hidden, with the jitter; `reset` runs every store's resync (spec 0006); reads ordered by spec 0006's revision rule, satisfies **AC-72** to **AC-75**
6. Deploy (api and worker first, then web); Playwright offline 6 minutes and the Centrifugo restart, locally and in production; `security-access-reviewer` and `state-performance-reviewer`, satisfies **AC-72** to **AC-76**

**Milestone 2: every kind of change is live** (after spec 0009 milestone 1)
7. Engine: `EntryRef` in `Change`, per list capping, the bounded far references with `coarseObjects`, satisfies **AC-80**, **AC-83**
8. `outboxHook` writes `entries` rows, widened `definitions` rows (objects, options, groups, lists, reorders), and one row per kind for the `Change` fields non engine writers record, satisfies **AC-80** to **AC-82**
9. `planDelivery` in `packages/core` over spec 0009's `audiences` and `filterEvent`, with one `open` audience on `workspace:<id>`, so a `jobs` row or a private view never names an id to a member who can't read it; the audience cache for the awake period, satisfies **AC-85**, **AC-87**
10. Live router handlers for `records`, `entries`, `definitions`, `members` and `access`; the registry test that every kind has a `filterEvent` rule and a handler slot (`jobs` filled by spec 0008, `views`, `notes` and `tasks` by #19 and #20), satisfies **AC-79**, **AC-81**
11. Deploy; visible: a column renamed or reordered in one browser moves in the other, satisfies **AC-81**

**Milestone 3: the outbox pruned** (after spec 0008 milestone 1)
12. Migration: `crm_outbox_prune` owned by `crm_relay` (which gains `delete` on `outbox`), execute to `crm_worker` only; guard tests, satisfies **AC-89**
13. `pruneOutbox` in `packages/db`; the relay's prune after a pass while awake, one batch per pass, a round at most every 10 minutes, satisfies **AC-89**, **AC-90**
14. A prune of 1 million rows on the local load seed with relay lag recorded; deploy; `security-access-reviewer` and `state-performance-reviewer`, satisfies **AC-89**

**Milestone 4: each audience receives only what it may see** (one release with spec 0009 milestone 3, after spec 0009 milestone 2)
15. Channels `workspace:<id>.<policyKey>`; `realtime.subscriptionToken` signs the caller's own audience channel; the relay publishes every `seq` to every audience channel, filtered or as the stub, in one ordered batch, and for one release also publishes the `open` audience's events to the old `workspace:<id>`, satisfies **AC-86**, **AC-87**
16. `access` rows: the cache drop and the 4500 disconnect; the client's access reload, satisfies **AC-84**, **AC-85**
17. `realtime.catchUp` filters through the caller's audience, satisfies **AC-88**
18. Playwright with three test audiences injected through spec 0009 milestone 2's rule source test server: frames inspected for hidden ids in live delivery and catch up; a role change and a removal; deploy; `security-access-reviewer`, satisfies **AC-84**, **AC-86** to **AC-88**
19. The next release stops publishing to the old `workspace:<id>`

**Milestone 5: measured and proven**
20. The harness `live` scenario (in #12's harness, or its thin slice here): 100 and 1,000 online, delivery time from `at`, relay lag, discarded share, a prune of 1 million rows during the run, satisfies **AC-78**, **AC-89**, **AC-91**
21. `verify.md` with the numbers; `state-performance-reviewer`, satisfies **AC-77**, **AC-78**, **AC-91**

## Migration plan

**Strategy**: additive, in deploy order. **Phases**:
1. Milestone 1: the api and worker deploy first: the new columns have defaults, the enum only gains values, events gain `at`, and the client's existing `seq` logic is unaffected.
2. The web deploys next with the unknown kind rule and catch up. A client from before this phase never sees a new kind, because no writer emits one yet.
3. Milestone 4: the relay publishes both to the old `workspace:<id>` (the `open` audience's events) and to the audience channels for one release, so browsers open across the deploy keep updating until they reconnect and take the new channel from their token; the next release stops the old publish.
**Rollback**: revert the code; the columns, the enum values and the prune function stay unused. Clients fall back to spec 0005's refetch on an unrecovered subscription.
**Risks**: a web deploy that lags the api by minutes sees `head` it doesn't read yet (ignored), nothing worse. Enum values can't be removed once added; that is accepted, since every kind is planned.

## Consequences

**Positive**:
- A laptop that slept, a dropped train connection, or a Centrifugo deploy no longer costs a resync: the outbox is the long history, with no new service.
- One kind registry and one writer (`outboxHook`) means search (#33), notifications (#28), webhooks (#35) and automations read the same stream later.
- Filtering happens in one pure function (spec 0009's `filterEvent`) shared by live delivery and catch up, so #24's rules hold on the live path the day they land.
- With no rules, a workspace still has one channel and the relay publishes each event once.
- Delivery has numbers from day one: lag in logs and `/health`, and a harness proof.

**Negative / tradeoffs**:
- The stub tells a restricted member that something changed, and when.
- Each extra audience multiplies the relay's publishes per event; heavy record rules on a busy workspace add relay lag, measured in AC-78 only with the test audiences until #24's real rules exist.
- An audience under a record rule gets coarse events and refetches what it holds, more requests than a precise event.
- A `jobs` event names its job only on a channel whose every member may read it; everywhere else it is coarse, so watchers of a job refetch it more often than a precise event would need.
- Writes that change something take the counter row plus a slightly wider outbox row; still one row per object, list or kind.
- 24 hours of outbox rows live on Neon's free plan storage; a busy workspace adds tens of megabytes. Retention is a constant to lower if storage tightens. If the worker sleeps for days, old rows wait for the next wake or the daily cleanup.
- The first cached read waits for the workspace token's `head` when live is on (in parallel with `me.get`, so usually free; when the token call is slower, first load waits for it).
- Channel per object is not done: a member receives every event of the workspace even for objects they aren't looking at. The trigger to split: the harness's discarded share above 80% with delivery p95 above 750 ms, or a client spending more than 5% of a frame budget on discarded events.
- Postgres enum values can't be dropped once added.

**Neutral**:
- Two migrations (outbox columns and kinds; the prune function and its grant). No new Centrifugo namespace.
- AC-38's "refetch on unrecovered" becomes "catch up, then resync only on reset".
- No new dependencies.

## Follow-up

- [ ] **#24**: rules exercised for real through spec 0009's `filterEvent` and rule source; what a task with several linked records means for visibility (with #19). Bump nothing: an `access` row is enough.
- [ ] **#25**: "sign out everywhere" and revoked sessions should disconnect the user from Centrifugo; the API has no Centrifugo key today, so route it through an outbox `access` row or give the api a publish only key.
- [ ] **#28, #33, #35**: the first consumer besides the relay adds `outbox_consumers (consumer, workspace_id, seq)`; pruning then keeps rows at or above the slowest healthy consumer, never more than 7 days, and a consumer further behind resyncs.
- [ ] **#36**: the audit hook names a deleted record with its link count, since `Change` no longer lists every far reference.
- [ ] **#26 presence**: rides its own channel, never the outbox (house rule), so nothing here changes for it.
- [ ] **#11**: chart `relay.stats` (lag distribution, pending, oldest pending age) and alert when the oldest pending row is older than 30 seconds while the worker is awake.
- [ ] **#12**: adopt the `live` scenario if this spec built its thin slice; measure the audience cache and the fan out with several audiences.
- [ ] **#20**: private views ride the `views` rule in spec 0009's `filterEvent` from milestone 2; spec 0020's exemption for private view writes ends then.
- [ ] `/sync`: spec 0005's change events say "Hooks receive the full `Change`"; AC-83's far reference cap reverses that (a hook now gets at most 1,001 far ids per object and `coarseObjects`). Record it in `0005-change-events.md`, `packages/core/AGENTS.md` and `apps/api/AGENTS.md`.
- [ ] `/sync`: record in `apps/api/AGENTS.md` and `packages/data/AGENTS.md` the live router, the audience channels, `outboxHook` as the one outbox writer, and spec 0005's AC-38 note on refetch (now catch up first).

## Owner decisions

**Answered by the owner on 8 October 2026: accepted as recommended.**

1. **The stub's timing signal.** On a channel whose audience may not read an event, the event arrives as a stub (`{ seq, at, kind: 'restricted' }`), so a member with restricted access learns that something they can't see changed, and when, but not what or where. Recommended: accept it. It is the cheapest way to keep one gap free stream per channel, it reveals no id, record, field or value, and only matters once #24 adds rules. Runner up: no stub and a sequence per channel kept by the relay, which brings back the complexity of a personal channel per member.

**Decided by the owner on 8 October 2026, with spec 0006 milestone 2.**

2. **The `replaced` list's size.** A `records` event's `replaced` names `by` once per event, not per entry (`{ by, cells }`), and holds at most 200 cells; a write that replaced more carries no list, so tabs refetch and show no notice. Spec 0006's [versions and undo](../0006-client-data-state/0006-versions-and-undo.md#owner-decisions) has the detail.
