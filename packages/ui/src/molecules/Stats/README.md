# Stats

A row of figures that wraps: Home's metrics, this week against last (spec 0041).

## Why it exists

New. Home's metrics row needs figures read at a glance: a label, a large value and what it is read against. DescriptionList pairs terms with values in body type and has no comparison or trend; Meter and ProgressBar show a share of a whole, not a count; a Card per figure would draw five frames inside the metrics card. A third DescriptionList layout was turned down: its terms and values are body text in a two column grid, and figures need heading type, tabular numbers, a comparison line and a wrapping row of their own, so the variant would share no markup or CSS with the other two. The Dashboard module in the inventory (#52, reports) is a larger thing and can build on this.

## Use

```tsx
<Stats
  label="This week"
  items={[
    { id: 'meetings', label: 'Meetings booked', value: '12', comparison: '8 last week', trend: 'up' },
    { id: 'won', label: 'Deals won', value: '$4,200', comparison: '$0 last week', trend: 'up' },
  ]}
/>
```

- A group named by `label`, holding a real `<dl>`: each label is a term, the value and the comparison its descriptions. With no items (and not loading) it draws nothing, so the screen leaves its card out.
- As many columns as fit, each at least `size-column-narrow` (120px), sharing the width; a phone wraps them.
- `trend` draws an arrow before the comparison in the tertiary colour, never green or red: more open deals or more meetings is not always good news. Screen readers hear "Up from 8 last week". `same` draws no arrow.
- `href` makes a figure's label a link to the records behind it (Home's New people opens People). Why: a figure that moved begged "which ones?", and the label is the one piece of text that says what the figure counts, so it is the link's name.
- Values use tabular figures, so they line up as they change.

## States

- Default: the figures.
- `isLoading`: a skeleton label and a heading height value per figure (five when none are known yet), `aria-busy` on the group.
- Empty: no items draws nothing (the Empty story).
- Empty, error and no access belong to the card around it (EmptyState): a figure the reader may not see is left out by the screen.

## Keyboard

None: nothing in it takes focus.

## Differences from the artifact

Not in the artifact.
