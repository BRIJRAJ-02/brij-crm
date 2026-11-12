# MotionDemos

Spec 0068's stageshow demos (AC-6807): the three key interactions of the public pages, each made first as a demo, filmed and fixed until it read right, then its timing carried into the library's own motion parts.

- **BookDemo**: a guest picks a time (the chip fills with the accent over `duration-move`), Confirm wakes, and on its press the card slides to "You're booked" (`duration-modal`, 8px out of a 2px blur), the SuccessCheck drawing a third of the way in, and the button's label rising to Booked.
- **SheetDemo**: a menu item pressed opens its sheet from the foot (`duration-modal` on the drawer curve, a panel reveal); Large is chosen on the SegmentedControl, whose thumb slides, and the price pops (NumberPop: only the changed digits rise, the last two a stagger apart).
- **PublishDemo**: Publish pressed swaps to Published (the Button's label swap, with the icon turning to a check) and "1 change not published" to "Guests see this version"; the guest's view takes the new length a press later, so the cause reads before the effect.

## Why it exists

AC-6807 asks for each key interaction to be made first as a demo, kept as a story, with the best becoming loops for the marketing homepage. They are built only from the library's parts (Button, SegmentedControl, NumberPop, SuccessCheck, Icon), so what was filmed is what ships. Never exported from the index and never in an app: a story's illustration, inert, with a pointer drawn over it.

## What the films carried back

- The public pages' press and label swap now come from tokens: `--scale-press: var(--scale-medium)` (0.97) and `--label-swap: var(--duration-fast)`, set by the link page's root as the booking page sets its own calmer pace, so a Book, Directions or Share pressed on a link page eases down and a changed label rises in.
- The confirmation lands a press after its cause (`duration-press`), never with it: in the film the guest's view changing at the same frame as the button read as one flash.

## States

Each demo has a loop (its stories `*Loop`) and a poster (`*Poster`, the beat that tells the story on its own: the result on screen, never a frame caught mid change). Under reduced motion every demo shows its poster and nothing moves.

## Keyboard

None: a demo is an illustration, inert, out of the tab order, named for what it shows.
