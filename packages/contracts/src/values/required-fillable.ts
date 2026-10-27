// The one rule for "a required field nothing can fill" (the owner, 27 October
// 2026: an object with a required `status` and no default option failed every
// public form submission, after the visitor had typed the whole form in).
//
// A record created with nobody at the keyboard — a form submission, a booking
// page's answers, an import row, an API create — sends only the values it was
// given. The engine then fills each attribute's default and refuses the write
// for every required one still missing (`initialValues` in
// `packages/core/src/engine/records.ts`). So a required attribute with nothing
// to fill it is a wall every such create hits. This file says which attributes
// are that wall, in plain TypeScript with no Zod and no I/O, so the settings
// screen, the publish check, the booking page save and the import check all
// read the same rule.
import { AttributeDefault, defaultKindsFor } from './attribute-config.ts';
import type { AttributeType } from './attribute-values.ts';

/** What the rule needs of an attribute: exactly what the engine looks at when it fills a new record. */
export interface FillableAttribute {
  readonly type: AttributeType;
  readonly isRequired: boolean;
  readonly isSystem: boolean;
  /** The stored `AttributeDefault`, or null/undefined for none. */
  readonly defaultValue: unknown;
}

/**
 * Who the record is being created for. A `current_user` default fills itself
 * only for a member: a public form's visitor and a booking page's guest are
 * not one, so for them the attribute is as empty as if it had no default
 * (`defaultFor` answers undefined).
 */
export interface Filler {
  /** True when a member is behind the create (settings, an import, the API with a member token). */
  readonly byMember: boolean;
}

/** Nobody at the keyboard: a public form submission or a booking page's answers. */
export const ANONYMOUS: Filler = { byMember: false };

/** A member is behind the create: an import, or the API under a member's token. */
export const BY_MEMBER: Filler = { byMember: true };

/**
 * Whether a record created without this attribute being given would be
 * refused for it: required, not filled by the system, and nothing else fills
 * it. A checkbox is false until ticked, so it is never missing. A select's or
 * status attribute's static default survives its option being archived (the
 * engine falls back to the first live option), so only the absence of a
 * default counts here.
 */
export function isUnfillableRequired(attribute: FillableAttribute, filler: Filler): boolean {
  if (!attribute.isRequired || attribute.isSystem || attribute.type === 'checkbox') return false;
  const parsed = AttributeDefault.safeParse(attribute.defaultValue);
  if (!parsed.success) return true;
  // A default of a kind the type no longer allows gives nothing, exactly as the engine reads it.
  if (!defaultKindsFor(attribute.type).includes(parsed.data.kind)) return true;
  return parsed.data.kind === 'current_user' && !filler.byMember;
}

/** The types whose Required setting settings may turn on only with a default: their options are the default. */
export const OPTION_DEFAULT_TYPES: readonly AttributeType[] = ['select', 'status'];

/**
 * Why a select or status attribute can't be made required yet: it has no
 * options, so there is no value to fall back on and every create with nobody
 * at the keyboard would fail. Refused on `isRequired`, so settings points at
 * the switch the writer just flicked.
 */
export const REQUIRED_NEEDS_AN_OPTION =
  'Add at least one option before you make this required. A required field with no default stops every form, booking page and import from creating a record.';

/** How a required field nothing fills is described to someone who may not see it (never its name). */
export const A_FIELD_YOU_CANT_SEE = 'a field you can’t see';
