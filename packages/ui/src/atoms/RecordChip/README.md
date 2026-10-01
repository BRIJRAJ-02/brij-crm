# RecordChip

A linked record, a member, or another actor as a chip with its avatar or icon.

## Why it exists

Ported from the artifact's RecordChip card. It is the one display for record references and actor references (members, API keys, automations, the system), in cells, the record panel, cards, the timeline and filters. Screens render it through the field set.

## Use

```tsx
<RecordChip display={{ objectId: 'companies', recordId: 'r1', name: 'Northwind', kind: 'company' }} href="/companies/r1" />
<RecordChip display={{ type: 'member', id: 'm1', name: 'Ada Lovelace' }} />
<RecordChip display={{ type: 'system', id: null, name: '' }} isFlat />
```

- `display` is the `RecordRefDisplay` or `ActorDisplay` the data layer (#6) builds; the chip never resolves an id.
- People get a circle avatar, companies and other records a square. API keys, automations and the system get their icon (key, zap, server), and the system always reads "System".
- `href` makes it a routed link to the record; it passes `safeHref()`.
- `isFlat` drops the edge for dense places.

## States

Hover and focus, when it links.

## Keyboard

When it links, Tab reaches it and Enter follows it.

## Differences from the artifact

- One `display` prop replaces `name`, `kind` and `color`, and actors are new.
- `isFlat` replaces `flat`.
