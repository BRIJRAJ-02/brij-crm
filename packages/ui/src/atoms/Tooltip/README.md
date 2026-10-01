# Tooltip

A short line that appears after a pause on hover, or at once on keyboard focus.

## Why it exists

New. Truncated text, exact times, icon only buttons and disabled reasons all need the same small label. It wraps React Aria's `TooltipTrigger`, so it opens on hover and focus, closes on Esc, and is described to screen readers.

## Use

```tsx
<Tooltip content="Archive record">
  <Button icon="archive" label="Archive" />
</Tooltip>
<Tooltip content={fullText} isTextTrigger><span>{cut}</span></Tooltip>
```

- It adds to a name and never replaces it: an icon only button keeps its own `label`.
- `isTextTrigger` wraps plain text, which shows the tooltip on hover and when something focuses it on purpose (a grid cell); it adds no tab stop.
- `placement`: `top` (the default), `bottom`, `start` or `end`.
- The delay is React Aria's (1.5 s to open, at once once one is showing).

## States

Hidden, showing. Opened from the keyboard it appears at once; from a pointer it fades in.

## Keyboard

Focus on the trigger shows it; Esc hides it.

## Differences from the artifact

Not in the artifact.
