# ActivityFeed

A record's timeline: what happened to it, newest first, under period headings.

## Why it exists

New. The record page (#17), its Activity tab (#19), email (#43) and meetings (#44) all show what happened to a record in one list. Each entry reuses what exists: the actor is a flat `RecordChip`, a changed value shows its old and new value through `AttributeDisplay`, a note's title is a `Link`, and the time is a `RelativeTime`. The list is long and arrives in pages, so it takes a `ListSource` (AC-9) and draws only what is on screen, with TanStack Virtual measuring each entry, since entries differ in height.

## Use

```tsx
<ActivityFeed label="Activity" entries={activitySource} />
```

- `entries` is a `ListSource<ActivityEntry>`, newest first. An entry not loaded yet draws as a skeleton, and `onRangeChange` hears which range is on screen.
- An entry is a `change` (an attribute, its value before and after, and their display shapes), `created`, or a `note`, `task`, `comment`, `email` or `meeting` with a title, a line of text and an optional `href`. A task with `isDone` reads "completed a task".
- A change reads "set" when there was no value before, and "cleared" when there is none after.
- Headings: Today, Yesterday, Earlier this week (from the language's first day of the week), then the month, with its year when it isn't this year. "Today" is today in the provider's time zone.
- `status`: `loading` (the first page: skeleton entries after the loading delay), `error` (with Try again from `onRetry`), or `no-access`.
- Give it a slot with a height: it scrolls inside it.

## States

Default, loading (skeleton entries after the loading delay), empty, failed (with Try again), no access, entries still loading (skeleton articles, busy, that still take focus). Focus on an entry (the inset ring).

## Keyboard

It follows the feed pattern: the feed is one tab stop, on the entry last focused. The up and down arrows, and Page Up and Page Down, move to the entry before or after; Home and End go to the newest and the oldest. Tab moves into an entry's links.

## Differences from the artifact

The artifact's record page shows a short static timeline; this one is virtualised and takes its entries from a source.
