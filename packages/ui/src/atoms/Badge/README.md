# Badge

A small count beside a tab, a nav item or a list heading.

## Why it exists

Ported from the artifact's Badge card. Tabs, the sidebar and the notification inbox show counts with it.

## Use

```tsx
<Badge count={12} />
<Badge count={3} tone="accent" label="unread" />
<Badge count={240} />  // 99+
```

- `count` is formatted in the provider's language; over `max` (99) it shows `99+`.
- `tone`: `neutral` (the default) beside a label, `accent` for counts that ask for attention.
- `label` names what is counted for screen readers ("3 unread"); leave it out when the label beside it already says.

## States

None of its own.

## Keyboard

It takes no focus.

## Differences from the artifact

- `count` is a number, not children, so it formats in the viewer's language and caps at `max`.
- `tone="accent"` replaces the `ws-badge-accent` class.
