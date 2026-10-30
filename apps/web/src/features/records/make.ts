// Making a record from a record picker (a person's Company, a company's
// People): whether the far object can be made from a name alone, and that
// name as its primary attribute's value. Plain, so it is tested in Node.
import type { AttributeDefinition, ObjectSummary } from '@crm/data';

/** A personal name's parts, as the field set's Personal name takes them. */
export interface NameParts {
  readonly firstName?: string;
  readonly lastName?: string;
}

/**
 * "Ada Lovelace" or "Lovelace, Ada" as a personal name, the way the name
 * field reads a pasted one: a comma puts the last name first; otherwise the
 * first word is the first name and the rest the last.
 */
export function splitName(label: string): NameParts | undefined {
  const text = label.trim();
  if (text === '') return undefined;
  const comma = text.indexOf(',');
  const [first, last] =
    comma === -1
      ? [text.split(/\s+/)[0] ?? '', text.split(/\s+/).slice(1).join(' ')]
      : [text.slice(comma + 1).trim(), text.slice(0, comma).trim()];
  return {
    ...(first === '' ? {} : { firstName: first }),
    ...(last === '' ? {} : { lastName: last }),
  };
}

/** The typed name as the far object's primary attribute takes it, or nothing when a name can't fill it. */
export function nameValueOf(primary: AttributeDefinition | undefined, label: string): unknown {
  const text = label.trim();
  if (primary === undefined || text === '') return undefined;
  if (primary.type === 'text') return text;
  if (primary.type === 'personal_name') return splitName(text);
  return undefined;
}

/** How a picker may make a record of its far object: from the typed name, or only through the full form. */
export type MakeMode = 'name' | 'form';

/**
 * Whether the person may make records of `object` here, and how (owner flow
 * pass, 30 Oct 2026): not at all without write access or on an archived
 * object; through the full form when the primary attribute isn't a name or a
 * required attribute has no default to fill it; otherwise from the name alone.
 */
export function makeModeOf(object: ObjectSummary, attributes: readonly AttributeDefinition[]): MakeMode | undefined {
  if (object.access !== 'write' || object.isArchived) return undefined;
  const primary = attributes.find((attribute) => attribute.id === object.primaryAttributeId);
  if (primary === undefined || (primary.type !== 'text' && primary.type !== 'personal_name')) return 'form';
  const asksMore = attributes.some(
    (attribute) =>
      attribute.isRequired &&
      !attribute.isSystem &&
      !attribute.isArchived &&
      attribute.id !== primary.id &&
      attribute.type !== 'checkbox' &&
      attribute.defaultValue === undefined,
  );
  return asksMore ? 'form' : 'name';
}
