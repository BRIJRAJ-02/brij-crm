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
- An entry is a `change` (an attribute, its value before and after, and their display shapes), `created`, `links`, a `meeting`, or a `note`, `task`, `comment` or `email` with a title, a line of text and an optional `href`. A task with `isDone` reads "completed a task". A task's detail is one quiet row, not a card: its icon (a check once done; never a box, which would read as one to tick) and its title as text, a step quieter once done, the whole row opening the task through `href` (surface-hover under a pointer, the outline ring, inset, on keyboard focus). Why: a bordered card holding an underlined blue link read heavier than the line above it (the owner's call, 20 October 2026). Notes, comments and emails keep their card, which holds a line of their text.
- A `meeting` (spec 0024) sits at its start and reads "Meeting: <title>", with no actor chip: a meeting is nobody's doing on the record. Its card holds the time span in the provider's time zone ("Tue, Oct 13, 10:00 – 10:45 AM"; an all day meeting its days, read in UTC, its end exclusive), the attendees (`MeetingAttendee`: a person's or member's flat chip with its page, else the name or address as text, each followed by its answer unless it is yes: "maybe", "no reply", "declined"), and the video link ("Join video call", out in a new tab). A private meeting the reader doesn't hold (`detailsHidden`) shows its time and a line saying only the people it belongs to see its details (a colleague's booking reads the same way).
- An attendee's `match` (spec 0024, milestone 2): `unknown` (an address no one in the CRM holds) offers a ghost "Add as person" button after their answer while the screen gives `onAddPerson`; it spins until the promise settles, and the screen says how it went (the meeting's change event then shows them as a person). `ambiguous` (several people hold the address, none linked) adds "several people match" to their answer, in the same quiet label. Why a variant: the attendee row already exists, and an action on it belongs beside the name it acts on. Known gap: when the person lands and the button leaves, focus goes back to the page; moving it to the new chip comes with the live patch.
- A change reads "set" when there was no value before, and "cleared" when there is none after; a clear draws the old value, the arrow and the empty mark, so it never reads as a value still held. Values draw on the field set's `card` surface: one line each, chips flat like the names around them (a link's text alone, a record's chip grey), a long text cut (Details holds it whole). A side that holds one record (a person's Company) is a `change` with record references, drawn through the field set.
- The actor is a plain chip at the body's weight, like the verb after it; the attribute's name stays at the strong weight, so "set **Phone numbers**" reads what changed first (the owner, 20 and 21 October 2026).
- A checkbox's change says itself in its verb, "checked Email opt out" or "unchecked Email opt out", with nothing under the line. Why: two boxes and an arrow read as controls to tick, a blue filled one loudest, and took a line of their own (the owner, 21 October 2026).
- A `changes` entry is one actor's changes at one moment (a save of several fields, an import's row), which the screen groups: "changed 3 attributes", the attributes' names on one quiet line, and a ghost Show all (`aria-expanded`) that lays each change out as a single entry draws it, its name then the old value, the arrow and the new; Show less folds them. Why a variant: ten changes from one save read as ten entries and buried the rest of the timeline (Attio groups them the same way). Story `GroupedChanges`.
- A `call` or `logged_meeting` (migration 0137) is a call or meeting a person logged, shown at the moment it happened ("Ada Lovelace logged a call", the phone or people icon). Its card holds, on one line, how it went as a coloured Tag (`outcome`) and how long it ran (`duration`), both worded by the screen and both opening the entry when it has a `href`, then the start of its notes. Nothing draws under the line when it has none of them. Why entries on the existing note path rather than the calendar's `meeting`: a logged meeting is a person's word, not a calendar event, so it keeps a person as its actor and has no attendees (story `LoggedActivities`).
- A `deleted` entry says the record moved to the trash ("moved this record to the trash", the trash icon), with nothing under its line.
- A `merged` entry says another record was merged into this one (spec 0049): "Brij merged Jane D. into this record", the layers icon (no merge glyph in the registry: every page carries it), the merged record's name as a flat chip with no page (it is gone), or "a record" when the reader can't name it, with nothing under its line. Why a kind and not a `deleted` entry: it happened to this record, which is still here, and names the other.
- A `comment` with no title makes its text the link to the thread (`href`), so the card is never a dead end.
- A `links` entry is what one write did to a side that holds many records: `added` and `removed` name up to 3 records each (`LinkedRecord`: the chip's display and the record's `href`), and `addedCount` and `removedCount` say how many in all. It reads "added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team", "removed Barbara Liskov from Team", or both in one sentence ("added Katherine Johnson and Margaret Hamilton to Team, and removed Edsger Dijkstra from Team"). Each name is a link to its record; "and N others" is plain text. On screen the chips' own boxes part the names, and the commas between them are for screen readers only. The marker is the reference type's icon.
- `layout`: `feed` (the default) is virtualised and scrolls inside its slot; give it a slot with a height. `inline` draws the first entries it is given, at most 10, at their own height with no scroll of their own, for a short block such as Overview's card. Both are the same feed for the keyboard.
- Newer entries arriving above (a live refresh) keep the entry being read where it is on screen, in the feed layout: sizes are kept per entry, and the feed scrolls down by the room the new entries take. At the very top nothing moves, so the newest entries show. The tab stop stays on the same entry.
- The rail runs from just under one marker to the next down a period (the next marker's surface ring parts it), and stops under the last entry and the last of each period, where the next period's heading starts. Entries sit 12px apart (`space-6` above the line and below the detail); in the inline layout the first period's heading has no air above it, since its block's own heading and padding give it.
- Headings: Upcoming (an entry more than 5 minutes ahead of the clock: a meeting still to come), Today, Yesterday, Earlier this week (from the language's first day of the week), then the month, with its year when it isn't this year. "Today" is today in the provider's time zone.
- `toolbar` draws above the feed in every state (the Activity tab's kind filter), as NoteList's does; the feed takes the height left. Why a prop: the filter belongs to the feed's slot, and a screen can't lay the two out itself (no styles in apps).
- `status`: `loading` (the first page: skeleton entries after the loading delay), `error` (with Try again from `onRetry`), or `no-access`.

## States

Default, grouped changes (folded and open), a comment and the trash entry, links, meetings (upcoming, all day, private, past), inline, inline capped at 10, loading (skeleton entries after the loading delay, both layouts), empty, failed (with Try again), no access, entries still loading (skeleton articles, busy, that still take focus), newer entries arriving while scrolled down (the entry being read stays put) and at the top (they show). Focus on an entry (the outline ring, inset, since the feed clips).

## Keyboard

It follows the feed pattern: the feed is one tab stop, on the entry last focused (kept inside the entries there are when a feed is read afresh with fewer). The up and down arrows, and Page Up and Page Down, move to the entry before or after; Home and End go to the newest and to the oldest loaded (while more pages wait, End lands on the one still loading, and the next End goes on once it arrives; in the inline layout, the oldest drawn). Tab moves into an entry's links, such as a linked record's name. Ctrl (or Cmd) with End or Home leaves the feed for what comes after or before it. When the entry holding focus is drawn again (it loaded), focus stays on it.

## Accessibility

Each entry is described by its time and what changed (the values, or a note's title and text), read after its line. While more pages wait, `aria-setsize` is -1 (not known yet). In the inline layout the period headings are h4, a level under the block's own heading.

Each entry is an article named by its line and described by its time and what changed (the values, or a note's title and text). While more pages wait, `aria-setsize` is -1 (not known yet). In the inline layout the period headings are h4, a level under the block's own heading. Each entry is an article named by its line ("Ada Lovelace added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team"). The commas between names are visually hidden text. A chip is its own box, so a browser may read a space before the comma after a name; screen readers pass over it.

## Differences from the artifact

The artifact's record page shows a short static timeline; this one is virtualised and takes its entries from a source. The artifact has no link entry and no inline layout yet: they arrive with the next publish.

## A booked meeting's answers (spec 0057)

A meeting entry may carry `answers`, label then words: the visitor's answers to the booking page's own questions, those the reader may see. The entry shows the first three as excerpt lines and says how many more are on the booking; the words are text, never markup. A private meeting the reader doesn't hold (`detailsHidden`) never carries them (the server leaves them out). Story: `MeetingWithAnswers`.

## A submission's answers (forms fix a1, 5 November 2026)

A `submission` entry reads "<form> submission created this record" (or "updated this record", "came in", "linked this record"), one entry per submission: the server folds the record's own creation entry into it when a submission made the record, so one answer is never logged twice. It may carry `answers` (label then words, those the reader may see; given only when the reader may open the submission) and an `href`. Under its line sit a ghost "Show N answers" disclosure and "Open submission"; the answers unfold in a card under them, so the button never moves from under the pointer. Why folded: a record with many submissions keeps one line each until someone asks. Story: `FromAForm`.

## Timefix prototype (spec 0072)

Takes its look from the prototype's ActivityFeed: each entry a round `size-icon-lg` well (`surface-subtle`, its icon in `text-secondary`, ringed by `space-2` of `surface` so it parts the rail) on a `border-subtle` hairline rail, the well's column and the text `space-12` apart, entries padded `space-6` above and below; a meeting, call or logged meeting's well is blue (`accent-soft`, `accent-text`: blue marks time). The time is `text-caption` in `text-tertiary` with tabular figures; period headings `text-label` in `text-tertiary`. A note's, comment's, email's, logged activity's and meeting's detail sits in the prototype's comment card (`surface-subtle`, `radius-md`, padded `space-8` `space-12`, no edge), its title `text-body-sm-strong` and its text the prototype's preview (`text-body-sm` in `text-secondary`, two lines). Shown all, each change's attribute is the prototype's diff label (`text-label`, `text-tertiary`, `calc(2 * space-48)` wide). A task row and the entry take the outline ring inset (`outline-offset: calc(-1 * border-width-focus)`), since the feed is a clipped scroller. A toolbar sits `space-12` over the feed.

**Use it for** a record's timeline (its Activity tab, Overview's Recent activity inline). **Don't use it for** a workspace audit log (DataGrid) or notifications (NotificationList).

**The consumer provides** `entries` as a `ListSource`, newest first, `label`, `layout`, `status` with `onRetry`, and `onAddPerson` for unknown attendees.

**States**: one change (`Default`), several changes folded and shown (`GroupedChanges`, `ShowAllFoldsBack`: Show all flips to Show less and back, focus staying), a comment and an email in the grey card (`EmailAndComment`, read as each entry's description), meetings with the blue well (`Meetings`), logged activities (`LoggedActivities`), newer entries arriving (`NewerAtTop`, `KeepsReading`), loading, empty, failed and no access. An empty period never draws its heading: headings come from the entries.

**Interaction**: one tab stop with the feed pattern's keys (above). Show all and Show answers fold in place.

**Differences from the prototype**
- Virtualised and paged (a `ListSource`), where the prototype draws every event and folds the older ones behind "Show n older": the library loads older entries as they scroll into view instead.
- The marker is always the entry's icon (the attribute's own for a change); the prototype draws the actor's 20px avatar for a change or comment. The actor is a plain RecordChip in the line.
- The line stays `text-body`, where the prototype's is `text-body-sm`: the plain RecordChip that names the actor draws at the body size, and a line in two sizes read wrong. It moves with RecordChip's plain size.
- New entries arriving show at once (and keep the entry being read in place); the prototype's drop in (0 height rising 12px) needs `freshIds`, a new prop owed to the record page's phase.
- Show all and Show answers stay ghost Buttons, not the prototype's grey pill; the old value is drawn at full strength, not the prototype's 60% opacity, which fails AA contrast on its values.
- Kept beyond it: `links`, `merged`, `deleted`, `submission`, the `meeting` card with attendees and Add as person, `inline` layout, `toolbar`, `status`, the feed pattern's keyboard and the reading position on refresh.

TSX change for the port: the marker carries `data-kind` (the entry's kind) for the blue well, and its Icon no longer passes `tone="muted"`, so the icon draws in the well's colour (`text-secondary`, as before, or `accent-text`).
