// A relationship as one of its sides sees it (spec 0014): the block a record
// reference attribute carries in `attributes.list`. Apart from relations.ts,
// which answers with attribute definitions, so attributes.ts can carry the
// block without the two importing each other.
import * as z from 'zod';
import { CARDINALITIES } from './values/cardinality.ts';

/**
 * How many records each side of a relationship may link to, read from the
 * defining side (`from`): `one_to_many` is one `from` record to many `to`
 * records.
 */
export const Cardinality = z.enum(CARDINALITIES);
/** How many records each side of a relationship may link to. */
export type Cardinality = z.infer<typeof Cardinality>;

/**
 * A record reference attribute's relationship (spec 0014, `attributes.list`):
 * its id and cardinality, which side this attribute is (`from` defines it),
 * the objects it links to that the caller may see, the attribute on the
 * other side (absent for a one way reference, or when the caller can't see
 * it), and whether that other side holds one record (so a record picked
 * here may already be linked elsewhere).
 */
export const AttributeRelationship = z.object({
  id: z.uuid(),
  cardinality: Cardinality,
  side: z.enum(['from', 'to']),
  targetObjectIds: z.array(z.uuid()),
  pairedAttributeId: z.uuid().optional(),
  farHoldsOne: z.boolean(),
});
/** A record reference attribute's relationship. */
export type AttributeRelationship = z.infer<typeof AttributeRelationship>;
