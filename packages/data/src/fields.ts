// How an object's attributes and members reach the field set (spec 0005,
// value sourcing): one `toFieldAttribute()` for every column and form field,
// and members as the actor displays an Owner cell draws. Plain and small, so
// it sits in the first load with the rest of the layer's surface.
import type { ActorDisplay, AttributeDefinition, AttributeType, Hue, MemberSummary } from '@crm/contracts';

/** A member (Owner) shows but is never edited in this loop. */
const READ_ONLY_IN_THIS_LOOP: readonly AttributeType[] = ['actor_reference'];

/** The types a create form leaves out for now: members, and record references (linked from the table). */
const NOT_IN_FORMS: readonly AttributeType[] = ['record_reference', 'actor_reference'];

/**
 * Whether a record reference can't be linked from here (spec 0014): one way
 * references, and a side whose far object the person can't see (it lists no
 * target), show but never edit.
 */
const isUnlinkable = (definition: Pick<AttributeDefinition, 'type' | 'relationship'>): boolean =>
  definition.type === 'record_reference' &&
  (definition.relationship === undefined || definition.relationship.targetObjectIds.length === 0);

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
  /** A number shown as a percent (its Display setting, spec 0012). */
  readonly isPercent?: boolean;
  /** A select's options or a status attribute's stages, in order, archived ones marked (spec 0012). */
  readonly options?: readonly {
    readonly id: string;
    readonly label: string;
    readonly hue: Hue;
    readonly archived: boolean;
  }[];
}

/**
 * Whether a create form edits this attribute's values in this loop: not a
 * system attribute, a reference or a member, and not one the server says
 * they may only read (spec 0009, AC-142).
 */
export const isEditableHere = (definition: Pick<AttributeDefinition, 'type' | 'isSystem' | 'readOnly'>): boolean =>
  !definition.isSystem && definition.readOnly === undefined && !NOT_IN_FORMS.includes(definition.type);

/**
 * An attribute definition as the field set's attribute: title to name,
 * `isMulti` to `allowMultiple`, a currency's default and a number's percent
 * display from its config, and
 * the options of a select or status attribute (archived ones marked), and
 * read only for members in this loop and for a record reference that can't
 * link (one way, or its far object hidden), with `readOnlyReason` (the
 * screen's words) as the reason. A system attribute is read only with
 * the field set's own reason ("Set by the system"). An attribute the server
 * says the person may only read (`readOnly`, spec 0009, AC-142) is read only
 * with the server's reason, which wins over the screen's: the cell shows it
 * in the library's read only state. The server still checks every write.
 */
export function toFieldAttribute(definition: AttributeDefinition, readOnlyReason?: string): FieldAttributeShape {
  // Members stay read only here; a record reference edits through its picker (spec 0014) unless it can't link.
  const isReference = READ_ONLY_IN_THIS_LOOP.includes(definition.type) || isUnlinkable(definition);
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
    ...(definition.type === 'number' && definition.config.display === 'percent' ? { isPercent: true } : {}),
    // Options inline (spec 0006, AC-59; spec 0012), so a select or status cell never fetches.
    ...(definition.options === undefined
      ? {}
      : {
          options: definition.options.map((option) => ({
            id: option.id,
            label: option.label,
            hue: option.hue,
            archived: option.isArchived,
          })),
        }),
  };
}

/** A workspace's members as the actor displays an Owner cell and the member picker draw (`members.list`). */
export function toActorDisplays(members: readonly MemberSummary[]): readonly ActorDisplay[] {
  return members.map((member) => ({ type: 'member', id: member.id, name: member.name, email: member.email }));
}
