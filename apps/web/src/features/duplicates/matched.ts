import type { AttributeDefinition } from '@crm/data';

/** What the rules read of an attribute. */
type Matchable = Pick<AttributeDefinition, 'id' | 'type' | 'apiSlug' | 'isPrimary' | 'isArchived'>;

/** How long after the last change a check is asked (AC-4904). */
export const DUPLICATE_CHECK_DELAY_MS = 300;

/**
 * The attributes a duplicate rule reads on this object (AC-4901): its name, its email and domain attributes, and on
 * People the Company. Only these go in a check, so editing anything else asks nothing.
 */
export function matchedAttributes<T extends Matchable>(
  attributes: readonly T[],
  standardKey: string | undefined,
): readonly T[] {
  return attributes.filter(
    (each) =>
      !each.isArchived &&
      (each.isPrimary ||
        (each.type === 'email' && standardKey !== 'companies') ||
        (each.type === 'domain' && standardKey !== 'people') ||
        (standardKey === 'people' && each.apiSlug === 'company' && each.type === 'record_reference')),
  );
}

/** The values a check sends, by attribute id: only the matched attributes', empty ones left out. */
export function matchedValues(
  attributes: readonly Matchable[],
  values: Readonly<Record<string, unknown>>,
  standardKey: string | undefined,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    matchedAttributes(attributes, standardKey).flatMap((each) => {
      const value = values[each.id];
      return value === undefined || value === null ? [] : [[each.id, value]];
    }),
  );
}
