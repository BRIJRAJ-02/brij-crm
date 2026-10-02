# CommandPalette

The keyboard first picker for Quick actions (⌘K) and "Choose record": a search field over a list of rows, and a foot naming the keys.

## Why it exists

Ported from the artifact's CommandPalette card. The core loop (#10), relations (#15) and global search (#33) all pick through it. It is a `Modal` (its `palette` variant) holding an inline searchable `Menu` over a `ListSource`, so it is keyboard first, virtualised and async without new parts.

## Use

```tsx
<CommandPalette
  isOpen={isOpen}
  onOpenChange={setOpen}
  title="Choose record"
  items={results}
  onSearch={search}
  onAction={(item) => open(item.id)}
/>
```

- `items` is a `ListSource` of rows for the current search; rows still loading draw skeletons. `onSearch` gets each change to the search.
- A row shows its `name`, then its `description` (a domain, an email) under it, its `kind` at the end, and an action's `kbd`. `icon` or `leading` (an Avatar) comes first.
- Choosing a row (Enter or a click) calls `onAction` and closes the palette.
- It never animates: it opens from the keyboard many times a day.

## States

Open with results, loading rows (skeletons), nothing matches.

## Keyboard

It opens with its search field focused. Typing searches, the up and down arrows move the highlight, Enter chooses, Esc closes and returns focus to where it opened from.

## Differences from the artifact

- `items` is a `ListSource` with `onSearch`, rather than a static list; `sectionLabel` and `actionLabel` are gone (the foot names the keys instead of repeating the action).
- Match highlighting is left for global search (#33), which knows how it matched.
