// The relationship block each record reference attribute carries in
// `attributes.list` (spec 0014): its cardinality, which side it is, what it
// links to and its paired attribute, as the caller may see them.
import type { AttributeRelationship } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { loadRelationships } from '../engine/relationships.ts';
import { objectLevel, type Access } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';

/** An attribute row, as far as its relationship block needs it. */
export interface RelationshipRow {
  readonly id: string;
  readonly type: string;
  readonly relationshipId: string | null;
}

/**
 * The relationship blocks of some attributes, by attribute id, in one read.
 * Objects the caller can't see are left out of `targetObjectIds`, and the
 * paired attribute is named only when the caller may see it (spec 0009:
 * hidden means absent).
 */
export async function relationshipBlocks(
  tx: WorkspaceTx,
  access: Access,
  rows: readonly RelationshipRow[],
): Promise<ReadonlyMap<string, AttributeRelationship>> {
  const references = rows.filter((row) => row.type === 'record_reference' && row.relationshipId !== null);
  if (references.length === 0) return new Map();
  const loaded = await loadRelationships(tx, [...new Set(references.map((row) => row.relationshipId ?? ''))]);
  const blocks = new Map<string, AttributeRelationship>();
  for (const row of references) {
    const relationship = loaded.get(row.relationshipId ?? '');
    if (relationship === undefined) continue;
    const isFrom = relationship.fromAttributeId === row.id;
    const targets = isFrom ? relationship.toObjectIds : [relationship.fromObjectId];
    const pairedId = isFrom ? relationship.toAttributeId : relationship.fromAttributeId;
    const pairedObject = isFrom ? relationship.toObjectIds[0] : relationship.fromObjectId;
    const pairedSeen =
      pairedId !== null &&
      pairedObject !== undefined &&
      objectLevel(access, pairedObject) !== 'none' &&
      attributeVisible(access, { id: pairedId, objectId: pairedObject, listId: null });
    blocks.set(row.id, {
      id: relationship.id,
      cardinality: relationship.cardinality,
      side: isFrom ? 'from' : 'to',
      targetObjectIds: targets.filter((objectId) => objectLevel(access, objectId) !== 'none'),
      ...(pairedSeen
        ? { pairedAttributeId: pairedId, pairedTitle: (isFrom ? relationship.toTitle : relationship.fromTitle) ?? '' }
        : {}),
      farHoldsOne: isFrom ? relationship.toSingle : relationship.fromSingle,
    });
  }
  return blocks;
}
