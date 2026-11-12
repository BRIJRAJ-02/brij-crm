# DescriptionList

Labelled values that are not attributes.

## Why it exists

New. Developer settings (#34, #39) show an API key's scopes or a webhook's last delivery as terms and values. Attribute values go through the field set (AttributeList); this is for everything else.

## Use

```tsx
<DescriptionList
  items={[
    { term: 'Created', description: <RelativeTime value={key.createdAt} /> },
    { term: 'Scopes', description: 'records:read, records:write' },
  ]}
/>
```

- `id` keys a row when terms repeat, such as a booking's chat lines (Visitor, Assistant, Visitor); without it the term is the key.
- `layout`: `columns` (terms beside values, the default), `stacked` (terms above), or `compact`: columns on a tight rhythm (`space-4` between rows) with the terms in one fixed `size-column-narrow` column, so short values line up (a booking page's week, "Mon to Wed" over "Thu"; the owner, 22 October 2026: the default rhythm spread a seven row week too far).
- `copy` (`{ value, label }`) puts an icon CopyButton after a description: shown on the row's hover or focus with a pointer, always under a finger, copying the raw value, which can differ from what shows (a phone shown spaced copies its E.164 number). Why a prop: a form submission's email and phone are copied far more than they are read, and a screen can't lay a button beside a value itself (22 October 2026).
- `isPlaceholder` draws a description that stands in for a missing value ("No answer") in `text-tertiary`, so it never reads as an answer (22 October 2026).
- `address` puts an email or web address on a line of its own under the description, in `text-secondary` (a booking's guest: their name, then their email). It never breaks at a hyphen or a dot and is never hyphenated; it breaks anywhere only when it is longer than the line (`line-break: anywhere`). Why a prop: a phone's narrow column broke "vera-1c8a…@example.com" at its hyphen, and a screen can't style a value's inside itself (spec 0058, 31 October 2026).
- It is a real `<dl>`, so screen readers pair each term with its value.

## States

None of its own.

## Keyboard

Only what its descriptions hold takes focus.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's DescriptionList (read only): every row a control tall, the term in `text-body-sm` and `text-secondary` at the top of its row, level with the value's first line in the body type, so a taller value never moves its term. `compact` is the prototype's fixed name column (136 at full size, `4 * size-control - space-8`) with rows a small control tall; `stacked` puts each term over its value.

**Use it for** read only label and value pairs: a booking's or a submission's details, a summary. **Don't use it for** a record's editable attributes (AttributeList) or tabular data (DataGrid).

**States**: filled, a placeholder value (`text-tertiary`), with a copy button (shown on the row's hover or focus with a pointer, always under a finger), stacked.

**Differences from the prototype**: no icon wells and no inline editing here (AttributeList draws those); the default layout sizes its term column to the longest term, `compact` is the prototype's fixed column. `address` and `copy` are kept.
