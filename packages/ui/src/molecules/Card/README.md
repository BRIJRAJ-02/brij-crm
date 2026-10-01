# Card

A framed group with a header: a settings section, a dashboard tile, a template.

## Why it exists

New. Settings pages (#39, #42), dashboard tiles (#52) and the template and onboarding lists (#40) group content in frames. One Card keeps the frame, header and footer the same everywhere.

## Use

```tsx
<Card
  title="API keys"
  description="Keys act as the workspace. Keep them secret."
  actions={<Button icon="plus">New key</Button>}
>
  …
</Card>
```

- `actions` sit at the end of the header; `footer` holds a form's Save.
- `tone="sunken"` for a quieter group inside a page.
- `placement="page"` is the one frame for a page outside the app shell: the status page and the not found page now, and `AuthLayout` (sign in, sign up, verify email, accept invite) builds on it later rather than drawing a second centred frame. The card is then the page's `main` landmark, its title (required) an `h1`, centred, capped at `size-page-card` (520px), and kept 16 px (`--space-16`) from each edge on a phone. Inline cards keep `section` and `h3`.
- Use it to group, not to decorate: a single list or form on a page needs no card, except with `placement="page"`, where the card is the page.

## States

Its content brings them (Skeleton, EmptyState). `isBusy` marks the card `aria-busy` while a Skeleton stands in.

## Keyboard

Only its content takes focus.

## Differences from the artifact

Not in the artifact.
