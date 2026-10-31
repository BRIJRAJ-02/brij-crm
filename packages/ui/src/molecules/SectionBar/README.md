# SectionBar

One row of controls above a section of a page: start controls, a heading, end controls (Bookings' calendar and list, spec 0025).

## Why it exists

New. Screens can't lay out a row of controls themselves (no styles in `apps/web`), and the existing bars don't fit: TopBar is the page's one h1 bar, ViewBar is an object view's view switcher, and Toolbar holds a view's sorts and filters. A calendar needs "Calendar | List · 19 – 25 October 2026 · ‹ Today › Filter" on one row that wraps.

## Use

```tsx
<SectionBar
  start={<SegmentedControl label="View" segments={…} value="week" onChange={…} />}
  title="19 – 25 October 2026"
  end={<><Button icon="chevron-left" label="Previous week" /><Button>Today</Button></>}
/>
```

- `title` is an h2: the section's heading under the page's TopBar.
- `description` is one quiet line after the heading, on its baseline, in `text-secondary`: Home's greeting and today's date (spec 0041). Why a prop: screens can't set text beside a heading themselves, and a Card would frame a single line.
- `after` holds controls right after the heading, before `end`: Bookings' week puts its calendar switch after the dates. Why a prop: the owner's bar (22 October 2026) reads Today ‹ › dates, then the calendars, then Filter at the end, and `end` is pushed to the far side.
- `isTitleQuiet` sets the heading in `text-body-strong` rather than `text-title`, for a heading that is a place in time (the week's dates) beside the controls that lead. Why: the week's bar read heavy with the dates in title type (the owner, 22 October 2026).
- `isTitleProminent` sets the heading in `text-note-title` (28px, the largest type token) rather than `text-title`, with a little room above and below, for a page's opening line over cards whose own titles are in title type: Home's greeting over Today and the link page card. Why: with both in title type the greeting, the card titles and their body read as one level (the owner, 31 October 2026, Home item 1), and 18px still read as one level in the browser check. The note title token is borrowed for now: it waits on a page title role token in the artifact (same value), which the owner confirms with the 28px size, so a later change to note titles doesn't move Home's greeting. The two don't combine: the props' type takes one or the other, never both.
- `end` sits at the end and moves under the rest when the row wraps.
- `variant="bar"` draws it as a page's bar under the TopBar, with the toolbar's height, padding and bottom edge (My tasks, spec 0019). Use it rather than Toolbar for controls that keep their own arrow keys, such as SegmentedControls: Toolbar's arrow key roving would move focus off a segment instead of choosing the next one.

## States

None of its own: the controls' own. Heading types: title (default), quiet (`isTitleQuiet`), prominent (`isTitleProminent`).

## Keyboard

Tab moves through the start controls, then the end controls, in order.

## Differences from the artifact

Not in the artifact.
