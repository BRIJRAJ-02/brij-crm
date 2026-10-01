# StatusDot

A status as a dot in its hue, then its label.

## Why it exists

Ported from the artifact's StatusDot card. It is the status attribute's one display (cells, the record panel, cards, filters, board column headers). Screens render it through the field set, never directly. The one exception is the status page's health dot, which is the system's state, not an attribute value (its import carries an ESLint disable saying so).

## Use

```tsx
<StatusDot hue="green">Active</StatusDot>
<StatusDot hue="orange" isArchived>Paused</StatusDot>
```

- The label always shows; the dot's colour is never the only cue.
- `isArchived` turns the dot gray and adds "(archived)" for screen readers.

## States

Archived.

## Keyboard

It takes no focus.

## Differences from the artifact

- `hue` replaces `color`, and is required; `isArchived` is new.
