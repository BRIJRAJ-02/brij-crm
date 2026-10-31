// The formula language's syntax (spec 0015, 0015-formulas.md): tokens, then a
// closed tree of known nodes, or the first error with its position (a
// character index from 0). Plain TypeScript, so the editor and the server
// parse the same way. Nothing here runs anything: a tree is only data.

/** A binary operator, loosest binding first in the grammar. */
export type FormulaOperator = '=' | '!=' | '<' | '<=' | '>' | '>=' | '&' | '+' | '-' | '*' | '/';

/** One node of a parsed formula. `at` is where it starts in the source. */
export type FormulaNode =
  | { readonly k: 'number'; readonly value: string; readonly at: number }
  | { readonly k: 'text'; readonly value: string; readonly at: number }
  | { readonly k: 'bool'; readonly value: boolean; readonly at: number }
  /** `{{api_slug}}`; `id` is filled in by `checkFormula`, so evaluation never looks a slug up. */
  | { readonly k: 'ref'; readonly slug: string; readonly id?: string; readonly at: number }
  | { readonly k: 'call'; readonly name: string; readonly args: readonly FormulaNode[]; readonly at: number }
  | {
      readonly k: 'binary';
      readonly op: FormulaOperator;
      readonly left: FormulaNode;
      readonly right: FormulaNode;
      readonly at: number;
    }
  | { readonly k: 'negate'; readonly operand: FormulaNode; readonly at: number };

/** A refusal with where it happened, counted from 0. */
export interface FormulaError {
  readonly message: string;
  readonly position: number;
}

/** What parsing gives: the tree, or the first error. */
export type ParseResult =
  { readonly ok: true; readonly ast: FormulaNode } | { readonly ok: false; readonly error: FormulaError };

/** The formula limits (spec 0015, AC-331), each with the sentence its refusal says. */
export const FORMULA_LIMITS = {
  source: 2_000,
  nodes: 200,
  references: 20,
  depth: 20,
} as const;

/** The refusal sentences of the limits. */
export const FORMULA_LIMIT_MESSAGES = {
  source: 'Keep a formula to 2,000 characters.',
  nodes: 'This formula is too long. Split it into two formula attributes.',
  references: 'A formula can use at most 20 attributes.',
  depth: 'This formula nests too deeply.',
} as const;

type Token =
  | { readonly t: 'number'; readonly value: string; readonly at: number }
  | { readonly t: 'text'; readonly value: string; readonly at: number }
  | { readonly t: 'ref'; readonly value: string; readonly at: number }
  | { readonly t: 'name'; readonly value: string; readonly at: number }
  | { readonly t: 'op'; readonly value: string; readonly at: number }
  | { readonly t: 'end'; readonly at: number };

/** Thrown inside the parser only, and turned into a `FormulaError` at its edge. */
type Stop = Error & { readonly stop: FormulaError };

const stop = (message: string, position: number): Stop =>
  Object.assign(new Error(message), { stop: { message, position } });
const isStop = (value: unknown): value is Stop => value instanceof Error && 'stop' in value;

const SLUG = /^[a-z][a-z0-9_]*$/;
const OPERATORS = ['<=', '>=', '!=', '=', '<', '>', '&', '+', '-', '*', '/', '(', ')', ','] as const;

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/\d/.test(char)) {
      const match = /^\d+(?:\.\d+)?/.exec(source.slice(i));
      const value = match?.[0] ?? char;
      tokens.push({ t: 'number', value, at: i });
      i += value.length;
      if (/[.\w]/.test(source.charAt(i))) throw stop('That number is not written right.', i);
      continue;
    }
    if (char === '"') {
      let value = '';
      let j = i + 1;
      for (;;) {
        const next = source.charAt(j);
        if (j >= source.length) throw stop('This text has no closing quote.', i);
        if (next === '\\') {
          const escaped = source.charAt(j + 1);
          if (escaped !== '"' && escaped !== '\\') throw stop('Only \\" and \\\\ can follow a backslash.', j);
          value += escaped;
          j += 2;
          continue;
        }
        if (next === '"') break;
        value += next;
        j += 1;
      }
      tokens.push({ t: 'text', value, at: i });
      i = j + 1;
      continue;
    }
    if (source.startsWith('{{', i)) {
      const close = source.indexOf('}}', i + 2);
      if (close === -1) throw stop('This attribute has no closing }}.', i);
      const slug = source.slice(i + 2, close).trim();
      if (!SLUG.test(slug)) throw stop('Write an attribute as {{api_name}}.', i);
      tokens.push({ t: 'ref', value: slug, at: i });
      i = close + 2;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      const value = match?.[0] ?? char;
      tokens.push({ t: 'name', value, at: i });
      i += value.length;
      continue;
    }
    const operator = OPERATORS.find((op) => source.startsWith(op, i));
    if (operator === undefined) throw stop(`${char} can't be used here.`, i);
    tokens.push({ t: 'op', value: operator, at: i });
    i += operator.length;
  }
  tokens.push({ t: 'end', at: source.length });
  return tokens;
}

const COMPARISONS = new Set(['=', '!=', '<', '<=', '>', '>=']);

/**
 * Parses a formula's source into its tree, or answers the first error with its
 * position. Refuses a source over 2,000 characters, more than 200 nodes and
 * nesting more than 20 deep (`FORMULA_LIMITS`).
 */
