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
- `end` sits at the end and moves under the rest when the row wraps.
- `variant="bar"` draws it as a page's bar under the TopBar, with the toolbar's height, padding and bottom edge (My tasks, spec 0019). Use it rather than Toolbar for controls that keep their own arrow keys, such as SegmentedControls: Toolbar's arrow key roving would move focus off a segment instead of choosing the next one.

## States

None of its own: the controls' own.

## Keyboard

Tab moves through the start controls, then the end controls, in order.

## Differences from the artifact

Not in the artifact.
