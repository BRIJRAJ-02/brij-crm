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

- A stat with nothing yet ("None") is quiet body text in text-tertiary, not the heading type, so it never reads as the strip's headline (QA, 22 October 2026).

Default, loading (skeleton values), none (a stat with no value), pressable (hover takes `surface-hover`, focus the inset ring), narrow (as many to a row as fit at 140px each, a short last row stretching; under 480px of box the values step down to body strong type, so a relative time like "13 minutes ago" reads whole on a phone, and the same with four stats or more in a row).

## Keyboard

Tab reaches each stat that goes somewhere; Enter or Space presses it.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from Card (spec 0072): the prototype folds RecordStats into Card's StatCard. Its own module draws the StatCard's figure in its hairline strip (decision 14: sharing one part with Stats was measured heavier per page, see Card's README): a grey `text-body-sm-strong` label (its icon muted) over its value in `text-title` tabular figures (`text-body-strong` with four or more, or under 480px). A stat that goes somewhere washes `surface-hover` under the pointer and wears the outline ring just inside its tile on focus (the strip clips anything outside it).

**States**: a count, a moment, a value, loading (a skeleton, busy), none, pressable (hover, focus visible).

**Differences from the prototype**: the hairline strip, `onPress` per stat, counts at least, times and "None" are kept; the StatCard's number pop is not drawn.

**Repeats from its replacer** (AC-4): the figure's label, value and comparison type (shared with Stats); they leave with this export.
