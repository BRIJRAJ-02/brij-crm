// Evaluating a checked formula (spec 0015, 0015-formulas.md): a fixed
// interpreter over the closed tree, with no access to anything but the
// record's own values. Exact decimals, empty values that flow through, and
// errors that give empty, never a throw. The same in the browser (the
// editor's preview) and on the server (the write and the jobs).
import { toCanonicalDecimal } from '../values/decimal.ts';
import { divide, fitsStored, formatDecimal, fromInteger, multiply, parseDecimal, roundTo, wholeOf } from './decimal.ts';
import type { FormulaResultType } from './check.ts';
import type { FormulaNode } from './parse.ts';

/** A value inside the evaluator. `undefined` is empty. */
type Value =
  | { readonly t: 'number'; readonly v: bigint }
  | { readonly t: 'currency'; readonly v: bigint; readonly code: string }
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'date'; readonly v: string }
  | { readonly t: 'timestamp'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean }
  | undefined;

/** One referenced attribute's input: its stored type and its value as the engine decodes it. */
export interface FormulaInput {
  readonly type: string;
  readonly value: unknown;
}

/** The longest text a formula may give; a longer one stores empty. */
export const FORMULA_TEXT_MAX = 500;

/** An evaluation error: the whole formula gives empty. */
const FAIL = Symbol('formula failed');
type Fail = typeof FAIL;

/** The one collator text comparisons use, in Node and in the browser (the root locale, accents count, case doesn't). */
const COLLATOR = new Intl.Collator('und', { sensitivity: 'accent' });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

/** A decimal from a stored number (a canonical string, or a rating as a number), or undefined. */
function decimalOf(value: unknown): bigint | undefined {
  if (typeof value === 'string') return parseDecimal(value);
  if (typeof value === 'number' && Number.isFinite(value)) return parseDecimal(String(value));
  return undefined;
}

/** How many characters a text holds, counting each code point once (an emoji is one). */
function characters(text: string): number {
  return Array.from(text).length;
}

/** A referenced attribute's decoded value as a formula value. */
function fromInput(input: FormulaInput | undefined, labels: ReadonlyMap<string, string>): Value {
  if (input === undefined) return undefined;
  const { type, value } = input;
  if (type === 'checkbox') return { t: 'bool', v: value === true };
  if (value === null || value === undefined) return undefined;
  switch (type) {
    case 'number':
    case 'rating': {
      const parsed = decimalOf(value);
      return parsed === undefined ? undefined : { t: 'number', v: parsed };
    }
    case 'currency': {
      if (!isRecord(value) || typeof value.currency !== 'string') return undefined;
      const parsed = decimalOf(value.amount);
      return parsed === undefined ? undefined : { t: 'currency', v: parsed, code: value.currency };
    }
    case 'date':
      return typeof value === 'string' ? { t: 'date', v: value } : undefined;
    case 'timestamp':
      return typeof value === 'string' ? { t: 'timestamp', v: value } : undefined;
    case 'select':
    case 'status': {
      const label = typeof value === 'string' ? labels.get(value) : undefined;
      return label === undefined ? undefined : { t: 'text', v: label };
    }
    case 'phone':
      return isRecord(value) && typeof value.number === 'string' ? { t: 'text', v: value.number } : undefined;
    case 'personal_name':
      return isRecord(value) && typeof value.fullName === 'string' ? { t: 'text', v: value.fullName } : undefined;
    default:
      return typeof value === 'string' ? { t: 'text', v: value } : undefined;
  }
}

/** A date as days since 1970-01-01, or undefined. */
function dayNumber(date: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return undefined;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? undefined : Math.round(time / 86_400_000);
}

