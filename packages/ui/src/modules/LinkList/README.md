# LinkList

Links as rows, not a table: booking pages today, forms' links next (spec 0025 experience, the host's list).

## Why it exists

New. The experience note asks for rows (a title that opens the link, a quiet tag, its address, chips for its facts, Copy link and a menu at the end). Table is a grid of cells with a header and column alignment, which reads wrong for a handful of links with varying facts, and a variant would fight its keyboard model (Table moves by cell).

## Use

```tsx
<LinkList
  label="Booking pages"
  rows={[{ id, title: 'Intro call', address: '/b/Xy12', chips: ['30 min'], actions: <CopyButton value={url} /> }]}
  onOpen={(id) => open(id)}
  emptyState={<EmptyState title="No booking pages yet" />}
/>
```

- The title is a ghost Button; `onOpen` gets the row's id.
- `tag` ("Off") and `chips` show as Badges with a short label: facts, not values, so not the field set's Tag.
- `actions` sits at the row's end; below 480px of its container it moves under the facts.

## States

Rows, empty (the caller's EmptyState); the buttons' own hover, focus and pressed states.

## Keyboard

Tab moves through each row's title button and its actions in order.

## Differences from the artifact

Not in the artifact.
