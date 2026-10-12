# ActivityFeed

A record's timeline: what happened to it, newest first, under period headings.

## Why it exists

New. The record page (#17), its Activity tab (#19), email (#43) and meetings (#44) all show what happened to a record in one list. Each entry reuses what exists: the actor is a flat `RecordChip`, a changed value shows its old and new value through `AttributeDisplay`, linked records are flat `RecordChip` links, a note's title is a `Link`, and the time is a `RelativeTime`. The list is long and arrives in pages, so it takes a `ListSource` (AC-9) and draws only what is on screen, with TanStack Virtual measuring each entry, since entries differ in height.

The `links` entry and the `inline` layout are variants (spec 0017, milestone 2), not new components: a link change is one more kind of entry in the same feed, and Overview's "Recent activity" is the same entries drawn without a scroll of their own.

## Use

```tsx
<ActivityFeed label="Activity" entries={activitySource} />
<ActivityFeed label="Recent activity" entries={firstFive} layout="inline" />
```

- `entries` is a `ListSource<ActivityEntry>`, newest first. An entry not loaded yet draws as a skeleton, and `onRangeChange` hears which range is on screen.
- An entry is a `change` (an attribute, its value before and after, and their display shapes), `created`, `links`, or a `note`, `task`, `comment`, `email` or `meeting` with a title, a line of text and an optional `href`. A task with `isDone` reads "completed a task".
- A change reads "set" when there was no value before, and "cleared" when there is none after. A side that holds one record (a person's Company) is a `change` with record references, drawn through the field set.
- A `links` entry is what one write did to a side that holds many records: `added` and `removed` name up to 3 records each (`LinkedRecord`: the chip's display and the record's `href`), and `addedCount` and `removedCount` say how many in all. It reads "added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team", "removed Barbara Liskov from Team", or both in one sentence ("added Katherine Johnson and Margaret Hamilton to Team, and removed Edsger Dijkstra from Team"). Each name is a link to its record; "and N others" is plain text. On screen the chips' own boxes part the names, and the commas between them are for screen readers only. The marker is the reference type's icon.
- `layout`: `feed` (the default) is virtualised and scrolls inside its slot; give it a slot with a height. `inline` draws the first entries it is given, at most 10, at their own height with no scroll of their own, for a short block such as Overview's card. Both are the same feed for the keyboard.
- Newer entries arriving above (a live refresh) keep the entry being read where it is on screen, in the feed layout: sizes are kept per entry, and the feed scrolls down by the room the new entries take. At the very top nothing moves, so the newest entries show. The tab stop stays on the same entry.
- Headings: Today, Yesterday, Earlier this week (from the language's first day of the week), then the month, with its year when it isn't this year. "Today" is today in the provider's time zone.
- `status`: `loading` (the first page: skeleton entries after the loading delay), `error` (with Try again from `onRetry`), or `no-access`.

## States

Default, links, inline, inline capped at 10, loading (skeleton entries after the loading delay, both layouts), empty, failed (with Try again), no access, entries still loading (skeleton articles, busy, that still take focus), newer entries arriving while scrolled down (the entry being read stays put) and at the top (they show). Focus on an entry (the inset ring).

## Keyboard

It follows the feed pattern: the feed is one tab stop, on the entry last focused. The up and down arrows, and Page Up and Page Down, move to the entry before or after; Home and End go to the newest and the oldest (in the inline layout, the oldest drawn). Tab moves into an entry's links, such as a linked record's name.

## Accessibility

Each entry is an article named by its line ("Ada Lovelace added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team"). The commas between names are visually hidden text. A chip is its own box, so a browser may read a space before the comma after a name; screen readers pass over it.

## Differences from the artifact

The artifact's record page shows a short static timeline; this one is virtualised and takes its entries from a source. The artifact has no link entry and no inline layout yet: they arrive with the next publish.
