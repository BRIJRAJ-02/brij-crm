// Working out one computed attribute for a batch of records (spec 0015): the
// one function the jobs, the preview and the definition checks share. It reads
// the definition as it is now and answers how its values come out.
import type { ComputedDefinition, LookupDefinition, RollupDefinition } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { computedKindOf, isArchivedNow, loadAttribute, loadAttributes, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { formulaOf, formulaValues, refreshFormulas } from './formulas.ts';
import { loadVia, lookupValues, rollupValues } from './statements.ts';
import { writeComputedBatch, type ComputedTarget, type NextItems } from './write.ts';

/** How to work out values for some records, once the definition's parts are read. */
export type Computer = (tx: WorkspaceTx, ownerIds: readonly string[]) => Promise<NextItems>;

/**
 * The computer of a stored lookup or rollup, or undefined when a part of it is
 * gone (its side or attribute archived, or no longer what it was): the caller
 * then does nothing, and `checkComputed` marks it as not updating.
 */
export async function computerOf(
  tx: WorkspaceTx,
  attribute: ComputedTarget,
  definition: LookupDefinition | RollupDefinition,
  /** The preview: a lookup keeps the related attribute's own options, having no mirrors yet. */
  isPreview = false,
): Promise<Computer | undefined> {
  const viaAttribute = await loadAttribute(tx, definition.via).catch(() => undefined);
  if (viaAttribute === undefined || isArchivedNow(viaAttribute)) return undefined;
  const via = await loadVia(tx, viaAttribute, attribute.objectId);
  if (via === undefined) return undefined;
  const target =
    definition.target === undefined ? undefined : await loadAttribute(tx, definition.target).catch(() => undefined);
  if (definition.target !== undefined && (target === undefined || target.objectId !== via.farObjectId)) {
    return undefined;
  }
  if (definition.kind === 'lookup') {
    if (target === undefined) return undefined;
    return (inTx, ownerIds) => lookupValues(inTx, attribute, definition, via, target, ownerIds, isPreview);
  }
  return (inTx, ownerIds) => rollupValues(inTx, definition, via, target, ownerIds);
}

/** The stored definition of a computed attribute (parsed when it was written). */
export function storedDefinition(attribute: AttributeDef): ComputedDefinition | undefined {
  return computedKindOf(attribute) === undefined ? undefined : (attribute.computed as ComputedDefinition);
}

/**
 * Rewrites one computed attribute's values for some records, then the same
 * record formulas that read it (AC-326's chains on one record). Answers the
 * records whose value changed. A broken or archived attribute writes nothing.
 */
export async function recomputeRecords(
  context: WriteContext,
  attributeId: string,
  ownerIds: readonly string[],
): Promise<readonly string[]> {
  const { tx } = context;
  const attribute = await loadAttribute(tx, attributeId).catch(() => undefined);
  if (attribute?.objectId === null || attribute === undefined) return [];
  if (attribute.computedState === 'broken' || isArchivedNow(attribute)) return [];
  const target: ComputedTarget = { ...attribute, objectId: attribute.objectId };
  const definition = storedDefinition(attribute);
  if (definition === undefined) return [];
  const attributes = await loadAttributes(tx, attribute.objectId);
  let changed: readonly string[];
  if (definition.kind === 'formula') {
    const formula = formulaOf(attribute);
    if (formula === undefined) return [];
    changed = await writeComputedBatch(context, target, ownerIds, (live) =>
      formulaValues(tx, formula, attributes, live),
    );
  } else {
    const computer = await computerOf(tx, target, definition);
    if (computer === undefined) return [];
    changed = await writeComputedBatch(context, target, ownerIds, (live) => computer(tx, live));
  }
  await refreshFormulas(context, attributes, [attribute.id], changed);
  return changed;
}
