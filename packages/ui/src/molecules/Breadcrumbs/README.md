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

## States

Link, hover (pointer only), focus, current.

## Keyboard

Tab moves through the links; the current page takes no focus.

## Differences from the artifact

Not in the artifact.
