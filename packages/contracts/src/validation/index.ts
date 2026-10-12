// `@crm/contracts/validation`: the rule checker, its condition evaluator and
// its messages (spec 0013), as plain TypeScript with no Zod and no I/O, so
// the browser's records layer runs the very function the engine runs. The
// schemas for rules and their settings check live in `@crm/contracts/values`.
export {
  checkRules,
  ruleInputs,
  touchesRule,
  type CheckRulesInput,
  type PatternCompiler,
  type PatternTest,
  type RuleAttribute,
  type RuleFailure,
  type ValidationRule,
} from './check.ts';
export { addDays, formatDay, todayOf, type RuleClock } from './clock.ts';
export {
  conditionAttributeIds,
  itemsOf,
  matchesCondition,
  type ConditionActor,
  type ConditionAttributeShape,
  type ConditionInput,
} from './condition.ts';
export { compareDecimal } from './decimal.ts';
export { PATTERN_PRESETS, RULE_KINDS, RULE_LIMITS, ruleKindFits, ruleKindsFor, type RuleKindName } from './kinds.ts';
export {
  generatedMessage,
  HIDDEN_CONDITION,
  HIDDEN_FAILURE,
  kindMessage,
  listWords,
  MANY_CONDITIONS,
  OPERATOR_PHRASES,
  summarizeCondition,
  type NamedAttribute,
} from './messages.ts';
export { patternSourceOf } from './pattern-source.ts';
