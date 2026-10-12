// The browser's half of validation rules (spec 0013, AC-257): an object's
// rules as the definitions store holds them, and the check the records layer
// runs before it sends a create or an edit, with the very `checkRules` the
// server runs. A rule whose inputs the browser doesn't hold is left to the
// server, which checks every rule anyway.
import type { AttributeDefinition } from '@crm/contracts';
import {
  checkRules,
  touchesRule,
  type PatternCompiler,
  type RuleAttribute,
  type RuleFailure,
  type ValidationRule,
} from '@crm/contracts/validation';

/** An attribute as the browser's check needs it: the checker's view, and whether a create fills it by default. */
export interface CheckedAttribute extends RuleAttribute {
  readonly isSystem: boolean;
  readonly hasDefault: boolean;
}

/** One object's rules, from its cached attribute definitions. */
export interface ObjectRules {
  readonly rules: readonly ValidationRule[];
  readonly attributes: ReadonlyMap<string, CheckedAttribute>;
}

/** An object with no rules: nothing to check. */
export const NO_OBJECT_RULES: ObjectRules = { rules: [], attributes: new Map() };

/** An object's rules from its live attribute definitions (the ones the reader may see, with their rules inline). */
export function objectRulesOf(definitions: readonly AttributeDefinition[]): ObjectRules {
  const rules = definitions.flatMap((definition) =>
    (definition.validation?.rules ?? []).map((rule): ValidationRule => ({
      id: rule.id,
      attributeId: definition.id,
      kind: rule.kind,
      params: rule.params,
      ...(rule.condition === undefined ? {} : { condition: rule.condition }),
      ...(rule.message === undefined ? {} : { message: rule.message }),
      position: rule.position,
    })),
  );
  if (rules.length === 0) return NO_OBJECT_RULES;
  return {
    rules,
    attributes: new Map(
      definitions.map((definition) => [
        definition.id,
        {
          type: definition.type,
          isMulti: definition.isMulti,
          title: definition.title,
          position: definition.position,
          // Listed, so the reader may see it; a hidden attribute and the rules naming it never reach the browser.
          visible: true,
          archived: definition.isArchived,
          isSystem: definition.isSystem,
          hasDefault: definition.defaultValue !== undefined,
          ...(definition.options === undefined
            ? {}
            : { options: definition.options.map((option) => ({ id: option.id, label: option.label })) }),
        },
      ]),
    ),
  };
}

/** One write as the browser checks it. */
export interface BrowserCheck {
  readonly rules: ObjectRules;
  /** What the record will hold: what the screen shows, with the write's values over it. A create's are what was given. */
  readonly values: Readonly<Record<string, unknown>>;
  /** The attributes the write sets; on a create, every one. */
  readonly written: ReadonlySet<string>;
  readonly isCreate: boolean;
  readonly now: string;
  readonly timeZone: string;
  /** RE2 (`re2js`), once loaded; a stand in that passes everything when no touched rule needs a pattern. */
  readonly pattern: PatternCompiler;
}

/** The rules a write touches: on a create, all of them. */
export function touchedRules(
  rules: ObjectRules,
  written: ReadonlySet<string>,
  isCreate: boolean,
): readonly ValidationRule[] {
  return isCreate ? rules.rules : rules.rules.filter((rule) => touchesRule(rule, written));
}

/** Whether a touched rule is a pattern, so the check must wait for `re2js`. */
export function needsPattern(rules: readonly ValidationRule[]): boolean {
  return rules.some((rule) => rule.kind === 'pattern');
}

/** A pattern stand in for checks that run no pattern rule. */
export const NO_PATTERN: PatternCompiler = () => ({ test: () => true });

/**
 * The rules a write breaks, as the server would word them (spec 0013,
 * AC-257). On a create, an attribute it doesn't give is empty unless its
 * default fills it (then unknown, so its rules are left to the server).
 */
export function checkInBrowser(input: BrowserCheck): readonly RuleFailure[] {
  const touched = touchedRules(input.rules, input.written, input.isCreate);
  if (touched.length === 0) return [];
  const values: Record<string, unknown> = {};
  if (input.isCreate) {
    for (const [id, attribute] of input.rules.attributes) {
      if (attribute.isSystem || attribute.archived || attribute.hasDefault) continue;
      values[id] = attribute.type === 'checkbox' ? false : null;
    }
  }
  Object.assign(values, input.values);
  const written = input.isCreate
    ? new Set(
        [...input.rules.attributes]
          .filter(([, attribute]) => !attribute.isSystem && !attribute.archived)
          .map(([id]) => id),
      )
    : input.written;
  // A rule whose inputs aren't all held here is the server's: `checkRules` leaves it alone.
  return checkRules({
    rules: touched,
    attributes: input.rules.attributes,
    values,
    written,
    clock: { now: input.now, timeZone: input.timeZone, weekStart: 'monday' },
    pattern: input.pattern,
  });
}
