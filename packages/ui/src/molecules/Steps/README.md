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
- `orientation="horizontal"` lays the list in one row, each hairline running on to the next marker: the import page, where a column of four steps pushed the work below the fold on a wide screen (Customer.io and Attio put import steps in a row across the top). Under 480px of slot it turns back into the column, since a phone has no room for every label. It is for labels only: leave out `description` in a row, where a second line would sit the markers off their labels. Why an option, not a new component: the same steps, states and markup, only the direction changes.
- `onStepPress` makes each done step a button that goes back to it (the import page's earlier steps, as Attio's do); without it done steps are plain text. Why an option: the same list, only the done steps become pressable.
- It is an ordered list; the current step is `aria-current="step"`, and done and failed steps say so to screen readers.

## States

Done (accent tick), current (accent ring), upcoming, failed (danger cross). Counted ("Step 2 of 3").

## Keyboard

It takes no focus, unless `onStepPress` is given: then each done step is a button in tab order (Enter or Space goes back to it).

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Steps: `space-24` rings a hairline and a half wide (the prototype's 1.5px, as a ratio of the hairline token) with the number in `text-label`; upcoming is a `control-border` ring with a grey number; current an `accent` ring with an `accent-text` number and a 2px `accent-soft` halo; done an `accent` disc with the tick in `on-accent`. Labels are `text-body-sm-strong`, `text-secondary` while upcoming and `text` once current or done; descriptions and the count are `text-body-sm`. The line between steps is a hairline and a half of `border` and turns `accent` after a done step over `duration-slow`. A done step that goes back is a pill that washes `surface-hover` under the pointer, with the outline ring on focus.

**Use it for** a short sequence someone moves through (an import, setup, a hosted form's pages). **Don't use it for** navigation between unrelated pages (Tabs or the sidebar), or for progress with no named steps (a progress bar).

**States**: upcoming, current (`aria-current="step"`), done, done and pressable (hover wash, focus ring), failed (the library's own: a danger ring and cross).

**Differences from the prototype**
- The line turns accent as a whole, with a colour fade, rather than filling from its start: the line is the step's own `::after`, so a moving fill would need a second element in every step.
- The tick appears with the disc; the prototype's drawn tick (transitions.dev 10) is owed to the phase that brings the shared success check (phase 2's SuccessCheck).
- A pressed done step washes instead of underlining its label (the prototype's).
- Kept beyond the prototype: `failed`, the `count` variant, and the horizontal row that turns into the column under 480px.
- Stepper is named in the prototype's `replaces` only: it is a quantity control (− n +), not a step indicator, so it keeps its own look (see its README).
