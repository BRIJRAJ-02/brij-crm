# 0006. Versions, the replaced notice and undo

## Summary

Every value the browser reads now carries the id of its current version, and every record a revision number that only grows. Edits say which version they started from, so the server can tell when a save replaced one its author never saw; the person whose value was replaced is told and can put it back. The same versions make undo safe: a change is undone only if nobody changed it since.

## Reads

- `RecordView.revision`: `records.revision`, bumped by every statement that updates the records row (every value write through `touchOwner`, near side link writes, delete, restore).
- `RecordView.versions`: per returned attribute with a current version row (a cleared marker counts), its `version_id`. All items of a multi valued attribute share one version, because one write stamps them together. Record references have no entry in v1.
- **The revision rule**: the store replaces a base only with a read whose revision is at least the held one. A write's response, a block, a `records.get` after an event: all pass the same check. Equal revisions replace (a far side link change doesn't bump, see Follow-up in [index.md](index.md)).

## Edits

- The layer sends, per attribute, `baseVersionId` = the base's version for it, or `null` when the base holds the attribute with no version. A cell is never editable while its attribute is unknown, so there is always a base.
- A second edit to the same cell while the first is in flight sends the same base (the base hasn't moved). The server then reports `replaced` naming the first edit's version, by the same member, which raises nothing.
- The response's `versions` become the base's; the layer records each version it wrote in the tab's own versions (the last 500, with the value written).
- A network retry resends the same request (same `mutationId`, same base). If the first attempt landed, the value is unchanged and nothing is written or published.

## The replaced notice

1. B's save carries a base older than the current version (A's). The engine writes it (last save wins) and its `Change` names `replaced: { versionId: A's, setBy: A }`.
2. The outbox hook adds `{ recordId, attributeId, versionId: A's, by: B }` to the row's `replaced` (at most 1,000 per row).
3. A's tab receives the event. The record is refetched as usual (A now sees B's value).
4. For each `replaced` entry whose `versionId` is in A's own versions and whose `by` is not A's member and not the system: one toast per record and attribute, "<B's name> changed <Attribute> on <Record> just after you, so your value was replaced." with "Use mine".
5. "Use mine" sends A's value as a normal edit, based on B's version (now A's base), so it raises nothing for B. It is undoable like any edit.

- B sees nothing: their value is the one showing.
- Several replaced cells from one event in one record make one toast naming the first attribute and "and 2 more".
- If A's tab is closed, nothing is shown (a lasting notification is #28).

## Batch writes

- `records.setValuesBatch({ workspace, items ≤ 500, mutationId })` calls the engine's `setValuesBatch` through the one write composer: one transaction, one savepoint per record, one outbox row per object, one `mutationId`.
- The grid's `onCellsChange` (paste, range clear) groups its changes by record and sends one batch. Each record's cells apply optimistically; per record results confirm or roll back with cell messages; one toast with Retry covers the refused ones.
- Over 500 records the screen refuses the paste: "Paste into at most 500 records at once."

## Undo

- **The stack**: per data layer (one per tab), per workspace, 50 entries, in memory. An entry is one user action: `{ label, cells: [{ recordId, attributeId, before, writtenVersionId }] }`, where `before` is the value the base showed when the action began and `writtenVersionId` comes from the confirmed response.
- **When an entry is pushed**: when its write is confirmed. A refused cell is left out; a fully refused action pushes nothing. Unchanged cells (no new version) are left out.
- **Running it**: `data.undo.run()` pops the top entry and sends `records.setValuesBatch` (or `records.setValues` for one record) with `value: before` and `ifVersionId: writtenVersionId` per cell. It applies optimistically. Cells refused `VERSION_CHANGED` roll back and count toward "N cells were changed by someone else since, so they were kept". Other refusals roll back with their own messages.
- An undo pressed while its entry's write is still in flight waits for that response first.
- The undo's own write is not pushed (no redo in v1); it updates the tab's own versions like any write.
- Cleared with the store (sign out, workspace switch). Schema changes (add attribute) are not undoable here.
- **The shortcut**: the workspace frame listens for Cmd+Z (Ctrl+Z off Apple platforms) on the document, ignores it when the event target is an input, a textarea or a content editable (their own undo wins) or when a dialog is open, and calls `data.undo.run()`. ShortcutHelp lists "Undo your last change".
- **Toasts**: after an undo, "Undid <Attribute> on <Record>" (or "Undid the paste into 40 cells"). After a paste or range clear over more than one cell lands, "Pasted into 40 cells" with "Undo". Copy lives in the screen's `strings.ts`; the layer returns the facts.

## Engine

- `ifVersionId` on `ValueInput`: after the record lock and before writing that attribute, the current version (any row with `active_until` null for that owner and attribute) must equal it, else `VERSION_CHANGED` naming the attribute; the record's other values in the same call are not written (one record lands all or nothing, spec 0004 AC-13).
- `baseVersionId: null`: a current version exists, so `replaced` reports it.
- `touchOwner` sets `revision = revision + 1`; delete and restore do too.

## Tests

- Real Postgres: revision grows on every kind of record write; `ifVersionId` equal writes, unequal refuses and writes nothing on that record; `null` base reports `replaced`; the outbox row holds `replaced` with the writing actor, capped at 1,000.
- Fake API and events: the revision rule with a late confirmation; base never from a layer; own versions bounded at 500; notice shown only for its four conditions; "Use mine"; batch partial refusal; undo of one cell, of a paste, with some cells changed since, while in flight, at depth 51; cleared on switch.
- Playwright, two browsers: the clash and "Use mine"; undo after another member's change.

## Rationale (short)

The engine already reports a replaced version (spec 0004, AC-12); publishing its id lets the loser's tab match it against versions it wrote, so the server never needs to know who is online. A revision per record is the cheapest total order for reads: version ids aren't ordered reliably and `updated_at` is the transaction's start time, which can run backwards across two writes. A strict version check is the only safe undo when others edit live.
