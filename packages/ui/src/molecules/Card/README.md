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
- Use it to group, not to decorate: a single list or form on a page needs no card.

## States

None of its own; its content brings them (Skeleton, EmptyState).

## Keyboard

Only its content takes focus.

## Differences from the artifact

Not in the artifact.
