# 0007. Change events and realtime: decision record

## Context

Spec 0005 builds the thin first path for live updates: an outbox row in every write transaction, a relay in the worker that is active while there is work and dormant after 3 quiet minutes (woken by the API after a write), one Centrifugo channel per workspace with 1,000 events or 5 minutes of memory history, and a browser that refetches named records. That path is enough for one table and two browsers. The scope's Done when for #7 asks for more: delivery within one second at p95 with 100 people online, a screen that catches up after a drop with no gap and no refresh, and an event that never carries data the viewer may not see.

Forces:
- **History is short and volatile.** Centrifugo runs one node on the memory engine. Its history is lost on every restart or deploy, and a laptop asleep for 10 minutes is already past it, so spec 0005's fallback (refetch everything held) becomes the common case rather than the rare one.
- **Access rules are coming.** #9 and #24 add object, field and record rules. On one shared channel, ids alone leak: an event names records a member may not see, `attribute_ids` name hidden fields, and two rows sharing a `mutationId` reveal a link (spec 0005's follow ups). Jobs (spec 0008) are visible only to their starter and to owners and admins. Filtering must happen somewhere every event and every catch up passes through.
- **More kinds of change.** Lists and entries (#51), views (#20), notes and tasks (#19), members (#23), access changes (#9, #24) and jobs (#8) all change what screens show, and the scope says every write produces one event. The engine's `Change` lists entries as bare ids, without their list.
- **The outbox grows forever** until something deletes it, on a Neon free plan with limited storage and a monthly compute allowance (the owner keeps the free plan). Anything that queries the database on a timer keeps the compute awake.
- **No measurement exists.** The target is p95 within one second at 100 online; nothing records commit time, publish time or receive time, and the load harness (#12) is being designed in parallel.
- **A known engine hazard**: deleting a record with about 200,000 links builds a `Change` with every far reference in memory (spec 0005 follow up assigned to #7).
- Constraints: one Railway project with no Redis, a small team, Tracer Bullet delivery, and scale proofs run locally in capped Docker.

## Options considered

### Option 1: one ordered stream per audience channel, the outbox as long history (chosen)

Members with the same data policy share an audience and one channel, `workspace:<id>.<policyKey>`; with no rules everyone shares `open`. Every `seq` reaches every audience channel, as that audience's filtered event or as a stub with only the `seq`. Short drops recover from Centrifugo's memory; anything longer catches up through an API call that reads the outbox through the same filter.

**Pros**: keeps spec 0005's gap check and ordering exactly, per channel; one channel per browser; no new service; the outbox already is a durable ordered log; filtering is one pure function shared by live delivery and catch up; costs nothing extra while every event is open (all of today), since a workspace with no rules has one audience; record rules become coarse events (spec 0009), so audiences don't splinter into one per member.
**Cons**: the stub leaks timing; each extra audience multiplies publishes; a coarse event under a record rule costs a refetch of what is held.

### Option 2: one shared stream with stubs, plus a personal channel per member for filtered copies

Keep `workspace:<id>` as the stream of every `seq` (the event when open, else a stub), and send each restricted member a filtered copy on `member:<workspaceId>.<memberId>`.

**Pros**: copies are exact per member, so record rules never need coarse events.
**Cons**: two channels per browser and a client that merges two sources; a broadcast per restricted event to every affected member; facts per member per event; the personal channel has no history of its own, so a missed copy always means a catch up.

### Option 3: one personal channel per member for every event

The relay filters every event per member and publishes to every member's channel. No shared channel.

**Pros**: one channel per browser; no stub, so no timing signal; filtering is uniform.
**Cons**: gap detection by workspace `seq` breaks (filtered out rows are holes), so each channel needs its own sequence kept by the relay, or Centrifugo offsets plus a separate long history per member; every event costs a publish per member even in workspaces with no rules; history per member multiplies memory.

### Option 4: a Redis engine for Centrifugo with long history, and a subscribe proxy

Add Redis on Railway, raise history to hours, and let a proxy authorise each subscription.

**Pros**: Centrifugo's own recovery handles long drops; standard pattern in its docs.
**Cons**: a new paid service to run and back up; history is still bounded and per channel, so filtering is not solved; history becomes a second copy of the outbox that can disagree with it; Centrifugo's docs warn against using history as a primary store.

## Rationale

Option 1 answers each force with what already exists. The outbox is already gap free, ordered and in Postgres, so making it the long history costs one read procedure and a retention rule, not a service, which fits a small team and the free Neon plan. Putting every `seq` on every audience channel keeps spec 0005's correctness check unchanged on each channel, and because events are invalidations (applying one twice or late changes nothing), a filtered or empty event is always safe. Option 2 pays for two channels and a merge in every browser; option 3 pays for filtering on every event in every workspace and breaks the gap check; option 4 adds an operational dependency without solving the access force.

Per decision (settled in the cross check of 8 October 2026 unless marked):
- **Audience channels keyed by spec 0009's `policyKey`, every `seq` on every channel**: one channel per browser, one channel per workspace while there are no rules, and Centrifugo recovery per channel still works. Runner up: option 2's shared channel plus member channels.
- **24 hour retention** (`OUTBOX_RETENTION`): covers a night's sleep and a dropped connection; anything older resyncs what the screen holds, which is correct, only slower. Runner up: 7 days, rejected for free plan storage; 10 minutes, rejected because a laptop asleep overnight would always resync.
- **Pruning only while the relay is awake, and in the daily cleanup**: a prune timer of its own would wake the database for nothing; a relay pass already holds a connection. Runner up: an hourly timer, rejected for the Neon compute allowance.
- **Prune through a definer function on the worker's login** (`crm_outbox_prune`, executable by `crm_worker` only): `crm_app` never deletes outbox rows and never lists workspaces, so a bug in tenant code can't erase another workspace's history. Runner up: a `delete` grant to `crm_app` under row level security, which needed a second workspace listing function and gave the API a destructive right it never uses.
- **No channel per object yet**: events are tiny ids, the client already skips objects it holds nothing of, and per object channels add subscription churn on every navigation. AC-91 measures the discarded share; the split has a stated trigger.
- **Outbox over Redis for long history**: see option 4.
- **The restricted stub** (left to the owner): the cheapest way to keep one gap free stream per channel; it reveals only that something hidden changed, and when.
- **Filter at delivery, not at write**: rules can change between commit and publish, and a catch up hours later must use today's rules; the outbox keeps full ids and never leaves the database.
- **`mutationId` only on unchanged events**: the writer still skips its echo when it sees the change whole, and shared ids can't reveal a hidden link.
- **`head` from the token, read ordering from spec 0006's revision rule**: no read changes shape, the token call runs beside `me.get`, and one rule orders every read. The earlier per record request numbers are dropped (one owner per concept: spec 0006).
- **Collapsed catch up with a 5,000 row cap**: bounded response size and cost per call; beyond the cap a resync is cheaper than replaying.
- **Ordered `batch` publishes of 100**: drains a backlog without one HTTP call per row, keeping order.
- **Pruning by batched deletes, not daily partitions**: the primary key already orders rows by `seq` per workspace, and partitioning would force `created_at` into the key. Revisit if pruning shows in relay lag (AC-89 measures it).
- **Far references capped at collection**: no hook needs every far id; the audit log names the deleted record and a count. Fixes the memory hazard at its source.
- **Members and access as events, and a disconnect with code 4500 on an access change**: removal must cut delivery, and a rule change must reshape what the affected screens hold; rows in the same ordered stream tell the relay exactly when to rebuild its audiences, and the disconnect makes the client fetch a token for its new channel. A terminal code keeps the client from reconnecting to the old channel before it has reloaded.
- **One exported outbox writer** (`outboxHook`, composed by `writeHooks`): non engine writers record their ids in the `Change`, so no second write path to the outbox exists to forget the counter row or the cap.
- **The relay inside the worker's awake state**: one idle clock for the relay and the job runner, so the database sleeps when nobody uses the app.

## Evidence

From reading the repo on 3 October 2026, checked again on 8 October 2026 against spec 0005's lanes in flight:
- The outbox, `outboxHook` (`packages/core/src/engine/outbox.ts`), the `writeHooks` composer (`apps/api/src/hooks.ts`), the relay (`apps/api/src/realtime/relay.ts`: active and dormant, a safety poll backing off 1, 2, 5, 15, then 60 seconds, dormant after 3 quiet minutes) and the wake call (`apps/api/src/realtime/wake.ts`: `POST /internal/outbox-wake` with the `x-crm-wake` header, `WORKER_INTERNAL_URL` and `WORKER_WAKE_SECRET`) are spec 0005 milestone 3, being built now.
- `packages/db/src/schema/outbox.ts`: `kind` is the enum `outbox_kind` (`records`, `definitions`), `object_id` is not null, no actor column; the relay function `crm_outbox_workspaces` is owned by `crm_relay` and granted to `crm_app` today.
- `infra/centrifugo/config.json` runs the memory engine; `.railway/railway.ts` has three services (api, worker, centrifugo) and no Redis.
- `packages/core/src/engine/write.ts`: `Change` lists records as `RecordRef` but entries as bare ids; `capChange` caps records per object at `CHANGE_CAP` (1,000); hooks run after the counter row is taken, so a hook's cost holds every other write in the workspace.
- `packages/core/src/engine/deletion.ts`: delete, restore and erasure each call `farReferences` and record the whole list in the `Change`.
- `packages/core/src/access/door.ts`: the door grants an active member everything; no rules exist yet.
- No general rate limiter exists for RPC procedures; only Better Auth's on `/api/auth/*`, and spec 0005's cap of 6 reads in flight per workspace.
- The #11 brief already plans relay lag and backlog metrics; the #12 brief sets live delivery p95 1 second at 100 online and relay lag under 250 ms; the #19, #20, #13 and #18 briefs each name the outbox kind they emit.