export function parseFormula(source: string): ParseResult {
  if (source.length > FORMULA_LIMITS.source) {
    return { ok: false, error: { message: FORMULA_LIMIT_MESSAGES.source, position: FORMULA_LIMITS.source } };
  }
  try {
    const tokens = tokenize(source);
    let index = 0;
    let nodes = 0;
    const peek = (): Token => tokens[index] ?? { t: 'end', at: source.length };
    const take = (): Token => {
      const token = peek();
      index += 1;
      return token;
    };
    const isOp = (token: Token, value: string) => token.t === 'op' && token.value === value;
    const count = (at: number, depth: number) => {
      nodes += 1;
      if (nodes > FORMULA_LIMITS.nodes) throw stop(FORMULA_LIMIT_MESSAGES.nodes, at);
      if (depth > FORMULA_LIMITS.depth) throw stop(FORMULA_LIMIT_MESSAGES.depth, at);
    };

    const comparison = (depth: number): FormulaNode => {
      const left = join(depth);
      const token = peek();
      if (token.t !== 'op' || !COMPARISONS.has(token.value)) return left;
      take();
      const right = join(depth);
      const after = peek();
      if (after.t === 'op' && COMPARISONS.has(after.value)) {
        throw stop('Compare two values at a time. Use AND() to join comparisons.', after.at);
      }
      count(token.at, depth);
      return { k: 'binary', op: token.value as FormulaOperator, left, right, at: token.at };
    };
    const join = (depth: number): FormulaNode => {
      let left = additive(depth);
      while (isOp(peek(), '&')) {
        const token = take();
        count(token.at, depth);
        left = { k: 'binary', op: '&', left, right: additive(depth), at: token.at };
      }
      return left;
    };
    const additive = (depth: number): FormulaNode => {
      let left = multiplicative(depth);
      while (isOp(peek(), '+') || isOp(peek(), '-')) {
        const token = take();
        count(token.at, depth);
        const op = token.t === 'op' && token.value === '+' ? '+' : '-';
        left = { k: 'binary', op, left, right: multiplicative(depth), at: token.at };
      }
      return left;
    };
    const multiplicative = (depth: number): FormulaNode => {
      let left = unary(depth);
      while (isOp(peek(), '*') || isOp(peek(), '/')) {
        const token = take();
        count(token.at, depth);
        const op = token.t === 'op' && token.value === '*' ? '*' : '/';
        left = { k: 'binary', op, left, right: unary(depth), at: token.at };
      }
      return left;
    };
    const unary = (depth: number): FormulaNode => {
      const token = peek();
      if (isOp(token, '-')) {
        take();
        count(token.at, depth + 1);
        return { k: 'negate', operand: unary(depth + 1), at: token.at };
      }
      return primary(depth);
    };
    const primary = (depth: number): FormulaNode => {
      const token = take();
      count(token.at, depth);
      switch (token.t) {
        case 'number':
          return { k: 'number', value: token.value, at: token.at };
        case 'text':
          return { k: 'text', value: token.value, at: token.at };
        case 'ref':
          return { k: 'ref', slug: token.value, at: token.at };
        case 'name': {
          const upper = token.value.toUpperCase();
          if (upper === 'TRUE' || upper === 'FALSE') {
            if (isOp(peek(), '(')) throw stop(`${upper} is a value, not a function.`, token.at);
            return { k: 'bool', value: upper === 'TRUE', at: token.at };
          }
          if (!isOp(peek(), '(')) throw stop(`Add ( after ${upper}, or write text in quotes.`, token.at);
          take();
          const args: FormulaNode[] = [];
          if (!isOp(peek(), ')')) {
            for (;;) {
              args.push(comparison(depth + 1));
              if (isOp(peek(), ',')) {
                take();
                continue;
              }
              break;
            }
          }
          const close = take();
          if (!isOp(close, ')')) throw stop(`Close ${upper}( with ).`, close.at);
          return { k: 'call', name: upper, args, at: token.at };
        }
        case 'op':
          if (token.value === '(') {
            const inner = comparison(depth + 1);
            const close = take();
            if (!isOp(close, ')')) throw stop('Close the bracket with ).', close.at);
            return inner;
          }
          throw stop(`${token.value} can't start a value here.`, token.at);
        case 'end':
          throw stop(source.trim() === '' ? 'Write a formula.' : 'The formula ends too soon.', token.at);
      }
    };

    const ast = comparison(0);
    const rest = peek();
    if (rest.t !== 'end') throw stop("Something's missing before this. Join values with an operator.", rest.at);
    return { ok: true, ast };
  } catch (error) {
    if (isStop(error)) return { ok: false, error: error.stop };
    throw error;
  }
}

/** Every attribute API name a tree references, in source order, each once. */
export function referencedSlugs(ast: FormulaNode): readonly string[] {
  const slugs: string[] = [];
  const walk = (node: FormulaNode): void => {
    if (node.k === 'ref') {
      if (!slugs.includes(node.slug)) slugs.push(node.slug);
    } else if (node.k === 'call') node.args.forEach(walk);
    else if (node.k === 'binary') {
      walk(node.left);
      walk(node.right);
    } else if (node.k === 'negate') walk(node.operand);
  };
  walk(ast);
  return slugs;
}

/** How a formula error reads to a person: its sentence with the character counted from 1. */
export function formulaErrorText(error: FormulaError): string {
  return `${error.message.replace(/\.$/, '')} at character ${String(error.position + 1)}.`;
}