/** Days since 1970-01-01 as a date, or a failure outside the years 1 to 9999. */
function dateOf(days: number): string | Fail {
  const date = new Date(days * 86_400_000);
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < 1 || year > 9999) return FAIL;
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** Any value as text (TEXT, `&`, CONCAT): empty is "", the converters' forms otherwise. */
function asText(value: Value): string {
  if (value === undefined) return '';
  switch (value.t) {
    case 'number':
      return formatDecimal(value.v);
    case 'currency':
      return `${value.code} ${formatDecimal(value.v)}`;
    case 'bool':
      return value.v ? 'Yes' : 'No';
    case 'timestamp':
      return new Date(value.v).toISOString();
    default:
      return value.v;
  }
}

/** Where a yes or no is needed, empty counts as no. */
const truthy = (value: Value): boolean => value?.t === 'bool' && value.v;

/** Orders two values of one type: negative, zero or positive; a failure for mixed currencies. */
function compare(a: NonNullable<Value>, b: NonNullable<Value>): number | Fail {
  if (a.t === 'currency' && b.t === 'currency') {
    if (a.code !== b.code) return FAIL;
    return a.v === b.v ? 0 : a.v < b.v ? -1 : 1;
  }
  if (a.t === 'number' && b.t === 'number') return a.v === b.v ? 0 : a.v < b.v ? -1 : 1;
  if (a.t === 'text' && b.t === 'text') return Math.sign(COLLATOR.compare(a.v, b.v));
  if (a.t === 'bool' && b.t === 'bool') return a.v === b.v ? 0 : a.v ? 1 : -1;
  if (a.t === 'date' && b.t === 'date') return a.v === b.v ? 0 : a.v < b.v ? -1 : 1;
  if (a.t === 'timestamp' && b.t === 'timestamp') {
    const left = new Date(a.v).getTime();
    const right = new Date(b.v).getTime();
    return left === right ? 0 : left < right ? -1 : 1;
  }
  return FAIL;
}

/** True when two values are equal for `=`: empty equals empty and "", nothing else. */
function equal(a: Value, b: Value): boolean | Fail {
  const blank = (value: Value) => value === undefined || (value.t === 'text' && value.v === '');
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  if (a === undefined || b === undefined) return false;
  const order = compare(a, b);
  return order === FAIL ? FAIL : order === 0;
}

const number = (v: bigint): Value => ({ t: 'number', v });

/**
 * Evaluates a checked tree over one record's values (`inputs`, by attribute
 * id, decoded as the engine reads them; `labels`, option id to label for the
 * referenced selects and statuses) and answers the stored value: a canonical
 * decimal string, a `{ amount, currency }`, text, a date, `true` for yes, or
 * null for empty (no, too). Dividing by zero, mixed currencies, a value past
 * 14 digits, a date outside the years 1 to 9999 or text over 500 characters
 * give null.
 */
