# RecordChipList

Records as RecordChips in a row that wraps, each opening its record: Home's Recently viewed (spec 0041).

## Why it exists

New. Recently viewed shows the member's last records as chips, the way a record shows anywhere else (rule 3, one field design). The record reference display draws chips too, but as one attribute's value: one line cut short with "+N", inside a field's surface, for a single attribute. LinkList and TeamList are rows of links or people with their own lines. A chip row that wraps, with its own loading, empty and failed states, fitted none of them as a variant.

## Use

```tsx
<RecordChipList
  label="Recently viewed"
  records={[{ display: { objectId, recordId, name: 'Northwind Traders', kind: 'company' }, href: '/w/acme/companies/…' }]}
  emptyTitle="Nothing viewed yet"
  emptyText="Records you open show here."
/>
```

- A `<ul>` labelled by `label`; each chip is a link when it has an `href`, so Tab moves through them in reading order.
- A long name is cut inside its chip; the chip never runs past the list's width.
- The screen decides which records come and how many; the list draws them all.

## States

- Default: the chips, wrapping.
- Loading: two skeleton lines, read as "Loading records" (the card around it carries `aria-busy`).
- Empty: a row EmptyState with `emptyTitle` and `emptyText`.
- Error: a row EmptyState with Try again (`onRetry`), the same height as the empty row.
- Read only and disabled don't apply: the chips only open their records.
- No access: a locked row EmptyState.

## Keyboard

Tab reaches each chip in turn; Enter opens its record.

## Differences from the artifact

Not in the artifact.
