# VisuallyHidden

Text for screen readers only: read aloud, but taking no space on screen.

## Why it exists

New. Counts, archived marks and status words need a word for screen readers that sight gets from colour or position. It wraps React Aria's `VisuallyHidden`, so every component hides text the same way.

## Use

```tsx
<span>
  3<VisuallyHidden elementType="span"> unread</VisuallyHidden>
</span>
```

- Use it to add words, never to hide a control. A control's name comes from its `label`.
- `elementType="span"` wherever only phrasing content is allowed: inside a `p`, an `a`, a `button`, a heading or a `span`, which is most places a word is added mid sentence. It draws a `div` by default, and a `div` inside a paragraph is invalid HTML: React reports a hydration error and the browser repairs it by closing the paragraph early, which moves the rest of the sentence out of it (the link page's banner, 2 November 2026).
- `isFocusable` shows what it holds while focus is inside it, for a skip link: hidden until Tab reaches it.
- `id` lets a control name it in `aria-describedby`: why a button is off, when what shows on screen already says it to sight (Empty trash while a change runs, its progress in the bar).

## States

None.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
