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

- `layout`: `columns` (terms beside values, the default) or `stacked` (terms above).
- It is a real `<dl>`, so screen readers pair each term with its value.

## States

None of its own.

## Keyboard

Only what its descriptions hold takes focus.

## Differences from the artifact

Not in the artifact.
