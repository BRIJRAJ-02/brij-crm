// `@crm/contracts/formula`: the formula language of computed attributes (spec
// 0015, 0015-formulas.md), plain TypeScript with no Zod, so the FormulaEditor
// in the browser and the engine on the server parse, check and evaluate the
// same way.
export {
  FORMULA_LIMIT_MESSAGES,
  FORMULA_LIMITS,
  formulaErrorText,
  parseFormula,
  referencedSlugs,
  type FormulaError,
  type FormulaNode,
  type FormulaOperator,
  type ParseResult,
} from './parse.ts';
export {
  checkFormula,
  checkFormulaSource,
  FORMULA_RESULT_TYPES,
  formulaTypeOf,
  resultWords,
  type CheckResult,
  type FormulaAttribute,
  type FormulaResultType,
} from './check.ts';
export { evaluateFormula, FORMULA_TEXT_MAX, type FormulaInput } from './evaluate.ts';
export { FUNCTIONS, FUNCTION_NAMES, typeWords, type FormulaFunction, type FormulaType } from './functions.ts';
