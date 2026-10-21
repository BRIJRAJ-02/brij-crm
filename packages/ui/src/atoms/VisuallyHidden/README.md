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
- `isFocusable` shows what it holds while focus is inside it, for a skip link: hidden until Tab reaches it.
- `id` lets a control name it in `aria-describedby`: why a button is off, when what shows on screen already says it to sight (Empty trash while a change runs, its progress in the bar).

## States

None.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
