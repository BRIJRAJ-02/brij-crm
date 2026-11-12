# Breadcrumbs

Where a page sits: Settings › Objects › Companies.

## Why it exists

New. Settings (#13, #23) and nested record pages show their place the same way. It wraps React Aria's `Breadcrumbs`, so the last crumb is marked as the current page and links go through the router. Path is for attribute paths through relations, not navigation.

## Use

```tsx
<Breadcrumbs
  items={[
    { id: 'settings', label: 'Settings', href: '/settings' },
    { id: 'objects', label: 'Objects', href: '/settings/objects' },
    { id: 'companies', label: 'Companies' },
  ]}
/>
```

- A place before the last without an `href` is a group's name rather than a page ("Account" in Account › Preferences, spec 0026): it draws as plain text in the links' colour, with no link and no tab stop. Why a variant: a settings page's trail names its navigation group, which has no page of its own, and a link to nowhere would be a dead tab stop.

## States

Link, hover (pointer only), focus (the outline ring on the link's pill), current, and a group's name (the links' `text-secondary` at rest, as a place on the way, but no hover, no focus and no link; the current page stays the one place in `text`).

Always one line: when the row is short, each label ends in an ellipsis, the places above the current one giving way first. In a container under 480px (TopBar is one, so a phone's top bar) only the current place shows, as the title, and the sidebar is the way back up (21 October 2026: a settings bar with its tile, badge and action wrapped to three lines at 375).

## Keyboard

Tab moves through the links; the current page takes no focus.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Breadcrumbs: each link is a small pill (`size-control-sm` tall, `space-6` in, `radius-sm`) in `text-body` and `text-secondary` that washes `surface-hover` and turns `text` under the pointer (no underline), joined by `text-tertiary` chevrons `space-4` apart; the current page is `text-body-strong` in `text`. Focus is the outline ring on the pill's edge (offset 0, so a bar never clips it).

**Use it for** where a page sits under its parents (Settings › Objects › Companies). **Don't use it for** steps of a flow (Steps) or tabs.

**States**: link, hover, focus, current, a group's name (plain text, no wash, no focus).

**Differences from the prototype**
- No "…" overflow menu: when the row is short each label ends in an ellipsis, places above the current one giving way first, and under 480px of container only the current place shows (the prototype folds at 640px of screen; a container query works in any bar).
- No `size` (`sm`, `title`) yet; the trail is `text-body`. Owed to the screen that needs a title sized trail.
- Kept beyond the prototype: a group's name with no link, `safeHref` on every link.
