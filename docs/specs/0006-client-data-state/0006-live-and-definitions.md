# 0006. Live changes, definitions and reconnects

## Summary

Objects, attributes and members live in one definitions store per workspace that every screen reads. A record page or a chip subscribes to one record through the same store as the tables. Incoming changes are gathered per frame and fetched together, coarse "refetch everything" changes are limited to one a second, and when spec 0007's live layer can't catch up on what was missed, the store refetches what it holds by itself, with no reload.

## The definitions store

```ts
definitions(workspace) → {
  objects(): ObjectSummary[],
  object(idOrSlug): ObjectSummary | undefined,
  attributes(objectId): AttributeDefinition[],   // options inline for select and status; loads on first ask
  members(): Member[],
  member(id): Member | undefined,
  subscribe, getSnapshot, status,
}
```

- Objects and members load when the workspace frame opens; an object's attributes load on first ask and stay.
- `attributes.list` returns `options` inline (id, label, hue, position, archived, and for status the outcome and target time), so a select cell never fetches.
- Replaces spec 0005's per call caches (`objects.list` cached per app load, `members.list` per workspace).
- Events: `kind: 'definitions'` with an `objectId` refetches that object's attributes; without one (added by #13 for object changes) it refetches the objects and every loaded object's attributes. A `members` kind (added by #23) refetches members. A window whose filter or sorts name an attribute that has gone (archived) is refetched once; #20 decides what the view shows.
- `@crm/data/react` adds `useDefinitions(workspace)` and narrow selectors (`useAttributes(objectId)`, `useMember(id)`) so a screen rerenders only when its slice changes.

## Record subscriptions

```ts
records.one(workspace, recordId, { attributeIds | 'all' }) → { subscribe, getSnapshot, status: 'loading' | 'ready' | 'deleted' | 'error', retry }
```

- `'all'` means every attribute the definitions store lists for the record's object.
- Fetches only the attributes the body lacks (`records.get` with those `attributeIds`); holds the body while subscribed.
- A `records.get` that leaves the record out sets `deleted`; the screen decides what to show (#17).

## The event pipeline

Spec 0007's live router owns the subscription, the `seq` check, the watermark and catch up, and hands each event to the handler its store registered (`live.on(kind, handler)`). This spec registers the `records`, `definitions` and `members` handlers, and the store's resync. Per `records` event (shape from spec 0007's `ChangeEvent`, plus `replaced` from this spec):
1. (The live router has already checked `seq` and moved the watermark.)
2. Skip the refetch if `mutationId` is one of this tab's own while it is due: kept from the moment the write is sent until its response, then until `echoes` events carrying it have arrived (the write's answer says how many: one per object or list it touched), or 60 seconds, whichever is first. The replaced check still runs.
3. `kind: 'records'`, fine: for each id the tab holds, add the ids and the attributes to fetch (the intersection rule in [0006-windows.md](0006-windows.md)) to the frame's batch. Mark each window on that object dirty.
4. `kind: 'records'`, coarse: schedule the object's coarse refetch (below).
5. `replaced`: run the notice check ([0006-versions-and-undo.md](0006-versions-and-undo.md)).
6. At the next animation frame (a 50 ms timer while the tab is hidden), send `records.get` per attribute set, 500 ids a call, and apply the results under the revision rule in one store update, so React renders once.

**Coarse coalescing**: per object, the first coarse event refetches at once; later ones within 1 second set one trailing refetch at the end of that second, plus a random 0 to 2 seconds, so the tabs of a whole workspace never refetch in the same instant after a bulk job. A refetch rereads every loaded block of every window on the object (which refreshes their bodies and order), their counts, and the bodies held by `records.one` subscriptions of that object (500 a call).

## Reconnects and the resync

- **Who decides**: spec 0007's live layer. A recovered resubscribe (Centrifugo's `recovered: true`) or a successful `realtime.catchUp` replays the missed events through the pipeline above, in order; nothing else is refetched.
- **The resync** (this spec's): when the live layer asks for it (a catch up answered `reset: true`, or there is no watermark to catch up from), the store waits a random 0 to 2 seconds, then once refetches the definitions, every loaded block of every window and its count, and every subscribed record. Pending optimistic layers stay on top of the new bases; open editors keep their drafts.
- Until spec 0007 milestone 1 lands, spec 0005's subscription calls the resync on any `seq` gap or `recovered: false`, as it refetches today.
- `live.status()` stays `paused` from the drop until the catch up or the resync finishes, then `live`. The paused callout (spec 0005) clears then.

## Offline

- `connectivity.status()`: `online` or `offline`, from `navigator.onLine`, its events, and any call that fails with no response (which also starts a probe of `GET /api/health` every 5 seconds until one answers; that route never touches the database, so the probe never wakes Neon). A request the app aborted itself (an `AbortError` from our own `AbortController`, such as a block scrolled away) never counts as a failure.
- While `offline`, the frame shows a Callout (warning): "You're offline. Changes will save when you're back."
- A write that fails with no response retries after 1, 2, 4, 8 and 15 seconds, keeping its optimistic layer. If none lands, it rolls back with "You're offline, so this change wasn't saved." and Retry. A response of any kind (even a refusal) ends the retries.
- Reads that fail offline show their error state with Retry and retry by themselves when the status returns to `online`.
- Coming back online with the live connection also lost hands over to spec 0007's live layer, which catches up, or asks for the resync once.

## Sign out and workspace switch

- `auth.signOut()` and opening another workspace clear: the store's bodies and layers, every window, the definitions, the undo stack, the tab's own versions, pending event batches and timers, and the live subscription (spec 0005 already disconnects on sign out).
- Pending writes of the old workspace are allowed to finish but their results are discarded.

## Lint

The `packages/config` rule that bans network calls in `apps/web` outside `packages/data` adds: `@tanstack/db`, `@tanstack/react-db`, `@tanstack/react-query`, `centrifuge`, the oRPC client packages, and deep imports of `@crm/data/*` other than `@crm/data/react`. Fixture tests prove each ban fires.

## Tests

- Fake API and event source: definitions load once, refetch by object, selectors rerender only their slice; `records.one` fetches only missing attributes and goes `deleted`; frame batching (one call per 500 ids, one render); own echo skipped but its `replaced` checked; a `mutationId` dropped after its response and its `echoes` echoes, and after 60 seconds when an echo never comes; coarse leading at once and trailing with jitter; a resync refetches once after its jitter; layers survive a resync; offline retries, rollback at 30 seconds, end on any response; an aborted request leaves the status `online`; clearing on sign out and switch.
- Playwright: a record subscription and the table showing one record edited from another browser; devtools offline for 10 and for 40 seconds; a socket killed with and without history; the burst script for coalescing; a frame time trace under 100 events a second.

## Rationale (short)

Definitions change rarely and shape every cell, so one store per workspace with narrow selectors is cheaper than fetching them per screen. Gathering per frame and coalescing coarse events keeps a busy workspace or a bulk job from causing a render or request storm, and the jitter keeps a hundred tabs from refetching in the same instant. A resync is simple and always correct; spec 0007's catch up avoids it whenever the outbox still holds what was missed. Keeping a `mutationId` only while its echoes are due keeps the skip list small and bounded, and an id whose echo never comes (an event lost, or a write that stored nothing) is dropped after 60 seconds instead of lingering.
