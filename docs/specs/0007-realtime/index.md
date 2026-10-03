# 0007. Change events and realtime: every change, to everyone allowed to see it

**Date**: 2026-10-03
**Status**: Proposed

## Summary

Spec 0005 built the first live path: each write stores a small event in the database, and a relay sends it to everyone in the workspace. This spec finishes that path. A screen that was offline for minutes or hours catches up from the database instead of reloading, every kind of change (list entries, views, notes, tasks, members, access) gets its own event, and once access rules exist each person only ever receives ids they may see. Old events are deleted after a day, and the time from a save to every open screen is measured against the one second target with 100 people online.

## Requirements

**User stories**:
- As a member, I want a screen that lost its connection to catch up by itself when it returns, so I never work on stale data or have to reload.
- As a member, I want changes to lists, views, notes, tasks and members to appear live, not only changes to records.
- As a member with limited access, I want live updates to show me only what I may see, so the live channel never leaks a record or field hidden from me.
- As the owner of this product, I want delivery time measured against the target, so a slow relay shows up before users notice.
- As an admin, I want a removed member to stop receiving our workspace's events at once.

**Acceptance criteria** (numbered after spec 0005's and the range reserved for #11 to #22; this spec owns AC-72 to AC-101):
- **AC-72**: A browser offline for longer than Centrifugo's memory history (more than 5 minutes or more than 100 events) catches up when it reconnects: it calls `realtime.catchUp` from its last applied `seq`, and every record, column, definition and member change made meanwhile shows in place, with no page reload and no refetch of rows that didn't change. Proven by Playwright: one browser offline 6 minutes while another makes 150 edits across 40 records and adds a column; within 2 seconds of reconnecting every change shows.
- **AC-73**: When the last applied `seq` is older than the oldest retained outbox row, or more than 5,000 rows behind the head, `realtime.catchUp` answers `reset: true` and the client refetches everything it holds (windows, counts, definitions, members) without a page reload. The paused notice clears when the refetch lands.
- **AC-74**: No change is lost around a first load or a reconnect. The data layer reads the workspace head (from `realtime.subscriptionToken`) before its first cached read, and on every new or unrecovered subscription calls `realtime.catchUp` from its watermark. A write that commits while a screen's first load is in flight shows on that screen. Per record, a response replaces the stored base only when its request was sent after the request that set the current base, so a slow refetch never shows an older value.
- **AC-75**: Restarting Centrifugo (memory history lost, a new epoch) loses no change and causes no full refetch for a client whose watermark is still retained: it catches up through the API. Clients spread their catch up calls over a random 0 to 2 seconds after an unrecovered resubscribe.
- **AC-76**: The relay publishes each workspace's rows in `seq` order through Centrifugo's `batch` API, up to 100 rows per call, with idempotency keys. After the worker is stopped for 10 minutes while 2,000 rows pile up across 3 workspaces, it drains them in order within 30 seconds of restarting, and no client applies a row twice out of order.
- **AC-77**: Every outbox row records its commit time (`created_at`, taken with `clock_timestamp()` in the hook under the counter row lock) and its `published_at`. Every event carries `at` (the commit time). The relay keeps a rolling 5 minute window and once a minute logs `relay.stats` (rows published, lag p50, p95 and max, pending rows and the oldest pending age); the worker's `/health` JSON reports the same numbers for #11 to chart.
- **AC-78**: With 100 simulated members online in one workspace on the load seed (the #12 harness's `live` scenario, local capped Docker, per the owner's decision that scale proofs run locally), while the open model mix edits, the time from a write's commit to the change in every subscriber's store (event received and `records.get` done) has p95 ≤ 1 second, and relay lag p95 ≤ 250 ms. The same run with 1,000 members online is measured and recorded (judged in #41). Results go in `verify.md`.
- **AC-79**: One Zod `ChangeEvent` union in `packages/contracts` defines every event kind: `records`, `definitions`, `entries`, `views`, `notes`, `tasks`, `members`, `access`, plus the `restricted` stub. A test fails when a kind has no audience rule on the server or no handler slot in the client's live router. A client ignores a kind it doesn't know (a newer server during a deploy) without breaking its `seq` order.
- **AC-80**: Every engine write that touches list entries (an entry added, removed, restored, hidden or shown by its record's delete or restore, purged, or an entry value changed) stores one `entries` row per list, naming the entry ids and their record ids. Past 1,000 entries in one list the row is coarse (refetch what you hold of that list).
- **AC-81**: `definitions` rows cover every schema change: an object created, renamed, archived, restored or reordered; an attribute, option or attribute group created, changed, archived, restored or reordered; a list's own definitions. A row names its `objectId`, its `listId`, or neither (the workspace's object list), and the client refetches exactly that.
- **AC-82**: Writes outside the engine (views #20, notes and tasks #19, members #23, access rules #9 and #24) store their rows through the same `appendOutbox` in their own transaction, taking the counter row last. The test that calls every write procedure and expects outbox rows (spec 0005) covers them, and a refused write stores none.
- **AC-83**: Deleting, restoring or erasing a record with 200,000 links collects at most 1,001 far record ids per object, marks that object coarse in the `Change`, and keeps the write's extra memory under 50 MB. Its event names the object as coarse.
- **AC-84**: Within 5 seconds of a member being removed (#23), the relay unsubscribes that user from the workspace's channels, and `realtime.subscriptionToken` for that workspace answers `NOT_FOUND`.
- **AC-85**: An `access` row (a role, team or rule change) makes every client of the workspace refetch everything it holds, and the relay rebuilds its audience for that workspace before publishing the next row.
- **AC-86**: An event goes out in full on `workspace:<id>` only when every id it names is readable by every active member. Otherwise `workspace:<id>` gets the stub `{ seq, at, kind: 'restricted' }`, and each member whose filtered copy is not empty gets that copy on `member:<workspaceId>.<memberId>`, naming only the records, attributes, entries and items that member may read. Proven with a test audience that hides one object, hides one field and limits one member to their own records: the WebSocket frames a restricted member's browser receives (Playwright) contain no hidden id, and a member who may read none of an event receives only its stub.
- **AC-87**: `mutationId` appears on open events and on the copies sent to the member who made the write, and on no other copy. A writer's own changes are still never fetched back.
- **AC-88**: `realtime.catchUp` filters through the same audience as live delivery, so a catch up never returns an id the caller wouldn't have received live.
- **AC-89**: Once an hour, published outbox rows older than 24 hours are deleted in batches of 10,000 per workspace; an unpublished row is never deleted. A catch up from a pruned `seq` answers `reset: true`. Pruning 1 million rows on the load seed keeps relay lag inside AC-78's target while it runs.
- **AC-90**: Coarse events for one object or list cause at most one refetch of it per second in a browser, however many arrive.
- **AC-91**: The harness records the share of delivered events a client discards because it holds nothing of the named object, so the decision not to split channels per object is checked against a number (the trigger is in Consequences). Recorded in `verify.md`.

## Decision

**Chosen option**: Option 1: keep one workspace channel as the ordered stream, make the Postgres outbox the history behind it, and send filtered copies on a personal channel only for events not every member may see.

Every event keeps its gap free per workspace `seq`; Centrifugo's memory history covers short drops and `realtime.catchUp` reads the outbox for anything longer; events are filtered at delivery time through one audience function that #9 fills with rules, and today every event is open.

Decisions taken from the recommendations (the brief has no #7 section, so these are this spec's calls, listed for the owner to confirm): the outbox keeps published rows for 24 hours, and anything older resyncs what the screen holds; no channel per object until AC-91's number says so; history beyond memory comes from Postgres, not a Redis engine for Centrifugo; the `restricted` stub tells every member that something they can't see changed, and when.

**Implementation skills**: `centrifugo` (`pedronauck/skills`, community, `.claude/skills/centrifugo/`) · `neon-postgres` (`.claude/skills/neon-postgres/`) · `drizzle` (`.claude/skills/drizzle/`) · `zod` (`.claude/skills/zod/`) · `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `vitest` (`.claude/skills/vitest/`) · `playwright-cli` (`.claude/skills/playwright-cli/`) · `use-railway` (`.claude/skills/use-railway/`) · `system-design` (`.claude/skills/system-design/`) · `security-and-hardening` (`.claude/skills/security-and-hardening/`) · house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Starting point**: spec 0005 milestone 3 (the outbox, `appendOutbox` through the outbox hook, the relay, `workspace:<id>`, the tokens and the browser subscription) is built first. Everything here extends it; nothing replaces it.

**Dependencies, and the thin slice this spec builds where a feature isn't there yet**:

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #10 core loop (spec 0005) | the outbox, relay, channel and client subscription | none: a hard prerequisite |
| #6 client data | the live router, store resync, request ordering | built here in `packages/data`, in the shape #6 keeps |
| #8 background jobs | a cron for `outbox.prune` | the relay runs the same prune function on its own hourly timer under its advisory lock; it moves to #8's cron unchanged when #8 lands |
| #9 access model | the rules behind `Audience` | `openAudience`: every active member reads everything, except private views (#20), which only their owner reads |
| #12 load harness | the 100 and 1,000 online `live` scenario | if `packages/load` doesn't exist, this spec builds only the `live` scenario there, on #12's seed and session minting interface, and #12 adopts it |
| #11 monitoring | charts and alerts on relay lag and backlog | the `relay.stats` log line and the worker `/health` numbers |
| #13, #18, #19, #20, #23, #24, #51 | their writes emit their kinds | none: each feature calls `appendOutbox` with its kind and registers its client handler; this spec defines the kinds and the test that holds them to it |

**Data model** (one migration for milestone 1, one for milestone 3):

| Table | Change | Rules |
|---|---|---|
| `outbox` | `kind` check widens to `records`, `definitions`, `entries`, `views`, `notes`, `tasks`, `members`, `access`. New: `list_id` uuid null, `item_ids` uuid[] not null default `'{}'`, `coarse` boolean not null default false, `actor_member_id` uuid null (never published; picks who gets `mutationId`). `created_at` now defaults to `clock_timestamp()` and the hook sets it explicitly. | Existing primary key (`workspace_id`, `seq`) and the unpublished partial index stay. No new index: pruning walks the primary key from the oldest `seq`. |
| `crm_outbox_stale_workspaces(before timestamptz, max integer)` | new security definer function, owned by `crm_relay`, execute to `crm_app` | Returns ids of workspaces with published rows created before `before`, at most `max` (clamped 1 to 500). Ids only. Same hardening as `crm_outbox_workspaces` (begin atomic, stable, fixed `search_path`, qualified names). The guard tests list it. |
| grants | `crm_app` gains `delete` on `outbox` | Deletes run inside `withWorkspace`, under forced row level security. |

`item_ids` by kind: `entries` entry ids, `views` view ids, `notes` note ids, `tasks` task ids, `members` member ids; empty for the rest. `record_ids` carries records for `records`, the entries' records for `entries`, the parent record for `notes`, the linked records for `tasks`.

**Engine changes** (`packages/core/src/engine/write.ts`):
- Entry lists in `Change` become `EntryRef { entryId, listId, recordId }`. `capChange` caps entries per list at `CHANGE_CAP` the way it caps records per object, and adds `coarseLists`.
- `farReferences` returns at most `CHANGE_CAP + 1` distinct far record ids per object (a `limit` per object in SQL) and a `truncated` flag; `context.record` notes truncated objects in a new `Change.coarseObjects`, and `capChange` puts them in `coarse`. No hook gets every far reference any more: the audit log (#36) names the deleted record and its link count.
- The outbox hook writes one row per object for `records`, one per list for `entries`, and one per object, list or workspace for `definitions`.

**The event** (`ChangeEvent`, Zod in `packages/contracts/src/realtime.ts`; `seq` and `at` on every kind):

```json
{ "seq": 41, "at": "2026-10-03T09:12:44.318Z", "kind": "records", "objectId": "…", "recordIds": ["…"], "attributeIds": ["…"], "coarse": false, "mutationId": "…" }
{ "seq": 42, "at": "…", "kind": "entries", "listId": "…", "entryIds": ["…"], "recordIds": ["…"], "attributeIds": ["…"], "coarse": false }
{ "seq": 43, "at": "…", "kind": "definitions", "objectId": "…" }
{ "seq": 44, "at": "…", "kind": "views", "objectId": "…", "viewIds": ["…"] }
{ "seq": 45, "at": "…", "kind": "notes", "recordIds": ["…"], "noteIds": ["…"] }
{ "seq": 46, "at": "…", "kind": "tasks", "recordIds": ["…"], "taskIds": ["…"] }
{ "seq": 47, "at": "…", "kind": "members", "memberIds": ["…"] }
{ "seq": 48, "at": "…", "kind": "access" }
{ "seq": 49, "at": "…", "kind": "restricted" }
```

Ids only, never values. What each kind makes the client do: `records` refetch the named records (`records.get`) or, when coarse, the object's loaded windows and count; `entries` the same for list entries; `definitions` refetch the named object's or list's attributes, or `objects.list`; `views`, `notes`, `tasks` refetch those items through their own stores; `members` refetch `members.list`; `access` refetch everything held; `restricted` advance the watermark and wait for the copy, if any, on the member channel.

**Channels** (Centrifugo, one node, memory engine):

| Namespace | Channel | History | Who subscribes | Carries |
|---|---|---|---|---|
| `workspace` (exists) | `workspace:<workspaceId>` | 100 rows, 5 minutes, `force_recovery` | every active member, by subscription token | every `seq`: the full event when open, else the stub |
| `member` (new) | `member:<workspaceId>.<memberId>` | none (`history_size` 0) | that member only, by subscription token | filtered copies of restricted events |

`allow_subscribe_for_client` stays false on both: only tokens from the door open a channel. The member channel keeps no history because a missed copy is always behind a stub the workspace channel did deliver, and the client then catches up through the API.

**The relay, per row** (`apps/api/src/realtime/relay.ts`, pure planning in `packages/core/src/realtime/plan.ts`):
1. Load the workspace's `Audience` (cached per workspace; dropped when the relay passes a `members` or `access` row, so the change takes effect in `seq` order).
2. `planDelivery(row, audience, facts)` answers `{ open: event }` or `{ stub, copies: [{ memberIds, event }] }`. Members with identical copies share one entry. `facts` (record owners and teams, view owners and visibility) are loaded once per batch only for rows the audience says need them.
3. Publish through `POST /api/batch` (ordered, `parallel: false`): the `publish` to `workspace:<id>` with idempotency key `<workspace>:<seq>`, and for each copy a `broadcast` to its members' channels with key `<workspace>:<seq>:<n>`. Mark `published_at` when the batch succeeds; a failure stops that workspace and retries next tick (as in 0005).
4. For a `members` row, after publishing: for each named member who is no longer active, call Centrifugo `unsubscribe` for that user on `workspace:<id>` and on their member channel.
5. Feed the lag (`published_at - created_at`) into the rolling stats.

**Audience** (`packages/core/src/access/audience.ts`; #9 owns the rules, this spec owns the interface):

```ts
export interface Audience {
  readonly members: readonly { readonly memberId: string; readonly userId: string }[];
  /** True when every active member may read everything this row names. */
  isOpen(row: OutboxRow): boolean;
  /** Which facts `filter` needs for this row, loaded once per batch. */
  needs(row: OutboxRow): FactRequest;
  /** The copy one member may receive, or undefined for none. */
  filter(row: OutboxRow, memberId: string, facts: Facts): ChangeEvent | undefined;
}
```

| Kind | Open when | A member's copy |
|---|---|---|
| `records` | the object, every named attribute and every named record are readable by every member | named records the member may read; attributes they may read; a record whose only changed attributes are hidden drops out; created, deleted, restored ids kept for readable records; purged ids only with read on the whole object; `coarse` kept when the object is readable |
| `entries` | the list and its parent object are open | entries of records the member may read, in a list they may read |
| `definitions` | the object or list is readable by every member and no named attribute is hidden from anyone | the object or list when readable, with visible attribute ids |
| `views` | every named view is shared with the workspace and its object or list is open | views the member may see (a private view: its owner only) |
| `notes` | the parent record is open | notes on records the member may read |
| `tasks` | every linked record is open, or none is linked | tasks the member may see (#19 and #9 define it), with only readable linked records |
| `members`, `access` | always | not applicable |

`openAudience` (until #9): every row is open except `views` rows naming a private view.

**API surface** (oRPC on `/api/rpc`):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `realtime.subscriptionToken` (changed) | `workspace`, `channel`: `workspace` or `member` | `{ channel, token, head }` (`head` only for `workspace`) | member | 404 `NOT_FOUND` |
| `realtime.catchUp` (new) | `workspace`, `after` (integer ≥ 0) | `{ head, reset, events: ChangeEvent[] }` | member | 404 `NOT_FOUND`, 400 `INPUT_INVALID` |
| `realtime.connectionToken` (exists) | none | `{ token }` | session | 401 |

`realtime.catchUp` reads rows with `seq > after` up to the head, filters each through the audience for the caller (an open row as it is, a restricted row as the caller's copy or nothing; never a stub), and collapses them into at most one event per (kind, object or list), ids merged; past 1,000 ids an object or list goes coarse. It answers `reset: true` with no events when `after` is below the oldest retained row minus one, or more than 5,000 rows behind the head. Its own events carry the collapsed range's last `seq`.

**Status codes**: 400 `INPUT_INVALID`, 401 `UNAUTHENTICATED`, 404 `NOT_FOUND` (non member, removed member, unknown workspace), 500 `INTERNAL`. No new codes. Rate limiting of `realtime.catchUp` comes with the central limits module (#38) like every read; its cost is bounded by the 5,000 row cap.

**Client** (`packages/data/src/live/`):
- One live router: each store registers a handler for its kinds (`live.on(kind, handler)`); unknown kinds are ignored after their `seq` is applied.
- Watermark `W`: the last contiguous `seq` applied from `workspace:<id>`. It starts at `head` from the workspace token, which the data layer awaits before its first cached read (the token call runs beside `me.get`, so it adds no round trip).
- A new subscription, an unrecovered resubscribe, a `seq` gap, or a member channel resubscribe: `realtime.catchUp({ after: W })` (after a random 0 to 2 second delay when unrecovered), apply its events, set `W = head`, then apply buffered live events with `seq > W`. `reset: true`: every store resyncs.
- Copies on the member channel are applied when they arrive; they never move `W`. Own echoes are skipped by `mutationId`, as in 0005.
- Per record request ordering: each refetch carries a local request number; a response replaces the base only when its number is higher than the base's.
- Coarse refetches coalesce to one per object or list per second.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| write | `seq` | `workspace_counters.outbox_seq + 1` under the row lock (spec 0005) |
| write | `created_at`, the event's `at` | `clock_timestamp()` in the hook, after the counter row is taken |
| write | `actor_member_id` | the write scope's actor when it is a member, else null |
| write | the kind and the ids | the capped `Change` (engine writes) or the caller of `appendOutbox` (non engine writes) |
| write | `coarse` for an object or list | `capChange`: more than `CHANGE_CAP` (1,000) ids, or the object is in `Change.coarseObjects` |
| relay | open or restricted, and each copy | `planDelivery` with the workspace's `Audience` (`openAudience` until #9) |
| relay | the member channel name | `member:<workspaceId>.<memberId>` from the audience's member list |
| relay | `mutationId` on a copy | only when the copy's member equals `actor_member_id` |
| relay | users to unsubscribe | `members.user_id` of members named by a `members` row and no longer active, read under `withWorkspace` |
| relay | `published_at` | `clock_timestamp()` when Centrifugo's batch answers success |
| relay stats | lag p50, p95, max | rolling 5 minute window of `published_at - created_at` of rows this relay published |
| relay stats | pending rows, oldest pending age | the unpublished rows the relay read this tick |
| `subscriptionToken` | `head` | `workspace_counters.outbox_seq`, read without a lock |
| `catchUp` | `head` | the same counter, read first in the transaction |
| `catchUp` | the oldest retained `seq` | `min(seq)` of the workspace's outbox rows (first primary key row) |
| `catchUp` | `reset` | `after < oldest - 1`, or `head - after > CATCH_UP_MAX_ROWS` (5,000, a constant in `packages/core`) |
| client | the watermark at start | `head` from the workspace token |
| client | the catch up delay | random 0 to 2,000 ms, only after an unrecovered resubscribe |
| prune | the cutoff | `now() - OUTBOX_RETENTION` (24 hours, a constant in `packages/core`) |
| prune | the batch | 10,000 rows per workspace per statement, oldest `seq` first |
| prune | which workspaces | `crm_outbox_stale_workspaces(cutoff, 500)`, repeated until empty |
| harness | delivery time | the subscriber's clock when `records.get` resolves, minus the event's `at` (same host, so one clock) |
| harness | discarded share | events whose object or list the simulated client holds nothing of, over events received |

**Key invariants**:
- Every committed write that changes something has its outbox rows; a rolled back write has none (0005).
- `seq` per workspace has no gaps and follows commit order, and `workspace:<id>` carries every `seq` exactly once, as the event or its stub.
- Events are filtered at delivery time (live and catch up), never at write time; the outbox stores the full ids.
- An event or copy names only ids its receiver may read; a stub names none.
- Events are invalidations: applying one twice or out of order changes nothing, so only completeness matters, and the watermark guards it.
- An unpublished row is never pruned.
- `actor_member_id` never leaves the database.
- No hook receives an unbounded far reference list.

**Security model**:
- Channels open only by tokens from the `member` door; a token names one channel. The member channel token is minted for the caller's own member id only.
- A removed member is unsubscribed by the relay and refused new tokens; a connection token outlives a removal by at most 10 minutes but opens nothing.
- The stub reveals that something the member can't see changed, and when; nothing more. Accepted (listed for the owner).
- `mutationId` goes only to open events and the actor's copies, so two rows sharing one can't reveal a hidden link.
- The relay and catch up read outbox rows under `withWorkspace` as `crm_app`; the new definer function returns workspace ids only.
- `security-access-reviewer` reviews milestones 1 and 3; `state-performance-reviewer` reviews milestones 1 and 4.

**Configuration required**:
- `infra/centrifugo/config.json`: the `workspace` namespace (from 0005) and the new `member` namespace (`allow_subscribe_for_client` false, `history_size` 0). No new variables: the worker already has `CENTRIFUGO_API_URL` and `CENTRIFUGO_API_KEY`, the api `CENTRIFUGO_TOKEN_SECRET`.
- Constants, not variables: `OUTBOX_RETENTION` (24 hours), `CATCH_UP_MAX_ROWS` (5,000), relay batch size (100), prune batch (10,000).

**Critical test scenarios**:
- Happy path: two browsers, one offline 6 minutes while the other edits; reconnect shows every change with no reload, verifies **AC-72**, **AC-74**.
- Restart: Centrifugo restarted mid session; worker stopped 10 minutes with 2,000 pending rows, verifies **AC-75**, **AC-76**.
- Reset: a watermark below the retained rows, and one 6,000 rows behind, verifies **AC-73**, **AC-89**.
- Kinds: each engine write kind and each non engine writer stores its rows; the kind registry test; an unknown kind is skipped, verifies **AC-79** to **AC-82**.
- Huge delete: 200,000 links, memory and the coarse event, verifies **AC-83**.
- Permission: the test audience (hidden object, hidden field, own records only) across live delivery and catch up; frames inspected; a removed member's browser stops receiving, verifies **AC-84** to **AC-88**.
- Load: 100 and 1,000 online, delivery p95, relay lag, discarded share, prune during load, coarse coalescing, verifies **AC-77**, **AC-78**, **AC-89** to **AC-91**.

## Build plan

Tracer Bullet: each milestone ends with something you can see in production or in the harness.

**Milestone 1: a screen that was away catches up**
1. Migration: the new `outbox` columns and the `clock_timestamp()` default; the hook writes `created_at` and `actor_member_id`, satisfies **AC-77**, **AC-87**
2. `ChangeEvent` in `packages/contracts` with `at` and the `restricted` stub; the relay publishes `at`; the client ignores unknown kinds after applying their `seq` (shipped before any server emits a new kind), satisfies **AC-77**, **AC-79**
3. Relay batching through Centrifugo's `batch` API, the rolling stats, the `relay.stats` log line and the worker `/health` numbers, satisfies **AC-76**, **AC-77**
4. `realtime.catchUp` (collapse, cap, reset) and `head` on the workspace token, satisfies **AC-72**, **AC-73**
5. Client: the watermark from `head`, catch up on new, unrecovered or gapped subscriptions with the jitter, `reset` resyncs every store, per record request ordering, coarse coalescing, satisfies **AC-72** to **AC-75**, **AC-90**
6. Deploy (api and worker first, then web); Playwright offline 6 minutes and the Centrifugo restart, locally and in production; `security-access-reviewer` and `state-performance-reviewer`, satisfies **AC-72** to **AC-76**

**Milestone 2: every kind of change is live**
7. Engine: `EntryRef` in `Change`, per list capping, the bounded far references with `coarseObjects`, satisfies **AC-80**, **AC-83**
8. The outbox hook writes `entries` rows and widened `definitions` rows (objects, options, groups, lists, reorders); `appendOutbox` exported for non engine writers, satisfies **AC-80** to **AC-82**
9. The live router (`live.on`) with handlers for `records`, `entries`, `definitions`, `members` and `access`; the registry test that every kind has an audience rule and a handler slot (views, notes and tasks slots filled by #19 and #20), satisfies **AC-79**, **AC-81**, **AC-85**
10. `members` rows: the relay unsubscribes removed members; `realtime.subscriptionToken` refuses them; `access` rows drop the relay's audience cache, satisfies **AC-84**, **AC-85**
11. Deploy; visible: a column renamed or reordered in one browser moves in the other, satisfies **AC-81**

**Milestone 3: each person receives only what they may see**
12. No table change: the `member` namespace in Centrifugo's config, and `realtime.subscriptionToken` for `channel: 'member'` (the caller's own member id only), satisfies **AC-86**
13. `Audience`, `openAudience` (private views to their owner) and `planDelivery` in `packages/core`, pure and unit tested with the test audience, satisfies **AC-86**, **AC-87**
14. The relay publishes open events, stubs and copies in one ordered batch; facts loaded once per batch, satisfies **AC-86**, **AC-87**
15. `realtime.catchUp` filters through the same audience; the client subscribes to its member channel and applies copies, satisfies **AC-86**, **AC-88**
16. Playwright with the test audience: frames inspected for hidden ids in live delivery and catch up; deploy; `security-access-reviewer`, satisfies **AC-86** to **AC-88**

**Milestone 4: pruned, measured, proven**
17. Migration: `crm_outbox_stale_workspaces`, `delete` for `crm_app`, guard tests; `pruneOutbox` in `packages/db`; the hourly run (the #8 cron `outbox.prune`, or the relay's own timer until #8 lands), satisfies **AC-89**
18. The harness `live` scenario (in #12's harness, or its thin slice here): 100 and 1,000 online, delivery time from `at`, relay lag, discarded share, a prune of 1 million rows during the run, satisfies **AC-78**, **AC-89**, **AC-91**
19. `verify.md` with the numbers; `state-performance-reviewer`, satisfies **AC-77**, **AC-78**, **AC-91**

## Migration plan

**Strategy**: additive, in deploy order. **Phases**:
1. The api and worker deploy first: new columns have defaults, events gain `at`, the client's existing `seq` logic is unaffected.
2. The web deploys next with the unknown kind rule, catch up and the member channel. A client from before this phase never sees a new kind, because no writer emits one and `openAudience` sends no stub until private views (#20) exist.
3. Milestone 3 turns on stubs and copies; by then every client runs the new router.
**Rollback**: revert the code; the columns and the definer function stay unused. Clients fall back to 0005's refetch on an unrecovered subscription.
**Risks**: a web deploy that lags the api by minutes sees `head` it doesn't read yet (ignored), nothing worse.

## Consequences

**Positive**:
- A laptop that slept, a dropped train connection, or a Centrifugo deploy no longer costs a full refetch: the outbox is the long history, with no new service.
- One kind registry and one writer means search (#33), notifications (#28), webhooks (#35) and automations read the same stream later.
- Filtering happens in one pure function shared by live delivery and catch up, so #24's rules hold on the live path the day they land.
- Delivery has numbers from day one: lag in logs and `/health`, and a harness proof.

**Negative / tradeoffs**:
- The stub tells a restricted member that something changed, and when.
- Restricted events cost the relay a facts query and a broadcast per batch; heavy record rules on a busy workspace add relay lag, measured in AC-78 only with the test audience until #24's real rules exist.
- Writes that change something take the counter row plus a slightly wider outbox row; still one row per object, list or kind.
- 24 hours of outbox rows live on Neon's free plan storage; a busy workspace adds tens of megabytes. Retention is a constant to lower if storage tightens.
- The first cached read waits for the workspace token's `head` (in parallel with `me.get`, so usually free; when the token call is slower, first load waits for it).
- Until #8, pruning runs inside the relay process.
- Channel per object is not done: a member receives every event of the workspace even for objects they aren't looking at. The trigger to split: the harness's discarded share above 80% with delivery p95 above 750 ms, or a client spending more than 5% of a frame budget on discarded events.

**Neutral**:
- Two migrations (outbox columns; the prune function and grant). One new Centrifugo namespace.
- AC-38's "refetch on unrecovered" becomes "catch up, then refetch only on reset".
- No new dependencies.

## Follow-up

- [ ] **Owner to confirm**: 24 hour retention; no channel split per object until AC-91's trigger; outbox history over a Redis engine; the `restricted` stub's timing signal.
- [ ] **#9 and #24**: implement `Audience` with real rules (object, field, record), its facts loaders, and what a task with several linked records means for visibility (with #19). Bump nothing: an `access` row is enough.
- [ ] **#25**: "sign out everywhere" and revoked sessions should disconnect the user from Centrifugo; the API has no Centrifugo key today, so route it through an outbox `access` row or give the api a publish only key.
- [ ] **#28, #33, #35**: the first consumer besides the relay adds `outbox_consumers (consumer, workspace_id, seq)`; pruning then keeps rows at or above the slowest healthy consumer, never more than 7 days, and a consumer further behind resyncs.
- [ ] **#36**: the audit hook names a deleted record with its link count, since `Change` no longer lists every far reference.
- [ ] **#26 presence**: rides its own channel, never the outbox (house rule), so nothing here changes for it.
- [ ] **#11**: chart `relay.stats` (lag distribution, pending, oldest pending age) and alert when the oldest pending row is older than 30 seconds.
- [ ] **#12**: adopt the `live` scenario if this spec built its thin slice.
- [ ] `/sync`: record in `apps/api/AGENTS.md` and `packages/data/AGENTS.md` the live router, the member channel and `appendOutbox`; spec 0005's AC-38 note on refetch.
