# 0005. The client data layer for the core loop

## Summary

Screens never fetch. They ask `packages/data`, which keeps one copy of every record in the browser, loads the table in windows as you scroll, shows edits at once and undoes them if the server refuses, and patches records in place when a change event arrives. The record store is TanStack DB only if it passes a short prototype first; either way the interface screens use stays the same.

## The prototype gate (first, time boxed to one day)

- Build: a TanStack DB collection holding record bodies keyed by id (server rows through its sync `begin/write/commit`, edits through optimistic transactions), and our own ordered id windows for the table (TanStack DB never orders rows: the server's sort keys can't be reproduced in the browser).
- Measure with 100,000 synthetic records: memory after scrolling the whole table, frame time while scrolling, time to patch 50 records from an event, and an edit's apply and rollback.
- Pass: memory under 200 MB, no dropped frames at the grid's normal scroll (the grid's own 100,000 row story is the baseline), patch under 16 ms, rollback restores exactly.
- Fail: the same interface on a plain store (a `Map` per record plus `useSyncExternalStore`), with optimistic layers kept per record. Record the numbers and the call in `verify.md`.

## Interface (what screens and the router see)

```ts
createDataLayer({ origin, notify, mintId, realtime? }) → {
  me: { get() },
  workspaces: { create(input) },
  objects: { list(workspace) },
  attributes: { list(workspace, objectId), create(workspace, input) },      // create waits for the server
  records: {
    view(workspace, objectId): RecordView store,                           // { subscribe, getSnapshot, source: RowSource<RecordView>, status, retry, cellErrors }
    create(workspace, objectId, values): Promise<RecordView>,              // optimistic
    setValue(workspace, change: CellChange): void,                         // optimistic
  },
  auth: { sendCode(email), verify(email, code), signInWithGoogle(redirect), signOut(), session() },
  live: { status(): 'live' | 'paused' },
}
```

- `@crm/data/react` adds `useView(store)` over `useSyncExternalStore`, so screens never import TanStack.
- `notify` is the app's toast queue; `mintId` returns uuid v7 (browser crypto).
- TanStack DB, the Better Auth client and `centrifuge` load with a dynamic import when first needed, so the first load stays under 250 kB. Each is imported in exactly one module of `packages/data`; `@tanstack/react-db` joins the screen lint ban.

## Windows

- A view keeps `count` (from `records.count`) and blocks of 100 ids (from `records.query` with `position`). `onRangeChange` loads the blocks the grid asks for (visible rows plus overscan), one `AbortController` per block, and evicts blocks more than 5 blocks from view. Blocks hold ids; bodies live in the store.
- The loop's People table has no filter and no sort, so rows are in id order (uuid v7, creation order) and a new record goes at the end. The window code stays generic over `position` or `cursor` for #6.
- The router loader warms the view (count and first block) and never hands rows to the screen directly.
- Subscriptions are reference counted so React StrictMode's double effects don't double subscribe.

## Writes

- **Edit**: apply to the store at once (every view of that record updates), call `records.setValues` with a fresh `mutationId`, replace with the returned RecordView. On a refusal, roll back, set `cellErrors[`${recordId}:${attributeId}`]` to the message, and toast with Retry. A second edit to the same cell while the first is in flight layers on top; a late response or event never shows the older value.
- **Create**: mint the id, insert the draft, append to the window, count + 1, call `records.create`. On success replace with the RecordView; on a refusal remove it, restore the count, and return the refusals so the dialog can mark fields. A network retry reuses the same id (the server replays).
- **Add attribute**: no optimistic step; the dialog shows busy, the column list refetches on success.
- **401** from any call: the layer rolls back pending edits with "You were signed out" and tells the router to go to `/sign-in?redirect=…`.

## Live patches

- `live` subscribes to `workspace:<id>` (tokens from `realtime.*`). Per event: skip it if its `mutationId` is one of ours; check `seq` = last + 1; gather ids for one animation frame, then `records.get` (500 at most per call) and upsert into the store. A created record not in the window is appended (id order) and the count bumped.
- `kind: "definitions"` refetches that object's attributes.
- A `seq` gap, or a resubscribe with `recovered: false`, refetches the loaded blocks and the count.
- While disconnected, `live.status()` is `paused`; the table shows a quiet callout.

## Tests

Vitest against a fake API and a fake event source: apply then confirm; refusal rollback with cell error and toast; own echo skipped; an event before its own write's response; two quick edits to one cell; block loading, abort and eviction; create then refusal; a gap triggers a refetch; 401 rolls back and redirects. The prototype gate's measurements are their own script.

## Rationale (short)

Spec 0001 chose TanStack DB but made it conditional on a prototype; the gate keeps that promise without delaying screens, because the interface is fixed first. Ordering stays ours because only the server knows the stored sort keys. Schema writes wait for the server because they are often refused and reshape the grid.
