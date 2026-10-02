# RecordHeader

The head of a record's page: its avatar, name and object, who else is viewing it, and its actions.

## Why it exists

New. Every record page (#17) and the people and company pages (#26) open with the same header. It composes atoms that exist (`Avatar`, `AvatarStack`) with the page's own buttons; `TopBar` is the bar above it, holding the crumbs and the page's h1.

## Use

```tsx
<RecordHeader
  record={company}
  objectName="Company"
  meta={<LinkChip href={company.domainHref}>{company.domain}</LinkChip>}
  viewers={presence}
>
  <Button variant="ghost" icon="star" label="Add to favorites" />
  <RecordMenu />
</RecordHeader>
```

- `record` is the record's display shape. A person's avatar is a circle; companies and other records are squares.
- The name is the page's second level heading: the `TopBar` above holds the h1 (as the crumbs' current place).
- `meta` follows the object name on the label line: a domain, a job title.
- `viewers` are the others with the record open (presence, #26), read as "Also viewing Grace Hopper and Alan Turing".
- `isLoading` shows skeletons after the loading delay. Below 480px wide the actions wrap under the name.

## States

Default, loading, with and without viewers, narrow.

## Keyboard

Nothing of its own: Tab reaches the meta's link and the actions.

## Differences from the artifact

The artifact's record page draws a static header; this one adds presence and the loading state.
