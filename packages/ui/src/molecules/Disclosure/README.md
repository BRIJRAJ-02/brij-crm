# Disclosure and DisclosureGroup

A section that opens and closes under its title.

## Why it exists

New. Attribute groups on the record panel (#18), advanced settings and import options (#13, #23) fold away the same way. It wraps React Aria's `Disclosure`, so the title is a real button with `aria-expanded`. Use Tabs when only one section should show at a time and they are peers.

## Use

```tsx
<Disclosure title="Contact" count={4} defaultExpanded>…</Disclosure>
<DisclosureGroup allowsMultipleExpanded>
  <Disclosure id="contact" title="Contact">…</Disclosure>
  <Disclosure id="billing" title="Billing">…</Disclosure>
</DisclosureGroup>
```

- `count` shows a Badge after the title.
- In a `DisclosureGroup`, opening one closes the others unless `allowsMultipleExpanded`.

## States

Closed, open (the chevron turns and the panel's height animates over `duration-move`), hover (pointer only), focus, disabled. Reduced motion opens it at once.

## Keyboard

Tab reaches the title; Enter or Space opens and closes it.

## Differences from the artifact

Not in the artifact.