export function evaluateFormula(
  ast: FormulaNode,
  inputs: ReadonlyMap<string, FormulaInput>,
  labels: ReadonlyMap<string, string>,
  resultType: FormulaResultType,
): unknown {
  const run = (node: FormulaNode): Value | Fail => {
    switch (node.k) {
      case 'number': {
        const parsed = parseDecimal(node.value);
        return parsed === undefined ? FAIL : number(parsed);
      }
      case 'text':
        return { t: 'text', v: node.value };
      case 'bool':
        return { t: 'bool', v: node.value };
      case 'ref':
        return node.id === undefined ? undefined : fromInput(inputs.get(node.id), labels);
      case 'negate': {
        const value = run(node.operand);
        if (value === FAIL || value === undefined) return value;
        if (value.t === 'number') return number(-value.v);
        if (value.t === 'currency') return { ...value, v: -value.v };
        return FAIL;
      }
      case 'binary':
        return binary(node.op, node.left, node.right);
      case 'call':
        return call(node.name, node.args);
    }
  };

  const binary = (
    op: Extract<FormulaNode, { k: 'binary' }>['op'],
    leftNode: FormulaNode,
    rightNode: FormulaNode,
  ): Value | Fail => {
    const a = run(leftNode);
    if (a === FAIL) return FAIL;
    const b = run(rightNode);
    if (b === FAIL) return FAIL;
    if (op === '&') return { t: 'text', v: asText(a) + asText(b) };
    if (op === '=' || op === '!=') {
      const same = equal(a, b);
      if (same === FAIL) return FAIL;
      return { t: 'bool', v: op === '=' ? same : !same };
    }
    if (a === undefined || b === undefined) return undefined;
    if (op === '<' || op === '<=' || op === '>' || op === '>=') {
      const order = compare(a, b);
      if (order === FAIL) return FAIL;
      const v = op === '<' ? order < 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : order >= 0;
      return { t: 'bool', v };
    }
    if (op === '+' || op === '-') {
      const sign = op === '+' ? 1n : -1n;
      if (a.t === 'number' && b.t === 'number') return number(a.v + sign * b.v);
      if (a.t === 'currency' && b.t === 'currency') {
        return a.code === b.code ? { ...a, v: a.v + sign * b.v } : FAIL;
      }
      if (a.t === 'date' && b.t === 'number') return shiftDate(a.v, sign * b.v);
      if (a.t === 'number' && b.t === 'date' && op === '+') return shiftDate(b.v, a.v);
      if (a.t === 'date' && b.t === 'date' && op === '-') {
        const end = dayNumber(a.v);
        const start = dayNumber(b.v);
        return end === undefined || start === undefined ? FAIL : number(fromInteger(end - start));
      }
      return FAIL;
    }
    if (op === '*') {
      if (a.t === 'number' && b.t === 'number') return number(multiply(a.v, b.v));
      if (a.t === 'currency' && b.t === 'number') return { ...a, v: multiply(a.v, b.v) };
      if (a.t === 'number' && b.t === 'currency') return { ...b, v: multiply(a.v, b.v) };
      return FAIL;
    }
    // Division.
    if (b.t !== 'number' && b.t !== 'currency') return FAIL;
    if (a.t === 'currency' && b.t === 'currency' && a.code !== b.code) return FAIL;
    if (a.t !== 'number' && a.t !== 'currency') return FAIL;
    const quotient = divide(a.v, b.v);
    if (quotient === undefined) return FAIL;
    if (a.t === 'currency' && b.t === 'number') return { ...a, v: quotient };
    if (a.t === 'number' && b.t === 'currency') return FAIL;
    return number(quotient);
  };

  const shiftDate = (date: string, days: bigint): Value | Fail => {
    const whole = wholeOf(days);
    const start = dayNumber(date);
    if (whole === undefined || start === undefined) return FAIL;
    const next = dateOf(start + whole);
    return next === FAIL ? FAIL : { t: 'date', v: next };
  };

  const call = (name: string, argNodes: readonly FormulaNode[]): Value | Fail => {
    // IF and COALESCE run only the arguments they need.
    if (name === 'IF') {
      const [condition, then, otherwise] = argNodes;
      const test = condition === undefined ? undefined : run(condition);
      if (test === FAIL) return FAIL;
      const chosen = truthy(test) ? then : otherwise;
      return chosen === undefined ? undefined : run(chosen);
    }
    if (name === 'COALESCE') {
      for (const node of argNodes) {
        const value = run(node);
        if (value === FAIL) return FAIL;
        if (value !== undefined) return value;
      }
      return undefined;
    }
    const args: Value[] = [];
    for (const node of argNodes) {
      const value = run(node);
      if (value === FAIL) return FAIL;
      args.push(value);
    }
    const [first, second] = args;
    switch (name) {
      case 'AND':
        return { t: 'bool', v: args.every(truthy) };
      case 'OR':
        return { t: 'bool', v: args.some(truthy) };
      case 'NOT':
        return { t: 'bool', v: !truthy(first) };
      case 'ISBLANK':
        return { t: 'bool', v: first === undefined || (first.t === 'text' && first.v === '') };
      case 'BLANK':
        return undefined;
      case 'ROUND': {
        if (first === undefined) return undefined;
        const digitsNode = argNodes[1];
        const digits = digitsNode?.k === 'number' ? Number(digitsNode.value) : 0;
        if (first.t === 'number') return number(roundTo(first.v, digits));
        if (first.t === 'currency') return { ...first, v: roundTo(first.v, digits) };
        return FAIL;
      }
      case 'ABS':
        if (first === undefined) return undefined;
        if (first.t === 'number' || first.t === 'currency') return { ...first, v: first.v < 0n ? -first.v : first.v };
        return FAIL;
      case 'MIN':
      case 'MAX': {
        const present = args.filter((value): value is NonNullable<Value> => value !== undefined);
        let best: NonNullable<Value> | undefined;
        for (const value of present) {
          if (best === undefined) {
            best = value;
            continue;
          }
          const order = compare(value, best);
          if (order === FAIL) return FAIL;
          if (name === 'MIN' ? order < 0 : order > 0) best = value;
        }
        return best;
      }
      case 'AMOUNT':
        return first?.t === 'currency' ? number(first.v) : undefined;
      case 'CURRENCY': {
        const code = argNodes[1]?.k === 'text' ? argNodes[1].value : undefined;
        if (first === undefined) return undefined;
        return first.t === 'number' && code !== undefined ? { t: 'currency', v: first.v, code } : FAIL;
      }
      case 'LEN':
        return first === undefined ? undefined : number(fromInteger(characters(asText(first))));
      case 'UPPER':
        return first === undefined ? undefined : { t: 'text', v: asText(first).toUpperCase() };
      case 'LOWER':
        return first === undefined ? undefined : { t: 'text', v: asText(first).toLowerCase() };
      case 'TRIM':
        return first === undefined ? undefined : { t: 'text', v: asText(first).trim() };
      case 'CONTAINS':
        return { t: 'bool', v: asText(first).toLowerCase().includes(asText(second).toLowerCase()) };
      case 'CONCAT':
      case 'TEXT':
        return { t: 'text', v: args.map(asText).join('') };
      case 'DATE':
        if (first?.t !== 'timestamp') return undefined;
        return { t: 'date', v: new Date(first.v).toISOString().slice(0, 10) };
      case 'DAYS': {
        if (first?.t !== 'date' || second?.t !== 'date') return undefined;
        const end = dayNumber(first.v);
        const start = dayNumber(second.v);
        return end === undefined || start === undefined ? FAIL : number(fromInteger(end - start));
      }
      case 'ADD_DAYS':
        if (first?.t !== 'date' || second?.t !== 'number') return undefined;
        return shiftDate(first.v, second.v);
      case 'YEAR':
      case 'MONTH':
      case 'DAY': {
        if (first?.t !== 'date') return undefined;
        const [year, month, day] = first.v.split('-').map(Number);
        const part = name === 'YEAR' ? year : name === 'MONTH' ? month : day;
        return part === undefined || Number.isNaN(part) ? FAIL : number(fromInteger(part));
      }
      default:
        return FAIL;
    }
  };

  const result = run(ast);
  return stored(result, resultType);
}

/** The evaluator's answer as the stored value of the result type, or null. */
function stored(result: Value | Fail, resultType: FormulaResultType): unknown {
  if (result === FAIL || result === undefined) return null;
  switch (resultType) {
    case 'bool':
      return result.t === 'bool' && result.v ? true : null;
    case 'number': {
      if (result.t !== 'number') return null;
      const rounded = roundTo(result.v, 4);
      return fitsStored(rounded) ? (toCanonicalDecimal(formatDecimal(rounded)) ?? null) : null;
    }
    case 'currency': {
      if (result.t !== 'currency') return null;
      const rounded = roundTo(result.v, 4);
      if (!fitsStored(rounded)) return null;
      const amount = toCanonicalDecimal(formatDecimal(rounded));
      return amount === undefined ? null : { amount, currency: result.code };
    }
    case 'text': {
      const text = asText(result);
      return text === '' || characters(text) > FORMULA_TEXT_MAX ? null : text;
    }
    case 'date':
      return result.t === 'date' ? result.v : null;
  }
}
