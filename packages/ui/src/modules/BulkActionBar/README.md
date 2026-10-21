# BulkActionBar

The bar that shows while records are selected: how many, "Select all N matching", the actions, and the progress of one that is running.

## Why it exists

New. Bulk actions and trash (#22) act on a selection that can be every record matching a view, a million of them, so the bar says how many and offers all of them. It is a React Aria `Toolbar` holding `Button`s and a `ProgressBar`, in the `FloatingBar` shell it shares with SaveBar (the same size, corners, shadow and motion); the screen places it, usually with `placement="floating"` in the DataGrid's `floatingBar`, which floats it over the grid's foot.

## Use

```tsx
<BulkActionBar
  isOpen={selected > 0 || running !== undefined}
  onLeft={() => setBarShown(false)}
  count={selectedCount(selection, total)}
  total={total}
  isAllMatching={selection.kind === 'all-matching'}
  onSelectAllMatching={selectAll}
  onClear={clear}
  progress={running}
>
  <Button icon="list-plus">Add to list</Button>
  <Button variant="danger" icon="trash">
    Delete
  </Button>
</BulkActionBar>
```

- `placement="floating"` centres it `space-16` above the bottom of its nearest positioned container, over the rows, with only the bar taking the pointer: hand it to the DataGrid's `floatingBar`, whose frame is that container, and which keeps the focused row clear of it. Why a variant: the app has no stylesheets of its own, and every screen that selects records (#20, #21, #22) floats it the same way. `inline` (the default) leaves it where it is put.
- `isOpen` false sends it away: it sinks out (`duration-exit`), inert, still saying what it last said, then draws nothing and calls `onLeft`. Keep it mounted (and in the grid's `floatingBar`) until `onLeft`, so the exit plays and the grid gives back its room after. Opened or closed from the keyboard (Space or Esc in the grid), it comes and goes at once, as the house motion rule asks.
- A note goes in as a `Callout placement="bar"` among the children: beside the actions for a refusal they can try again (a background change refused, in the danger tone, before them), or in their place when no action can follow (an object the member may only read, "Nothing left to change."). On a phone the note wraps rather than cutting its words short.
- The count is a live region, so a change in the selection is announced (the DataGrid leaves its own count to the bar while one shows). A `count` of 0 (a change started with nothing ticked, such as Empty trash) leaves the count and the offer out.
- "Select all N matching" shows while only some are selected, more match, and `onSelectAllMatching` is given: leave it out when no action could follow (a read only object). `isTotalAtLeast` marks a view's count that stopped at its cap: "Select all 10,000+ matching". Once all matching are selected, the count reads the total less any left out ("All 9,998 matching selected", or "All 10,000+ matching selected" while the total is a floor).
- `progress` (a label, and a value from 0 to 100 when known) takes the actions' place while one runs, with Cancel when you give `onCancel`; Clear waits until it ends. The count and "Select all" step aside meanwhile: a background change runs on a snapshot, and its selection may already be cleared, so its progress label ("Deleting 4,500 of 12,345") says the number. The progress has a measure's width and gives it up on a narrow bar, so Cancel always stays inside.
- `onReview` marks a change counted and waiting to be confirmed: the progress is full and its label is the count ("12,345 people counted"), and Review (primary) opens the screen's confirm beside Cancel. The confirm never opens by itself, so it never takes focus from a cell editor or a field.
- `isCancelling` keeps Cancel in place while the change stops after its current batch, pending, reading "Cancelling".
- The steps of a running change are said politely when their words change (Starting…, Counting…, 12,345 people counted, Deleting 0 of 12,345, Stopping after this batch…), never at each tick of their numbers.
- When the control in use goes (Select all once pressed, an action giving way to its progress, Review once its confirm went through, a confirm that closed over a change that ended), focus moves to Cancel, Review or the first action once any closing overlay has gone (`focusLater`), so it never falls to the page. `focusRequest` (a new object) asks the same for a change started outside the bar (Empty trash in the top bar): focus comes to Cancel as soon as there is one.

## States

Some selected, all matching selected (with some left out, with a capped count), nothing selected (a change started with none ticked), starting (no Cancel yet), counting (unknown progress), counted (full, with Review), an action running (known progress) with Cancel, cancelling (Cancel pending); inline or floating; with a note in an action's place, with a danger note beside the actions; leaving; wide and narrow (a phone's width: the progress gives up room, a note wraps).

## Keyboard

Tab enters the toolbar once; the left and right arrows move between its buttons. Esc clears the selection (not while an action runs).

## Differences from the artifact

Not in the artifact.
