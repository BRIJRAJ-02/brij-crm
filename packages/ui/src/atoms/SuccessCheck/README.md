# SuccessCheck

The moment something is done (spec 0068, AC-6806): booking confirmed, registration done, Published. A tick in a filled success circle fades in out of a blur with a small turn and drop, and its tick draws a beat later (transitions.dev's success check). It plays once as it mounts: show it when the thing is done, and take it away after.

## Why a new part

BookingReceipt pops its own state mark beside the host, and nothing else in the library confirms. The registration and the booking summary on public pages need the same moment, so it is one part. It is for public pages only: the dashboard (the publish bar) keeps its plain icon and words.

## States

`sm` (an icon's size, beside words that say it, hidden from screen readers) and `lg` (a control's height, leading a confirmation; with `label` it reads as an image of that name). Reduced motion shows it drawn at once.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
