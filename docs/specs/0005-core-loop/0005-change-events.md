# 0005. Change events for the core loop

## Summary

Every write that changes something also stores a small outbox row in the same transaction: which records or attributes changed, numbered per workspace with no gaps. A relay in the worker publishes those rows, in order, to the workspace's Centrifugo channel. Browsers fetch the named records again through the API, so the access door decides what each person sees.

## Outbox

- Table `outbox` (see the data model in [index.md](index.md)), forced row level security with the standard policy. Primary key (`workspace_id`, `seq`); index (`published_at` is null) leading with `workspace_id` for the relay.
- `seq`: `update workspace_counters set outbox_seq = outbox_seq + 1 where workspace_id = $1 returning outbox_seq` inside the write transaction. The row lock makes numbers gap free and in commit order per workspace (record creates already lock this row). The hook runs last, so creates take the lock first and other writes take it at the end: mixed order, but `runWrite` retries a deadlock. It also means writes in one workspace commit one at a time at this row; a bulk change stays one transaction and one event.
- The composer: `writeHooks(context, { mutationId })` in `apps/api`, so the hook sees the input's `mutationId`.
- The hook: `outboxHook({ mutationId })` returns an `AfterWrite`. It skips an empty `Change`, writes one row per object touched (`kind: 'records'`), and one `kind: 'definitions'` row when attributes changed, then `pg_notify('crm_outbox', workspace_id)` (delivered on commit, works through PgBouncer).
- `Change` grows: record lists are `RecordRef` (`{ recordId, objectId }`), `values[]` carry `objectId` (or `listId` for entries), plus `references`, `purgedRecords` and the entry lists (landed with the spec 0004 review fixes). This loop adds `definitions: { objectId, attributeIds }[]`, filled by `insertAttribute`, `updateAttribute` and `archiveAttribute` through `context.record({ definitions })`. 
- One composer in `apps/api` (`writeHooks(context)`) builds the hook list for every write procedure, so no handler can forget it. A test calls every write procedure and checks one outbox row each, and none for a refused write.

## Relay

- Reading across workspaces: one security definer SQL function, owned by `crm_relay` (no login, BYPASSRLS, `select` on `outbox` only), execute granted to `crm_app`:
  - `crm_outbox_workspaces(max integer)` returns the distinct workspace ids with unpublished rows, at most `max` (clamped 1 to 500). Ids only, never row contents.
  - Same hardening as `crm_search_text`: a `begin atomic` body, `stable`, `search_path = pg_catalog, pg_temp`, qualified names, the migration refuses to finish if anyone but the owner can reach `crm_relay`. The guard tests list exactly these two definer functions and the two roles.
- Reading and marking rows: inside `withWorkspace(id)`, under row level security, as `crm_app` (which gets `select` and `update (published_at)` on `outbox`). The LISTEN payload already names the workspace, so a notified workspace skips the function.
- `packages/db` exports `createOutboxReader(direct)` → `{ lock(), unlock(), workspaces(max), pending(workspaceId, max), mark(workspaceId, upto), listen(onNotify) }`; `relay.ts` takes it as a dependency, so no raw `pg` lives outside `packages/db`.
- `apps/api/src/realtime/relay.ts`, a factory with injected deps, started by `worker.ts`:
  - `LISTEN crm_outbox` on the direct connection, plus a 1 second poll. A dropped connection (Neon's compute sleeping, for example) reconnects with backoff (1, 2, 4 up to 30 seconds) instead of exiting the worker; the poll covers what LISTEN missed.
  - `pg_try_advisory_lock` so only one relay publishes.
  - For each workspace's pending rows in `seq` order: `POST {CENTRIFUGO_API_URL}/api/publish` with `X-API-Key`, channel `workspace:<id>`, the event, and `idempotency_key` `<workspace>:<seq>`; then mark. A failed publish stops that workspace's batch and retries next tick; other workspaces continue.
- Rows are never deleted in this loop; #8 prunes them.

## Centrifugo

- A `workspace` namespace: `allow_subscribe_for_client` false (subscription tokens only), `history_size` 100, `history_ttl` 5 minutes, `force_recovery` on. The memory engine stays (one node).
- The browser passes `getToken` callbacks for both the connection and the subscription, so the 10 minute tokens renew themselves. The subscription token's `sub` equals the connection's user id.
- `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` holds `APP_URL` in production (set in `.railway/railway.ts`, where it is preserved today).
- `realtime.connectionToken`: HS256 with `CENTRIFUGO_TOKEN_SECRET`, `sub` = user id, 10 minutes, signed with `node:crypto` in one module.
- `realtime.subscriptionToken({ workspace })`: through the `member` door, a token for channel `workspace:<id>` only.
- Variables: worker `CENTRIFUGO_API_URL=http://centrifugo.railway.internal:9000` and `CENTRIFUGO_API_KEY` (references to the Centrifugo service); api `CENTRIFUGO_TOKEN_SECRET` (reference); web `VITE_REALTIME_URL` and the CSP `connect-src`. Previews get no realtime in this loop (their CSP and hosts differ); without `VITE_REALTIME_URL` the client's live status is `off` and the table shows nothing about it.

## Tests

- Real Postgres: a write stores one row with the next `seq`; concurrent writes in one workspace get consecutive numbers in commit order; a refused write stores none; definitions changes store a `definitions` row.
- The relay against a fake Centrifugo: publishes in order, marks, retries a failed publish without skipping, a second relay waits on the lock, a dropped connection reconnects.
- The definer function returns ids only and nothing to a caller without execute.
- Guard tests: the definer functions and roles, as above.
- Two browsers (Playwright), locally and against production: an edit in one shows in the other within 1 second.

## Rationale (short)

The outbox in the write transaction is the only way an event can never describe a change that rolled back, and never miss one that committed. Ids only keeps future field and record rules (#9) in one place, the API. One definer function that returns only workspace ids keeps the hole in row level security as small as it can be; it follows the reviewed `crm_search_text` pattern and adds no login or secret.
