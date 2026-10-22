# Steps

Numbered steps through a flow: done, current, still to come, or failed.

## Why it exists

New. Imports (#30), two factor setup (#25) and onboarding (#40) walk through steps, and show where you are the same way.

## Use

```tsx
<Steps
  label="Import progress"
  steps={[
    { id: 'upload', label: 'Upload' },
    { id: 'map', label: 'Map columns' },
    { id: 'review', label: 'Review' },
  ]}
  current="map"
/>
```

- Steps before `current` are done; `failed` marks the one that failed.
- `variant="count"` is one quiet line, "Step 2 of 3", for a flow whose own title names the step: first run's split card (spec 0036), where it leads the title in Card's `eyebrow`. Why a variant: the same flow and the same current step, said in a line where a list of every step would crowd a narrow column and repeat the title.
- `orientation="horizontal"` lays the list in one row, each hairline running on to the next marker: the import page, where a column of four steps pushed the work below the fold on a wide screen (Customer.io and Attio put import steps in a row across the top). Under 480px of slot it turns back into the column, since a phone has no room for every label. Why an option, not a new component: the same steps, states and markup, only the direction changes.
- It is an ordered list; the current step is `aria-current="step"`, and done and failed steps say so to screen readers.

## States

Done (accent tick), current (accent ring), upcoming, failed (danger cross). Counted ("Step 2 of 3").

## Keyboard

It takes no focus; the flow's own buttons move between steps.

## Differences from the artifact

Not in the artifact.
