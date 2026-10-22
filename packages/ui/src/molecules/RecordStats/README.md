# RecordStats

A record's stat strip: a few counts and the last activity, side by side, under the record page's header and over the record panel's tabs.

## Why it exists

New (13 Oct reference batch 4, the record panel and lists). The owner's reference puts a strip of numbers under a record's name (tickets, overdue, response time). Nothing in the library held it: `DescriptionList` pairs a label with plain text down a column or in columns of pairs, and edits nothing; a strip needs each value in the heading type, a count or a relative time, a loading skeleton per value, and a tile that goes somewhere when pressed. A `DescriptionList` variant would have carried all of that into every key and value list. It sits in `molecules`, shared by `RecordHeader` and `RecordPanel`.

## Use

```tsx
<RecordStats
  label="About Northwind Traders"
  stats={[
    { id: 'tasks', label: 'Open tasks', icon: 'list-checks', count: 3, onPress: () => openTab('tasks') },
    { id: 'activity', label: 'Last activity', icon: 'activity', time: lastActivityAt },
  ]}
/>
```

- Each `RecordStat` holds a `count` (a floor with `isCountAtLeast`, "10,000+"), a `time` (ISO 8601, shown by `RelativeTime` as "3 hours ago" or "in 2 days"), a `value` the screen draws through its field's one display (a deal's value, `AttributeDisplay`), or none of them ("None"). `isLoading` draws a skeleton in place of the value.
- `onPress` makes the whole tile pressable: the label is the button and its target covers the tile; the value stays outside it (a time's tooltip is never inside a control) and is read with it (`aria-describedby`).
- `label` names the strip, a group, for screen readers.
- Usually passed through `RecordHeader`'s or `RecordPanel`'s `stats`.

## States

Default, loading (skeleton values), none (a stat with no value), pressable (hover takes `surface-hover`, focus the inset ring), narrow (as many to a row as fit at 140px each, a short last row stretching; under 480px of box the values step down to body strong type, so a relative time like "13 minutes ago" reads whole on a phone, and the same with four stats or more in a row).

## Keyboard

Tab reaches each stat that goes somewhere; Enter or Space presses it.

## Differences from the artifact

Not in the artifact.
