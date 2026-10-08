// How an object's attributes and members reach the field set (spec 0005,
// value sourcing): one `toFieldAttribute()` for every column and form field,
// and members as the actor displays an Owner cell draws. Plain and small, so
// it sits in the first load with the rest of the layer's surface.
import type { ActorDisplay, AttributeDefinition, AttributeType, MemberSummary } from '@crm/contracts';

/** The types this loop shows but never edits: a record reference (a company) and a member (Owner). */
const READ_ONLY_IN_THIS_LOOP: readonly AttributeType[] = ['record_reference', 'actor_reference'];

/**
 * An attribute as the field set reads it: structurally the library's
 * `FieldAttribute`, which a screen passes straight to the grid and the editors.
 */
export interface FieldAttributeShape {
  readonly id: string;
  readonly name: string;
  readonly type: AttributeType;
  readonly allowMultiple: boolean;
  readonly isRequired: boolean;
  readonly isUnique: boolean;
  readonly isReadOnly: boolean;
  readonly readOnlyReason?: string;
  readonly cardinality?: 'one' | 'many';
  readonly defaultCurrency?: string;
}

/**
 * Whether people can edit this attribute's values in this loop: not a system
 * attribute, a reference or a member, and not one the server says they may
 * only read (spec 0009, AC-142).
 */
export const isEditableHere = (definition: Pick<AttributeDefinition, 'type' | 'isSystem' | 'readOnly'>): boolean =>
  !definition.isSystem && definition.readOnly === undefined && !READ_ONLY_IN_THIS_LOOP.includes(definition.type);

/**
 * An attribute definition as the field set's attribute: title to name,
 * `isMulti` to `allowMultiple`, a currency's default from its config, and
 * read only for references and members in this loop, with `readOnlyReason`
 * (the screen's words) as the reason. A system attribute is read only with
 * the field set's own reason ("Set by the system"). An attribute the server
 * says the person may only read (`readOnly`, spec 0009, AC-142) is read only
 * with the server's reason, which wins over the screen's: the cell shows it
 * in the library's read only state. The server still checks every write.
 */
export function toFieldAttribute(definition: AttributeDefinition, readOnlyReason?: string): FieldAttributeShape {
  const isReference = READ_ONLY_IN_THIS_LOOP.includes(definition.type);
  const currency = definition.config.defaultCurrency;
  const ruled = definition.isSystem ? undefined : definition.readOnly?.reason;
  const reason = ruled ?? (isReference && !definition.isSystem ? readOnlyReason : undefined);
  return {
    id: definition.id,
    name: definition.title,
    type: definition.type,
    allowMultiple: definition.isMulti,
    isRequired: definition.isRequired,
    isUnique: definition.isUnique,
    isReadOnly: definition.isSystem || isReference || ruled !== undefined,
    ...(reason === undefined ? {} : { readOnlyReason: reason }),
    ...(definition.type === 'record_reference' ? { cardinality: definition.isMulti ? 'many' : 'one' } : {}),
    ...(typeof currency === 'string' ? { defaultCurrency: currency } : {}),
  };
}

/** A workspace's members as the actor displays an Owner cell and the member picker draw (`members.list`). */
export function toActorDisplays(members: readonly MemberSummary[]): readonly ActorDisplay[] {
  return members.map((member) => ({ type: 'member', id: member.id, name: member.name, email: member.email }));
}
