# TextSwap

Words that change in place (spec 0068, AC-6806): Publish → Published, Book → Booked, Add → Added. When `children`
changes, the old words rise `space-4` out and fade in `duration-quick`, then the new words rise `space-4` in
from below and fade in, in `duration-fast` (transitions.dev's text states swap). The first value is simply
there.

## Why a new part

Button's own label swap (`--label-swap`) only fades the new label in, and only where a public page turns it on; the
owner asked for the full out-then-in swap on Publish (4 November 2026), and words outside a button (a status line)
need it too. One part keeps every swap the same.

## Use

```tsx
<TextSwap>{isPublished ? 'Published' : 'Publish'}</TextSwap>

// Inside a Button: the Button draws its label through TextSwap.
<Button variant="primary" animateLabel labelReserve="Published">
  {isPublished ? 'Published' : 'Publish'}
</Button>
```

- Both words share one grid cell while they cross, so the wider sets the width and nothing beside them jumps mid
  swap. Pair it with the Button's `labelReserve` when the width must never change at all.
- Screen readers read the current words only (the leaving ones are hidden); whoever shows it decides whether a change
  is announced.

## Soft

`variant="soft"` (spec 0073, AC-7310, the prototype's SoftText): both values cross fade in one cell at once over `duration-quick`, with no movement, for a value recomputed where it stands (a total after a period change, a price after a currency change, a relative time ticking over). `align="end"` keeps a right aligned figure on its edge, `center` a centred one. It has no movement, so reduced motion keeps the cross fade (the house rule: reduced motion keeps fades). Why a variant: it is the same swap in one cell, timed differently, and one part keeps every word change in one place. The prototype's TextMorph maps to the default swap (spec 0073: fewer kinds of motion). Story: `Soft`.

## States

Still (the first value), swapping, and reduced motion (a plain crossfade, no movement). No blur: the artifact has no blur token yet.

## Keyboard

None: it is words.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
