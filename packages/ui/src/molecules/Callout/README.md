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
- `placement`: `inline` (the default) sits inside a padded region, as a bordered box. `banner` runs full width under a view's bars, for a state of the whole view (live updates paused): square, with only a hairline below in its tone's colour (the bar above draws the line over it), its content in line with the bars' content. Why a variant: a bordered, rounded box flush against the view's edges notched against the sidebar, doubled the bar's hairline and sat out of line with the bars. `bar` is one short, quiet line (the tone's icon and text, with no fill or edge, so it never reads as a button; a long one is cut short) at a control's height inside a bar (the view bar), for a state that comes and goes under the person: live updates paused. Why a variant: the banner pushed the table down each time the connection dropped and came back. On a phone (its container under 480px, as FloatingBar narrows) a long one wraps under its first words instead, so a reason in the bulk bar is read whole.
- `isAnnounced` says it politely when it appears (`role="status"`), for a state that changed under the person rather than one they caused. Its words go in a frame after it mounts, since a status region announces changes, not what it was born with. `danger` is always announced, as an alert, unless `isPolite`: a danger the person caused themselves (a form's "2 answers need a look" after Send, with focus already on the first) is said politely, as a status.

## States

The four tones, inline, in a bar (wrapping on a phone) and as a banner, announced or not.

## Keyboard

Only its actions take focus.

## Differences from the artifact

Not in the artifact.
