# SampleTable

A picture of a small table: a tinted header row over a few sample rows.

## Why it exists

New (31 October 2026, the copy pass). The CSV import's first step said "The first row holds the column names. Nothing changes until you start the import." in a sentence; a three row picture says the same at a glance, and one component can say the same for any other file or grid a screen wants to show the shape of. Neither reusing Table (it is a real, focusable React Aria table; a picture must take no focus and read as one image) nor a variant of DescriptionList (terms beside values, not rows and columns) fit, so it is its own molecule.

## Use

```tsx
<SampleTable
  label="The first row holds the column names"
  rows={[
    ['Name', 'Email', 'Company'],
    ['Ada Lovelace', 'ada@example.com', 'Analytical Engines'],
    ['Grace Hopper', 'grace@example.com', 'Navy'],
  ]}
  caption="Row 1: column names"
/>
```

- The first row is the header: tinted `surface-subtle` and in the strong label weight. Every row has the same number of cells, and the columns share the width evenly; a long cell cuts with an ellipsis.
- `label` is what a screen reader hears; the cells are hidden from it, since they are decoration. `caption` is a few words under the picture in `text-tertiary`.
- It is a `figure` holding one `role="img"`, so it is never in the tab order and pointer events pass through it.

## States

None: it is a picture. It follows the theme through the tokens.

## Keyboard

None. It takes no focus.

## Differences from the artifact

Not in the artifact.
