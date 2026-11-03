# Reveal

A public page's entrance, played once as it first draws (spec 0068, AC-6803, AC-6806): what it wraps rises `space-12` out of a soft blur, and each `order` (1 to 6) waits one stagger more than the one before, so a headline lands before its line and the rows after both. It is transitions.dev's texts reveal, built in CSS alone, so it costs no script and never replays on a re-render.

## Why a new part

Nothing in the library moved text in: the app never does (its first paint is simply there), and the booking page's own reveals live inside BookingFrame. The link page, and the business, event and menu pages after it, need the same entrance, so it is one part rather than a copy per module.

## States

There is one: it plays as it mounts. Under reduced motion it is simply there. `display="inline"` keeps it in its line (a word in a heading); `block` (the default) stands on its own.

## Use

On public pages only, around a page's own words as they first draw (LinkPage's name, job title and bio). Never in the app, and never around something that changes after the first paint (use NumberPop or a label swap for that).

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`. The stagger, pace and blur are literals waiting on the artifact's public page pace and blur tokens.
