# Badge

A small count beside a tab, a nav item or a list heading.

## Why it exists

Ported from the artifact's Badge card. Tabs, the sidebar and the notification inbox show counts with it.

## Use

```tsx
<Badge count={12} />
<Badge count={3} tone="accent" label="unread" />
<Badge count={240} />  // 99+
<Badge count={10_000} max={Infinity} isAtLeast label="people" />  // 10,000+
<Badge text="New" />
```

- `count` is formatted in the provider's language; over `max` (99) it shows `99+`.
- For a total (a table's record count beside its title), pass `max={Infinity}`: uncapped, so 12,480 reads as itself.
- `isAtLeast` says the count is a floor, not the total: a capped count (a filtered view past 10,000) reads "10,000+".
- `text` puts a short label in place of a count (a grid row's note, "New"). Past the room it has it truncates with an ellipsis; the full text stays in the DOM, so it is read whole.
- `tone`: `neutral` (the default) beside a label, `accent` for counts that ask for attention.
- `label` names what is counted for screen readers ("3 unread"); leave it out when the label beside it already says.

## States

None of its own.

## Keyboard

It takes no focus.

## Differences from the artifact

- `count` is a number, not children, so it formats in the viewer's language and caps at `max`. A label goes in `text`, a string, never markup.
- `tone="accent"` replaces the `ws-badge-accent` class.
