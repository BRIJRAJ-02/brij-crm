// The merge pair's plain rules (spec 0049, AC-4910): which record is kept by default, and a picked reference.

/**
 * The pair as the dialog opens it: the newer record (the greater uuid v7, so the later made) merged away and the
 * older kept, unless `swapped`. Two ids in either order give the same pair.
 */
export function keptFirst(
  a: string,
  b: string,
  swapped: boolean,
): { readonly keepId: string; readonly mergeId: string } {
  const [older, newer] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return swapped ? { keepId: newer, mergeId: older } : { keepId: older, mergeId: newer };
}

/** The record a reference value names (one ref, or the first of a list), or undefined. */
export function refOf(value: unknown): { readonly objectId: string; readonly recordId: string } | undefined {
  const item: unknown = Array.isArray(value) ? (value as readonly unknown[])[0] : value;
  if (typeof item !== 'object' || item === null || !('objectId' in item) || !('recordId' in item)) return undefined;
  const { objectId, recordId } = item;
  return typeof objectId === 'string' && typeof recordId === 'string' ? { objectId, recordId } : undefined;
}
