// A relationship's cardinality and what it means for each side (spec 0004,
// AC-5; spec 0014). Plain TypeScript with no Zod, so the relationship dialog
// in the browser phrases its choices and sentence by the same rule the
// engine enforces (`singleEnds` in packages/core).

/**
 * The four cardinalities, read from the defining side (`from`): `one_to_many`
 * is one `from` record to many `to` records, so each `to` record has one
 * `from` record. In the order the dialog offers them.
 */
export const CARDINALITIES = ['many_to_one', 'one_to_many', 'many_to_many', 'one_to_one'] as const;

/** How many records each side of a relationship may link to. */
export type CardinalityKey = (typeof CARDINALITIES)[number];

/**
 * Which sides of a cardinality hold one record at most: the `from` side
 * holds one when each `from` record links to one `to` record. Mirrors the
 * engine's `singleEnds`.
 */
export function sidesHoldingOne(cardinality: CardinalityKey): { readonly from: boolean; readonly to: boolean } {
  return {
    from: cardinality === 'one_to_one' || cardinality === 'many_to_one',
    to: cardinality === 'one_to_one' || cardinality === 'one_to_many',
  };
}

/** The same relationship read from the other side: `one_to_many` becomes `many_to_one`. */
export function flipCardinality(cardinality: CardinalityKey): CardinalityKey {
  if (cardinality === 'one_to_many') return 'many_to_one';
  if (cardinality === 'many_to_one') return 'one_to_many';
  return cardinality;
}
