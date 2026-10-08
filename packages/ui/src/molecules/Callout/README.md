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
- `placement`: `inline` (the default) sits inside a padded region, as a bordered box. `banner` runs full width under a view's bars, for a state of the whole view (live updates paused): square, with only a hairline below in its tone's colour (the bar above draws the line over it), its content in line with the bars' content. Why a variant: a bordered, rounded box flush against the view's edges notched against the sidebar, doubled the bar's hairline and sat out of line with the bars.
- `isAnnounced` says it politely when it appears (`role="status"`), for a state that changed under the person rather than one they caused. Its words go in a frame after it mounts, since a status region announces changes, not what it was born with. `danger` is always announced, as an alert.

## States

The four tones, inline and as a banner, announced or not.

## Keyboard

Only its actions take focus.

## Differences from the artifact

Not in the artifact.
