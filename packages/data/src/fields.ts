// How an object's attributes and members reach the field set (spec 0005,
// value sourcing): one `toFieldAttribute()` for every column and form field,
// and members as the actor displays an Owner cell draws. Plain and small, so
// it sits in the first load with the rest of the layer's surface.
import type { ActorDisplay, AttributeDefinition, AttributeType, Hue, MemberSummary } from '@crm/contracts';

/** The types a create form leaves out for now: record references (linked from the table or the record page). */
const NOT_IN_FORMS: readonly AttributeType[] = ['record_reference'];

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
  /** Its API name, from which a standard attribute takes its own icon (a time zone's globe). */
  readonly apiSlug?: string;
  /** The object it belongs to, by standard key or API name ("companies"): a LinkedIn handle on a company is its company page. */
  readonly objectKey?: string;
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
 * Whether a create form (and a bulk edit) edits this attribute's values: not
 * a system attribute or a record reference, and not one the server says they
 * may only read (spec 0009, AC-142). A member (Owner) edits through the
 * member picker, "Me" first.
 */
export const isEditableHere = (definition: Pick<AttributeDefinition, 'type' | 'isSystem' | 'readOnly'>): boolean =>
  !definition.isSystem && definition.readOnly === undefined && !NOT_IN_FORMS.includes(definition.type);

/**
 * An attribute definition as the field set's attribute: title to name,
 * `isMulti` to `allowMultiple`, a currency's default and a number's percent
 * display from its config, and
 * the options of a select or status attribute (archived ones marked), and
 * read only for a record reference that can't link (one way, or its far
 * object hidden), with `readOnlyReason` (the screen's words) as the reason.
 * A member (Owner) edits through the member picker like any other value. A system attribute is read only with
 * the field set's own reason ("Set by the system"). An attribute the server
 * says the person may only read (`readOnly`, spec 0009, AC-142) is read only
 * with the server's reason, which wins over the screen's: the cell shows it
 * in the library's read only state. The server still checks every write.
 * `objectKey` (the object's standard key, else its API name) tells a
 * network's editor a company from a person.
 */
export function toFieldAttribute(
  definition: AttributeDefinition,
  readOnlyReason?: string,
  objectKey?: string,
): FieldAttributeShape {
  // A record reference edits through its picker (spec 0014) unless it can't link; a member through the member picker.
  const isReference = isUnlinkable(definition);
  const currency = definition.config.defaultCurrency;
  const ruled = definition.isSystem ? undefined : definition.readOnly?.reason;
  const reason = ruled ?? (isReference && !definition.isSystem ? readOnlyReason : undefined);
  return {
    id: definition.id,
    name: definition.title,
    apiSlug: definition.apiSlug,
    ...(objectKey === undefined || objectKey === '' ? {} : { objectKey }),
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

/**
 * The members a member picker offers for what was typed (spec 0003, Actor
 * reference: a Menu of members, "Me" first): those whose name or email holds
 * it, ignoring case and the spaces around it, in the workspace's order. `meId`
 * is left out, since the picker pins Me above the results already and one
 * member twice in one menu would share a key.
 */
export function searchMembers(members: readonly ActorDisplay[], query: string, meId?: string): readonly ActorDisplay[] {
  const wanted = query.trim().toLocaleLowerCase();
  return members.filter(
    (member) =>
      member.id !== meId &&
      (wanted === '' ||
        member.name.toLocaleLowerCase().includes(wanted) ||
        (member.email?.toLocaleLowerCase().includes(wanted) ?? false)),
  );
}
