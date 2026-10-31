// Checking a parsed formula against an object's attributes (spec 0015,
// 0015-formulas.md): each reference resolved to its attribute (so the stored
// tree holds ids, never slugs), every node's type worked out, and the result
// type, or the first error with its position. Pure, so the editor checks on
// every keystroke exactly as the server does at create and update.
import { CURRENCY_CODES } from '../values/currencies.ts';
import { FUNCTION_NAMES, typeWords, type FormulaType } from './functions.ts';
import {
  FORMULA_LIMIT_MESSAGES,
  FORMULA_LIMITS,
  parseFormula,
  type FormulaError,
  type FormulaNode,
  type FormulaOperator,
} from './parse.ts';

/** An attribute as a formula sees it: enough to resolve `{{api_slug}}` and give it a type. */
export interface FormulaAttribute {
  readonly id: string;
  readonly apiSlug: string;
  readonly title: string;
  /** Its stored type (a computed attribute's result type). */
  readonly type: string;
  readonly isMulti: boolean;
  readonly isArchived: boolean;
  /** A currency attribute's default code: a currency result takes the first one referenced. */
  readonly defaultCurrency?: string;
}

/** The types a formula may give, and how each is stored. */
export const FORMULA_RESULT_TYPES = {
  number: 'number',
  currency: 'currency',
  text: 'text',
  date: 'date',
  bool: 'checkbox',
} as const;

/** A type a formula may give. */
export type FormulaResultType = keyof typeof FORMULA_RESULT_TYPES;

/** A tree whose references carry their attribute's id, formula type and stored type. */
export type ResolvedNode = FormulaNode;

/** What checking gives: the result type and the resolved tree, or the first error. */
export type CheckResult =
  | {
      readonly ok: true;
      readonly type: FormulaResultType;
      readonly ast: ResolvedNode;
      /** The referenced attributes' ids, in source order, each once. */
      readonly references: readonly string[];
      /** Referenced single selects and statuses: renaming one of their options refills the formula. */
      readonly optionReferences: readonly string[];
      /** A currency result's code (spec 0015's currency rule). */
      readonly currency?: string;
    }
  | { readonly ok: false; readonly error: FormulaError };

const TYPE_NAMES: Readonly<Record<string, string>> = {
  actor_reference: 'Member',
  location: 'Location',
  file: 'File',
  interaction: 'Interaction',
  record_reference: 'Relationship',
};

/** The formula type of a stored attribute type, or why a formula can't use it. */
export function formulaTypeOf(attribute: Pick<FormulaAttribute, 'type' | 'isMulti'>): string {
  if (attribute.isMulti) return "Formulas can't use attributes that hold several values yet.";
  switch (attribute.type) {
    case 'number':
    case 'rating':
      return 'number';
    case 'currency':
      return 'currency';
    case 'text':
    case 'long_text':
    case 'email':
    case 'url':
    case 'domain':
    case 'phone':
    case 'personal_name':
    case 'select':
    case 'status':
      return 'text';
    case 'date':
      return 'date';
    case 'timestamp':
      return 'timestamp';
    case 'checkbox':
      return 'bool';
    default:
      return `Formulas can't use ${TYPE_NAMES[attribute.type] ?? attribute.type} attributes yet.`;
  }
}

const isFormulaType = (value: string): value is FormulaType =>
  ['number', 'currency', 'text', 'date', 'timestamp', 'bool', 'empty'].includes(value);

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

type Stop = Error & { readonly stop: FormulaError };
const stop = (message: string, position: number): Stop =>
  Object.assign(new Error(message), { stop: { message, position } });
const isStop = (value: unknown): value is Stop => value instanceof Error && 'stop' in value;

const VERBS: Readonly<Record<FormulaOperator, string>> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
  '&': 'join',
  '=': 'compare',
  '!=': 'compare',
  '<': 'compare',
  '<=': 'compare',
  '>': 'compare',
  '>=': 'compare',
};

/** The type two operands share, empty taking the other's; undefined when they differ. */
function common(a: FormulaType, b: FormulaType): FormulaType | undefined {
  if (a === 'empty') return b;
  if (b === 'empty') return a;
  return a === b ? a : undefined;
}

/** A node's type with its tree resolved. */
interface Typed {
  readonly type: FormulaType;
  readonly node: FormulaNode;
}

/**
 * Checks a parsed tree against the object's attributes (by API name): every
 * reference must be a live attribute a formula can use, every operator and
 * function must get types it takes, at most 20 attributes are referenced,
 * and the whole gives a number, currency, text, date or yes or no.
 */
