// FieldAttribute fixtures for field stories and tests. Stories only.
import type { AttributeType } from '@crm/contracts/values';
import type { FieldAttribute } from '../fields/types.ts';

/** A FieldAttribute of `type` named `name`, with the overrides given. */
export function attributeOf(
  type: AttributeType,
  name: string,
  overrides: Partial<FieldAttribute> = {},
): FieldAttribute {
  return {
    id: name.toLowerCase().replaceAll(/\W+/g, '_'),
    name,
    type,
    allowMultiple: false,
    isRequired: false,
    isUnique: false,
    isReadOnly: false,
    ...overrides,
  };
}
