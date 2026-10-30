// Pure helpers every field type shares: lists, parsing an editor's candidate
// value with its schema before it may leave (AC-5), and text refusals.
import { parseAttributeValue, type AttributeType } from '@crm/contracts/values';
import { splitPasted } from '../lib/parse-input.ts';
import { strings } from './strings.ts';
import type { FieldAttribute, FieldValue, Surface, TextRefusal } from './types.ts';

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
    return attribute.isRequired && attribute.isRequiredOnSubmit !== true
      ? { ok: false, message: strings.required(attribute.name) }
      : { ok: true, value: null };
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

/**
 * Splits pasted text for a list attribute (`splitPasted`): commas, semicolons,
 * tabs or line breaks, never inside a quoted name or angle brackets, and
 * spaces too with `onSpaces` (emails, domains, links never hold one).
 */
export function splitList(text: string, options: { readonly onSpaces?: boolean } = {}): readonly string[] {
  return splitPasted(text, options);
}

/** The list types whose values never hold a space, so a pasted "a.com b.com" is two. */
export function splitsOnSpaces(type: AttributeType): boolean {
  return type === 'email' || type === 'domain' || type === 'url';
}

/** Runs `fromText` for one value over each part of a list, refusing the whole list when one part is refused. */
export function listFromText<V>(
  text: string,
  one: (part: string) => V | TextRefusal,
  options: { readonly onSpaces?: boolean } = {},
): readonly V[] | TextRefusal {
  const values: V[] = [];
  for (const part of splitList(text, options)) {
    const value = one(part);
    if (isRefusal(value)) return value;
    values.push(value);
  }
  return values;
}

/**
 * Whether an editor on `surface` is compact: small, its label hidden. A cell,
 * a filter value and a record panel row each show the attribute's name beside
 * the value already.
 */
export function isCompactSurface(surface: Surface): boolean {
  return surface === 'cell' || surface === 'filter' || surface === 'panel';
}

/**
 * Whether a typed editor keeps Esc for itself (it puts the draft back). On a
 * form (a create or edit dialog) Esc belongs to the dialog and closes it, as
 * it does from every other field there, unless the caller asked for its own
 * cancel. Everywhere else (a cell, a panel row, a filter) Esc cancels the edit.
 */
export function escapesHere(surface: Surface, onCancel: (() => void) | undefined): boolean {
  return surface !== 'form' || onCancel !== undefined;
}

/**
 * Whether a display's chips are flat on `surface`: on a card (a board card, a
 * line of the timeline) a link is its text alone and a record's or member's
 * chip is grey with no edge, so values sit in the line like the words around
 * them. Decided here once for every chip display.
 */
export function isFlatSurface(surface: Surface): boolean {
  return surface === 'card';
}

/**
 * Whether a member shows plain on `surface`: on a record's panel an owner or
 * assignee is the avatar and the name as text, like the values around it. A
 * record stays a framed chip there, since it opens its own page; a member is
 * not a link.
 */
export function isPlainActorSurface(surface: Surface): boolean {
  return surface === 'panel';
}
