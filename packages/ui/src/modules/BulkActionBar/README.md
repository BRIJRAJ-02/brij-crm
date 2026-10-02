# BulkActionBar

The bar that shows while records are selected: how many, "Select all N matching", the actions, and the progress of one that is running.

## Why it exists

New. Bulk actions and trash (#22) act on a selection that can be every record matching a view, a million of them, so the bar says how many and offers all of them. It is a React Aria `Toolbar` holding `Button`s and a `ProgressBar`; the screen places it (floating over the bottom of the view).

## Use

```tsx
<BulkActionBar
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

- The count is a live region, so a change in the selection is announced.
- "Select all N matching" shows while only some are selected and more match.
- `progress` (a label, and a value from 0 to 100 when known) takes the actions' place while one runs, with Cancel when you give `onCancel`; Clear waits until it ends.
- When the button in use goes (Select all once pressed, an action once its progress shows), focus moves to the first action, or to Cancel, so it never falls to the page.

## States

Some selected, all matching selected, an action running (known or unknown progress).

## Keyboard

Tab enters the toolbar once; the left and right arrows move between its buttons. Esc clears the selection (not while an action runs).

## Differences from the artifact

Not in the artifact.
