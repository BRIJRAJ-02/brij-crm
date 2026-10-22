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
- It is a real `<dl>`, so screen readers pair each term with its value.

## States

None of its own.

## Keyboard

Only what its descriptions hold takes focus.

## Differences from the artifact

Not in the artifact.
