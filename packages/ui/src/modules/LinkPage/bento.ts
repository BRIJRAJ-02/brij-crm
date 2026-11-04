// The bento grid's spans (spec 0068, AC-6808): pure, so the page and the editor snap a group's cards the same way and
// a Node test holds the rule.

/** A card's span as its owner set it: one column or two. */
export type BentoSpan = 1 | 2;

/** The columns a bento grid has: one on a phone, two, or three where the blocks have the room. */
export type BentoColumns = 1 | 2 | 3;

/** A card's span from its stored size: `wide` and spec 0061's `large` take two columns, anything else one. */
export function spanOf(size: string | undefined): BentoSpan {
  return size === 'wide' || size === 'large' ? 2 : 1;
}

/**
 * Each card's span on a grid of `columns`, in the owner's order, so the grid fills without holes (AC-6808): a card
 * takes the span it asked for, at most the grid's width; a card that would not fit the room left in its row starts
 * the next row, and the card before it widens to close the gap; the last row's last card widens the same way. So
 * every row is full, nothing moves ahead of its place, and the reading order, the focus order and the screen agree.
 */
export function bentoSpans(wanted: readonly BentoSpan[], columns: BentoColumns): readonly number[] {
  const spans: number[] = [];
  let used = 0;
  for (const want of wanted) {
    const span = Math.min(want, columns);
    if (used + span > columns) {
      const last = spans.length - 1;
      spans[last] = (spans[last] ?? 0) + (columns - used);
      used = 0;
    }
    spans.push(span);
    used = (used + span) % columns;
  }
  if (used > 0 && spans.length > 0) {
    const last = spans.length - 1;
    spans[last] = (spans[last] ?? 0) + (columns - used);
  }
  return spans;
}

/** Whether a card's span was widened from what its owner asked, on a grid of `columns`: what the editor says. */
export function isSnapped(wanted: readonly BentoSpan[], columns: BentoColumns, at: number): boolean {
  const asked = wanted[at];
  return asked !== undefined && bentoSpans(wanted, columns)[at] !== Math.min(asked, columns);
}
