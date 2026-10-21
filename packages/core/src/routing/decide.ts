// Deciding a route (spec 0043, AC-1601, AC-1602): the rules in order, the
// first whose conditions hold over the facts deciding; none means the
// surface's own fallback. Pure: the facts come in, a decision comes out, so a
// form's submit, a team page's booking and the tests run the same steps.
import { isRecordFact, matchesShowWhen, type Facts, type Route, type RoutingRule } from '@crm/contracts';

/** What one decision answers: the rule (absent: the fallback), its route and tag, and the rules skipped. */
export interface RouteDecision {
  readonly rule?: RoutingRule;
  readonly route?: Route;
  readonly qualified?: boolean;
  /** Rules passed over because a fact they read couldn't be read (AC-1602), by id. */
  readonly skipped: readonly string[];
}

/** What deciding reads besides the rules and facts. */
export interface DecideOptions {
  /** Fact keys that can't be read (a field archived, or one of another object): a rule reading one is skipped. */
  readonly unreadable?: ReadonlySet<string>;
  /** Only rules with these routes count (a form's or a team page's); any other is skipped as unusable. */
  readonly routes?: readonly Route['kind'][];
}

/** The first rule that holds, or the fallback (AC-1601). */
export function decideRoute(rules: readonly RoutingRule[], facts: Facts, options: DecideOptions = {}): RouteDecision {
  const skipped: string[] = [];
  for (const rule of rules) {
    const unusable = options.routes !== undefined && !options.routes.includes(rule.then.kind);
    const unreadable = rule.when.rules.some((condition) => options.unreadable?.has(condition.key) === true);
    if (unusable || unreadable) {
      skipped.push(rule.id);
      continue;
    }
    if (matchesShowWhen(rule.when, facts)) {
      return {
        rule,
        route: rule.then,
        ...(rule.qualified === undefined ? {} : { qualified: rule.qualified }),
        skipped,
      };
    }
  }
  return { skipped };
}

/** The record fields the rules read (`person.<id>`, `company.<id>`), each once. */
export function recordFactKeys(rules: readonly RoutingRule[]): readonly string[] {
  return [...new Set(rules.flatMap((rule) => rule.when.rules.map((condition) => condition.key).filter(isRecordFact)))];
}
