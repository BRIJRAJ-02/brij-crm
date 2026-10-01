# Callout

A message that stays in the page beside what it is about.

## Why it exists

New. An import that skipped rows (#30), a secret shown once (#34), a plan near its limit (#38) and a setup step (#14, #22) need a message that stays put until what it describes changes. A toast leaves after 5 seconds, and EmptyState fills a whole region; neither fits. It borrows the tag colours for its tones, since the tokens have no separate callout colours.

## Use

```tsx
<Callout tone="warning" title="3 rows were skipped" actions={<Button>Download skipped rows</Button>}>
  Their dates weren't in one format. Fix them, then import those rows again.
</Callout>
```

- `info` explains, `success` confirms in place, `warning` comes before a risky step, `danger` says what failed (and is announced).
- Never the only copy of something critical for long: pair it with the place to act.

## States

The four tones.

## Keyboard

Only its actions take focus.

## Differences from the artifact

Not in the artifact.
