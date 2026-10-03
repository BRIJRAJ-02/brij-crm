# 0007. Change events and realtime: decision record

## Context

Spec 0005 builds the thin first path for live updates: an outbox row in every write transaction, a relay in the worker, one Centrifugo channel per workspace with 100 events or 5 minutes of memory history, and a browser that refetches named records. That path is enough for one table and two browsers. The scope's Done when for #7 asks for more: delivery within one second at p95 with 100 people online, a screen that catches up after a drop with no gap and no refresh, and an event that never carries data the viewer may not see.

Forces:
- **History is short and volatile.** Centrifugo runs one node on the memory engine. Its history is lost on every restart or deploy, and a laptop asleep for 10 minutes is already past it, so 0005's fallback (refetch everything held) becomes the common case rather than the rare one.
- **Access rules are coming.** #9 and #24 add object, field and record rules. On one shared channel, ids alone leak: an event names records a member may not see, `attribute_ids` name hidden fields, and two rows sharing a `mutationId` reveal a link (0005's follow ups). Filtering must happen somewhere every event and every catch up passes through.
- **More kinds of change.** Lists and entries (#51), views (#20), notes and tasks (#19), members (#23) and access changes (#24) all change what screens show, and the scope says every write produces one event. The engine's `Change` lists entries as bare ids, without their list.
- **The outbox grows forever** until something deletes it, on a Neon free plan with limited storage (the owner keeps the free plan).
- **No measurement exists.** The target is p95 within one second at 100 online; nothing records commit time, publish time or receive time, and the load harness (#12) is being designed in parallel.
- **A known engine hazard**: deleting a record with about 200,000 links builds a `Change` with every far reference in memory (0005 follow up assigned to #7).
- Constraints: one Railway project with no Redis, a small team, Tracer Bullet delivery, and scale proofs run locally in capped Docker.

## Options considered

### Option 1: one workspace stream, the outbox as long history, filtered copies only when needed (chosen)

Keep `workspace:<id>` as the ordered stream of every `seq`. Short drops recover from Centrifugo's memory; anything longer catches up through an API call that reads the outbox. An event every member may read goes out in full; otherwise the shared channel carries a stub with only the `seq`, and each member gets a filtered copy on a personal channel.

**Pros**: keeps 0005's gap check and ordering exactly; no new service; the outbox already is a durable ordered log; filtering is one pure function shared by live delivery and catch up; costs nothing extra while every event is open (all of today).
**Cons**: two channels per browser; the stub leaks timing; the client merges two sources.

### Option 2: one personal channel per member for every event

The relay filters every event per member and broadcasts to every member's channel. No shared channel.

**Pros**: one channel per browser; no stub, so no timing signal; filtering is uniform.
**Cons**: gap detection by workspace `seq` breaks (filtered out rows are holes), so each channel needs its own sequence kept by the relay, or Centrifugo offsets plus a separate long history per member; every event costs a broadcast to all members even in workspaces with no rules; history per member multiplies memory.

### Option 3: one channel per audience (members grouped by identical access)

Members with the same effective rules share a channel; the relay publishes one copy per audience.

**Pros**: cheapest fan out when there are few distinct audiences.
**Cons**: record rules like "own records" make every member their own audience, so it degenerates to option 2; audiences change whenever rules, roles or teams change, forcing resubscribes; gap detection has the same problem as option 2.

### Option 4: a Redis engine for Centrifugo with long history, and a subscribe proxy

Add Redis on Railway, raise history to hours, and let a proxy authorise each subscription.

**Pros**: Centrifugo's own recovery handles long drops; standard pattern in its docs.
**Cons**: a new paid service to run and back up; history is still bounded and per channel, so filtering per member is not solved; history becomes a second copy of the outbox that can disagree with it; Centrifugo's docs warn against using history as a primary store.

## Rationale

Option 1 answers each force with what already exists. The outbox is already gap free, ordered and in Postgres, so making it the long history costs one read procedure and a retention rule, not a service, which fits a small team and the free Neon plan. Keeping the shared stream for every `seq` keeps 0005's correctness check unchanged, and because events are invalidations (applying one twice or late changes nothing), merging a personal channel into it needs no ordering guarantees, only completeness, which the watermark guards. Options 2 and 3 pay for filtering on every event in every workspace and break the gap check; option 4 adds an operational dependency without solving the access force.

Per decision (recommendations taken; the brief had no #7 section, so the first four are listed for the owner to confirm):
- **24 hour retention**: covers a night's sleep and a dropped connection; anything older resyncs what the screen holds, which is correct, only slower. Runner up: 7 days, rejected for free plan storage.
- **No channel per object yet**: events are tiny ids, the client already skips objects it holds nothing of, and per object channels add subscription churn on every navigation. AC-91 measures the discarded share; the split has a stated trigger.
- **Outbox over Redis for long history**: see option 4.
- **The restricted stub**: the cheapest way to keep one gap free stream; it reveals only that something hidden changed, and when. Runner up: no stub and per channel offsets, rejected for the complexity in option 2.
- **Filter at delivery, not at write**: rules can change between commit and publish, and a catch up hours later must use today's rules; the outbox keeps full ids and never leaves the database.
- **`mutationId` only to the actor's copies**: the writer still skips its echo, and shared ids can't reveal a hidden link.
- **`head` from the token, not `seq` on every read**: no read changes shape (an array to object change would break a web deploy that lags the api); the token call runs beside `me.get`, and per record request numbers stop a slow response overwriting a newer one. Runner up: `seq` on every read, rejected for the shape change.
- **Collapsed catch up with a 5,000 row cap**: bounded response size and cost per call; beyond the cap a resync is cheaper than replaying.
- **Ordered `batch` publishes of 100**: drains a backlog without one HTTP call per row, keeping order.
- **Pruning by batched deletes, not daily partitions**: the primary key already orders rows by `seq` per workspace, and partitioning would force `created_at` into the key. Revisit if pruning shows in relay lag (AC-89 measures it).
- **Far references capped at collection**: no hook needs every far id; the audit log names the deleted record and a count. Fixes the memory hazard at its source.
- **Members and access as events**: removal must cut delivery, and a rule change must reshape what every screen holds; both are cheapest as rows in the same ordered stream, which also tells the relay exactly when to rebuild its audience.
- **Thin slices for #8, #9 and #12**: the relay's own prune timer, `openAudience`, and the `live` scenario, each in the shape the owning feature keeps, so parallel work never blocks this spec.

## Evidence

From reading the repo on 3 October 2026:
- The outbox, relay and client subscription are spec 0005 milestone 3, being built now; `apps/api/src/worker.ts` holds the direct connection and today exits when it drops (0005 changes that to reconnect with backoff).
- `infra/centrifugo/config.json` runs the memory engine with no namespaces yet; `.railway/railway.ts` has three services (api, worker, centrifugo) and no Redis.
- `packages/core/src/engine/write.ts`: `Change` lists records as `RecordRef` but entries as bare ids; `capChange` caps records per object at `CHANGE_CAP` (1,000); hooks run after the counter row is taken, so a hook's cost holds every other write in the workspace.
- `packages/core/src/engine/deletion.ts`: delete, restore and erasure each call `farReferences` and record the whole list in the `Change`.
- `packages/core/src/access/door.ts`: the door grants an active member everything; no rules exist yet.
- No general rate limiter exists for RPC procedures; only Better Auth's on `/api/auth/*`.
- The #11 brief already plans relay lag and backlog metrics; the #12 brief sets live delivery p95 1 second at 100 online and relay lag under 250 ms; the #19, #20, #13 and #18 briefs each name the outbox kind they emit.
