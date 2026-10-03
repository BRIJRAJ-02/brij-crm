# 0005. Change events for the core loop

## Summary

Every write that changes something also stores a small outbox row in the same transaction: which records or attributes changed, numbered per workspace with no gaps. A relay in the worker publishes those rows, in order, to the workspace's Centrifugo channel. Browsers fetch the named records again through the API, so the access door decides what each person sees.

## Outbox

- Table `outbox` (see the data model in [index.md](index.md)), forced row level security with the standard policy. Primary key (`workspace_id`, `seq`); index (`published_at` is null) leading with `workspace_id` for the relay.
- `seq`: `update workspace_counters set outbox_seq = outbox_seq + 1 where workspace_id = $1 returning outbox_seq` inside the write transaction. The row lock makes numbers gap free and in commit order per workspace (record creates already lock this row).
- The hook: `outboxHook({ mutationId })` returns an `AfterWrite`. It skips an empty `Change`, writes one row per object touched (`kind: 'records'`), and one `kind: 'definitions'` row when attributes changed, then `pg_notify('crm_outbox', workspace_id)` (delivered on commit, works through PgBouncer).
- `Change` grows: each created and changed record carries its `objectId`, and a `definitions: { objectId, attributeIds }[]` part that `defineAttribute` fills. (The fresh review of #5 found `Change` under reports deletes and restores; that fix lands first and this hook reads the corrected payload.)
- One composer in `apps/api` (`writeHooks(context)`) builds the hook list for every write procedure, so no handler can forget it. A test calls every write procedure and checks one outbox row each, and none for a refused write.

## Relay

- Reading across workspaces: two security definer SQL functions, owned by `crm_relay` (no login, BYPASSRLS, `select` and `update (published_at)` on `outbox` only), execute granted to `crm_app`:
  - `crm_outbox_pending(max integer)` returns unpublished rows ordered by (`workspace_id`, `seq`), at most `max` (clamped 1 to 500).
  - `crm_outbox_mark(workspace uuid, upto bigint)` sets `published_at` for that workspace's rows up to `upto`.
  - Same hardening as `crm_search_text`: `begin atomic` bodies, `search_path = pg_catalog, pg_temp`, qualified names, the migration refuses to finish if anyone but the owner can reach `crm_relay`. The guard tests list exactly these three definer functions and the two roles.
- `apps/api/src/realtime/relay.ts`, a factory with injected deps, started by `worker.ts`:
  - `LISTEN crm_outbox` on the direct connection, plus a 1 second poll (covers a dropped LISTEN, for example after Neon's compute sleeps).
  - `pg_try_advisory_lock` so only one relay publishes.
  - For each workspace's pending rows in `seq` order: `POST {CENTRIFUGO_API_URL}/api/publish` with `X-API-Key`, channel `workspace:<id>`, the event, and `idempotency_key` `<workspace>:<seq>`; then mark. A failed publish stops that workspace's batch and retries next tick; other workspaces continue.
- Rows are never deleted in this loop; #8 prunes them.

## Centrifugo

- A `workspace` namespace: subscriptions need a subscription token, `history_size` 100, `history_ttl` 5 minutes, `force_recovery` on. The memory engine stays (one node).
- `realtime.connectionToken`: HS256 with `CENTRIFUGO_TOKEN_SECRET`, `sub` = user id, 10 minutes, signed with `node:crypto` in one module.
- `realtime.subscriptionToken({ workspace })`: through the `member` door, a token for channel `workspace:<id>` only.
- Variables: worker `CENTRIFUGO_API_URL=http://centrifugo.railway.internal:9000` and `CENTRIFUGO_API_KEY` (references to the Centrifugo service); api `CENTRIFUGO_TOKEN_SECRET` (reference); web `VITE_REALTIME_URL` and the CSP `connect-src`. Previews get no realtime in this loop (their CSP and hosts differ); the client shows "live updates paused" there.

## Tests

- Real Postgres: a write stores one row with the next `seq`; concurrent writes in one workspace get consecutive numbers in commit order; a refused write stores none; definitions changes store a `definitions` row.
- The relay against a fake Centrifugo: publishes in order, marks, retries a failed publish without skipping, a second relay waits on the lock.
- Guard tests: the definer functions and roles, as above.
- Two browsers (Playwright), locally and against production: an edit in one shows in the other within 1 second.

## Rationale (short)

The outbox in the write transaction is the only way an event can never describe a change that rolled back, and never miss one that committed. Ids only keeps future field and record rules (#9) in one place, the API. Definer functions follow the reviewed `crm_search_text` pattern and add no login or secret.
