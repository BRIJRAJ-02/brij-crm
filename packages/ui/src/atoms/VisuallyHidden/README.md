# VisuallyHidden

Text for screen readers only: read aloud, but taking no space on screen.

## Why it exists

New. Counts, archived marks and status words need a word for screen readers that sight gets from colour or position. It wraps React Aria's `VisuallyHidden`, so every component hides text the same way.

## Use

```tsx
<span>
  3<VisuallyHidden> unread</VisuallyHidden>
</span>
```

- Use it to add words, never to hide a control. A control's name comes from its `label`.

## States

None.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
