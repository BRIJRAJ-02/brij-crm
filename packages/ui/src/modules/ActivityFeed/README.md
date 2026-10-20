# ActivityFeed

A record's timeline: what happened to it, newest first, under period headings.

## Why it exists

New. The record page (#17), its Activity tab (#19), email (#43) and meetings (#44) all show what happened to a record in one list. Each entry reuses what exists: the actor is a plain `RecordChip` (its avatar and name as text, no pill), a changed value shows its old and new value through `AttributeDisplay`, linked records are flat `RecordChip` links, a note's title is a `Link`, and the time is a `RelativeTime`. The list is long and arrives in pages, so it takes a `ListSource` (AC-9) and draws only what is on screen, with TanStack Virtual measuring each entry, since entries differ in height.

The `links` entry and the `inline` layout are variants (spec 0017, milestone 2), as is the `meeting` entry (spec 0024), not new components: a link change is one more kind of entry in the same feed, and Overview's "Recent activity" is the same entries drawn without a scroll of their own.

## Use

```tsx
<ActivityFeed label="Activity" entries={activitySource} />
<ActivityFeed label="Recent activity" entries={firstFive} layout="inline" />
```

- `entries` is a `ListSource<ActivityEntry>`, newest first. An entry not loaded yet draws as a skeleton, and `onRangeChange` hears which range is on screen.
- An entry is a `change` (an attribute, its value before and after, and their display shapes), `created`, `links`, a `meeting`, or a `note`, `task`, `comment` or `email` with a title, a line of text and an optional `href`. A task with `isDone` reads "completed a task". A task's detail is one quiet row, not a card: its icon (a check once done; never a box, which would read as one to tick) and its title as text, a step quieter once done, the whole row opening the task through `href` (surface-hover under a pointer, the inset ring on keyboard focus). Why: a bordered card holding an underlined blue link read heavier than the line above it (the owner's call, 20 October 2026). Notes, comments and emails keep their card, which holds a line of their text.
- A `meeting` (spec 0024) sits at its start and reads "Meeting: <title>", with no actor chip: a meeting is nobody's doing on the record. Its card holds the time span in the provider's time zone ("Tue, Oct 13, 10:00 – 10:45 AM"; an all day meeting its days, read in UTC, its end exclusive), the attendees (`MeetingAttendee`: a person's or member's flat chip with its page, else the name or address as text, each followed by its answer unless it is yes: "maybe", "no reply", "declined"), and the video link ("Join video call", out in a new tab). A private meeting the reader doesn't hold (`detailsHidden`) shows its time and a line saying only the people whose calendar holds it see its details.
- An attendee's `match` (spec 0024, milestone 2): `unknown` (an address no one in the CRM holds) offers a ghost "Add as person" button after their answer while the screen gives `onAddPerson`; it spins until the promise settles, and the screen says how it went (the meeting's change event then shows them as a person). `ambiguous` (several people hold the address, none linked) adds "several people match" to their answer, in the same quiet label. Why a variant: the attendee row already exists, and an action on it belongs beside the name it acts on. Known gap: when the person lands and the button leaves, focus goes back to the page; moving it to the new chip comes with the live patch.
- A change reads "set" when there was no value before, and "cleared" when there is none after; a clear draws the old value, the arrow and the empty mark, so it never reads as a value still held. Values draw on the field set's `card` surface: one line each, chips flat like the names around them, a long text cut (Details holds it whole). A side that holds one record (a person's Company) is a `change` with record references, drawn through the field set.
- A `links` entry is what one write did to a side that holds many records: `added` and `removed` name up to 3 records each (`LinkedRecord`: the chip's display and the record's `href`), and `addedCount` and `removedCount` say how many in all. It reads "added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team", "removed Barbara Liskov from Team", or both in one sentence ("added Katherine Johnson and Margaret Hamilton to Team, and removed Edsger Dijkstra from Team"). Each name is a link to its record; "and N others" is plain text. On screen the chips' own boxes part the names, and the commas between them are for screen readers only. The marker is the reference type's icon.
- `layout`: `feed` (the default) is virtualised and scrolls inside its slot; give it a slot with a height. `inline` draws the first entries it is given, at most 10, at their own height with no scroll of their own, for a short block such as Overview's card. Both are the same feed for the keyboard.
- Newer entries arriving above (a live refresh) keep the entry being read where it is on screen, in the feed layout: sizes are kept per entry, and the feed scrolls down by the room the new entries take. At the very top nothing moves, so the newest entries show. The tab stop stays on the same entry.
- Headings: Upcoming (an entry more than 5 minutes ahead of the clock: a meeting still to come), Today, Yesterday, Earlier this week (from the language's first day of the week), then the month, with its year when it isn't this year. "Today" is today in the provider's time zone.
- `status`: `loading` (the first page: skeleton entries after the loading delay), `error` (with Try again from `onRetry`), or `no-access`.

## States

Default, links, meetings (upcoming, all day, private, past), inline, inline capped at 10, loading (skeleton entries after the loading delay, both layouts), empty, failed (with Try again), no access, entries still loading (skeleton articles, busy, that still take focus), newer entries arriving while scrolled down (the entry being read stays put) and at the top (they show). Focus on an entry (the inset ring).

## Keyboard

It follows the feed pattern: the feed is one tab stop, on the entry last focused (kept inside the entries there are when a feed is read afresh with fewer). The up and down arrows, and Page Up and Page Down, move to the entry before or after; Home and End go to the newest and to the oldest loaded (while more pages wait, End lands on the one still loading, and the next End goes on once it arrives; in the inline layout, the oldest drawn). Tab moves into an entry's links, such as a linked record's name. Ctrl (or Cmd) with End or Home leaves the feed for what comes after or before it. When the entry holding focus is drawn again (it loaded), focus stays on it.

## Accessibility

Each entry is described by its time and what changed (the values, or a note's title and text), read after its line. While more pages wait, `aria-setsize` is -1 (not known yet). In the inline layout the period headings are h4, a level under the block's own heading.

Each entry is an article named by its line and described by its time and what changed (the values, or a note's title and text). While more pages wait, `aria-setsize` is -1 (not known yet). In the inline layout the period headings are h4, a level under the block's own heading. Each entry is an article named by its line ("Ada Lovelace added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team"). The commas between names are visually hidden text. A chip is its own box, so a browser may read a space before the comma after a name; screen readers pass over it.

## Differences from the artifact

The artifact's record page shows a short static timeline; this one is virtualised and takes its entries from a source. The artifact has no link entry and no inline layout yet: they arrive with the next publish.
