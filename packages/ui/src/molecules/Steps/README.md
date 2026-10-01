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
- It is an ordered list; the current step is `aria-current="step"`, and done and failed steps say so to screen readers.

## States

Done (accent tick), current (accent ring), upcoming, failed (danger cross).

## Keyboard

It takes no focus; the flow's own buttons move between steps.

## Differences from the artifact

Not in the artifact.
