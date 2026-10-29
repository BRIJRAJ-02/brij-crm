// Which objects a booking page can save its answers to, as plain functions: a booking knows the person by the email
// they typed alone, so the object needs a field that finds their record by it.
import type { AttributeDefinition } from '@crm/data';

/**
 * True when a booking can find or make the person's record on an object with these attributes: a unique email
 * that is neither a system field nor archived, the server's own test (`visitorMatchOf` in core's booking questions).
 */
export function canMatchVisitor(attributes: readonly AttributeDefinition[]): boolean {
  return attributes.some(
    (attribute) => attribute.type === 'email' && attribute.isUnique && !attribute.isSystem && !attribute.isArchived,
  );
}
