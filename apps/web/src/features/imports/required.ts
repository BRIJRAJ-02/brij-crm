// The required attributes an import that makes records leaves empty (spec
// 0040, 27 October 2026): no column fills them and they can't fill
// themselves, so every new row would be refused. The columns step names each
// one with a way to match a column, as a quiet row until Continue is pressed
// (then as an error), rather than the server refusing at Start. Pure; the engine's own check
// (`isUnfillableRequired`, by a member) still refuses one this misses.
import type { AttributeDefinition, ImportTarget } from '@crm/data';

/** Whether a record made by a member with no value for `attribute` would be refused. */
export function isUnfilledRequired(attribute: AttributeDefinition): boolean {
  if (!attribute.isRequired || attribute.isSystem || attribute.isArchived || attribute.type === 'checkbox')
    return false;
  // Any default fills it for a member, Current user too.
  return attribute.defaultValue === undefined;
}

/** The required attributes no column is matched to (a name part counts for its name), in the object's order. */
export function unmatchedRequired(
  attributes: readonly AttributeDefinition[],
  targets: readonly (ImportTarget | undefined)[],
): readonly AttributeDefinition[] {
  const matched = new Set(targets.flatMap((target) => (target === undefined ? [] : [target.attributeId])));
  return [...attributes]
    .filter((attribute) => isUnfilledRequired(attribute) && !matched.has(attribute.id))
    .sort((a, b) => a.position - b.position);
}

/** Why Continue can't go on yet: no column has a field, or a required field has no column. */
export type ColumnsBlock = 'no-column' | 'required';

/**
 * What stops the columns step (the foolproof pass, 5 November 2026): checked only when Continue is pressed, so an
 * unfinished match never reads as an error. Updating only (nothing made) needs no required field.
 */
export function columnsBlock(
  matched: number,
  required: readonly AttributeDefinition[],
  isCreating: boolean,
): ColumnsBlock | undefined {
  if (matched === 0) return 'no-column';
  if (isCreating && required.length > 0) return 'required';
  return undefined;
}

/** How an unmatched required field's row reads: quiet until Continue was pressed with it unmatched. */
export function requiredTone(isTried: boolean): 'info' | 'danger' {
  return isTried ? 'danger' : 'info';
}
