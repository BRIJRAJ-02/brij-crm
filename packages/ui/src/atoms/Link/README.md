# Link

An inline text link.

## Why it exists

New. Text in notes, descriptions, settings and empty states links somewhere; one atom routes app paths through the router and checks every href with `safeHref()` (AC-14). For a link as a value (an email, a domain, a URL) use LinkChip.

## Use

```tsx
<Link href="/settings/members">Invite your team</Link>
<Link href="https://docs.example.com">Read the guide</Link>
```

- App paths (`/people/1`) go through the router (React Aria's `RouterProvider`, from UiProvider).
- `http` and `https` links out open in a new tab with `noopener noreferrer`; `mailto:` and `tel:` open as usual.
- Any other href (`javascript:`, `data:`, `//host`) renders the text with no link.

## States

It is underlined at rest (soft), so it never relies on colour; hover and focus darken the underline.

## Keyboard

Tab reaches it; Enter follows it.

## Differences from the artifact

Not in the artifact.
