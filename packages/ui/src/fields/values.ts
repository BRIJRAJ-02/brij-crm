// Pure helpers every field type shares: lists, parsing an editor's candidate
// value with its schema before it may leave (AC-5), and text refusals.
import { parseAttributeValue, type AttributeType } from '@crm/contracts/values';
import { strings } from './strings.ts';
import type { FieldAttribute, FieldValue, TextRefusal } from './types.ts';

/** A value or a list of them as a list; `null` as an empty list. */
export function asList<V>(value: V | readonly V[] | null | undefined): readonly V[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? (value as readonly V[]) : [value as V];
}

/** True for a value no one has set: `null`, or an empty list. */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/** What an editor may commit: the parsed value, or the sentence its Field shows. */
export type Committable<T extends AttributeType> =
  { readonly ok: true; readonly value: FieldValue<T> | null } | { readonly ok: false; readonly message: string };

/**
 * Checks an editor's candidate before it leaves: empty becomes `null` (or a
 * "required" error), anything else must parse with the attribute's schema.
 * An editor commits only what this lets through, so what it emits always
 * parses (AC-5).
 */
export function toCommittable<T extends AttributeType>(attribute: FieldAttribute, candidate: unknown): Committable<T> {
  const empty = isEmptyValue(candidate) || candidate === '';
  if (empty && attribute.type !== 'checkbox') {
    return attribute.isRequired ? { ok: false, message: strings.required(attribute.name) } : { ok: true, value: null };
  }
  const parsed = parseAttributeValue(attribute.type, candidate, { allowMultiple: attribute.allowMultiple });
  return parsed.ok ? { ok: true, value: parsed.value as FieldValue<T> } : { ok: false, message: parsed.error.message };
}

/** A text the type can't take, and why. */
export function refuse(reason: string): TextRefusal {
  return { code: 'TEXT_REFUSED', reason };
}

/** True when `fromText` refused. */
export function isRefusal(value: unknown): value is TextRefusal {
  return typeof value === 'object' && value !== null && (value as { code?: unknown }).code === 'TEXT_REFUSED';
}

/** Splits pasted text for a list attribute: commas, semicolons or line breaks. */
export function splitList(text: string): readonly string[] {
  return text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** Runs `fromText` for one value over each part of a list, refusing the whole list when one part is refused. */
export function listFromText<V>(text: string, one: (part: string) => V | TextRefusal): readonly V[] | TextRefusal {
  const values: V[] = [];
  for (const part of splitList(text)) {
    const value = one(part);
    if (isRefusal(value)) return value;
    values.push(value);
  }
  return values;
}
