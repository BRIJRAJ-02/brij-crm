# NoteList

Notes, each with its title, a two line excerpt, its author and when it was last edited; a row opens the note.

## Why it exists

New (spec 0019). No list in the library shows a document summary (a title, a two line excerpt, an author and a time) and opens it: TaskList's rows are one line with a checkbox, and ActivityFeed's rows are events in a timeline. It follows TaskList's patterns: a React Aria `GridList`, virtualised through React Aria's `Virtualizer` (rows measured, since an excerpt may take one line or two), fed by a `ListSource` (AC-9), rows keyed by note (`keyedRows`). Each part is an existing atom: `TruncatedText` (its two line variant for the excerpt), `Avatar` and `RelativeTime`.

## Use

```tsx
<NoteList
  label="Notes"
  notes={noteSource}
  onAction={(id) => openNote(id)}
  status={status}
  onRetry={retry}
  emptyTitle="No notes yet"
  emptyBody="Write the first one."
  toolbar={
    <Button variant="primary" onPress={newNote}>
      New note
    </Button>
  }
/>
```

- A note is `{ id, title, excerpt, author: ActorDisplay, updatedAt }`. An empty title reads "Untitled note" in the secondary colour; an empty excerpt draws no line.
- The order is the screen's (last edited first).
- A note may carry its `record` (a `RecordRefDisplay`): a flat RecordChip leads its line, before the author, for a list that mixes notes of many records (the workspace's Notes page; story `WithRecords`). Why a variant: the row is the same, and only the record it is on is new; a record's own tab leaves it out.
- `toolbar` draws above the list in every state, so "New note" is there when the list is empty or failed.
- `emptyTitle` and `emptyBody` say what an empty list means in the screen's own words.
- `emptyActions` puts the way to start inside the empty state, under its words (a record's "New note"), as Attio and Twenty do; the screen then leaves its toolbar's New note out while the list is empty, so there is one button, where the eye lands. Why a prop: the toolbar's button sat away from the empty words that asked for it.
- `status`: `loading` (skeleton rows after the loading delay), `error` (with Try again from `onRetry`), or `no-access`.
- Give it a slot with a height: it scrolls inside it. Rows not loaded yet draw as skeletons, and `onRangeChange` hears which range is on screen.

## States

Default (rows), with records, untitled, rows still loading, a long list, loading, empty (the library's words or the screen's own), with a toolbar, failed (with Try again), no access. Hover on a row (pointer only), focus (the inset ring).

## Keyboard

Tab enters the list. The up and down arrows move between rows; Enter opens the note.

## Differences from the artifact

Not in the artifact before spec 0019.
