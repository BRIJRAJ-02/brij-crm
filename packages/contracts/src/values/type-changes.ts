// The type changes an attribute may take in place, the safe subset (the field types pass, 31 October 2026;
// spec 0013's full ledger and jobs come later): which picker keys each type may become, and what each target is.
// Plain TypeScript with no Zod, so the browser's first load can say whether a field offers "Change type"; the
// value converters, which parse with the schemas, live in `convert.ts`.

/** A picker key a type change may reach. */
export type TypeChangeKey = 'text' | 'long_text' | 'multi_select' | 'number' | 'currency' | 'email' | 'link' | 'phone';

/**
 * The picker keys (`PICKER_TYPES`) each type may change to, by the picker key it is now. Only changes that keep
 * every value: text and long text both ways, a select to a multi select, a number and a currency both ways, and
 * text to an email, a link or a phone (offered always, applied only when every value parses).
 */
export const TYPE_CHANGES: Readonly<Record<string, readonly TypeChangeKey[]>> = {
  text: ['long_text', 'email', 'link', 'phone'],
  long_text: ['text'],
  select: ['multi_select'],
  number: ['currency'],
  currency: ['number'],
};

/** The most values one type change rewrites in a single write; past it the change waits for spec 0013's jobs. */
export const TYPE_CHANGE_MAX_VALUES = 10_000;

/** The attribute type and multiple setting behind each picker key a change can reach. */
export const TYPE_CHANGE_SPECS: Readonly<
  Record<
    string,
    {
      readonly type: 'text' | 'long_text' | 'select' | 'number' | 'currency' | 'email' | 'url' | 'phone';
      readonly isMulti: boolean;
    }
  >
> = {
  text: { type: 'text', isMulti: false },
  long_text: { type: 'long_text', isMulti: false },
  select: { type: 'select', isMulti: false },
  multi_select: { type: 'select', isMulti: true },
  number: { type: 'number', isMulti: false },
  currency: { type: 'currency', isMulti: false },
  email: { type: 'email', isMulti: false },
  link: { type: 'url', isMulti: false },
  phone: { type: 'phone', isMulti: false },
};

/** What a type change needs to know about the attribute it starts from. */
export interface TypeChangeSource {
  readonly type: string;
  readonly isMulti: boolean;
  readonly isSystem: boolean;
  readonly isPrimary: boolean;
  readonly isArchived?: boolean;
}

/** The picker key an attribute's type and multiple setting stand for (`multi_select`, `link`), or its type. */
export function typeKeyOf(attribute: { readonly type: string; readonly isMulti: boolean }): string {
  if (attribute.type === 'select') return attribute.isMulti ? 'multi_select' : 'select';
  if (attribute.type === 'url') return 'link';
  return attribute.type;
}

/**
 * The picker keys an attribute may change to, in the table's order: none for a system attribute, the name records
 * go by, an archived one, or a type with no safe change (a date, a relationship).
 */
export function typeChangeTargets(attribute: TypeChangeSource): readonly TypeChangeKey[] {
  if (attribute.isSystem || attribute.isPrimary || attribute.isArchived === true) return [];
  return TYPE_CHANGES[typeKeyOf(attribute)] ?? [];
}

/** Whether `from` may change to `to` (both picker keys). */
export function isTypeChange(from: string, to: string): boolean {
  return (TYPE_CHANGES[from] ?? []).some((target) => target === to);
}
