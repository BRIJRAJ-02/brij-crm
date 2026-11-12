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
- `size="large"` sets each value in the page's biggest type (`text-note-title`): one headline figure on its own. Why a variant: a report's big number is the same label and value, only larger, and a second figure component would have repeated the `dl`, the loading skeleton and the comparison line (the reports lane, 31 October 2026).

- `variant="cards"` sets each figure on Card's own surface, hairline, corners and shadow (the prototype's StatCard, its value in `text-display`), a `space-12` gap between them, one row that wraps: a page's figures above the Cards that explain them (a form's Analytics: Views, Starts, Finished, Completion, Median time, 5 November 2026). Why a variant: the figures are the same `dl`, loading and comparison; a Card per figure would draw a header and body for a label and a number, and plain figures floating over a page of Cards read as unfinished (the owner: "vibe coded").

## States

- Default: the figures.
- `isLoading`: a skeleton label and a heading height value per figure (five when none are known yet), `aria-busy` on the group.
- Empty: no items draws nothing (the Empty story).
- Empty, error and no access belong to the card around it (EmptyState): a figure the reader may not see is left out by the screen.

## Keyboard

None: nothing in it takes focus.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from Card (spec 0072): the prototype folds Stats into Card's StatCard. Its own module draws the StatCard's figure (decision 14: sharing one part with RecordStats was measured heavier per page, see Card's README): a grey `text-body-sm-strong` label over the value in tabular figures (`text-title` in a row, `text-display` with `variant="cards"` or `size="large"`), the comparison in `text-body-sm` and `text-secondary` under it.

**States**: figures, loading (skeletons, the group busy), nothing (renders nothing), a label that links.

**Differences from the prototype**: no number pop, sparkline or breakdown; `href` on a label, `trend` arrows in no colour (up isn't always good) and the `plain` row are kept.

**Repeats from its replacer** (AC-4): the figure's label, value and comparison type (and the `cards` variant's Card surface, edge, corners and shadow); they leave with this export.