export function checkFormula(ast: FormulaNode, attributesBySlug: ReadonlyMap<string, FormulaAttribute>): CheckResult {
  const references: string[] = [];
  const optionReferences: string[] = [];
  let firstCurrencyAttribute: string | undefined;
  let firstCurrencyLiteral: string | undefined;

  const visit = (node: FormulaNode): Typed => {
    switch (node.k) {
      case 'number':
        return { type: 'number', node };
      case 'text':
        return { type: 'text', node };
      case 'bool':
        return { type: 'bool', node };
      case 'ref': {
        const attribute = attributesBySlug.get(node.slug);
        if (attribute === undefined) throw stop(`Unknown attribute {{${node.slug}}}.`, node.at);
        if (attribute.isArchived) throw stop(`{{${node.slug}}} is archived.`, node.at);
        const type = formulaTypeOf(attribute);
        if (!isFormulaType(type)) throw stop(type, node.at);
        if (!references.includes(attribute.id)) {
          references.push(attribute.id);
          if (references.length > FORMULA_LIMITS.references) throw stop(FORMULA_LIMIT_MESSAGES.references, node.at);
        }
        if ((attribute.type === 'select' || attribute.type === 'status') && !optionReferences.includes(attribute.id)) {
          optionReferences.push(attribute.id);
        }
        if (attribute.type === 'currency' && firstCurrencyAttribute === undefined) {
          firstCurrencyAttribute = attribute.defaultCurrency;
        }
        return { type, node: { ...node, id: attribute.id } };
      }
      case 'negate': {
        const operand = visit(node.operand);
        if (!['number', 'currency', 'empty'].includes(operand.type)) {
          throw stop(`Can't negate ${typeWords(operand.type)}.`, node.at);
        }
        return { type: operand.type, node: { ...node, operand: operand.node } };
      }
      case 'binary': {
        const left = visit(node.left);
        const right = visit(node.right);
        const resolved = { ...node, left: left.node, right: right.node };
        return { type: binaryType(node.op, left.type, right.type, node.at), node: resolved };
      }
      case 'call':
        return callType(node);
    }
  };

  const binaryType = (op: FormulaOperator, a: FormulaType, b: FormulaType, at: number): FormulaType => {
    const refuse = () => stop(`Can't ${VERBS[op]} ${typeWords(a)} and ${typeWords(b)}.`, at);
    if (op === '&') return 'text';
    if (op === '=' || op === '!=') {
      if (common(a, b) === undefined) throw refuse();
      return 'bool';
    }
    if (op === '<' || op === '<=' || op === '>' || op === '>=') {
      const shared = common(a, b);
      if (shared === undefined || shared === 'bool') throw refuse();
      return 'bool';
    }
    if (a === 'empty' && b === 'empty') return 'empty';
    if (op === '+' || op === '-') {
      const shared = common(a, b);
      if (shared === 'number' || shared === 'currency') return shared;
      if (a === 'date' && (b === 'number' || b === 'empty')) return 'date';
      if (op === '+' && b === 'date' && a === 'number') return 'date';
      if (op === '-' && shared === 'date') return 'number';
      throw refuse();
    }
    if (op === '*') {
      const shared = common(a, b);
      if (shared === 'number') return 'number';
      if ((a === 'currency' && (b === 'number' || b === 'empty')) || (b === 'currency' && a === 'number')) {
        return 'currency';
      }
      if (shared === 'currency' && (a === 'empty' || b === 'empty')) return 'currency';
      throw refuse();
    }
    // Division.
    if (common(a, b) === 'number') return 'number';
    if (a === 'currency' && (b === 'number' || b === 'empty')) return 'currency';
    if (a === 'currency' && b === 'currency') return 'number';
    if (a === 'empty' && b === 'currency') return 'number';
    throw refuse();
  };

  const callType = (node: Extract<FormulaNode, { k: 'call' }>): Typed => {
    const { name, at } = node;
    if (!FUNCTION_NAMES.has(name)) throw stop(`Unknown function ${name}.`, at);
    const args = node.args.map(visit);
    const resolved = { ...node, args: args.map((arg) => arg.node) };
    const count = (min: number, max = min) => {
      if (args.length < min || args.length > max) {
        const words = min === max ? String(min) : `${String(min)} to ${String(max)}`;
        throw stop(`${name} takes ${words} argument${min === max && min === 1 ? '' : 's'}.`, at);
      }
    };
    const want = (index: number, allowed: readonly FormulaType[]): FormulaType => {
      const arg = args[index];
      if (arg === undefined) return 'empty';
      if (arg.type === 'empty' || allowed.includes(arg.type)) return arg.type;
      const first = allowed[0] ?? 'empty';
      throw stop(
        `${name} needs ${typeWords(first)} as its ${ORDINALS[index] ?? 'next'} argument, not ${typeWords(arg.type)}.`,
        arg.node.at,
      );
    };
    const typed = (type: FormulaType): Typed => ({ type, node: resolved });
    const allSame = (from: number): FormulaType => {
      let shared: FormulaType = 'empty';
      args.slice(from).forEach((arg) => {
        const next = common(shared, arg.type);
        if (next === undefined) {
          throw stop(`${name} needs every value to be ${typeWords(shared)}, not ${typeWords(arg.type)}.`, arg.node.at);
        }
        shared = next;
      });
      return shared;
    };
    switch (name) {
      case 'IF': {
        count(2, 3);
        want(0, ['bool']);
        return typed(allSame(1));
      }
      case 'AND':
      case 'OR':
        count(1, 10);
        args.forEach((_, index) => want(index, ['bool']));
        return typed('bool');
      case 'NOT':
        count(1);
        want(0, ['bool']);
        return typed('bool');
      case 'ISBLANK':
        count(1);
        return typed('bool');
      case 'BLANK':
        count(0);
        return typed('empty');
      case 'COALESCE':
        count(2, 10);
        return typed(allSame(0));
      case 'ROUND': {
        count(1, 2);
        const type = want(0, ['number', 'currency']);
        const digits = node.args[1];
        if (digits !== undefined && (digits.k !== 'number' || !/^[0-4]$/.test(digits.value))) {
          throw stop('ROUND takes a whole number from 0 to 4 as its second argument.', digits.at);
        }
        return typed(type);
      }
      case 'ABS':
        count(1);
        return typed(want(0, ['number', 'currency']));
      case 'MIN':
      case 'MAX': {
        count(1, 10);
        const shared = allSame(0);
        if (shared !== 'number' && shared !== 'date' && shared !== 'empty') {
          throw stop(`${name} takes numbers or dates.`, at);
        }
        return typed(shared);
      }
      case 'AMOUNT':
        count(1);
        want(0, ['currency']);
        return typed('number');
      case 'CURRENCY': {
        count(2);
        want(0, ['number']);
        const code = node.args[1];
        if (code?.k !== 'text' || !(CURRENCY_CODES as readonly string[]).includes(code.value)) {
          throw stop('CURRENCY needs a currency code in quotes, like "USD", as its second argument.', code?.at ?? at);
        }
        firstCurrencyLiteral = firstCurrencyLiteral ?? code.value;
        return typed('currency');
      }
      case 'LEN':
        count(1);
        want(0, ['text']);
        return typed('number');
      case 'UPPER':
      case 'LOWER':
      case 'TRIM':
        count(1);
        want(0, ['text']);
        return typed('text');
      case 'CONTAINS':
        count(2);
        want(0, ['text']);
        want(1, ['text']);
        return typed('bool');
      case 'CONCAT':
        count(1, 10);
        return typed('text');
      case 'TEXT':
        count(1);
        return typed('text');
      case 'DATE':
        count(1);
        want(0, ['timestamp']);
        return typed('date');
      case 'DAYS':
        count(2);
        want(0, ['date']);
        want(1, ['date']);
        return typed('number');
      case 'ADD_DAYS':
        count(2);
        want(0, ['date']);
        want(1, ['number']);
        return typed('date');
      case 'YEAR':
      case 'MONTH':
      case 'DAY':
        count(1);
        want(0, ['date']);
        return typed('number');
      default:
        throw stop(`Unknown function ${name}.`, at);
    }
  };

  try {
    const result = visit(ast);
    if (result.type === 'timestamp') throw stop("A formula can't give a date and time yet. Use DATE().", ast.at);
    if (result.type === 'empty') throw stop('A formula must give a value.', ast.at);
    const currency = result.type === 'currency' ? (firstCurrencyAttribute ?? firstCurrencyLiteral) : undefined;
    if (result.type === 'currency' && currency === undefined) {
      throw stop('Give the result a currency with CURRENCY().', ast.at);
    }
    return {
      ok: true,
      type: result.type,
      ast: result.node,
      references,
      optionReferences,
      ...(currency === undefined ? {} : { currency }),
    };
  } catch (error) {
    if (isStop(error)) return { ok: false, error: error.stop };
    throw error;
  }
}

/** Parses then checks a formula's source in one step: what the editor and the server both run. */
export function checkFormulaSource(
  source: string,
  attributesBySlug: ReadonlyMap<string, FormulaAttribute>,
): CheckResult {
  const parsed = parseFormula(source);
  if (!parsed.ok) return parsed;
  return checkFormula(parsed.ast, attributesBySlug);
}

/** "Gives a number": what the editor's check line says for a valid formula. */
export function resultWords(type: FormulaResultType): string {
  return `Gives ${typeWords(type)}`;
}
