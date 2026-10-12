// "Create option" from a cell (spec 0012, AC-238): a select, multi select or
// status value in one record's write may name `{ newOption: { id, label } }`.
// The option is made (or a live one with that label reused) and set in the
// record write's own transaction, so both happen or neither. It is the one
// definition write a record write holds, and it needs `schema.manage` like
// every other (spec 0009, AC-136).
import { isUuidV7 } from './ids.ts';
import { insertOptionOf, liveOptionLabelled, lockOptionParent } from './options.ts';
import { refuse } from './refusals.ts';
import type { ValueInput } from './records.ts';
import { isArchivedNow, type AttributeDef } from './values.ts';
import type { WriteContext } from './write.ts';
import { requirePermission } from '../access/check.ts';
import { isOpen } from '../access/policy.ts';
import { attributeLevel } from '../access/visibility.ts';

/** A new option a cell names: the id the browser minted (UUID v7) and the label typed. */
interface NewOption {
  readonly id: string;
  readonly label: string;
}

/** Whether a value item is `{ newOption: … }` (well formed or not: a malformed one is refused, never stored). */
function isNewOptionItem(item: unknown): item is { readonly newOption: unknown } {
  return typeof item === 'object' && item !== null && !Array.isArray(item) && Object.hasOwn(item, 'newOption');
}

/** Whether a value names a new option, as itself or as one item of a multi select's list. */
function namesNewOption(value: unknown): boolean {
  return isNewOptionItem(value) || (Array.isArray(value) && value.some(isNewOptionItem));
}

/** The new option an item names, or `ATTRIBUTE_VALUE_INVALID` naming the attribute. */
function newOptionOf(attribute: AttributeDef, item: { readonly newOption: unknown }): NewOption {
  const option = item.newOption;
  const fields = typeof option === 'object' && option !== null ? (option as Readonly<Record<string, unknown>>) : {};
  const { id, label } = fields;
  if (typeof id !== 'string' || !isUuidV7(id)) {
    throw refuse('ATTRIBUTE_VALUE_INVALID', 'A new option needs a UUID v7 id.', attribute.id);
  }
  if (typeof label !== 'string' || label.trim() === '' || label.trim().length > 100) {
    throw refuse(
      'ATTRIBUTE_VALUE_INVALID',
      `Give the new ${attribute.title} option a label of 1 to 100 characters.`,
      attribute.id,
    );
  }
  return { id: id.toLowerCase(), label: label.trim() };
}

/**
 * The id a new option resolves to, under the attribute row's lock: a live
 * option whose label matches ignoring case (one made meanwhile is set, and
 * none is made), else the new option itself, made with the next hue (a status
 * stage open) after the room check (AC-237). A replay finds its own option.
 */
async function resolveOne(context: WriteContext, attribute: AttributeDef, option: NewOption): Promise<string> {
  await lockOptionParent(context.tx, attribute.id);
  const existing = await liveOptionLabelled(context.tx, attribute.id, option.label);
  if (existing !== undefined) return existing;
  const made = await insertOptionOf(context, attribute, { id: option.id, label: option.label });
  return made.optionId;
}

/**
 * The values of one record's write with every `{ newOption }` in a select,
 * multi select or status value replaced by the id of the option it resolves
 * to. Any `newOption` needs `schema.manage` (403 `FORBIDDEN`, nothing
 * written). A value whose attribute is unknown, hidden, read only, archived
 * or of another type is left as it is, for the parser to refuse as it would
 * any value it can't take.
 */
export async function resolveNewOptions(
  context: WriteContext,
  attributes: ReadonlyMap<string, AttributeDef>,
  values: Readonly<Record<string, ValueInput>>,
): Promise<Record<string, ValueInput>> {
  const entries = Object.entries(values);
  if (!entries.some(([, input]) => namesNewOption(input.value))) return values;
  // Asked for at all: a member's request is refused whole, whatever the cell showed.
  requirePermission(context.scope, 'schema.manage');
  const resolved = Object.create(null) as Record<string, ValueInput>;
  // In attribute id order, so two writes making options on the same attributes lock them in the same order.
  for (const [attributeId, input] of entries.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    resolved[attributeId] = input;
    const attribute = attributes.get(attributeId);
    if (attribute === undefined || !namesNewOption(input.value)) continue;
    const takesOptions = attribute.type === 'select' || attribute.type === 'status';
    const writable = isOpen(context.scope.access) || attributeLevel(context.scope.access, attribute) === 'write';
    if (!takesOptions || attribute.isSystem || isArchivedNow(attribute) || !writable) continue;
    if (Array.isArray(input.value)) {
      // A list only for a multi select; anything else stays for the parser to refuse.
      if (!attribute.isMulti) continue;
      if ((input.value as readonly unknown[]).filter(isNewOptionItem).length > 1) {
        throw refuse('ATTRIBUTE_VALUE_INVALID', `Create one new ${attribute.title} option at a time.`, attribute.id);
      }
      const items: unknown[] = [];
      for (const item of input.value as readonly unknown[]) {
        items.push(isNewOptionItem(item) ? await resolveOne(context, attribute, newOptionOf(attribute, item)) : item);
      }
      // A new option that resolves to one already in the list (its label reused) is held once.
      resolved[attributeId] = { ...input, value: [...new Set(items)] };
      continue;
    }
    if (isNewOptionItem(input.value)) {
      const id = await resolveOne(context, attribute, newOptionOf(attribute, input.value));
      // A multi select holds a list: one new option alone is a list of one.
      resolved[attributeId] = { ...input, value: attribute.isMulti ? [id] : id };
    }
  }
  return resolved;
}
