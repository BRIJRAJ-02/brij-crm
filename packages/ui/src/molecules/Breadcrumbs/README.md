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

Link, hover (pointer only), focus (the 1px `accent-line` ring just outside, as Link), current, and a group's name (the links' `text-secondary` at rest, as a place on the way, but no hover, no focus and no link; the current page stays the one place in `text`).

## Keyboard

Tab moves through the links; the current page takes no focus.

## Differences from the artifact

Not in the artifact.
